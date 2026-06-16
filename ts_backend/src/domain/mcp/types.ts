/**
 * MCP 客户端类型定义
 *
 * 定义 MCP Server 配置、连接状态、工具映射等核心类型。
 *
 * @module domain/mcp/types
 */

/** MCP Server 传输类型 */
export type McpTransportType = 'stdio' | 'http';

/** Stdio 传输配置：启动本地子进程 */
export interface McpStdioConfig {
  type: 'stdio';
  /** 要执行的命令，如 "npx"、"node"、"uvx" */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 额外环境变量 */
  env?: Record<string, string>;
}

/** HTTP 传输配置：连接远程 MCP Server */
export interface McpHttpConfig {
  type: 'http';
  /** Server URL */
  url: string;
  /** 自定义请求头 */
  headers?: Record<string, string>;
}

/** MCP Server 配置联合类型 */
export type McpServerConfig = McpStdioConfig | McpHttpConfig;

/** 带名称的 MCP Server 配置（运行时使用） */
export interface NamedMcpServerConfig {
  /** Server 唯一名称 */
  name: string;
  /** 传输配置 */
  config: McpServerConfig;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

/** MCP Server 连接状态 */
export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed';

/** MCP Server 连接信息 */
export interface McpConnectionInfo {
  /** Server 名称 */
  name: string;
  /** 连接状态 */
  status: McpConnectionStatus;
  /** 错误信息（仅 failed 状态） */
  error?: string;
  /** Server 提供的工具数量 */
  toolCount?: number;
}

/** MCP 工具在 Riko 工具注册表中的名称格式：mcp__{server}__{tool} */
export function buildMcpToolName(serverName: string, toolName: string): string {
  // 将非字母数字字符替换为下划线，避免工具名中出现特殊字符
  const normalize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');
  return `mcp__${normalize(serverName)}__${normalize(toolName)}`;
}

/** 解析 MCP 工具名，返回 [serverName, toolName] 或 null */
export function parseMcpToolName(fqn: string): { serverName: string; toolName: string } | null {
  const match = fqn.match(/^mcp__(.+)__(.+)$/);
  if (!match) return null;
  return { serverName: match[1], toolName: match[2] };
}
