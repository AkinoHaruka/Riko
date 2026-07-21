/**
 * 聊天补全路由模块
 *
 * 职责：处理 AI 聊天补全请求（流式 SSE 和非流式），以及可用模型列表查询。
 * 所有端点需要认证（由全局 authMiddleware 统一处理）。
 *
 * 端点概览：
 *   POST /chat/completions  — 聊天补全（支持流式 SSE 和非流式）
 *   GET  /models            — 获取可用模型列表
 */
import type { FastifyInstance } from 'fastify';
import {
  chatCompletionStream,
  chatCompletionNonStream,
  listModels,
} from '../../domain/chat/service.js';
import type { ChatCompletionRequest } from '../../domain/chat/types.js';
import { getCurrentUser } from '../../core/middleware/index.js';
import { chatCompletionSchema, errorResponse } from '../../core/validation/schemas.js';

/** 将错误信息格式化为 SSE data 事件，供前端流式解析 */
function formatSseError(code: string, message: string): string {
  return `data: ${JSON.stringify({ type: 'error', code, content: message })}\n\n`;
}

export function registerChatRoutes(app: FastifyInstance): void {
  /**
   * POST /chat/completions
   * 聊天补全核心端点，支持流式(SSE)和非流式两种模式。
   *
   * 限流：每分钟最多 20 次
   *
   * 请求体：
   *   - messages: Array<{ role: string, content: string }> — 对话消息列表（必填）
   *   - model: string — 模型名称（必填）
   *   - stream: boolean — 是否流式响应，默认 true
   *   - temperature, max_tokens, top_p 等可选模型参数
   *   - conversation_id: string — 关联的会话 ID（可选）
   *   - system_prompt: string — 自定义系统提示词（可选）
   *   - thinking, reasoning_effort, response_format, stop 等高级参数
   *
   * 流式响应：Content-Type: text/event-stream，逐块发送 SSE 事件
   * 非流式响应：直接返回完整补全结果 JSON
   *
   * @security 通过 getCurrentUser 提取 userId，确保请求关联到已认证用户
   */
  app.post<{ Body: ChatCompletionRequest }>(
    '/chat/completions',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['messages', 'model'],
          properties: {
            messages: {
              type: 'array',
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string' },
                  content: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                  tool_calls: { type: 'array', items: {} },
                  tool_call_id: { type: 'string' },
                  name: { type: 'string' },
                },
              },
            },
            model: { type: 'string' },
            temperature: { type: 'number', minimum: 0, maximum: 2 },
            max_tokens: { type: 'integer', minimum: 1 },
            top_p: { type: 'number', minimum: 0, maximum: 1 },
            stream: { type: 'boolean', default: true },
            thinking: { type: 'object' },
            reasoning_effort: { type: 'string', enum: ['low', 'medium', 'high', 'max'] },
            response_format: { type: 'object' },
            stop: { type: 'array', items: { type: 'string' } },
            system_prompt: { type: 'string' },
            conversation_id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = getCurrentUser(request).userId;
      const parsed = chatCompletionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(
            errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'),
          );
      }
      const body = parsed.data as ChatCompletionRequest;

      if (body.stream !== false) {
        // 流式模式：手动写入 SSE 响应头，绕过 Fastify 的响应缓冲
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          // @security X-Accel-Buffering: no 禁止 Nginx 等反向代理缓冲 SSE 流
          'X-Accel-Buffering': 'no',
        });

        // 客户端断开检测：用户关闭页面/取消请求时，Node 触发 request 'close' 事件。
        // 不监听此事件会导致：后端继续从上游 AI 拉流、继续执行工具、继续消耗 API token，
        // 而响应已无人接收——纯粹的资源浪费。检测到断开后 break 循环，让生成器 finally 块清理。
        let clientDisconnected = false;
        const onClientClose = () => {
          clientDisconnected = true;
        };
        request.raw.on('close', onClientClose);

        try {
          for await (const chunk of chatCompletionStream(body, userId)) {
            if (clientDisconnected) {
              // 客户端已断开：停止消费生成器，触发其 return()，终止后续工具调用与 API 拉流
              request.log.info('[Chat] 客户端断开，终止 SSE 流');
              break;
            }
            // 写入失败（如对端重置）同样视为断开
            if (!reply.raw.write(chunk)) {
              // 返回 false 表示缓冲区已满（背压），等待 drain 再继续，避免内存暴涨
              await new Promise<void>((resolve) => reply.raw.once('drain', () => resolve()));
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // 客户端已断开时不再尝试写入错误事件（socket 不可用，写入会抛错）
          if (!clientDisconnected) {
            // 流式传输中途异常时，通过 SSE error 事件通知前端，而非直接断开连接
            reply.raw.write(formatSseError('STREAM_ERROR', message));
          }
        } finally {
          request.raw.off('close', onClientClose);
          reply.raw.end();
        }
        return;
      }

      // 非流式模式：等待完整响应后一次性返回
      const result = await chatCompletionNonStream(body, userId);
      return reply.send(result);
    },
  );

  /**
   * GET /models
   * 获取当前用户可用的 AI 模型列表。
   *
   * 响应：{ models: Array<ModelInfo> }
   */
  app.get('/models', async (request, reply) => {
    const userId = getCurrentUser(request).userId;
    const models = await listModels(userId);
    return reply.send({ models });
  });
}
