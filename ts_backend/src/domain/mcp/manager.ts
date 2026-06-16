/**
 * MCP 客户端管理器
 *
 * 管理 MCP Server 的连接生命周期：连接、工具发现、工具调用、断开。
 * 支持 Stdio 和 HTTP 两种传输方式。
 *
 * 设计原则：
 * - 每个 MCP Server 独立管理，互不影响
 * - 工具发现后自动注册到 Riko 的 toolRegistry
 * - 连接失败不影响其他 Server
 * - 支持运行时动态添加/移除 Server
 *
 * @module domain/mcp/manager
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  McpServerConfig,
  McpStdioConfig,
  McpHttpConfig,
  McpConnectionInfo,
  McpConnectionStatus,
  NamedMcpServerConfig,
} from './types.js';
import { buildMcpToolName } from './types.js';
import { toolRegistry } from '../../tools/registry.js';
import type { ToolHandler, ToolContext, ToolCallResult } from '../../core/types/tools.js';
import { createLogger } from '../../core/logger/index.js';
import { eventManager } from '../../core/events/index.js';

const logger = createLogger('McpManager');

/** 连接超时（毫秒） */
const CONNECT_TIMEOUT = 30_000;

/** 内部连接状态 */
interface ManagedConnection {
  name: string;
  config: McpServerConfig;
  client: Client | null;
  /** Stdio 传输层引用，用于在 client 为 null 时手动杀死子进程 */
  transport: StdioClientTransport | StreamableHTTPClientTransport | null;
  status: McpConnectionStatus;
  error?: string;
  toolNames: string[];
}

/** 所有活跃连接 */
const connections = new Map<string, ManagedConnection>();

/**
 * 连接到单个 MCP Server。
 *
 * 建立 transport，初始化 MCP Client，发现工具并注册到 toolRegistry。
 *
 * @param serverConfig - 带名称的 Server 配置
 * @returns 连接信息
 */
export async function connectMcpServer(serverConfig: NamedMcpServerConfig): Promise<McpConnectionInfo> {
  const { name, config } = serverConfig;

  // 如果已有连接，先断开
  if (connections.has(name)) {
    await disconnectMcpServer(name);
  }

  const conn: ManagedConnection = {
    name,
    config,
    client: null,
    transport: null,
    status: 'connecting',
    toolNames: [],
  };
  connections.set(name, conn);

  try {
    // 创建 transport
    const transport = await createTransport(config);
    conn.transport = transport;

    // 创建 MCP Client
    const client = new Client(
      { name: 'riko-mcp-client', version: '1.0.0' },
      { capabilities: {} },
    );

    // 带超时的连接
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('连接超时')), CONNECT_TIMEOUT),
      ),
    ]);

    conn.client = client;
    conn.status = 'connected';

    // 发现工具
    const toolsResult = await client.request(
      { method: 'tools/list' },
      // 使用 SDK 提供的 schema 进行响应校验
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );

    // 注册工具到 toolRegistry
    const tools = toolsResult?.tools ?? [];
    for (const tool of tools) {
      const fqn = buildMcpToolName(name, tool.name);
      const handler = createMcpToolHandler(fqn, name, tool.name, tool.description ?? '', client);
      toolRegistry.register(handler);
      conn.toolNames.push(fqn);
    }

    conn.status = 'connected';
    logger.info('MCP Server 已连接: %s (%d 个工具)', name, tools.length);

    eventManager.emit('mcp:server:connected', { name, toolCount: tools.length });

    return {
      name,
      status: 'connected',
      toolCount: tools.length,
    };
  } catch (e) {
    conn.status = 'failed';
    conn.error = e instanceof Error ? e.message : String(e);
    logger.warn('MCP Server 连接失败: %s — %s', name, conn.error);

    // 连接失败时，确保子进程被杀死
    // client.close() 内部会调用 transport.close()，杀死子进程
    // 若 client 未创建（transport 阶段就失败了），则手动关闭 transport
    try {
      if (conn.client) {
        await conn.client.close();
      } else if (conn.transport) {
        await conn.transport.close();
      }
    } catch {
      // 忽略关闭错误
    }
    conn.client = null;
    conn.transport = null;

    eventManager.emit('mcp:server:error', { name, error: conn.error });

    return {
      name,
      status: 'failed',
      error: conn.error,
    };
  }
}

/**
 * 断开 MCP Server 连接，注销其所有工具。
 *
 * 关闭顺序：
 * 1. 先调用 client.close()（内部会调用 transport.close()，发送关闭通知后杀死子进程）
 * 2. 若 client 为 null（连接未完成），手动关闭 transport 杀死子进程
 */
export async function disconnectMcpServer(name: string): Promise<void> {
  const conn = connections.get(name);
  if (!conn) return;

  // 注销工具
  for (const toolName of conn.toolNames) {
    toolRegistry.unregister(toolName);
  }

  // 关闭连接：client.close() 内部会调用 transport.close()，正确杀死子进程
  try {
    if (conn.client) {
      await conn.client.close();
    } else if (conn.transport) {
      // client 未创建时（如连接超时），手动关闭 transport 确保子进程被杀死
      await conn.transport.close();
    }
  } catch (e) {
    logger.warn('关闭 MCP Server 连接时出错: %s — %s', name, e instanceof Error ? e.message : String(e));
    // 即使关闭出错，仍需尝试强制杀死子进程
    if (conn.transport instanceof StdioClientTransport) {
      const pid = conn.transport.pid;
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
          logger.info('强制杀死 MCP 子进程: %s (pid: %d)', name, pid);
        } catch {
          // 进程可能已退出
        }
      }
    }
  }

  conn.client = null;
  conn.transport = null;
  connections.delete(name);

  eventManager.emit('mcp:server:disconnected', { name });

  logger.info('MCP Server 已断开: %s', name);
}

/**
 * 获取所有 MCP Server 的连接状态。
 */
export function getMcpConnections(): McpConnectionInfo[] {
  return [...connections.values()].map((conn) => ({
    name: conn.name,
    status: conn.status,
    error: conn.error,
    toolCount: conn.toolNames.length,
  }));
}

/**
 * 批量连接多个 MCP Server。
 *
 * 并发连接，单个失败不影响其他。
 */
export async function connectMcpServers(servers: NamedMcpServerConfig[]): Promise<McpConnectionInfo[]> {
  const results = await Promise.allSettled(
    servers
      .filter((s) => s.enabled !== false)
      .map((s) => connectMcpServer(s)),
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      name: servers[i].name,
      status: 'failed' as const,
      error: r.reason?.message ?? String(r.reason),
    };
  });
}

/**
 * 断开所有 MCP Server。
 */
export async function disconnectAllMcpServers(): Promise<void> {
  const names = [...connections.keys()];
  await Promise.all(names.map((n) => disconnectMcpServer(n)));
}

// ---- 内部辅助 ----

/** 创建传输层 */
async function createTransport(config: McpServerConfig) {
  if (config.type === 'stdio' || !config.type) {
    const stdioConfig = config as McpStdioConfig;
    return new StdioClientTransport({
      command: stdioConfig.command,
      args: stdioConfig.args ?? [],
      env: { ...process.env, ...stdioConfig.env } as Record<string, string>,
      stderr: 'pipe',
    });
  }

  if (config.type === 'http') {
    const httpConfig = config as McpHttpConfig;
    return new StreamableHTTPClientTransport(new URL(httpConfig.url), {
      requestInit: {
        headers: httpConfig.headers,
      },
    });
  }

  throw new Error(`不支持的 MCP 传输类型: ${(config as McpServerConfig).type}`);
}

/** 为单个 MCP 工具创建 ToolHandler */
function createMcpToolHandler(
  fqn: string,
  serverName: string,
  toolName: string,
  _description: string,
  client: Client,
): ToolHandler {
  return {
    name: fqn,

    execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolCallResult> {
      return callMcpTool(client, serverName, toolName, args);
    },
  };
}

/** 调用 MCP 工具 */
async function callMcpTool(
  client: Client,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  eventManager.emit('mcp:tool:called', { serverName, toolName, args });

  try {
    const result = await client.request(
      {
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );

    // MCP 工具返回 content 数组
    const content = result?.content ?? [];
    const textParts = content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((c: any) => c.type === 'text')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => c.text as string);

    // MCP 工具返回 isError 标志
    const isError = result?.isError === true;

    return {
      success: !isError,
      output: textParts.join('\n') || '(无输出)',
      ...(isError ? { error: textParts.join('\n') || 'MCP 工具执行失败' } : {}),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('MCP 工具调用失败: %s/%s — %s', serverName, toolName, msg);
    return {
      success: false,
      error: `MCP 工具调用失败 (${serverName}/${toolName}): ${msg}`,
    };
  }
}
