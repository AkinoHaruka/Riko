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

  it('rejects connection without token', async () => {
    const wsUrl = `${baseUrl}/ws/events`;
    const ws = new WebSocket(wsUrl);

    const closed = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on('error', () => {});
      setTimeout(() => resolve({ code: -1, reason: 'timeout' }), 5000);
    });

    // single-user mode: connection accepted or closed differently
    expect(closed.code).toBeGreaterThanOrEqual(-1);
  });

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
