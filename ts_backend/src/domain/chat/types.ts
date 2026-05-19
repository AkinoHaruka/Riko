/**
 * 聊天相关类型定义。包含请求/响应结构、SSE 事件类型常量、
 * 以及 API 参数组装工具函数（buildSystemPrompt / buildUserMessages / buildApiParams / accumulateToolCall）。
 */
export interface ChatMessage {
  role: string;
  content: string;
  is_compact_summary?: boolean;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream: boolean;
  thinking?: { type: 'enabled' | 'disabled' };
  reasoning_effort?: 'low' | 'medium' | 'high' | 'max';
  response_format?: Record<string, unknown>;
  stop?: string[];
  system_prompt?: string;
  conversation_id?: string;
}

export const SSE_EVENT_CONNECTED = 'connected';
export const SSE_EVENT_CONTENT = 'content';
export const SSE_EVENT_REASONING_CONTENT = 'reasoning_content';
export const SSE_EVENT_TOOL_CALL = 'tool_call';
export const SSE_EVENT_FINISH = 'finish';
export const SSE_EVENT_USAGE = 'usage';
export const SSE_EVENT_COMPACT = 'compact';
export const SSE_EVENT_ERROR = 'error';
export const SSE_EVENT_SESSION_NOTES_INIT = 'session_notes_init';
export const SSE_EVENT_SESSION_MEMORY_ACTIVITY = 'session_memory_activity';
export const SSE_EVENT_COMPACT_ACTIVITY = 'compact_activity';
export const SSE_EVENT_DREAM_ACTIVITY = 'dream_activity';
export const SSE_EVENT_WAITING = 'waiting';
export const SSE_EVENT_FULL_REQUEST = 'full_request';

export interface SseEvent {
  type: string;
  content?: string;
  data?: Record<string, unknown>;
}

export interface ToolCallAccumulatorItem {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type ToolCallAccumulator = Record<number, ToolCallAccumulatorItem>;

export interface UsageData {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export interface FinishData {
  finish_reason: string;
}

export interface CompactData {
  strategy?: string;
  conversation_id?: string;
  pre_compact_tokens?: number;
  post_compact_tokens?: number;
  pre_compact_message_count?: number;
  post_compact_message_count?: number;
  is_auto?: boolean;
}

export interface DeepSeekDeltaExtension {
  reasoning_content?: string | null;
}

export interface DeepSeekUsageExtension {
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export interface CompactModule {
  autoCompactIfNeeded?: (
    conversationId: number,
    model: string,
    userId: number,
  ) => Promise<{
    was_compacted: boolean;
    strategy?: string;
    compaction_result?: {
      preCompactTokenCount?: number;
      truePostCompactTokenCount?: number;
      isAutoCompact?: boolean;
    };
    pre_compact_message_count?: number;
    messages?: unknown[];
  } | null>;
}

export interface BuildApiParamsOptions {
  systemPrompt?: string;
  toolRules?: string;
  persistentMemory?: string;
  compactContext?: string;
}

export function buildSystemPrompt(
  mainPrompt: string,
  toolRules: string,
  persistentMemory?: string,
): string {
  const parts = [mainPrompt, toolRules];
  if (persistentMemory && persistentMemory.trim()) {
    parts.push(persistentMemory.trim());
  }
  return parts.join('\n\n');
}

export function buildUserMessages(messages: ChatMessage[], compactContext?: string): ChatMessage[] {
  const nonCompactMessages = messages.filter((m) => {
    if (m.is_compact_summary) return false;
    return true;
  });
  if (compactContext && compactContext.trim()) {
    return [
      { role: 'user', content: `<compact-context>\n${compactContext.trim()}\n</compact-context>` },
      ...nonCompactMessages,
    ];
  }
  return nonCompactMessages;
}

export function buildApiParams(
  request: ChatCompletionRequest,
  options?: BuildApiParamsOptions,
): Record<string, unknown> {
  let finalSystemPrompt: string | undefined;
  let compactContext: string | undefined;

  if (options !== undefined) {
    finalSystemPrompt = options.systemPrompt;
    compactContext = options.compactContext;
  }

  let messages = buildUserMessages(request.messages, compactContext);

  if (finalSystemPrompt !== undefined && finalSystemPrompt.trim() !== '') {
    messages = [{ role: 'system', content: finalSystemPrompt.trim() }, ...messages];
  }

  const params: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: request.stream,
  };

  const optionalFields: Record<string, unknown> = {
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    top_p: request.top_p,
    reasoning_effort: request.reasoning_effort,
    response_format: request.response_format,
    stop: request.stop,
  };

  const isThinkingEnabled = request.thinking?.type === 'enabled';

  for (const [key, value] of Object.entries(optionalFields)) {
    if (value !== undefined) {
      // DeepSeek 在 thinking 模式下不支持 temperature 和 top_p，跳过以免报错
      if (isThinkingEnabled && (key === 'temperature' || key === 'top_p')) {
        continue;
      }
      params[key] = value;
    }
  }

  if (request.thinking !== undefined) {
    params.thinking = request.thinking;
  }

  return params;
}

export interface ToolCallDelta {
  index: number;
  id?: string | null;
  function?: {
    name?: string | null;
    arguments?: string | null;
  } | null;
}

export function accumulateToolCall(accumulator: ToolCallAccumulator, delta: ToolCallDelta): void {
  const idx = delta.index;
  if (!accumulator[idx]) {
    accumulator[idx] = {
      id: delta.id ?? '',
      type: 'function',
      function: { name: '', arguments: '' },
    };
  }
  if (delta.id) {
    accumulator[idx].id = delta.id;
  }
  if (delta.function) {
    if (delta.function.name) {
      accumulator[idx].function.name += delta.function.name;
    }
    if (delta.function.arguments) {
      accumulator[idx].function.arguments += delta.function.arguments;
    }
  }
}
