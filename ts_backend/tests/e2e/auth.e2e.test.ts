/**
 * 认证端到端测试
 *
 * 测试完整的用户认证流程，包括：
 * - 注册→登录→访问受保护资源的完整链路
 * - JWT token 格式校验（三段式）
 * - 单用户模式下无 token / 无效 token 自动登录行为
 * - 重复注册 409、错误密码 401、健康检查无需认证
 */
process.env.JWT_SECRET = 'test-secret-key-for-e2e';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/test_memories_e2e';
process.env.LOG_LEVEL = 'ERROR';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildE2EApp, teardownE2EApp, registerAndLogin } from './helpers.js';

describe('Auth E2E', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildE2EApp();
  });

  afterEach(async () => {
    await teardownE2EApp(app);
  });

  // 完整业务流程：注册 → 登录 → 用 token 访问受保护资源
  it('完整注册→登录→访问受保护资源流程', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'flowuser', password: 'password123' },
    });
    expect(regRes.statusCode).toBe(200);
    const { token } = regRes.json();

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'flowuser', password: 'password123' },
    });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toHaveProperty('token');

    const protectedRes = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(protectedRes.statusCode).toBe(200);
  });

  // 校验返回的 token 是标准 JWT 格式（header.payload.signature）
  it('注册返回有效 JWT token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'tokenuser', password: 'password123' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('token');
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.').length).toBe(3);
    expect(body).toHaveProperty('user');
    expect(body.user).toHaveProperty('id');
    expect(body.user.username).toBe('tokenuser');
  });

  it('使用 token 访问受保护端点成功', async () => {
    const { token } = await registerAndLogin(app);

    const response = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  // 单用户模式：未携带 token 时自动以默认用户身份登录
  it('无 token 访问 - 单用户模式自动登录', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/conversations',
    });

    expect(response.statusCode).toBe(200);
  });

  // 单用户模式：无效 token 也会自动降级为默认用户
  it('无效 token 访问 - 单用户模式自动登录', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: { authorization: 'Bearer invalid.token.here' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('重复用户名注册返回 409', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'duplicate', password: 'password123' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'duplicate', password: 'password456' },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error).toContain('已被注册');
  });

  it('错误密码登录返回 401', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'loginuser', password: 'password123' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'loginuser', password: 'wrongpassword' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error).toContain('用户名或密码错误');
  });

  it('健康检查端点无需认证', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
  });
});
