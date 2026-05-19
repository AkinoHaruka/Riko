// 工具模块入口：统一导出所有工具实现和 initializeTools 函数
export * from './types.js';
export * from './editFile/index.js';
export * from './writeFile/index.js';
export * from './grep/index.js';
export * from './findFiles/index.js';
export * from './listFiles/index.js';
export * from './readFile/index.js';
export * from './fileStats/index.js';
export { executeWc, countFileStats, buildWcToolDefinition } from './wordCount/index.js';
export * from './readHead/index.js';
export * from './readTail/index.js';
export { toolRegistry } from './registry.js';
export { validateSessionMemoryPath, sanitizeSearchPath } from './pathSecurity.js';

import { toolRegistry } from './registry.js';
import { editToolHandler } from './editFile/handler.js';
import { writeToolHandler } from './writeFile/handler.js';
import { grepToolHandler } from './grep/handler.js';
import { lsToolHandler } from './listFiles/handler.js';
import { catToolHandler } from './readFile/handler.js';
import { memorySearchToolHandler } from './memorySearch/handler.js';
export function initializeTools(): void {
  toolRegistry.register(editToolHandler); // Edit
  toolRegistry.register(writeToolHandler); // Write
  toolRegistry.register(catToolHandler); // Read
  toolRegistry.register(grepToolHandler); // Grep
  toolRegistry.register(lsToolHandler); // Glob
  toolRegistry.register(memorySearchToolHandler); // SearchMemory
}
