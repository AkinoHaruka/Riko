/**
 * 提示词文件路径常量
 *
 * 定义所有提示词模板的文件路径，统一管理避免路径散落各处。
 * PROMPT_DIR 可通过环境变量 PROMPT_DIR 覆盖。
 */
import path from 'path';

/** 提示词文件根目录，默认 ./data/prompts */
export const PROMPT_DIR = process.env.PROMPT_DIR || './data/prompts';

/** 各提示词模板的完整文件路径 */
export const PROMPT_PATHS = {
  /** 主聊天 System Prompt */
  mainPrompt: path.join(PROMPT_DIR, 'main_prompt.md'),
  /** 工具使用规则 */
  toolRules: path.join(PROMPT_DIR, 'tool_rules.md'),
  /** 会话记忆提取提示词 */
  sessionMemoryPrompt: path.join(PROMPT_DIR, 'session_memory_prompt.md'),
  /** 上下文压缩提示词 */
  compactPrompt: path.join(PROMPT_DIR, 'compact_prompt.md'),
  /** 梦境整合提示词 */
  dreamPrompt: path.join(PROMPT_DIR, 'dream_prompt.md'),
  /** 工作流提示词 */
  workflow: path.join(PROMPT_DIR, 'workflow.md'),
} as const;
