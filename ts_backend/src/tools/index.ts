/**
 * 工具模块入口
 *
 * 统一导出所有工具的类型定义、执行函数和 OpenAI function schema，
 * 并提供 initializeTools() 将各工具处理器注册到全局工具注册表。
 */
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
export * from './memorySearch/index.js';
export * from './skillsList/index.js';
export * from './skillView/index.js';
export { buildMcpToolDefinitions } from './mcpToolDefinitions.js';
export { toolRegistry } from './registry.js';
export { validateSessionMemoryPath, sanitizeSearchPath } from './pathSecurity.js';

import { toolRegistry } from './registry.js';
import { editToolHandler } from './editFile/handler.js';
import { writeToolHandler } from './writeFile/handler.js';
import { grepToolHandler } from './grep/handler.js';
import { lsToolHandler } from './listFiles/handler.js';
import { catToolHandler } from './readFile/handler.js';
import { memorySearchToolHandler } from './memorySearch/handler.js';
import { findToolHandler } from './findFiles/handler.js';
import { statToolHandler } from './fileStats/handler.js';
import { wcToolHandler } from './wordCount/handler.js';
import { headToolHandler } from './readHead/handler.js';
import { tailToolHandler } from './readTail/handler.js';
import { skillsListToolHandler } from './skillsList/handler.js';
import { skillViewToolHandler } from './skillView/handler.js';

/**
 * 初始化工具注册表，将所有内置工具处理器注册到全局 registry。
 * 应在应用启动时调用一次。
 */
export function initializeTools(): void {
  toolRegistry.register(editToolHandler); // Edit
  toolRegistry.register(writeToolHandler); // Write
  toolRegistry.register(catToolHandler); // Read
  toolRegistry.register(grepToolHandler); // Grep
  toolRegistry.register(lsToolHandler); // Glob
  toolRegistry.register(memorySearchToolHandler); // SearchMemory
  toolRegistry.register(findToolHandler); // Find
  toolRegistry.register(statToolHandler); // Stat
  toolRegistry.register(wcToolHandler); // Wc
  toolRegistry.register(headToolHandler); // Head
  toolRegistry.register(tailToolHandler); // Tail
  toolRegistry.register(skillsListToolHandler); // SkillsList
  toolRegistry.register(skillViewToolHandler); // SkillView
}
