/**
 * 会话记忆提示构建器。提供 Token 估算、章节大小分析、超限提醒生成以及系统提示扩展功能。
 *
 * 核心流程：
 * 1. analyzeSectionSizes — 解析笔记文件的 Markdown 章节，估算各章节 Token 数
 * 2. generateSectionReminders — 对超限章节生成精简提醒
 * 3. buildSystemPromptExtension — 组装完整的系统提示扩展（注入到主对话的 system prompt 中）
 * 4. buildSessionMemorySubAgentPrompt — 组装子代理专用提示（独立的多轮对话）
 */
import { getSessionMemoryPrompt } from '../../prompts/sessionMemoryPrompt.js';
import { SESSION_MEMORY_TEMPLATE } from './manager.js';
import { MAX_SECTION_LENGTH, MAX_TOTAL_SESSION_MEMORY_TOKENS } from './types.js';
import type { SectionSizes } from './types.js';
import { estimateTextTokens } from '../compact/tokenEstimator.js';
import { sanitizeUntrustedContent } from '../chat/types.js';

/** 将模板中的 {{变量名}} 替换为实际值，未匹配的变量保持原样 */
export function substituteVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key]! : match,
  );
}

// 统一使用 compact/tokenEstimator 中的估算函数，保持全项目一致性
export function estimateTokenCount(text: string): number {
  return estimateTextTokens(text);
}

/** Markdown 章节标题正则，匹配 # 开头的标题行 */
const SECTION_HEADER_PATTERN = /^#{1,6}\s+.+$/;

/**
 * 分析笔记文件中各章节的 Token 大小。
 * 按 Markdown 标题切分章节，估算每节的 Token 数。
 * @param content 笔记文件内容
 * @returns 章节标题 → Token 数的映射
 */
export function analyzeSectionSizes(content: string): SectionSizes {
  const sections: SectionSizes = {};
  const lines = content.split('\n');
  let currentSection = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    if (SECTION_HEADER_PATTERN.test(line)) {
      if (currentSection && currentContent.length > 0) {
        const sectionContent = currentContent.join('\n').trim();
        sections[currentSection] = estimateTokenCount(sectionContent);
      }
      currentSection = line;
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentSection && currentContent.length > 0) {
    const sectionContent = currentContent.join('\n').trim();
    sections[currentSection] = estimateTokenCount(sectionContent);
  }

  return sections;
}

/**
 * 生成章节超限提醒文本。当总 Token 超预算或单章节超限时，生成对应的警告信息。
 * @param sectionSizes 各章节的 Token 大小
 * @param totalTokens 笔记总 Token 数
 * @returns 提醒文本，无超限时返回空字符串
 */
export function generateSectionReminders(sectionSizes: SectionSizes, totalTokens: number): string {
  const overBudget = totalTokens > MAX_TOTAL_SESSION_MEMORY_TOKENS;
  const oversizedSections = Object.entries(sectionSizes)
    .filter(([_, tokens]) => tokens > MAX_SECTION_LENGTH)
    .sort(([, a], [, b]) => b - a);

  if (oversizedSections.length === 0 && !overBudget) {
    return '';
  }

  const parts: string[] = [];

  if (overBudget) {
    parts.push(
      `\n\n严重警告：会话笔记文件当前约 ${totalTokens} 个 token，` +
        `已超过上限 ${MAX_TOTAL_SESSION_MEMORY_TOKENS}。你必须精简文件以适应预算。` +
        `请积极缩短过长章节，合并相关条目，精简旧条目。` +
        `优先保持"当前状态与未竟之事"和"误解与修正"的准确性和详细度。`,
    );
  }

  if (oversizedSections.length > 0) {
    const items = oversizedSections
      .map(([s, t]) => `- "${s}" 约 ${t} 个 token（上限：${MAX_SECTION_LENGTH}）`)
      .join('\n');
    const label = overBudget ? '需要精简的超长章节' : '以下章节超出单章节限制，必须精简';
    parts.push(`\n\n${label}：\n${items}`);
  }

  return parts.join('');
}

/**
 * 构建注入到主对话 system prompt 的会话记忆扩展。
 * 包含笔记系统说明、当前笔记内容、章节超限提醒。
 * 笔记内容由 AI 自动写入，属于不可信数据，需净化后用边界标签包裹。
 * @param notesContent 当前笔记内容
 * @param conversationId 会话 ID，用于生成笔记文件路径
 */
export function buildSystemPromptExtension(
  notesContent: string,
  conversationId: number | undefined,
): string {
  const promptTemplate = getSessionMemoryPrompt();
  const templateContent = SESSION_MEMORY_TEMPLATE;
  const effectiveNotes = notesContent.trim() ? notesContent : templateContent;

  const notesPath = conversationId != null ? `session_memory/${conversationId}_*.md` : '';

  // 净化笔记内容，移除可能干扰上下文边界标记的 XML 标签
  const sanitizedNotes = sanitizeUntrustedContent(effectiveNotes);

  const variables: Record<string, string> = {
    notesPath,
    currentNotes: sanitizedNotes,
  };

  const basePrompt = substituteVariables(promptTemplate, variables);

  const sectionSizes = analyzeSectionSizes(effectiveNotes);
  const totalTokens = estimateTokenCount(effectiveNotes);
  const sectionReminders = generateSectionReminders(sectionSizes, totalTokens);

  const header =
    '\n\n---\n\n## 会话记忆系统\n\n你拥有一个会话笔记系统，可以在对话过程中使用工具来记录和更新对话中的重要信息。当对话内容足够丰富时，请主动选用合适的工具更新笔记。\n';

  return header + basePrompt + sectionReminders;
}

/**
 * 构建子代理专用的会话记忆提示。与 buildSystemPromptExtension 不同，
 * 此函数不包含系统说明头部，仅包含提示词模板和章节提醒。
 * @param notesPath 笔记文件相对路径
 * @param currentNotes 当前笔记内容
 * @param memoryRoot 记忆根目录路径
 */
export function buildSessionMemorySubAgentPrompt(
  notesPath: string,
  currentNotes: string,
  memoryRoot?: string,
): string {
  const promptTemplate = getSessionMemoryPrompt();
  const effectiveNotes = currentNotes.trim() ? currentNotes : SESSION_MEMORY_TEMPLATE;
  const variables: Record<string, string> = {
    notesPath,
    currentNotes: effectiveNotes,
    memoryRoot: memoryRoot ?? '',
  };
  const basePrompt = substituteVariables(promptTemplate, variables);
  const sectionSizes = analyzeSectionSizes(effectiveNotes);
  const totalTokens = estimateTokenCount(effectiveNotes);
  const sectionReminders = generateSectionReminders(sectionSizes, totalTokens);

  return basePrompt + sectionReminders;
}

/**
 * 将会话记忆更新内容注入到消息列表中。在指定位置后插入一条 system 消息，
 * 用 <session-memory-update> 标签包裹，便于前端识别和渲染。
 * @param messages 原始消息列表
 * @param updateContent 更新内容
 * @param insertAfterIndex 插入位置（在该索引之后插入）
 */
export function injectSessionMemoryUpdate(
  messages: Array<{ role: string; content: string }>,
  updateContent: string,
  insertAfterIndex: number,
): Array<{ role: string; content: string }> {
  const wrappedContent = `<session-memory-update>\n${updateContent}\n</session-memory-update>`;
  const systemMessage = { role: 'system', content: wrappedContent };

  const result = [...messages];
  const clampedIndex = Math.max(0, Math.min(insertAfterIndex, result.length));
  result.splice(clampedIndex + 1, 0, systemMessage);

  return result;
}
