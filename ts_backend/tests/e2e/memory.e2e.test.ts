/**
 * 记忆端到端测试
 *
 * 测试 /memories 端点的完整 CRUD 流程，包括：
 * - 创建记忆、获取列表、按关键词搜索
 * - 按来源批量删除、清空全部、单条删除
 * - 不存在的记忆返回 404
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

describe('Memory E2E', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await buildE2EApp();
    const auth = await registerAndLogin(app);
    token = auth.token;
  });

  afterEach(async () => {
    await teardownE2EApp(app);
  });

  it('创建记忆', async () => {
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

  it('获取记忆列表', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'user_name', content: '张三', type: 'fact' },
    });
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'user_age', content: '25', type: 'fact' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('memories');
    expect(body.memories.length).toBe(2);
  });

  // 搜索接口同时匹配 key 和 content 字段
  it('搜索记忆（按关键词）', async () => {
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

  // 按来源批量删除，验证只删除匹配 source 的记录
  it('按来源删除记忆', async () => {
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

    const listRes = await app.inject({
      method: 'GET',
      url: '/memories',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.json().memories.length).toBe(1);
  });

  it('清空所有记忆', async () => {
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

  it('删除单条记忆', async () => {
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

  it('不存在的记忆返回 404', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/memories/99999',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toContain('记忆不存在');
  });
});
