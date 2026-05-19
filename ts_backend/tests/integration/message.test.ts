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

async function createConversation(app: FastifyInstance, token: string, title = '测试会话') {
  const res = await app.inject({
    method: 'POST',
    url: '/conversations',
    headers: { authorization: `Bearer ${token}` },
    payload: { title },
  });
  return res.json() as { id: number };
}

describe('Message Routes', () => {
  let app: FastifyInstance;
  let token: string;
  let conversationId: number;

  beforeEach(async () => {
    app = await buildApp();
    const auth = await registerUser(app);
    token = auth.token;
    const conv = await createConversation(app, token);
    conversationId = conv.id;
  });

  afterEach(async () => {
    await teardownApp(app);
  });

  it('POST /messages - 201 创建消息', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        conversation_id: conversationId,
        role: 'user',
        content: '你好',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.role).toBe('user');
    expect(body.content).toBe('你好');
    expect(body.conversation_id).toBe(conversationId);
  });

  it('GET /messages?conversationId=X - 200 返回消息列表', async () => {
    await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { conversation_id: conversationId, role: 'user', content: '消息1' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/messages?conversationId=${conversationId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
  });

  it('GET /messages?conversationId=X&limit=10&offset=0 - 200 分页返回', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/messages',
        headers: { authorization: `Bearer ${token}` },
        payload: { conversation_id: conversationId, role: 'user', content: `消息${i}` },
      });
    }

    const response = await app.inject({
      method: 'GET',
      url: `/messages?conversationId=${conversationId}&limit=2&offset=0`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('messages');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('limit', 2);
    expect(body).toHaveProperty('offset', 0);
    expect(body.total).toBe(3);
    expect(body.messages.length).toBe(2);
  });

  it('PUT /messages/:id - 200 更新消息内容', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { conversation_id: conversationId, role: 'user', content: '原始内容' },
    });
    const { id } = createRes.json();

    const response = await app.inject({
      method: 'PUT',
      url: `/messages/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: '更新内容' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBe('更新成功');
  });

  it('DELETE /messages/:id - 200 删除消息', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { conversation_id: conversationId, role: 'user', content: '待删除' },
    });
    const { id } = createRes.json();

    const response = await app.inject({
      method: 'DELETE',
      url: `/messages/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBe('删除成功');
  });

  it('DELETE /messages?conversationId=X - 200 批量删除', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/messages',
        headers: { authorization: `Bearer ${token}` },
        payload: { conversation_id: conversationId, role: 'user', content: `消息${i}` },
      });
    }

    const response = await app.inject({
      method: 'DELETE',
      url: `/messages?conversationId=${conversationId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBe('删除成功');
    expect(body.deleted_count).toBe(3);
  });
});
