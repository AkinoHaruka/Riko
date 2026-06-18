/**
 * 压缩提示辅助函数。
 * 提供压缩摘要的用户展示消息组装，实际压缩提示模板由 prompts/compactPrompt.js 提供。
 */
export { buildCompactPrompt, formatCompactSummary } from '../../prompts/compactPrompt.js';
export { buildCompactPrompt as buildCompactSubAgentPrompt } from '../../prompts/compactPrompt.js';

/** 附加到压缩提示末尾的提醒，确保 AI 仅输出文本摘要而不调用工具 */
export const NO_TOOLS_TRAILER = '\n\nREMINDER: Respond with TEXT ONLY. No tool calls.';

/**
 * 标识符保留指令。
 * 注入到压缩 prompt，要求 AI 在摘要中原样保留关键不透明标识符。
 */
export const IDENTIFIER_PRESERVATION_INSTRUCTIONS = `
## 标识符保留要求
压缩摘要中必须原样保留以下类型的标识符，不得改写、缩写或省略：
- UUID（如 550e8400-e29b-41d4-a716-446655440000）
- 文件绝对路径（如 /home/user/project/src/file.ts）
- URL（如 https://api.example.com/v1/resource）
- IP 地址与端口（如 192.168.1.100:8080）
- 会话/任务 ID（如 sess_abc123、task_xyz789）
- Git commit hash（如 a1b2c3d）

如果标识符出现在"待解决"或"活跃任务"中，必须在摘要的"资源"章节列出。
`.trim();

/**
 * 结构化摘要模板。
 * 压缩摘要必须遵循此结构，确保关键信息不丢失且易于后续引用。
 */
export const STRUCTURED_SUMMARY_TEMPLATE = `
## 摘要结构要求
压缩摘要必须以"## 压缩摘要"开头，并按以下结构组织：

## 压缩摘要

### 已解决事项
- [已完成的事项，含关键决策]

### 待解决事项
- [尚未解决的问题，含阻碍原因]

### 活跃任务
- [正在进行的工作，含当前状态]

### 关键决策
- [影响后续工作的决策及理由]

### 资源
- [文件路径/URL/标识符列表]

### 用户偏好
- [用户表达的偏好或约束]

### 承诺
- [AI 对用户的承诺]

### 开放问题
- [需要用户澄清的问题]
`.trim();

/**
 * 摘要前缀，用于劫持防护。
 * 压缩后的摘要必须以此前缀开头，否则视为摘要劫持。
 */
export const SUMMARY_PREFIX = '## 压缩摘要';

/**
 * 检测摘要是否被劫持（不以规定前缀开头）。
 * @param summary - AI 生成的摘要文本
 * @returns true 表示摘要被劫持，应触发重试
 */
export function isSummaryHijacked(summary: string): boolean {
  if (!summary) return true;
  const trimmed = summary.trimStart();
  return !trimmed.startsWith(SUMMARY_PREFIX);
}

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
