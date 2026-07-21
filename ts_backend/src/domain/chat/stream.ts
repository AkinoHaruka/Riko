/**
 * SSE 流式响应编排器。
 * 负责连接管理、等待提示、请求日志，以及后采样钩子编排。
 * 多轮工具调用循环委托给 toolCallLoop.ts 的 streamingToolCallLoop。
 *
 * 多 Provider 支持：根据 model ID 自动路由到对应的 Transport，
 * 非 OpenAI 兼容 Provider 使用 Transport 的归一化流式接口。
 */
import { APIError, default as OpenAI } from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions/completions.js';
import { getOrCreateClient, getTransportForModel, resolveProvider } from '../../core/ai/client.js';
import type { ProviderTransport } from '../../core/ai/providers/index.js';
import { mapApiError } from '../../core/ai/errors.js';
import { createLogger } from '../../core/logger/index.js';
import {
  SSE_EVENT_CONNECTED,
  SSE_EVENT_ERROR,
  SSE_EVENT_FULL_REQUEST,
  SSE_EVENT_WAITING,
} from './types.js';
import { formatSseEvent, streamingToolCallLoop, streamingToolCallLoopTransport } from './toolCallLoop.js';
import { runPostSamplingHooks } from './postSampling.js';

const logger = createLogger('Stream');

// 重新导出 formatSseEvent 供外部使用（保持向后兼容）
export { formatSseEvent } from './toolCallLoop.js';

/**
 * 流式聊天响应主生成器。
 * 处理完整的流式生命周期：连接 → 等待提示 → 多轮工具调用循环 → 后采样钩子。
 * @param params - API 请求参数
 * @param userId - 用户 ID，用于获取该用户的 API 客户端
 * @param conversationId - 会话 ID，为空时跳过工具调用和后采样钩子
 * @param modelId - 模型 ID，用于路由到对应的 Provider
 */
export async function* streamResponse(
  params: Record<string, unknown>,
  userId: string,
  conversationId?: string,
  modelId?: string,
): AsyncGenerator<string> {
  const resolvedModel = modelId ?? (params.model as string) ?? 'deepseek-v4-flash';
  const provider = resolveProvider(resolvedModel);

  // OpenAI 兼容 Provider：使用原有的流式工具调用循环
  if (provider.apiMode === 'openai-compatible') {
    yield* streamResponseOpenAI(params, userId, conversationId, resolvedModel);
  } else {
    // 非 OpenAI 兼容 Provider：使用 Transport 的归一化流式接口
    yield* streamResponseTransport(params, userId, conversationId, resolvedModel);
  }
}

/**
 * OpenAI 兼容 Provider 的流式响应（原有逻辑）
 */
async function* streamResponseOpenAI(
  params: Record<string, unknown>,
  userId: string,
  conversationId?: string,
  _modelId?: string,
): AsyncGenerator<string> {
  let client: OpenAI;
  try {
    client = await getOrCreateClient(userId);
  } catch {
    yield formatSseEvent(
      SSE_EVENT_ERROR,
      'API Key 未配置，请在设置中配置或设置环境变量',
    );
    return;
  }

  yield formatSseEvent(SSE_EVENT_CONNECTED, 'ok');

  // 等待事件队列：定时器将 SSE 事件推入此数组，生成器在关键节点 drain 并 yield
  let hasReceivedFirstChunk = false;
  const pendingWaitingEvents: string[] = [];

  // 3 秒内未收到首个 chunk → 发送排队等待提示
  const waitingTimer = setTimeout(() => {
    if (!hasReceivedFirstChunk) {
      logger.info('AI 请求正在排队等待服务器响应...');
      pendingWaitingEvents.push(
        formatSseEvent(SSE_EVENT_WAITING, undefined, { status: 'queued', message: '请求正在排队等待服务器响应...' }),
      );
    }
  }, 3000);

  // 8 秒仍未收到 → 发送服务器繁忙提示
  const userWaitingTimer = setTimeout(() => {
    if (!hasReceivedFirstChunk) {
      logger.info('AI 服务器繁忙，请求正在排队中...');
      pendingWaitingEvents.push(
        formatSseEvent(SSE_EVENT_WAITING, undefined, { status: 'busy', message: '服务器繁忙，请求正在排队中...' }),
      );
    }
  }, 8000);

  try {
    const { stream: _stream, ...apiParams } = params;
    const requestParams = {
      ...apiParams,
      stream: true as const,
    } as ChatCompletionCreateParamsStreaming;

    // 发送完整请求 JSON 供前端监控面板显示
    yield formatSseEvent(SSE_EVENT_FULL_REQUEST, undefined, {
      request_json: JSON.stringify(requestParams, null, 2),
    });

    // 委托给多轮工具调用循环，传入等待事件队列和首 chunk 回调
    const loopStats = { toolCallCount: 0 };
    yield* streamingToolCallLoop(
      client,
      params,
      conversationId,
      undefined, // 使用默认 maxTurns
      () => { hasReceivedFirstChunk = true; },
      pendingWaitingEvents,
      loopStats,
      userId,
    );

    // 流式响应结束后执行后采样钩子（压缩、会话笔记、梦境）
    if (conversationId != null) {
      try {
        const hookEvents: string[] = [];
        await runPostSamplingHooks(
          {
            conversationId,
            userId,
            model: params.model as string,
            toolCallCountThisTurn: loopStats.toolCallCount,
          },
          (eventData: string) => {
            hookEvents.push(eventData);
          },
        );
        for (const eventData of hookEvents) {
          try {
            const parsed = JSON.parse(eventData) as { type: string; content?: string; data?: Record<string, unknown> };
            yield formatSseEvent(parsed.type, parsed.content, parsed.data);
          } catch {
            yield `data: ${eventData}\n\n`;
          }
        }
      } catch (e) {
        logger.warn('后采样钩子执行失败: %s', e);
      }
    }
  } catch (error: unknown) {
    if (error instanceof APIError) {
      const mapped = mapApiError(error);
      logger.error('AI API 错误 [%d]: %s', mapped.statusCode, mapped.message);
      yield formatSseEvent(SSE_EVENT_ERROR, mapped.message);
    } else {
      logger.error('AI 流式请求异常: %s', error);
      yield formatSseEvent(SSE_EVENT_ERROR, 'AI 请求失败，请稍后重试');
    }
  } finally {
    clearTimeout(waitingTimer);
    clearTimeout(userWaitingTimer);
  }
}

/**
 * 非 OpenAI 兼容 Provider 的流式响应（使用 Transport 归一化接口）
 */
async function* streamResponseTransport(
  params: Record<string, unknown>,
  userId: string,
  conversationId?: string,
  modelId?: string,
): AsyncGenerator<string> {
  const resolvedModel = modelId ?? (params.model as string) ?? 'deepseek-v4-flash';

  let transport: ProviderTransport;
  try {
    transport = await getTransportForModel(resolvedModel, userId);
  } catch {
    yield formatSseEvent(
      SSE_EVENT_ERROR,
      'API Key 未配置，请在设置中配置或设置环境变量',
    );
    return;
  }

  yield formatSseEvent(SSE_EVENT_CONNECTED, 'ok');

  // 构建归一化请求参数
  const chatParams = buildTransportParams(params, resolvedModel);

  // 发送完整请求 JSON 供前端监控面板显示
  yield formatSseEvent(SSE_EVENT_FULL_REQUEST, undefined, {
    request_json: JSON.stringify({ ...chatParams, stream: true }, null, 2),
  });

  let hasReceivedFirstChunk = false;
  const pendingWaitingEvents: string[] = [];

  const waitingTimer = setTimeout(() => {
    if (!hasReceivedFirstChunk) {
      pendingWaitingEvents.push(
        formatSseEvent(SSE_EVENT_WAITING, undefined, { status: 'queued', message: '请求正在排队等待服务器响应...' }),
      );
    }
  }, 3000);

  const userWaitingTimer = setTimeout(() => {
    if (!hasReceivedFirstChunk) {
      pendingWaitingEvents.push(
        formatSseEvent(SSE_EVENT_WAITING, undefined, { status: 'busy', message: '服务器繁忙，请求正在排队中...' }),
      );
    }
  }, 8000);

  try {
    // 委托给 Transport 流式多轮工具调用循环
    const loopStats = { toolCallCount: 0 };
    yield* streamingToolCallLoopTransport(
      transport,
      chatParams,
      conversationId,
      undefined, // 使用默认 maxTurns
      () => { hasReceivedFirstChunk = true; },
      pendingWaitingEvents,
      loopStats,
      userId,
    );

    // 后采样钩子
    if (conversationId != null) {
      try {
        const hookEvents: string[] = [];
        await runPostSamplingHooks(
          {
            conversationId,
            userId,
            model: resolvedModel,
            toolCallCountThisTurn: loopStats.toolCallCount,
          },
          (eventData: string) => {
            hookEvents.push(eventData);
          },
        );
        for (const eventData of hookEvents) {
          try {
            const parsed = JSON.parse(eventData) as { type: string; content?: string; data?: Record<string, unknown> };
            yield formatSseEvent(parsed.type, parsed.content, parsed.data);
          } catch {
            yield `data: ${eventData}\n\n`;
          }
        }
      } catch (e) {
        logger.warn('后采样钩子执行失败: %s', e);
      }
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'status' in error) {
      const mapped = mapApiError(error);
      logger.error('AI API 错误 [%d]: %s', mapped.statusCode, mapped.message);
      yield formatSseEvent(SSE_EVENT_ERROR, mapped.message);
    } else {
      logger.error('AI 流式请求异常: %s', error);
      yield formatSseEvent(SSE_EVENT_ERROR, 'AI 请求失败，请稍后重试');
    }
  } finally {
    clearTimeout(waitingTimer);
    clearTimeout(userWaitingTimer);
  }
}

/**
 * 将 OpenAI 格式的 params 转换为 Transport 归一化参数
 */
function buildTransportParams(
  params: Record<string, unknown>,
  modelId: string,
): import('../../core/ai/providers/types.js').TransportChatParams {
  const messages = (params.messages as Array<Record<string, unknown>>).map((m) => ({
    role: m.role as string,
    content: (m.content as string) ?? '',
    ...(m.tool_calls ? { toolCalls: m.toolCalls ?? m.tool_calls } : {}),
    ...(m.tool_call_id ? { toolCallId: m.tool_call_id as string } : {}),
  })) as import('../../core/ai/providers/types.js').NormalizedMessage[];

  const tools = params.tools
    ? (params.tools as Array<Record<string, unknown>>).map((t) => {
        const fn = (t.function ?? {}) as Record<string, unknown>;
        return {
          type: 'function' as const,
          function: {
            name: (fn.name as string) ?? '',
            description: fn.description as string | undefined,
            parameters: fn.parameters as Record<string, unknown> | undefined,
          },
        };
      })
    : undefined;

  return {
    model: modelId,
    messages,
    tools,
    temperature: params.temperature as number | undefined,
    maxTokens: params.max_tokens as number | undefined,
    topP: params.top_p as number | undefined,
    stream: true,
    thinking: params.thinking as { type: 'enabled' | 'disabled' } | undefined,
    reasoningEffort: params.reasoning_effort as string | undefined,
    responseFormat: params.response_format as Record<string, unknown> | undefined,
    stop: params.stop as string[] | undefined,
  };
}
