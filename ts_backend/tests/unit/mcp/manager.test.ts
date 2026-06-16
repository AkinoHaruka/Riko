/**
 * MCP 客户端管理器单元测试
 *
 * 测试 MCP Server 的连接、工具发现、断开等核心生命周期管理。
 * 使用 vi.mock 模拟 @modelcontextprotocol/sdk 的 Client 和 transport。
 *
 * 注意：vi.mock 工厂函数会被 vitest 提升到文件顶部执行，
 * 因此工厂内引用的变量必须通过 vi.hoisted() 声明，
 * 否则会出现 "Cannot access before initialization" 错误。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- 使用 vi.hoisted() 声明 mock 函数，确保 vi.mock 工厂可引用 ----

const {
  mockConnect,
  mockClose,
  mockRequest,
  mockTransportClose,
  mockRegister,
  mockUnregister,
} = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockClose: vi.fn(),
  mockRequest: vi.fn(),
  mockTransportClose: vi.fn(),
  mockRegister: vi.fn(),
  mockUnregister: vi.fn(),
}));

// ---- Mock MCP SDK ----

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function() {
    return {
      connect: mockConnect,
      close: mockClose,
      request: mockRequest,
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(function() {
    return { close: mockTransportClose };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function() {
    return { close: mockTransportClose };
  }),
}));

// ---- Mock toolRegistry ----

vi.mock('../../../src/tools/registry.js', () => ({
  toolRegistry: {
    register: mockRegister,
    unregister: mockUnregister,
  },
}));

// ---- Mock logger ----

vi.mock('../../../src/core/logger/index.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  connectMcpServer,
  disconnectMcpServer,
  getMcpConnections,
  connectMcpServers,
  disconnectAllMcpServers,
} from '../../../src/domain/mcp/manager.js';

/** 构造一个标准 stdio 配置 */
function makeStdioConfig(name: string) {
  return {
    name,
    config: { type: 'stdio' as const, command: 'npx', args: ['test-server'] },
  };
}

describe('MCP Manager', () => {
  beforeEach(() => {
    // 重置所有 mock 调用记录
    vi.clearAllMocks();
    // 默认行为：connect 成功
    mockConnect.mockResolvedValue(undefined);
    // 默认行为：tools/list 返回空工具列表
    mockRequest.mockResolvedValue({ tools: [] });
  });

  afterEach(async () => {
    // 清理模块级 connections Map，避免测试间状态泄漏
    await disconnectAllMcpServers();
  });

  // ---- connectMcpServer ----

  describe('connectMcpServer()', () => {
    it('连接成功时返回 connected + toolCount', async () => {
      mockRequest.mockResolvedValue({
        tools: [
          { name: 'read', description: '读取文件' },
          { name: 'write', description: '写入文件' },
        ],
      });

      const result = await connectMcpServer(makeStdioConfig('fs'));

      expect(result).toEqual({
        name: 'fs',
        status: 'connected',
        toolCount: 2,
      });
    });

    it('连接超时返回 failed', async () => {
      // 模拟 connect 永远不 resolve，触发超时
      mockConnect.mockImplementation(
        () => new Promise(() => { /* 永不 resolve */ }),
      );

      // 使用 vi.useFakeTimers 加速超时
      vi.useFakeTimers();

      const connectPromise = connectMcpServer(makeStdioConfig('slow'));

      // 推进时间超过 CONNECT_TIMEOUT（30s）
      await vi.advanceTimersByTimeAsync(35_000);

      const result = await connectPromise;

      expect(result.status).toBe('failed');
      expect(result.error).toContain('超时');

      vi.useRealTimers();
    });

    it('连接抛出异常返回 failed', async () => {
      mockConnect.mockRejectedValue(new Error('连接被拒绝'));

      const result = await connectMcpServer(makeStdioConfig('bad'));

      expect(result).toEqual({
        name: 'bad',
        status: 'failed',
        error: '连接被拒绝',
      });
    });

    it('已有连接时先断开再重连', async () => {
      mockRequest.mockResolvedValue({
        tools: [{ name: 'tool1', description: '' }],
      });

      // 第一次连接
      await connectMcpServer(makeStdioConfig('fs'));

      // 第二次连接同名 server，应先断开旧连接
      await connectMcpServer(makeStdioConfig('fs'));

      // unregister 应被调用（断开旧连接时注销工具）
      expect(mockUnregister).toHaveBeenCalled();
      // 最终只有一组工具注册
      const connections = getMcpConnections();
      expect(connections).toHaveLength(1);
      expect(connections[0].name).toBe('fs');
    });

    it('工具发现并注册到 toolRegistry', async () => {
      mockRequest.mockResolvedValue({
        tools: [
          { name: 'read', description: '读取文件' },
          { name: 'write', description: '写入文件' },
        ],
      });

      await connectMcpServer(makeStdioConfig('my-server'));

      // 应注册 2 个工具，名称格式为 mcp__{server}__{tool}
      expect(mockRegister).toHaveBeenCalledTimes(2);
      expect(mockRegister).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'mcp__my_server__read' }),
      );
      expect(mockRegister).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'mcp__my_server__write' }),
      );
    });
  });

  // ---- disconnectMcpServer ----

  describe('disconnectMcpServer()', () => {
    it('正常断开并注销工具', async () => {
      mockRequest.mockResolvedValue({
        tools: [{ name: 'tool1', description: '' }],
      });

      await connectMcpServer(makeStdioConfig('fs'));
      await disconnectMcpServer('fs');

      // 工具应被注销
      expect(mockUnregister).toHaveBeenCalledWith('mcp__fs__tool1');
      // 连接列表应为空
      expect(getMcpConnections()).toHaveLength(0);
    });

    it('不存在的 name 不报错', async () => {
      // 断开一个从未连接过的 server，应静默返回
      await expect(disconnectMcpServer('nonexistent')).resolves.toBeUndefined();
    });
  });

  // ---- getMcpConnections ----

  describe('getMcpConnections()', () => {
    it('返回所有连接状态', async () => {
      mockRequest.mockResolvedValue({ tools: [] });

      await connectMcpServer(makeStdioConfig('server-a'));
      await connectMcpServer({
        name: 'server-b',
        config: { type: 'http' as const, url: 'http://localhost:8080/mcp' },
      });

      const connections = getMcpConnections();
      expect(connections).toHaveLength(2);
      expect(connections.map((c) => c.name).sort()).toEqual(['server-a', 'server-b']);
      // 所有连接状态应为 connected
      expect(connections.every((c) => c.status === 'connected')).toBe(true);
    });

    it('包含失败连接的状态', async () => {
      mockConnect.mockRejectedValue(new Error('连接失败'));

      await connectMcpServer(makeStdioConfig('bad'));

      const connections = getMcpConnections();
      expect(connections).toHaveLength(1);
      expect(connections[0].status).toBe('failed');
      expect(connections[0].error).toBe('连接失败');
    });
  });

  // ---- connectMcpServers ----

  describe('connectMcpServers()', () => {
    it('enabled:false 被跳过', async () => {
      const servers = [
        { ...makeStdioConfig('active'), enabled: true },
        { ...makeStdioConfig('inactive'), enabled: false },
      ];

      const results = await connectMcpServers(servers);

      // 只有 active 的连接结果
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('active');
    });

    it('单个失败不影响其他', async () => {
      const servers = [
        makeStdioConfig('good-a'),
        makeStdioConfig('good-b'),
      ];

      // 让第二个 server 的连接失败
      mockConnect
        .mockResolvedValueOnce(undefined)  // good-a 成功
        .mockRejectedValueOnce(new Error('连接失败')); // good-b 失败

      const results = await connectMcpServers(servers);

      expect(results).toHaveLength(2);
      expect(results.find((r) => r.name === 'good-a')?.status).toBe('connected');
      expect(results.find((r) => r.name === 'good-b')?.status).toBe('failed');
    });
  });

  // ---- disconnectAllMcpServers ----

  describe('disconnectAllMcpServers()', () => {
    it('断开所有连接', async () => {
      mockRequest.mockResolvedValue({ tools: [] });

      await connectMcpServer(makeStdioConfig('s1'));
      await connectMcpServer(makeStdioConfig('s2'));

      expect(getMcpConnections()).toHaveLength(2);

      await disconnectAllMcpServers();

      expect(getMcpConnections()).toHaveLength(0);
    });
  });
});
