/**
 * 记忆路由集成测试
 *
 * 测试 /memories 端点的完整 CRUD 流程，包括：
 * - 列表查询（全部 / 按类型筛选）
 * - 关键词搜索
 * - 创建（含参数校验）
 * - 单条删除、按来源批量删除、清空全部
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

describe('Memory Routes', () => {
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

  // ── 查询 ──

  it('GET /memories - 200 返回所有记忆', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'user_name', content: '张三', type: 'fact' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('memories');
    expect(body.memories.length).toBe(1);
    expect(body.memories[0].key).toBe('user_name');
  });

  it('GET /memories?type=fact - 200 按类型筛选', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'fact1', content: '事实1', type: 'fact' },
    });
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'pref1', content: '偏好1', type: 'preference' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/memories?type=fact',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.memories.length).toBe(1);
    expect(body.memories[0].type).toBe('fact');
  });

  // 搜索接口同时匹配 key 和 content 字段
  it('GET /memories/search?keyword=test - 200 搜索记忆', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'test_key', content: '测试内容', type: 'fact' },
    });
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'other_key', content: '其他内容', type: 'fact' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/memories/search?keyword=test',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.memories.length).toBe(1);
    expect(body.memories[0].key).toBe('test_key');
  });

  // ── 创建 ──

  it('POST /memories - 200 创建记忆', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'hobby', content: '编程', source: 'chat', type: 'preference' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.key).toBe('hobby');
    expect(body.content).toBe('编程');
    expect(body.source).toBe('chat');
    expect(body.type).toBe('preference');
  });

  it('POST /memories - 400 key 和 content 不能为空', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: '', content: '' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error_code).toBe('VALIDATION_ERROR');
  });

  // ── 删除 ──

  it('DELETE /memories/:id - 200 删除记忆', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'to_delete', content: '待删除', type: 'fact' },
    });
    const { id } = createRes.json();

    const response = await app.inject({
      method: 'DELETE',
      url: `/memories/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBe('记忆已删除');
    expect(body.id).toBe(id);
  });

  // 按来源批量删除，只删除匹配 source 的记录
  it('DELETE /memories/by-source?source=x - 200 按来源删除', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'k1', content: 'c1', source: 'chat', type: 'fact' },
    });
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'k2', content: 'c2', source: 'chat', type: 'fact' },
    });
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'k3', content: 'c3', source: 'dream', type: 'fact' },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/memories/by-source?source=chat',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.deleted_count).toBe(2);
  });

  it('DELETE /memories/clear - 200 清空所有记忆', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'k1', content: 'c1', type: 'fact' },
    });
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'k2', content: 'c2', type: 'fact' },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/memories/clear',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.deleted_count).toBe(2);

    const listRes = await app.inject({
      method: 'GET',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.json().memories.length).toBe(0);
  });
});
