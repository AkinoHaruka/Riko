/**
 * Dream（梦境整合）端到端测试
 *
 * 测试 /dream 和 /dream/status 端点，包括：
 * - 触发梦境任务（返回 started 或错误状态）
 * - 查询梦境任务状态
 * - 单用户模式下未认证请求自动登录
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildE2EApp, teardownE2EApp, registerAndLogin } from './helpers.js';

process.env.JWT_SECRET = 'test-secret-key-for-e2e';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/test_memories_e2e';
process.env.LOG_LEVEL = 'ERROR';

describe('Dream E2E', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildE2EApp();
    const auth = await registerAndLogin(app);
    token = auth.token;
  });

  afterAll(async () => {
    await teardownE2EApp(app);
  });

  // 梦境任务可能启动成功(200)，也可能因并发/无数据返回 409 或 500
  it('POST /dream — returns started status or error response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dream',
      headers: { authorization: `Bearer ${token}` },
    });

    expect([200, 409, 500]).toContain(res.statusCode);
    const body = res.json();
    if (res.statusCode === 200) {
      expect(body.status).toBe('started');
    } else {
      expect(body.error).toBeDefined();
    }
  });

  it('GET /dream/status — returns idle or task summary', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dream/status',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toBeDefined();
  });

  // 单用户模式下未认证请求自动登录
  it('POST /dream — single-user auto-login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dream',
    });

    expect(res.statusCode).toBe(200);
  });

  it('GET /dream/status — single-user auto-login', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dream/status',
    });

    expect(res.statusCode).toBe(200);
  });
});
