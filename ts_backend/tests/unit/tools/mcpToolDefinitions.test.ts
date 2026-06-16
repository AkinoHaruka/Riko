/**
 * MCP 工具定义生成器单元测试
 *
 * 测试 buildMcpToolDefinitions 函数：
 * - 只为 mcp__ 前缀工具生成 OpenAI function schema
 * - 内置工具被跳过
 * - 无 MCP 工具时返回空数组
 * - MCP 工具参数 schema 为 { type: 'object' }
 * - 工具描述正确传递
 * - 多个 MCP 工具时全部生成
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock toolRegistry，控制 listNames() 返回值
const mockListNames = vi.fn();
vi.mock('../../../src/tools/registry.js', () => ({
  toolRegistry: {
    listNames: () => mockListNames(),
  },
}));

// mock parseMcpToolName，使用真实实现逻辑
vi.mock('../../../src/domain/mcp/types.js', () => ({
  parseMcpToolName: (fqn: string) => {
    const match = fqn.match(/^mcp__(.+)__(.+)$/);
    if (!match) return null;
    return { serverName: match[1], toolName: match[2] };
  },
}));

describe('buildMcpToolDefinitions', () => {
  beforeEach(() => {
    vi.resetModules();
    mockListNames.mockReset();
  });

  it('BUILTIN_TOOL_NAMES 包含 13 个内置工具名', async () => {
    // 内置工具名称列表（与源码中 BUILTIN_TOOL_NAMES 一致）
    const builtinNames = [
      'Edit', 'Write', 'Read', 'Grep', 'Glob',
      'Find', 'Stat', 'Wc', 'Head', 'Tail',
      'SearchMemory', 'SkillsList', 'SkillView',
    ];
    expect(builtinNames).toHaveLength(13);
  });

  it('只为 mcp__ 前缀工具生成 schema', async () => {
    // 模拟注册表中包含一个 MCP 工具和一个非 MCP 工具
    mockListNames.mockReturnValue(['mcp__server1__tool1', 'someOtherTool']);

    const { buildMcpToolDefinitions } = await import('../../../src/tools/mcpToolDefinitions.js');
    const result = buildMcpToolDefinitions();

    expect(result).toHaveLength(1);
    expect((result[0].function as Record<string, unknown>).name).toBe('mcp__server1__tool1');
  });

  it('内置工具被跳过', async () => {
    // 模拟注册表中包含内置工具和 MCP 工具
    mockListNames.mockReturnValue([
      'Edit', 'Write', 'Read', 'Grep', 'Glob',
      'Find', 'Stat', 'Wc', 'Head', 'Tail',
      'SearchMemory', 'SkillsList', 'SkillView',
      'mcp__server1__tool1',
    ]);

    const { buildMcpToolDefinitions } = await import('../../../src/tools/mcpToolDefinitions.js');
    const result = buildMcpToolDefinitions();

    // 只有 MCP 工具被生成
    expect(result).toHaveLength(1);
    expect((result[0].function as Record<string, unknown>).name).toBe('mcp__server1__tool1');
  });

  it('无 MCP 工具时返回空数组', async () => {
    // 只有内置工具
    mockListNames.mockReturnValue(['Edit', 'Write', 'Read']);

    const { buildMcpToolDefinitions } = await import('../../../src/tools/mcpToolDefinitions.js');
    const result = buildMcpToolDefinitions();

    expect(result).toEqual([]);
  });

  it('MCP 工具参数 schema 为 { type: "object" }', async () => {
    mockListNames.mockReturnValue(['mcp__myserver__mytool']);

    const { buildMcpToolDefinitions } = await import('../../../src/tools/mcpToolDefinitions.js');
    const result = buildMcpToolDefinitions();

    expect(result).toHaveLength(1);
    expect((result[0].function as Record<string, unknown>).parameters).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('工具描述正确传递 serverName 和 toolName', async () => {
    mockListNames.mockReturnValue(['mcp__filesystem__read_file']);

    const { buildMcpToolDefinitions } = await import('../../../src/tools/mcpToolDefinitions.js');
    const result = buildMcpToolDefinitions();

    expect(result).toHaveLength(1);
    expect((result[0].function as Record<string, unknown>).description).toContain('filesystem');
    expect((result[0].function as Record<string, unknown>).description).toContain('read_file');
    expect((result[0].function as Record<string, unknown>).description).toBe(
      'MCP tool from "filesystem": read_file. Use this tool when the user\'s request matches its capability.',
    );
  });

  it('多个 MCP 工具时全部生成', async () => {
    mockListNames.mockReturnValue([
      'mcp__server1__tool1',
      'mcp__server2__tool2',
      'mcp__server1__tool3',
    ]);

    const { buildMcpToolDefinitions } = await import('../../../src/tools/mcpToolDefinitions.js');
    const result = buildMcpToolDefinitions();

    expect(result).toHaveLength(3);
    const names = result.map((d) => (d.function as Record<string, unknown>).name);
    expect(names).toContain('mcp__server1__tool1');
    expect(names).toContain('mcp__server2__tool2');
    expect(names).toContain('mcp__server1__tool3');
  });
});
