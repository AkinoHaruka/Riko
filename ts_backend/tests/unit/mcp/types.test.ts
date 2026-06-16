/**
 * MCP 类型工具函数单元测试
 */
import { describe, it, expect } from 'vitest';
import { buildMcpToolName, parseMcpToolName } from '../../../src/domain/mcp/types.js';

describe('buildMcpToolName', () => {
  it('正常名称', () => {
    expect(buildMcpToolName('fs', 'read')).toBe('mcp__fs__read');
  });

  it('含连字符的 server 名称', () => {
    expect(buildMcpToolName('my-server', 'read')).toBe('mcp__my_server__read');
  });

  it('含点的 tool 名称', () => {
    expect(buildMcpToolName('fs', 'tool.name')).toBe('mcp__fs__tool_name');
  });

  it('含空格的名称', () => {
    expect(buildMcpToolName('my server', 'my tool')).toBe('mcp__my_server__my_tool');
  });

  it('下划线保留', () => {
    expect(buildMcpToolName('my_server', 'my_tool')).toBe('mcp__my_server__my_tool');
  });

  it('数字保留', () => {
    expect(buildMcpToolName('server1', 'tool2')).toBe('mcp__server1__tool2');
  });
});

describe('parseMcpToolName', () => {
  it('正常解析', () => {
    expect(parseMcpToolName('mcp__fs__read')).toEqual({
      serverName: 'fs',
      toolName: 'read',
    });
  });

  it('含下划线的名称', () => {
    expect(parseMcpToolName('mcp__my_server__my_tool')).toEqual({
      serverName: 'my_server',
      toolName: 'my_tool',
    });
  });

  it('非 MCP 工具名返回 null', () => {
    expect(parseMcpToolName('Read')).toBeNull();
  });

  it('只有一个下划线段返回 null', () => {
    expect(parseMcpToolName('mcp__fs')).toBeNull();
  });

  it('空字符串返回 null', () => {
    expect(parseMcpToolName('')).toBeNull();
  });

  it('无 mcp 前缀返回 null', () => {
    expect(parseMcpToolName('fs__read')).toBeNull();
  });

  it('三段以上下划线取最后一段为 toolName', () => {
    // mcp__a_b__c → serverName="a_b", toolName="c"
    expect(parseMcpToolName('mcp__a_b__c')).toEqual({
      serverName: 'a_b',
      toolName: 'c',
    });
  });
});
