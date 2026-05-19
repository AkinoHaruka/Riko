// 上下文压缩提示词：构建压缩指令（可附加自定义说明），格式化压缩结果
import { loadFile } from './loader.js';
import { PROMPT_PATHS } from './paths.js';
export function buildCompactPrompt(customInstructions?: string | null): string {
  const prompt = loadFile(PROMPT_PATHS.compactPrompt, '');
  if (customInstructions) {
    return prompt + '\n\n' + customInstructions;
  }
  return prompt;
}

export function formatCompactSummary(summary: string): string {
  let result = summary.replace(/<analysis>[\s\S]*?<\/analysis>/g, '');
  result = result.replace(/<summary>([\s\S]*?)<\/summary>/g, 'Summary:\n$1');
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}
