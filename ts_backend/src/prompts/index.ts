/**
 * 提示词模块入口
 *
 * 统一导出所有提示词加载函数、常量和迁移工具，
 * 供业务模块按需引入。
 */
export { getMainChatPrompt } from './systemPrompts.js';
export { getSessionMemoryPrompt } from './sessionMemoryPrompt.js';
export { buildCompactPrompt, formatCompactSummary } from './compactPrompt.js';
export {
  ENTRYPOINT_NAME as DREAM_ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES_STR,
  DIR_EXISTS_GUIDANCE,
  buildConsolidationPrompt,
  buildExtraContext,
} from './dreamPrompt.js';
export {
  loadPromptFile,
  loadMainPrompt,
  loadToolRules,
  loadPersistentMemory,
  loadSessionMemoryPrompt,
  loadCompactPrompt,
  migrateMainPromptToDb,
} from './loader.js';
export { PROMPT_DIR, PROMPT_PATHS } from './paths.js';
export { migratePromptDir } from './migrator.js';
