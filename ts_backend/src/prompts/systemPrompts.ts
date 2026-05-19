// 主聊天 System Prompt 加载：从提示词文件读取 AI 角色设定提示词
import { PROMPT_PATHS } from './paths.js';
import { loadFile } from './loader.js';

export function getMainChatPrompt(): string {
  return loadFile(PROMPT_PATHS.mainPrompt, '');
}
