/**
 * 会话记忆相关类型定义。管理每个对话的笔记状态（数据库记录）和触发阈值（Token/工具调用数）。
 * 笔记文件存储在 MEMORY_ROOT_DIR/session_memory/ 下。
 */

/** 数据库 session_notes_state 表的行映射 */
export interface SessionMemoryState {
  id?: string;
  conversation_id: string;
  /** 是否已初始化：0=未初始化，1=已初始化 */
  is_initialized: number;
  /** 当前笔记文件的估算 Token 数 */
  notes_token_count: number;
  /** 自上次更新以来的工具调用计数 */
  tool_call_count: number;
  last_updated_at: string;
}

/** 各章节的 Token 大小映射，key 为章节标题（含 # 前缀） */
export type SectionSizes = Record<string, number>;

/** 单章节最大 Token 数，超限会触发精简提醒 */
export const MAX_SECTION_LENGTH = 2000;
/** 笔记文件总 Token 上限，超限会触发严重警告 */
export const MAX_TOTAL_SESSION_MEMORY_TOKENS = 12000;
/** 兜底初始化阈值：消息数达到此值时允许初始化（当用户无自定义配置时使用） */
export const MINIMUM_MESSAGES_TO_INIT = 6;

/** 默认参数值 */
export const DEFAULT_MIN_MESSAGES_TO_INIT = 6;
export const DEFAULT_MIN_TOKENS_BETWEEN_UPDATE = 2000;
export const DEFAULT_TOOL_CALLS_BETWEEN_UPDATES = 3;

/** 触发状态快照，用于判断是否需要更新笔记 */
export interface SessionMemoryTriggerState {
  /** 上次更新时的 Token 数 */
  lastUpdateTokenCount: number;
  /** 上次更新时的工具调用计数 */
  lastUpdateToolCallCount: number;
  /** 上次更新时间 */
  lastUpdateAt: string;
}
