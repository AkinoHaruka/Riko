/**
 * MCP Server 配置加载
 *
 * 从 JSON 配置文件加载 MCP Server 列表。
 * 配置文件路径：data/mcp_servers.json
 *
 * 配置格式：
 * ```json
 * {
 *   "mcpServers": {
 *     "filesystem": {
 *       "type": "stdio",
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
 *     },
 *     "remote-api": {
 *       "type": "http",
 *       "url": "http://localhost:8080/mcp"
 *     }
 *   }
 * }
 * ```
 *
 * @module domain/mcp/config
 */

import fs from 'fs';
import path from 'path';
import type { NamedMcpServerConfig, McpServerConfig } from './types.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('McpConfig');

/** 配置文件中的顶层结构 */
interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * 从 JSON 文件加载 MCP Server 配置。
 *
 * @param configPath - 配置文件路径
 * @returns 带名称的 Server 配置列表
 */
export function loadMcpConfig(configPath: string): NamedMcpServerConfig[] {
  if (!fs.existsSync(configPath)) {
    logger.info('MCP 配置文件不存在: %s', configPath);
    return [];
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as McpConfigFile;

    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      logger.warn('MCP 配置文件格式错误: 缺少 mcpServers 字段');
      return [];
    }

    const servers: NamedMcpServerConfig[] = [];
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      if (!serverConfig || typeof serverConfig !== 'object') {
        logger.warn('跳过无效的 MCP Server 配置: %s', name);
        continue;
      }
      servers.push({ name, config: serverConfig as McpServerConfig });
    }

    logger.info('加载了 %d 个 MCP Server 配置', servers.length);
    return servers;
  } catch (e) {
    logger.warn('加载 MCP 配置失败: %s — %s', configPath, e instanceof Error ? e.message : String(e));
    return [];
  }
}

/**
 * 保存 MCP Server 配置到 JSON 文件。
 */
export function saveMcpConfig(configPath: string, servers: NamedMcpServerConfig[]): void {
  const mcpServers: Record<string, McpServerConfig> = {};
  for (const server of servers) {
    mcpServers[server.name] = server.config;
  }

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2), 'utf-8');
  logger.info('保存了 %d 个 MCP Server 配置', servers.length);
}
