/**
 * 会话记忆模块入口。导出会话笔记管理器、服务、提示构建器、工具定义、触发策略和类型。
 * 会话记忆通过 SubAgent 驱动 AI 自动提取对话要点，维护每个对话的笔记文件。
 */
export { SessionMemoryManager } from './manager.js';
export { SessionMemoryService, injectSessionMemoryUpdate } from './service.js';
export type { SessionNotesResponse, ExtractResponse, DeleteResponse } from './service.js';
export {
  substituteVariables,
  estimateTokenCount,
  analyzeSectionSizes,
  generateSectionReminders,
  buildSystemPromptExtension,
  buildSessionMemorySubAgentPrompt,
  injectSessionMemoryUpdate as injectSessionMemoryUpdateFromPromptBuilder,
} from './promptBuilder.js';
export { buildAllToolDefinitions } from './toolDefinitions.js';
export {
  type SessionMemoryState,
  type SectionSizes,
  type SessionMemoryTriggerState,
  MAX_SECTION_LENGTH,
  MAX_TOTAL_SESSION_MEMORY_TOKENS,
  MINIMUM_MESSAGES_TO_INIT,
  DEFAULT_MIN_MESSAGES_TO_INIT,
  DEFAULT_MIN_TOKENS_BETWEEN_UPDATE,
  DEFAULT_TOOL_CALLS_BETWEEN_UPDATES,
} from './types.js';
export { shouldTriggerSessionMemoryInit, shouldTriggerSessionMemoryUpdate } from './trigger.js';
