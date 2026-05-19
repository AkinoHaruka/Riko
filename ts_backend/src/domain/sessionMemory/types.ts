/**
 * 会话记忆相关类型定义。管理每个对话的笔记状态（数据库记录）和触发阈值（Token/工具调用数）。
 * 笔记文件存储在 MEMORY_ROOT_DIR/session_memory/ 下。
 */
export interface SessionMemoryState {
  id?: string;
  conversation_id: string;
  is_initialized: number;
  notes_token_count: number;
  tool_call_count: number;
  last_updated_at: string;
}

export type SectionSizes = Record<string, number>;

export const MAX_SECTION_LENGTH = 2000;
export const MAX_TOTAL_SESSION_MEMORY_TOKENS = 12000;
export const MINIMUM_MESSAGES_TO_INIT = 6;

export const DEFAULT_MIN_MESSAGES_TO_INIT = 6;
export const DEFAULT_MIN_TOKENS_BETWEEN_UPDATE = 2000;
export const DEFAULT_TOOL_CALLS_BETWEEN_UPDATES = 3;

export interface SessionMemoryTriggerState {
  lastUpdateTokenCount: number;
  lastUpdateToolCallCount: number;
  lastUpdateAt: string;
}
