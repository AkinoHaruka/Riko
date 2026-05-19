/**
 * 会话记忆提示构建器。提供 Token 估算、章节大小分析、超限提醒生成以及系统提示扩展功能。
 */
import { getSessionMemoryPrompt } from '../../prompts/sessionMemoryPrompt.js';
import { SESSION_MEMORY_TEMPLATE } from './manager.js';
import { MAX_SECTION_LENGTH, MAX_TOTAL_SESSION_MEMORY_TOKENS } from './types.js';
import type { SectionSizes } from './types.js';

export function substituteVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key]! : match,
  );
}

const CJK_RANGES: [number, number][] = [
  [0x4e00, 0x9fff],
  [0x3000, 0x303f],
  [0xff00, 0xffef],
];

export function estimateTokenCount(text: string): number {
  let cjkCount = 0;
  let otherCount = 0;

  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const isCjk = CJK_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
    if (isCjk) {
      cjkCount++;
    } else {
      otherCount++;
    }
  }

  return Math.floor(cjkCount / 1.5 + otherCount / 4);
}

const SECTION_HEADER_PATTERN = /^#{1,6}\s+.+$/;

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

export function buildSystemPromptExtension(
  notesContent: string,
  conversationId: number | undefined,
): string {
  const promptTemplate = getSessionMemoryPrompt();
  const templateContent = SESSION_MEMORY_TEMPLATE;
  const effectiveNotes = notesContent.trim() ? notesContent : templateContent;

  const notesPath = conversationId != null ? `session_memory/${conversationId}_*.md` : '';

  const variables: Record<string, string> = {
    notesPath,
    currentNotes: effectiveNotes,
  };

  const basePrompt = substituteVariables(promptTemplate, variables);

  const sectionSizes = analyzeSectionSizes(effectiveNotes);
  const totalTokens = estimateTokenCount(effectiveNotes);
  const sectionReminders = generateSectionReminders(sectionSizes, totalTokens);

  const header =
    '\n\n---\n\n## 会话记忆系统\n\n你拥有一个会话笔记系统，可以在对话过程中使用工具来记录和更新对话中的重要信息。当对话内容足够丰富时，请主动选用合适的工具更新笔记。\n';

  return header + basePrompt + sectionReminders;
}

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
