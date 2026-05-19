/**
 * 压缩提示辅助函数。提供压缩摘要的用户展示消息组装，
 * 实际压缩提示模板由 prompts/compactPrompt.js 提供。
 */
export { buildCompactPrompt, formatCompactSummary } from '../../prompts/compactPrompt.js';
export { buildCompactPrompt as buildCompactSubAgentPrompt } from '../../prompts/compactPrompt.js';

export const NO_TOOLS_TRAILER = '\n\nREMINDER: Respond with TEXT ONLY. No tool calls.';

export interface CompactUserSummaryOptions {
  suppressFollowUpQuestions?: boolean;
  hasRecentMessages?: boolean;
}

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
