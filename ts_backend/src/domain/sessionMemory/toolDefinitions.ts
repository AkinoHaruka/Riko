/**
 * 会话笔记子代理可用的工具定义。包含文件读写和搜索工具集合。
 */
import { buildEditToolDefinition } from '../../tools/editFile/definition.js';
import { buildWriteToolDefinition } from '../../tools/writeFile/definition.js';
import { buildGrepToolDefinition } from '../../tools/grep/definition.js';
import { buildLsToolDefinition } from '../../tools/listFiles/definition.js';
import { buildCatToolDefinition } from '../../tools/readFile/definition.js';
export function buildAllToolDefinitions(): Array<Record<string, unknown>> {
  return [
    buildEditToolDefinition(), // Edit
    buildWriteToolDefinition(), // Write
    buildCatToolDefinition(), // Read
    buildGrepToolDefinition(), // Grep
    buildLsToolDefinition(), // Glob
  ];
}
