/**
 * 梦境提示词，从 prompts/dreamPrompt.js 直接导出。
 */
import { buildConsolidationPrompt } from '../../prompts/dreamPrompt.js';

export { buildConsolidationPrompt };

export function buildDreamSubAgentPrompt(
  memoryRoot: string,
  sessionIds: string[],
  transcriptDir: string,
  residentMemoryPath: string,
  residentMemoryContent: string,
): string {
  return buildConsolidationPrompt(
    memoryRoot,
    transcriptDir || '',
    sessionIds,
    residentMemoryPath,
    residentMemoryContent,
    '',
  );
}
