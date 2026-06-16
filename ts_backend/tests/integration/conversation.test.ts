/**
 * 会话路由集成测试
 *
 * 测试 /conversations 端点的 CRUD 操作，包括创建、列表、更新标题、
 * 更新归档状态、删除、404 处理，以及单用户模式下无 token 自动登录行为。
 */
process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/memories';
process.env.SYSTEM_PROMPTS_DIR = './data/system_prompts';
process.env.LOG_LEVEL = 'ERROR';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, teardownApp, registerUser } from './helpers.js';

describe('Conversation Routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await buildApp();
    const auth = await registerUser(app);
    token = auth.token;
  });

  afterEach(async () => {
    await teardownApp(app);
  });

  it('POST /conversations - 201 创建会话', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '测试会话' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.title).toBe('测试会话');
    expect(body).toHaveProperty('id');
    expect(body.is_archived).toBe(0);
  });

  it('GET /conversations - 200 返回会话列表', async () => {
    await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '会话1' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].title).toBe('会话1');
  });

  it('PUT /conversations/:id - 200 更新标题', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '原始标题' },
    });
    const { id } = createRes.json();

    const response = await app.inject({
      method: 'PUT',
      url: `/conversations/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '新标题' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.title).toBe('新标题');
  });

  it('PUT /conversations/:id - 200 更新 is_archived', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '会话' },
    });
    const { id } = createRes.json();

    const response = await app.inject({
      method: 'PUT',
      url: `/conversations/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { is_archived: 1 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.is_archived).toBe(1);
  });

  it('DELETE /conversations/:id - 200 删除会话', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '待删除' },
    });
    const { id } = createRes.json();

    const response = await app.inject({
      method: 'DELETE',
      url: `/conversations/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBe('删除成功');
  });

  it('PUT /conversations/:id - 404 不存在的会话', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/conversations/nonexistent-id',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '不存在' },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toContain('不存在或无权');
  });

  // 单用户模式：未携带 token 时自动以默认用户身份登录，不会返回 401
  it('无 token 请求 - 自动以默认用户登录', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/conversations',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
