/**
 * MCP 管理 API 路由
 *
 * 提供 MCP Server 的增删查和连接管理接口。
 *
 * GET    /mcp/servers       — 列出所有 Server 及连接状态
 * POST   /mcp/servers       — 添加并连接新 Server
 * DELETE /mcp/servers/:name — 断开并移除 Server
 * POST   /mcp/servers/:name/reconnect — 重新连接指定 Server
 */

import type { FastifyInstance } from 'fastify';
import { connectMcpServer, disconnectMcpServer, getMcpConnections } from '../../domain/mcp/index.js';
import { loadMcpConfig, saveMcpConfig } from '../../domain/mcp/config.js';
import type { NamedMcpServerConfig, McpServerConfig } from '../../domain/mcp/types.js';
import { createLogger } from '../../core/logger/index.js';

const _logger = createLogger('McpRoutes');

/** MCP 配置文件路径（启动时注入） */
let configPath = '';

/** 初始化路由时设置配置文件路径 */
export function setMcpConfigPath(path: string): void {
  configPath = path;
}

export async function mcpRoutes(fastify: FastifyInstance): Promise<void> {
  // 列出所有 MCP Server 及连接状态
  fastify.get('/mcp/servers', async (_request, reply) => {
    const connections = getMcpConnections();
    return reply.send({ servers: connections });
  });

  // 添加并连接新 MCP Server
  fastify.post('/mcp/servers', async (request, reply) => {
    const body = request.body as { name: string; config: McpServerConfig };
    if (!body?.name || !body?.config) {
      return reply.status(400).send({ error: '缺少 name 或 config 字段' });
    }

    const serverConfig: NamedMcpServerConfig = {
      name: body.name,
      config: body.config,
    };

    // 连接
    const result = await connectMcpServer(serverConfig);

    // 持久化配置
    if (result.status === 'connected') {
      const existing = loadMcpConfig(configPath);
      const updated = existing.filter((s) => s.name !== body.name);
      updated.push(serverConfig);
      saveMcpConfig(configPath, updated);
    }

    return reply.send(result);
  });

  // 断开并移除 MCP Server
  fastify.delete('/mcp/servers/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    await disconnectMcpServer(name);

    // 从配置中移除
    const existing = loadMcpConfig(configPath);
    const updated = existing.filter((s) => s.name !== name);
    saveMcpConfig(configPath, updated);

    return reply.send({ success: true, name });
  });

  // 重新连接指定 MCP Server
  fastify.post('/mcp/servers/:name/reconnect', async (request, reply) => {
    const { name } = request.params as { name: string };
    const existing = loadMcpConfig(configPath);
    const server = existing.find((s) => s.name === name);

    if (!server) {
      return reply.status(404).send({ error: `未找到 MCP Server: ${name}` });
    }

    const result = await connectMcpServer(server);
    return reply.send(result);
  });
}
