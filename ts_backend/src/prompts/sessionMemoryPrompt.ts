// 会话记忆提示词加载：读取 AI 提取会话摘要时使用的提示词模板
import { loadFile } from './loader.js';
import { PROMPT_PATHS } from './paths.js';

export function getSessionMemoryPrompt(): string {
  return loadFile(PROMPT_PATHS.sessionMemoryPrompt, '');
}
