/**
 * MCP 工具定义生成器
 *
 * 为动态注册的 MCP 工具生成 OpenAI function schema。
 * MCP 工具的名称格式为 mcp__{server}__{tool}，
 * 在 AI 请求时动态注入到工具列表中。
 *
 * @module tools/mcpToolDefinitions
 */

import { toolRegistry } from './registry.js';
import { parseMcpToolName } from '../domain/mcp/types.js';

/** 内置工具名称集合（这些工具已有静态定义，不需要动态生成） */
const BUILTIN_TOOL_NAMES = new Set([
  'Edit', 'Write', 'Read', 'Grep', 'Glob',
  'Find', 'Stat', 'Wc', 'Head', 'Tail',
  'SearchMemory', 'SkillsList', 'SkillView',
]);

/**
 * 为所有已注册的 MCP 工具生成 OpenAI function schema。
 *
 * 每次请求时调用，确保动态注册/注销的 MCP 工具能被 AI 发现。
 */
export function buildMcpToolDefinitions(): Array<Record<string, unknown>> {
  const definitions: Array<Record<string, unknown>> = [];

  for (const toolName of toolRegistry.listNames()) {
    // 跳过内置工具
    if (BUILTIN_TOOL_NAMES.has(toolName)) continue;

    // 只为 MCP 工具（mcp__ 前缀）生成定义
    const parsed = parseMcpToolName(toolName);
    if (!parsed) continue;

    definitions.push({
      type: 'function',
      function: {
        name: toolName,
        description: `MCP tool from "${parsed.serverName}": ${parsed.toolName}. Use this tool when the user's request matches its capability.`,
        parameters: {
          type: 'object',
          properties: {
            // MCP 工具参数在调用时由 AI 自行推断
            // 这里使用通用 object schema，实际参数由 MCP Server 定义
          },
        },
      },
    });
  }

  return definitions;
}
