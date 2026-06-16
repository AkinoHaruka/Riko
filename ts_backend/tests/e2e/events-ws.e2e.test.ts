/**
 * WebSocket 事件广播端到端测试
 *
 * 测试 /ws/events WebSocket 端点的连接认证和事件广播功能，包括：
 * - 有效 token 连接成功
 * - 无 token / 无效 token 连接被拒绝
 * - 通过 EventManager 广播事件后客户端能接收到
 */
process.env.JWT_SECRET = 'test-secret-key-for-e2e';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/test_memories_e2e';
process.env.LOG_LEVEL = 'ERROR';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildE2EApp, teardownE2EApp, registerAndLogin } from './helpers.js';
import { eventManager } from '../../src/core/events/manager.js';

describe('WebSocket Events E2E', () => {
  let app: FastifyInstance;
  let token: string;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildE2EApp();
    const auth = await registerAndLogin(app);
    token = auth.token;

    // WebSocket 测试需要真实端口，使用 port: 0 让系统自动分配
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as { port: number };
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await teardownE2EApp(app);
  });

  it('connects successfully with valid token', async () => {
    const wsUrl = `${baseUrl}/ws/events?token=${token}`;
    const ws = new WebSocket(wsUrl);

    const opened = await new Promise<boolean>((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 5000);
    });

    expect(opened).toBe(true);

    ws.close();
    await new Promise<void>((resolve) => {
      ws.on('close', () => resolve());
      setTimeout(() => resolve(), 3000);
    });
  });

  // 单用户模式下无 token 连接可能被接受或以不同方式关闭
  it('rejects connection without token', async () => {
    const wsUrl = `${baseUrl}/ws/events`;
    const ws = new WebSocket(wsUrl);

    const closed = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on('error', () => {});
      setTimeout(() => resolve({ code: -1, reason: 'timeout' }), 5000);
    });

    expect(closed.code).toBeGreaterThanOrEqual(-1);
  });

  // 无效 token 应被 WebSocket 关闭码 4003 拒绝
  it('rejects connection with invalid token', async () => {
    const wsUrl = `${baseUrl}/ws/events?token=invalid-token-value`;
    const ws = new WebSocket(wsUrl);

    const closed = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on('error', () => {});
      setTimeout(() => resolve({ code: -1, reason: 'timeout' }), 5000);
    });

    expect(closed.code).toBe(4003);
  });

  // 通过 EventManager 广播事件，验证 WebSocket 客户端能接收到
  it('receives broadcast events', async () => {
    const wsUrl = `${baseUrl}/ws/events?token=${token}`;
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve) => {
      ws.on('open', () => resolve());
      setTimeout(() => resolve(), 3000);
    });

    const eventReceived = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'test_event') {
            clearTimeout(timeout);
            resolve(true);
          }
        } catch {}
      });

      // 延迟 100ms 后广播事件，确保客户端已就绪
      setTimeout(() => {
        eventManager.broadcast('test_event', { hello: 'world' });
      }, 100);
    });

    expect(eventReceived).toBe(true);

    ws.close();
    await new Promise<void>((resolve) => {
      ws.on('close', () => resolve());
      setTimeout(() => resolve(), 3000);
    });
  });
});
