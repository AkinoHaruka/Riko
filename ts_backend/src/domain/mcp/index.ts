/**
 * MCP 模块统一导出
 *
 * @module domain/mcp
 */

export type {
  McpTransportType,
  McpStdioConfig,
  McpHttpConfig,
  McpServerConfig,
  NamedMcpServerConfig,
  McpConnectionStatus,
  McpConnectionInfo,
} from './types.js';

export { buildMcpToolName, parseMcpToolName } from './types.js';
export { connectMcpServer, disconnectMcpServer, connectMcpServers, disconnectAllMcpServers, getMcpConnections } from './manager.js';
export { loadMcpConfig, saveMcpConfig } from './config.js';
