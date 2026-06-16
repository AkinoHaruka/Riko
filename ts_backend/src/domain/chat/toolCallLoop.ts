/**
 * 共享工具调用循环。
 *
 * 统一流式 (SSE) 和非流式两条路径的多轮工具调用逻辑。
 * 核心设计：continuation 请求始终保留 tools 字段，支持 N 轮工具调用，
 * 而非原先的单轮限制。maxTurns 防止无限循环。
 *
 * @module domain/chat/toolCallLoop
 */
import type { ChatCompletionChunk } from 'openai/resources/chat/completions.js';
import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions/completions.js';
import type OpenAI from 'openai';
import { createLogger } from '../../core/logger/index.js';
import { env } from '../../config/index.js';
import { executeToolCalls, buildToolResultMessages } from './toolHandler.js';
import type {
  ToolCallAccumulator,
  UsageData,
  FinishData,
  DeepSeekDeltaExtension,
  DeepSeekUsageExtension,
} from './types.js';
import {
  SSE_EVENT_CONTENT,
  SSE_EVENT_REASONING_CONTENT,
  SSE_EVENT_TOOL_CALL,
  SSE_EVENT_FINISH,
  SSE_EVENT_USAGE,
} from './types.js';
import { accumulateToolCall } from './types.js';

const logger = createLogger('ToolCallLoop');

type DeepSeekDelta = ChatCompletionChunk.Choice.Delta & DeepSeekDeltaExtension;
type DeepSeekUsage = NonNullable<ChatCompletionChunk['usage']> & DeepSeekUsageExtension;
type ChatStream = AsyncIterable<ChatCompletionChunk>;

/** 聊天场景默认最大轮次 */
const CHAT_DEFAULT_MAX_TURNS = 5;

/**
 * 从 API 请求参数的 tools 字段中提取允许的工具名称集合。
 * 用于白名单校验，防止 LLM 调用未声明的工具。
 * @param tools - OpenAI 格式的 tools 数组
 * @returns 工具名称集合，tools 为空时返回 undefined（允许所有已注册工具）
 */
function extractAllowedTools(tools: unknown): Set<string> | undefined {
  if (!Array.isArray(tools)) return undefined;
  const names = new Set<string>();
  for (const tool of tools) {
    const t = tool as { type?: string; function?: { name?: string } };
    if (t.type === 'function' && t.function?.name) {
      names.add(t.function.name);
    }
  }
  return names.size > 0 ? names : undefined;
}

// ─── SSE 格式化工具（同时供 stream.ts 使用） ───

/**
 * 格式化 SSE 事件为标准 data: ... 格式字符串。
 * @param eventType - 事件类型
 * @param content - 事件内容（可选）
 * @param data - 事件附加数据（可选）
 * @returns 格式化后的 SSE 字符串
 */
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

/**
 * 从 DeepSeek 用量数据中提取标准化的 UsageData。
 */
export function extractUsageData(usage: DeepSeekUsage): UsageData {
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

// ─── 流式 chunk 处理 ───

interface ChunkProcessResult {
  hasToolCalls: boolean;
  reasoningContentAccumulator: string;
  textContent: string;
}

/**
 * 处理流式 chunk 序列，产出 SSE 事件字符串。
 * @param stream - DeepSeek 流式响应
 * @param toolCallsAccumulator - 工具调用累积器
 * @param initialReasoningContent - 初始推理内容（用于续流场景）
 * @param isLastRound - 是否为最后一轮（控制 finish 事件发送）
 * @param onFirstChunk - 收到首个 chunk 时的回调（用于取消等待计时器）
 * @param pendingEvents - 外部等待事件队列，在 chunk 迭代间隙 drain
 */
async function* processStreamChunks(
  stream: ChatStream,
  toolCallsAccumulator: ToolCallAccumulator,
  initialReasoningContent: string,
  isLastRound: boolean,
  onFirstChunk?: () => void,
  pendingEvents?: string[],
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

    // drain 外部等待事件（定时器可能在上次 await 期间推入了事件）
    if (pendingEvents) {
      while (pendingEvents.length > 0) {
        yield pendingEvents.shift()!;
      }
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
        if (hasToolCalls && choice.finish_reason === 'tool_calls' && !isLastRound) {
          // 工具调用轮：发送处理提示，不发 finish（循环将继续）
          yield formatSseEvent(SSE_EVENT_TOOL_CALL, '正在调用工具...');
        } else {
          // 最终轮或 stop：发送 finish
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

// ─── 流式多轮工具调用循环 ───

/**
 * 流式多轮工具调用循环。
 *
 * 执行完整的流式生命周期：
 * 1. 发起首轮 API 流式请求
 * 2. 处理 chunk 并 yield SSE 事件
 * 3. 如有工具调用 → 执行工具 → 追加消息 → 发起续流（保留 tools）
 * 4. 重复直到无工具调用或达到 maxTurns
 * 5. 最后一轮发送 finish 事件
 *
 * @param client - OpenAI 客户端
 * @param params - 原始 API 请求参数（含 tools）
 * @param conversationId - 会话 ID，为空时跳过工具执行
 * @param maxTurns - 最大轮次数，默认 5
 * @param onFirstChunk - 收到首个 chunk 时的回调
 * @param pendingEvents - 外部等待事件队列
 * @param stats - 可变引用对象，循环结束后记录总工具调用数
 */
export async function* streamingToolCallLoop(
  client: OpenAI,
  params: Record<string, unknown>,
  conversationId?: string,
  maxTurns: number = CHAT_DEFAULT_MAX_TURNS,
  onFirstChunk?: () => void,
  pendingEvents?: string[],
  stats?: { toolCallCount: number },
): AsyncGenerator<string> {
  const { stream: _stream, ...baseParams } = params;
  const memoryRoot = env.MEMORY_ROOT_DIR;

  let messages = [...(params.messages as Record<string, unknown>[])];
  let reasoningContentAccumulator = '';
  let totalToolCalls = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    const isLastTurn = turn === maxTurns - 1;
    const toolCallsAccumulator: ToolCallAccumulator = {};

    const streamParams: ChatCompletionCreateParamsStreaming = {
      ...baseParams,
      messages: messages as unknown as ChatCompletionCreateParamsStreaming['messages'],
      stream: true,
    } as ChatCompletionCreateParamsStreaming;

    logger.info('[ToolCallLoop] 第 %d 轮流式请求, messages=%d', turn + 1, messages.length);

    const stream = await client.chat.completions.create(streamParams);

    // drain API 创建期间可能触发的等待事件
    if (pendingEvents) {
      while (pendingEvents.length > 0) {
        yield pendingEvents.shift()!;
      }
    }

    // 仅首轮传递 onFirstChunk 回调
    const firstChunkCb = turn === 0 ? onFirstChunk : undefined;
    const result = yield* processStreamChunks(
      stream,
      toolCallsAccumulator,
      reasoningContentAccumulator,
      isLastTurn,
      firstChunkCb,
      pendingEvents,
    );
    reasoningContentAccumulator = result.reasoningContentAccumulator;

    // 无工具调用 → 循环结束
    if (!result.hasToolCalls) {
      logger.info('[ToolCallLoop] 第 %d 轮无工具调用，结束', turn + 1);
      break;
    }

    // 无 conversationId → 无法执行工具（工具需要上下文）
    if (conversationId == null) {
      logger.info('[ToolCallLoop] 无 conversationId，跳过工具执行');
      yield formatSseEvent(SSE_EVENT_FINISH, undefined, { finish_reason: 'stop' });
      break;
    }

    // ── 执行工具调用 ──
    // 从 params.tools 中提取允许的工具名称白名单
    const allowedTools = extractAllowedTools(params.tools);
    const toolResults = await executeToolCalls(toolCallsAccumulator, conversationId, memoryRoot, allowedTools);
    const allToolCalls = Object.keys(toolCallsAccumulator)
      .sort((a, b) => Number(a) - Number(b))
      .map((idx) => toolCallsAccumulator[Number(idx)]);

    totalToolCalls += allToolCalls.length;

    const toolResultMessages = buildToolResultMessages(toolCallsAccumulator, toolResults);

    // 构建 assistant 消息（含 tool_calls）
    const assistantMessage: Record<string, unknown> = {
      role: 'assistant',
      content: result.textContent || null,
      tool_calls: allToolCalls,
    };
    if (reasoningContentAccumulator) {
      assistantMessage.reasoning_content = reasoningContentAccumulator;
    }
    messages.push(assistantMessage);
    messages.push(...toolResultMessages);

    logger.info(
      '[ToolCallLoop] 第 %d 轮工具调用完成, 工具数=%d',
      turn + 1,
      allToolCalls.length,
    );

    // 最后一轮仍需发送 finish（processStreamChunks 在 isLastRound=true 时已发）
    // 非最后一轮：循环继续，下一轮 processStreamChunks 会处理
  }

  // 将总工具调用数写入 stats 引用对象，供调用方使用
  if (stats) {
    stats.toolCallCount = totalToolCalls;
  }
}

// ─── 非流式多轮工具调用循环 ───

/**
 * 非流式多轮工具调用循环。
 *
 * 与流式版本逻辑一致，但使用非流式 API 调用，返回最终响应。
 *
 * @param client - OpenAI 客户端
 * @param params - 原始 API 请求参数（含 tools）
 * @param conversationId - 会话 ID，为空时跳过工具执行
 * @param maxTurns - 最大轮次数，默认 5
 * @returns 最终的非流式响应
 */
export async function nonStreamingToolCallLoop(
  client: OpenAI,
  params: Record<string, unknown>,
  conversationId?: string,
  maxTurns: number = CHAT_DEFAULT_MAX_TURNS,
): Promise<Record<string, unknown>> {
  const { stream: _stream, ...baseParams } = params;
  const memoryRoot = env.MEMORY_ROOT_DIR;

  let messages = [...(params.messages as Record<string, unknown>[])];
  let lastResponse: Record<string, unknown> | null = null;

  for (let turn = 0; turn < maxTurns; turn++) {
    const requestParams: ChatCompletionCreateParamsNonStreaming = {
      ...baseParams,
      messages: messages as unknown as ChatCompletionCreateParamsNonStreaming['messages'],
      stream: false,
    } as ChatCompletionCreateParamsNonStreaming;

    logger.info('[ToolCallLoop:NonStream] 第 %d 轮请求, messages=%d', turn + 1, messages.length);

    const response = await client.chat.completions.create(requestParams);
    lastResponse = response as unknown as Record<string, unknown>;

    const choice = (response as unknown as { choices?: Array<{ message?: Record<string, unknown> }> })
      .choices?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;
    const toolCalls = message?.tool_calls as Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }> | undefined;

    // 无工具调用 → 返回最终响应
    if (!toolCalls || toolCalls.length === 0) {
      logger.info('[ToolCallLoop:NonStream] 第 %d 轮无工具调用，结束', turn + 1);
      break;
    }

    // 无 conversationId → 无法执行工具
    if (conversationId == null) {
      logger.info('[ToolCallLoop:NonStream] 无 conversationId，跳过工具执行');
      break;
    }

    // ── 构建 accumulator 并执行工具 ──
    const toolCallsAccumulator: ToolCallAccumulator = {};
    toolCalls.forEach((tc, idx) => {
      if (tc.type === 'function') {
        toolCallsAccumulator[idx] = {
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        };
      }
    });

    const toolResults = await executeToolCalls(toolCallsAccumulator, conversationId, memoryRoot);
    const toolResultMessages = buildToolResultMessages(toolCallsAccumulator, toolResults);

    if (message) {
      messages.push(message);
    }
    messages.push(...toolResultMessages);

    logger.info(
      '[ToolCallLoop:NonStream] 第 %d 轮工具调用完成, 工具数=%d',
      turn + 1,
      Object.keys(toolCallsAccumulator).length,
    );
  }

  return lastResponse ?? {};
}
