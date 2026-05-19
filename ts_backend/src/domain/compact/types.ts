/**
 * 上下文压缩相关类型定义。包含压缩边界标记、压缩结果、警告状态和消息格式。
 * CompactBoundaryMetadata 作为 compact_metadata 存储在消息中，标记压缩历史和策略。
 */
export interface CompactBoundaryMetadata {
  type: 'compact_boundary';
  trigger: 'auto' | 'manual';
  preCompactTokenCount: number;
  preCompactMessageCount: number;
  timestamp: string;
  compactStrategy: 'legacy' | 'micro_compact' | 'sub_agent';
  post_compact_recent_tokens?: number;
}

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
}

export interface AutoCompactResult {
  was_compacted: boolean;
  strategy?: 'legacy' | 'micro_compact' | 'sub_agent';
  compaction_result?: CompactionResult;
  messages?: CompactMessage[];
  pre_compact_message_count?: number;
  error?: string;
}

export interface TokenWarningState {
  percent_left: number;
  is_above_warning_threshold: boolean;
  is_above_auto_compact_threshold: boolean;
  is_at_blocking_limit: boolean;
}

export interface CompactMessage {
  role: string;
  content: string;
  reasoning_content?: string;
  is_compact_summary?: boolean;
  compact_metadata?: string | null;
  created_at?: string;
}
