/**
 * SSE 流式响应处理。负责解析 DeepSeek 流式 chunk、工具调用累积、
 * 首个响应等待超时提示，以及后采样钩子（压缩、会话笔记、梦境）的编排。
 */
import type { ChatCompletionChunk } from 'openai/resources/chat/completions.js';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions/completions.js';
import { APIError, default as OpenAI } from 'openai';
import { getOrCreateClient } from '../../core/ai/client.js';
import { mapApiError } from '../../core/ai/errors.js';
import { env } from '../../config/index.js';
import { createLogger } from '../../core/logger/index.js';
import { executeToolCalls, buildToolResultMessages } from './toolHandler.js';
import type {
  ToolCallAccumulator,
  UsageData,
  FinishData,
  DeepSeekDeltaExtension,
  DeepSeekUsageExtension,
} from './types.js';
import {
  SSE_EVENT_CONNECTED,
  SSE_EVENT_CONTENT,
  SSE_EVENT_REASONING_CONTENT,
  SSE_EVENT_TOOL_CALL,
  SSE_EVENT_FINISH,
  SSE_EVENT_USAGE,
  SSE_EVENT_ERROR,
  SSE_EVENT_FULL_REQUEST,
} from './types.js';
import { accumulateToolCall } from './types.js';
import { runPostSamplingHooks } from './postSampling.js';

const logger = createLogger('Stream');

type DeepSeekDelta = ChatCompletionChunk.Choice.Delta & DeepSeekDeltaExtension;
type DeepSeekUsage = NonNullable<ChatCompletionChunk['usage']> & DeepSeekUsageExtension;
type ChatStream = AsyncIterable<ChatCompletionChunk>;

export function formatSseEvent(
  eventType: string,
  content?: string,
  data?: Record<string, unknown>,
): string {
  const payload: Record<string, unknown> = { type: eventType };
  if (content !== undefined) {
    payload.content = content;
  }
  if (data !== undefined) {
    payload.data = data;
  }
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function extractUsageData(usage: DeepSeekUsage): UsageData {
  const usageData: UsageData = {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
  if (usage.prompt_cache_hit_tokens !== undefined) {
    usageData.prompt_cache_hit_tokens = usage.prompt_cache_hit_tokens;
  }
  if (usage.prompt_cache_miss_tokens !== undefined) {
    usageData.prompt_cache_miss_tokens = usage.prompt_cache_miss_tokens;
  }
  return usageData;
}

interface ChunkProcessResult {
  hasToolCalls: boolean;
  reasoningContentAccumulator: string;
  textContent: string;
}

async function* processStreamChunks(
  stream: ChatStream,
  toolCallsAccumulator: ToolCallAccumulator,
  initialReasoningContent: string,
  isContinueStream: boolean,
  onFirstChunk?: () => void,
): AsyncGenerator<string, ChunkProcessResult> {
  let hasToolCalls = false;
  let reasoningContentAccumulator = initialReasoningContent;
  let textContentAccumulator = '';
  let isFirstChunk = true;

  for await (const chunk of stream) {
    if (isFirstChunk) {
      isFirstChunk = false;
      onFirstChunk?.();
    }

    if (chunk.choices && chunk.choices.length > 0) {
      const choice = chunk.choices[0];
      const delta = choice.delta as DeepSeekDelta;

      if (delta.content) {
        yield formatSseEvent(SSE_EVENT_CONTENT, delta.content);
        textContentAccumulator += delta.content;
      }

      if (delta.reasoning_content) {
        reasoningContentAccumulator += delta.reasoning_content;
        yield formatSseEvent(SSE_EVENT_REASONING_CONTENT, delta.reasoning_content);
      }

      if (delta.tool_calls) {
        hasToolCalls = true;
        for (const tc of delta.tool_calls) {
          accumulateToolCall(toolCallsAccumulator, tc);
        }
      }

      if (choice.finish_reason) {
        if (!isContinueStream && hasToolCalls && choice.finish_reason === 'tool_calls') {
          yield formatSseEvent(SSE_EVENT_TOOL_CALL, '正在更新会话笔记...');
        } else {
          yield formatSseEvent(SSE_EVENT_FINISH, undefined, {
            finish_reason: choice.finish_reason,
          } satisfies FinishData);
        }
      }
    }

    if (chunk.usage) {
      const usageData = extractUsageData(chunk.usage as DeepSeekUsage);
      yield formatSseEvent(
        SSE_EVENT_USAGE,
        undefined,
        usageData as unknown as Record<string, unknown>,
      );
    }
  }

  return { hasToolCalls, reasoningContentAccumulator, textContent: textContentAccumulator };
}

function buildContinueParams(
  originalParams: Record<string, unknown>,
  messages: Record<string, unknown>[],
): ChatCompletionCreateParamsStreaming {
  const { tools: _tools, messages: _oldMessages, stream: _stream, ...restParams } = originalParams;
  return {
    ...restParams,
    messages: messages as unknown as ChatCompletionCreateParamsStreaming['messages'],
    stream: true,
  } as ChatCompletionCreateParamsStreaming;
}

export async function* streamResponse(
  params: Record<string, unknown>,
  userId: string,
  conversationId?: string,
): AsyncGenerator<string> {
  // 使用缓存的客户端，避免每次请求都创建新实例
  let client: OpenAI;
  try {
    client = await getOrCreateClient(userId);
  } catch {
    yield formatSseEvent(
      SSE_EVENT_ERROR,
      'DeepSeek API Key 未配置，请在设置中配置或设置环境变量 DEEPSEEK_API_KEY',
    );
    return;
  }

  yield formatSseEvent(SSE_EVENT_CONNECTED, 'ok');

  // 如果 3 秒内没有收到第一个 chunk，发送等待提示
  let hasReceivedFirstChunk = false;
  const waitingTimer = setTimeout(() => {
    if (!hasReceivedFirstChunk) {
      logger.info('DeepSeek 请求正在排队等待服务器响应...');
    }
  }, 3000);

  // 如果 8 秒后仍未收到响应，向前端发送等待状态提示
  const userWaitingTimer = setTimeout(() => {
    if (!hasReceivedFirstChunk) {
      logger.info('DeepSeek 服务器繁忙，请求正在排队中...');
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

    const stream = await client.chat.completions.create(requestParams);

    const toolCallsAccumulator: ToolCallAccumulator = {};
    let reasoningContentAccumulator = '';

    const firstResult = yield* processStreamChunks(stream, toolCallsAccumulator, '', false, () => {
      hasReceivedFirstChunk = true;
    });
    reasoningContentAccumulator = firstResult.reasoningContentAccumulator;

    if (firstResult.hasToolCalls && conversationId != null) {
      const memoryRoot = env.MEMORY_ROOT_DIR;

      const toolResults = executeToolCalls(toolCallsAccumulator, conversationId, memoryRoot);
      const allToolCalls = Object.keys(toolCallsAccumulator)
        .sort((a, b) => Number(a) - Number(b))
        .map((idx) => toolCallsAccumulator[Number(idx)]);

      const toolResultMessages = buildToolResultMessages(toolCallsAccumulator, toolResults);

      const messages = params.messages as Record<string, unknown>[];
      const assistantMessage: Record<string, unknown> = {
        role: 'assistant',
        content: firstResult.textContent || null,
        tool_calls: allToolCalls,
      };
      if (reasoningContentAccumulator) {
        assistantMessage.reasoning_content = reasoningContentAccumulator;
      }
      messages.push(assistantMessage);
      messages.push(...toolResultMessages);

      const continueParams = buildContinueParams(params, messages);
      const continueStream = await client.chat.completions.create(continueParams);

      const continueToolCallsAccumulator: ToolCallAccumulator = {};
      yield* processStreamChunks(continueStream, continueToolCallsAccumulator, '', true);
    }

    if (conversationId != null) {
      try {
        const hookEvents: string[] = [];
        await runPostSamplingHooks(
          {
            conversationId,
            userId,
            model: params.model as string,
            toolCallCountThisTurn: Object.keys(toolCallsAccumulator).length,
          },
          (eventData: string) => {
            hookEvents.push(eventData);
          },
        );
        for (const eventData of hookEvents) {
          yield `data: ${eventData}\n\n`;
        }
      } catch (e) {
        logger.warn('后采样钩子执行失败: %s', e);
      }
    }
  } catch (error: unknown) {
    if (error instanceof APIError) {
      const mapped = mapApiError(error);
      logger.error('DeepSeek API 错误 [%d]: %s', mapped.statusCode, mapped.message);
      yield formatSseEvent(SSE_EVENT_ERROR, mapped.message);
    } else {
      logger.error('DeepSeek 流式请求异常: %s', error);
      const message = error instanceof Error ? error.message : String(error);
      yield formatSseEvent(SSE_EVENT_ERROR, `DeepSeek 请求失败: ${message}`);
    }
  } finally {
    clearTimeout(waitingTimer);
    clearTimeout(userWaitingTimer);
  }
}
