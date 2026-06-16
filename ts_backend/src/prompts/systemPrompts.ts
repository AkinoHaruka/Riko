/**
 * 主聊天 System Prompt 加载
 *
 * 从提示词文件读取 AI 角色设定的 System Prompt。
 * 此提示词会在每次聊天请求中作为系统消息发送给 AI，
 * 定义 AI 的行为方式和角色定位。
 */
import { PROMPT_PATHS } from './paths.js';
import { loadFile } from './loader.js';

/** 加载主聊天 System Prompt 模板 */
export function getMainChatPrompt(): string {
  return loadFile(PROMPT_PATHS.mainPrompt, '');
}
