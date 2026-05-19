// 梦境记忆整合提示词：构建 AI 整合指令，将多轮对话提炼为结构化记忆文件
export const ENTRYPOINT_NAME = 'INDEX.md';
export const MAX_ENTRYPOINT_LINES_STR = '200';
export const DIR_EXISTS_GUIDANCE = '';

import { createLogger } from '../core/logger/index.js';
const logger = createLogger('DreamPrompt');

import { loadFile } from './loader.js';
import { PROMPT_PATHS } from './paths.js';

export function buildConsolidationPrompt(
  memoryRoot: string,
  transcriptDir: string,
  sessionIds: string[],
  residentMemoryPath: string,
  residentMemoryContent: string,
  extra?: string,
): string {
  let prompt = loadFile(PROMPT_PATHS.dreamPrompt, '');
  prompt = prompt.replace(/\$\{memoryRoot\}/g, memoryRoot);
  prompt = prompt.replace(/\$\{transcriptDir\}/g, transcriptDir);
  prompt = prompt.replace(/\$\{ENTRYPOINT_NAME\}/g, ENTRYPOINT_NAME);
  prompt = prompt.replace(/\$\{DIR_EXISTS_GUIDANCE\}/g, DIR_EXISTS_GUIDANCE);
  prompt = prompt.replace(/\$\{MAX_ENTRYPOINT_LINES\}/g, MAX_ENTRYPOINT_LINES_STR);
  prompt = prompt.replace(/\$\{RESIDENT_MEMORY_PATH\}/g, residentMemoryPath);
  prompt = prompt.replace(
    /\$\{RESIDENT_MEMORY_CONTENT\}/g,
    residentMemoryContent || '(尚无常驻记忆)',
  );

  if (extra) {
    prompt = prompt + '\n\n' + extra;
  }

  logger.debug(
    '整合提示已构建 memory_root=%s sessions=%d extra_len=%d',
    memoryRoot,
    sessionIds.length,
    extra?.length ?? 0,
  );

  return prompt;
}

export function buildExtraContext(memoryRoot: string, sessionIds: string[]): string {
  const count = sessionIds.length;
  const lines: string[] = [
    '**Tool constraints for this run:**',
    `- File Edit/Write operations are restricted to files within the memory directory: ${memoryRoot}`,
    '- You may read any file for context using Read tool',
    '- You may search codebase with Grep tool for understanding',
    '',
    `Sessions since last consolidation (${count}):`,
  ];
  for (const sid of sessionIds) {
    lines.push(`- ${sid}`);
  }

  return lines.join('\n');
}
