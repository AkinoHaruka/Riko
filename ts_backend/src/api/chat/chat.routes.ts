// 聊天补全 API：处理流式(SSE)和非流式聊天请求，以及模型列表查询
import type { FastifyInstance } from 'fastify';
import {
  chatCompletionStream,
  chatCompletionNonStream,
  listModels,
} from '../../domain/chat/service.js';
import type { ChatCompletionRequest } from '../../domain/chat/types.js';
import { getCurrentUser } from '../../core/middleware/index.js';
import { chatCompletionSchema, errorResponse } from '../../core/validation/schemas.js';

function formatSseError(message: string): string {
  return `data: ${JSON.stringify({ type: 'error', content: message })}\n\n`;
}

export function registerChatRoutes(app: FastifyInstance): void {
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
                  content: { type: 'string' },
                },
              },
            },
            model: { type: 'string' },
            temperature: { type: 'number', minimum: 0, maximum: 2 },
            max_tokens: { type: 'integer', minimum: 1 },
            top_p: { type: 'number', minimum: 0, maximum: 1 },
            stream: { type: 'boolean', default: true },
            thinking: { type: 'object' },
            reasoning_effort: { type: 'string' },
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
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        try {
          for await (const chunk of chatCompletionStream(body, userId)) {
            reply.raw.write(chunk);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          reply.raw.write(formatSseError(`流式响应异常: ${message}`));
        } finally {
          reply.raw.end();
        }
        return;
      }

      const result = await chatCompletionNonStream(body, userId);
      return reply.send(result);
    },
  );

  app.get('/models', async (request, reply) => {
    const userId = getCurrentUser(request).userId;
    const models = await listModels(userId);
    return reply.send({ models });
  });
}
