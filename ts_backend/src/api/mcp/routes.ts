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

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { connectMcpServer, disconnectMcpServer, getMcpConnections } from '../../domain/mcp/index.js';
import { loadMcpConfig, saveMcpConfig } from '../../domain/mcp/config.js';
import type { NamedMcpServerConfig } from '../../domain/mcp/types.js';
import { getCurrentUser } from '../../core/middleware/index.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('McpRoutes');

/** MCP 配置文件路径（启动时注入） */
let configPath = '';

/** 初始化路由时设置配置文件路径 */
export function setMcpConfigPath(path: string): void {
  configPath = path;
}

/** Server 名称白名单：字母、数字、下划线、连字符，1-64 字符 */
const SERVER_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Stdio 配置 Zod schema */
const stdioConfigSchema = z.object({
  type: z.literal('stdio'),
  command: z.string().min(1).max(256),
  args: z.array(z.string().max(1024)).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

/** HTTP 配置 Zod schema */
const httpConfigSchema = z.object({
  type: z.literal('http'),
  url: z.string().url().max(2048),
  headers: z.record(z.string(), z.string()).optional(),
});

/** MCP Server 配置联合 schema（区分 type 字段） */
const serverConfigSchema = z.discriminatedUnion('type', [stdioConfigSchema, httpConfigSchema]);

/** 创建 Server 请求体 schema */
const createServerBodySchema = z.object({
  name: z.string().regex(SERVER_NAME_RE, 'name 仅允许字母、数字、下划线和连字符，长度 1-64'),
  config: serverConfigSchema,
});

/**
 * 校验 :name 路径参数，不合法时返回 400。
 * @returns 校验通过返回 name，否则返回 null（已发送错误响应）
 */
function validateServerName(name: unknown, reply: FastifyReply): string | null {
  if (typeof name !== 'string' || !SERVER_NAME_RE.test(name)) {
    reply.status(400).send({ error: 'name 仅允许字母、数字、下划线和连字符，长度 1-64' });
    return null;
  }
  return name;
}

export async function mcpRoutes(fastify: FastifyInstance): Promise<void> {
  // 列出所有 MCP Server 及连接状态
  fastify.get('/mcp/servers', async (request, reply) => {
    // 显式校验认证，确保未登录用户无法访问
    getCurrentUser(request);
    const connections = getMcpConnections();
    return reply.send({ servers: connections });
  });

  // 添加并连接新 MCP Server
  fastify.post('/mcp/servers', async (request, reply) => {
    getCurrentUser(request);

    const parsed = createServerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      const message = firstError ? firstError.message : '请求参数无效';
      logger.warn('创建 MCP Server 参数校验失败: %s', firstError?.path.join('.'));
      return reply.status(400).send({ error: message });
    }

    const { name, config } = parsed.data;
    const serverConfig: NamedMcpServerConfig = { name, config };

    // 连接
    const result = await connectMcpServer(serverConfig);

    // 持久化配置
    if (result.status === 'connected') {
      const existing = loadMcpConfig(configPath);
      const updated = existing.filter((s) => s.name !== name);
      updated.push(serverConfig);
      saveMcpConfig(configPath, updated);
    }

    return reply.send(result);
  });

  // 断开并移除 MCP Server
  fastify.delete('/mcp/servers/:name', async (request, reply) => {
    getCurrentUser(request);

    const { name: rawName } = request.params as { name: string };
    const name = validateServerName(rawName, reply);
    if (name === null) return;

    await disconnectMcpServer(name);

    // 从配置中移除
    const existing = loadMcpConfig(configPath);
    const updated = existing.filter((s) => s.name !== name);
    saveMcpConfig(configPath, updated);

    return reply.send({ success: true, name });
  });

  // 重新连接指定 MCP Server
  fastify.post('/mcp/servers/:name/reconnect', async (request, reply) => {
    getCurrentUser(request);

    const { name: rawName } = request.params as { name: string };
    const name = validateServerName(rawName, reply);
    if (name === null) return;

    const existing = loadMcpConfig(configPath);
    const server = existing.find((s) => s.name === name);

    if (!server) {
      return reply.status(404).send({ error: `未找到 MCP Server: ${name}` });
    }

    const result = await connectMcpServer(server);
    return reply.send(result);
  });
}
