/**
 * 上下文压缩相关类型定义。
 * 包含压缩边界标记、压缩结果、自动压缩结果、Token 警告状态和消息格式。
 * CompactBoundaryMetadata 作为 compact_metadata 存储在消息中，标记压缩历史和策略。
 */
import type { SubAgentTrace } from '../subAgent/types.js';

/** 压缩边界元数据，标记一次压缩操作的触发方式、策略和前后 Token 数 */
export interface CompactBoundaryMetadata {
  type: 'compact_boundary';
  trigger: 'auto' | 'manual';
  preCompactTokenCount: number;
  preCompactMessageCount: number;
  timestamp: string;
  compactStrategy: 'legacy' | 'micro_compact' | 'sub_agent';
  post_compact_recent_tokens?: number;
}

/** 单次压缩操作的完整结果 */
export interface CompactionResult {
  boundaryMarker: CompactMessage;
  summaryMessages: CompactMessage[];
  attachments: CompactMessage[];
  recentMessages: CompactMessage[];
  preCompactTokenCount: number;
  postCompactTokenCount: number;
  truePostCompactTokenCount: number;
  willRetriggerNextTurn: boolean;
  isAutoCompact: boolean;
  subAgentTrace?: SubAgentTrace;
}

/** 自动压缩检查结果，包含是否执行了压缩及压缩策略 */
export interface AutoCompactResult {
  was_compacted: boolean;
  strategy?: 'legacy' | 'micro_compact' | 'sub_agent';
  compaction_result?: CompactionResult;
  messages?: CompactMessage[];
  pre_compact_message_count?: number;
  error?: string;
}

/** Token 用量警告状态，用于前端展示不同级别的上下文剩余提示 */
export interface TokenWarningState {
  percent_left: number;
  is_above_warning_threshold: boolean;
  is_above_auto_compact_threshold: boolean;
  is_at_blocking_limit: boolean;
}

/** 压缩模块使用的消息格式，扩展了压缩相关的元数据字段 */
export interface CompactMessage {
  role: string;
  content: string;
  reasoning_content?: string;
  is_compact_summary?: boolean;
  compact_metadata?: string | null;
  created_at?: string;
}
