/**
 * 梦境提示词构建。
 * 封装梦境整固提示词的生成逻辑，将记忆根路径、会话 ID 列表、
 * 常驻记忆内容等组装为 SubAgent 可用的提示词。
 */
import { buildConsolidationPrompt } from '../../prompts/dreamPrompt.js';

export { buildConsolidationPrompt };

/**
 * 构建梦境子代理提示词。
 * @param memoryRoot - 记忆文件根目录
 * @param sessionIds - 待审查的会话 ID 列表
 * @param transcriptDir - 转录日志目录
 * @param residentMemoryPath - 常驻记忆文件路径
 * @param residentMemoryContent - 常驻记忆文件当前内容
 * @returns 完整的梦境整固提示词文本
 */
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
