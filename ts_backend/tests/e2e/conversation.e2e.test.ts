process.env.JWT_SECRET = 'test-secret-key-for-e2e';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/test_memories_e2e';
process.env.LOG_LEVEL = 'ERROR';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildE2EApp, teardownE2EApp, registerAndLogin } from './helpers.js';

describe('Conversation E2E', () => {
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

  it('创建会话', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'E2E测试会话' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.title).toBe('E2E测试会话');
    expect(body).toHaveProperty('id');
    expect(body.is_archived).toBe(0);
  });

  it('获取会话列表', async () => {
    await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '会话1' },
    });
    await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '会话2' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });

  it('更新会话标题', async () => {
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

  it('更新会话归档状态', async () => {
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

  it('删除会话', async () => {
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

  it('删除会话后关联消息也被删除', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '级联删除测试' },
    });
    const { id } = createRes.json();

    await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { conversation_id: id, role: 'user', content: '消息1' },
    });
    await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { conversation_id: id, role: 'assistant', content: '消息2' },
    });

    await app.inject({
      method: 'DELETE',
      url: `/conversations/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const msgRes = await app.inject({
      method: 'GET',
      url: `/messages?conversationId=${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(msgRes.json().length).toBe(0);
  });

  it('不存在的会话返回 404', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/conversations/99999',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '不存在' },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toContain('不存在或无权');
  });

  it('未认证请求 - 单用户模式自动登录', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/conversations',
    });

    expect(response.statusCode).toBe(200);
  });
});
