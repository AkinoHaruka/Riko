/**
 * 聊天领域模块入口。
 * 统一导出聊天相关的类型定义、SSE 事件常量、工具调用处理器、
 * 流式响应处理和聊天服务函数。
 */
export type {
  ChatMessage,
  ChatCompletionRequest,
  SseEvent,
  ToolCallAccumulatorItem,
  ToolCallAccumulator,
  UsageData,
  FinishData,
  CompactData,
} from './types.js';

export {
  SSE_EVENT_CONNECTED,
  SSE_EVENT_CONTENT,
  SSE_EVENT_REASONING_CONTENT,
  SSE_EVENT_TOOL_CALL,
  SSE_EVENT_FINISH,
  SSE_EVENT_USAGE,
  SSE_EVENT_COMPACT,
  SSE_EVENT_ERROR,
  buildApiParams,
} from './types.js';

export { executeToolCalls, buildToolResultMessages } from './toolHandler.js';

export { formatSseEvent, streamingToolCallLoop, nonStreamingToolCallLoop } from './toolCallLoop.js';

export { streamResponse } from './stream.js';

export { chatCompletionStream, chatCompletionNonStream, listModels } from './service.js';
