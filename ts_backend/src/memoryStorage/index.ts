/**
 * 记忆存储模块入口
 *
 * 统一导出记忆存储子模块的公共 API，包括：
 * - paths：目录和文件路径管理
 * - types：类型定义和常量
 * - scanner：记忆文件扫描
 * - migrator：数据迁移工具
 */
export {
  getMemoryRoot,
  getSystemPromptsDir,
  isAutoMemoryEnabled,
  getAutoDreamRoot,
  getAutoDreamIndexPath,
  getAutoDreamLockPath,
  ensureAutoDreamDirExists,
  ensureMemoryDirExists,
} from './paths.js';

export {
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES,
  MAX_ENTRYPOINT_BYTES,
  MAX_MEMORY_FILES,
  FRONTMATTER_MAX_LINES,
  MEMORY_TYPES,
  MEMORY_TYPES_INFO,
  WHAT_NOT_TO_SAVE,
  type MemoryHeader,
  parseMemoryType,
  truncateEntrypointContent,
} from './types.js';

export { scanMemoryFiles, formatMemoryManifest } from './scanner.js';

export {
  migrateAutoDreamFiles,
  migrateAutoDreamNestedStructure,
  migrateSessionNotesToSessionMemory,
  migrateSystemPrompts,
} from './migrator.js';
