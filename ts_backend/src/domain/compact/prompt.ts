/**
 * 压缩提示辅助函数。
 * 提供压缩摘要的用户展示消息组装，实际压缩提示模板由 prompts/compactPrompt.js 提供。
 */
export { buildCompactPrompt, formatCompactSummary } from '../../prompts/compactPrompt.js';
export { buildCompactPrompt as buildCompactSubAgentPrompt } from '../../prompts/compactPrompt.js';

/** 附加到压缩提示末尾的提醒，确保 AI 仅输出文本摘要而不调用工具 */
export const NO_TOOLS_TRAILER = '\n\nREMINDER: Respond with TEXT ONLY. No tool calls.';

/** 压缩用户摘要消息的配置选项 */
export interface CompactUserSummaryOptions {
  /** 是否抑制 AI 提出后续问题 */
  suppressFollowUpQuestions?: boolean;
  /** 是否有最近消息被保留在压缩后的上下文中 */
  hasRecentMessages?: boolean;
}

/**
 * 构建展示给用户的压缩摘要消息。
 * 包含压缩说明、摘要内容、最近消息保留提示和工具调用抑制提醒。
 * @param summaryText - 压缩摘要文本
 * @param options - 配置选项
 * @returns 格式化后的用户摘要消息
 */
export function getCompactUserSummaryMessage(
  summaryText: string,
  options?: CompactUserSummaryOptions,
): string {
  const { suppressFollowUpQuestions = false, hasRecentMessages = false } = options ?? {};

  const parts: string[] = [];

  parts.push('此会话从之前的对话继续，之前的对话因上下文长度限制而被压缩。');

  parts.push(summaryText);

  if (hasRecentMessages) {
    parts.push('最近的消息已在下方完整保留。');
  }

  if (suppressFollowUpQuestions) {
    parts.push('重要：不要提出后续问题，直接从上次中断处继续任务。');
  }

  parts.push(NO_TOOLS_TRAILER.trim());

  return parts.join('\n\n');
}
