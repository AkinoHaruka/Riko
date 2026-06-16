/**
 * 上下文压缩领域模块入口。
 * 统一导出压缩相关的类型定义、Token 估算、提示词构建、
 * 触发策略、微型压缩、自动压缩决策和核心压缩服务。
 */
export type {
  CompactMessage,
  CompactionResult,
  AutoCompactResult,
  TokenWarningState,
  CompactBoundaryMetadata,
} from './types.js';

export {
  estimateTextTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  getEffectiveContextWindow,
  getAutoCompactThreshold,
  calculateTokenWarningState,
  splitMessagesByCompactBoundary,
  MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  AUTOCOMPACT_BUFFER_TOKENS,
  WARNING_THRESHOLD_BUFFER_TOKENS,
  BLOCKING_LIMIT_BUFFER_TOKENS,
} from './tokenEstimator.js';

export {
  buildCompactPrompt,
  formatCompactSummary,
  getCompactUserSummaryMessage,
  buildCompactSubAgentPrompt,
  NO_TOOLS_TRAILER,
} from './prompt.js';
export type { CompactUserSummaryOptions } from './prompt.js';

export {
  stripImagesFromMessages,
  groupMessagesByApiRound,
  truncateHeadForPtlRetry,
  createCompactBoundaryMessage,
  selectRecentMessages,
  buildPostCompactResult,
  streamCompactSummary,
  createPostCompactFileAttachments,
  buildPostCompactMessages,
  compactConversation,
  runPostCompactCleanup,
  autoCompactIfNeeded,
  messagesToCompactMessages,
  RuntimeError,
  ValueError,
  MAX_PTL_RETRIES,
  COMPACT_MAX_OUTPUT_TOKENS,
  POST_COMPACT_MAX_FILES,
  POST_COMPACT_TOKEN_BUDGET,
  POST_COMPACT_MAX_TOKENS_PER_FILE,
  POST_COMPACT_SESSION_NOTES_TOKEN_BUDGET,
} from './service.js';

export {
  TIME_BASED_MC_CONFIG,
  isToolResultMessage,
  clearOldToolResults,
  maybeTimeBasedMicroCompact,
} from './microCompact.js';

export {
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  shouldAutoCompact,
  resetCompactFailures,
  incrementCompactFailures,
} from './autoCompact.js';

export {
  shouldTriggerCompact,
  calculateUncompactTokens,
  findLastCompactBoundaryIndex,
  isAutoCompactFeatureEnabled,
} from './trigger.js';
