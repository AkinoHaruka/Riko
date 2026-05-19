// 记忆存储模块入口：统一导出路径/类型定义/扫描/迁移工具
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
