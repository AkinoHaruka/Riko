// 提示词文件路径常量：定义所有提示词模板的文件路径
import path from 'path';

export const PROMPT_DIR = process.env.PROMPT_DIR || './data/prompts';

export const PROMPT_PATHS = {
  mainPrompt: path.join(PROMPT_DIR, 'main_prompt.md'),
  toolRules: path.join(PROMPT_DIR, 'tool_rules.md'),
  sessionMemoryPrompt: path.join(PROMPT_DIR, 'session_memory_prompt.md'),
  compactPrompt: path.join(PROMPT_DIR, 'compact_prompt.md'),
  dreamPrompt: path.join(PROMPT_DIR, 'dream_prompt.md'),
  workflow: path.join(PROMPT_DIR, 'workflow.md'),
} as const;
