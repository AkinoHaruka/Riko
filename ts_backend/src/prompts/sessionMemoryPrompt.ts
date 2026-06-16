/**
 * 会话记忆提示词加载
 *
 * 读取 AI 提取会话摘要时使用的提示词模板。
 * 会话记忆功能在每轮对话结束后自动提取关键信息，
 * 供后续对话和梦境整合使用。
 */
import { loadFile } from './loader.js';
import { PROMPT_PATHS } from './paths.js';

/** 加载会话记忆提取提示词模板 */
export function getSessionMemoryPrompt(): string {
  return loadFile(PROMPT_PATHS.sessionMemoryPrompt, '');
}
