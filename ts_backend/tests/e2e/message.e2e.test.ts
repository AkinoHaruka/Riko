/**
 * 消息端到端测试
 *
 * 测试 /messages 端点的完整 CRUD 流程，包括：
 * - 创建消息、获取会话消息列表
 * - 更新消息内容、删除单条消息、按会话批量删除
 * - 消息按创建时间排序验证
 * - 不存在的消息返回 404
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

/**
 * 创建测试会话，返回包含 id 的对象
 * @param app - Fastify 应用实例
 * @param token - 认证 token
 * @param title - 会话标题，默认 '测试会话'
 */
async function createConversation(app: FastifyInstance, token: string, title = '测试会话') {
  const res = await app.inject({
    method: 'POST',
    url: '/conversations',
    headers: { authorization: `Bearer ${token}` },
    payload: { title },
  });
  return res.json() as { id: number };
}

describe('Message E2E', () => {
  let app: FastifyInstance;
  let token: string;
  let conversationId: number;

  beforeEach(async () => {
    app = await buildE2EApp();
    const auth = await registerAndLogin(app);
    token = auth.token;
    const conv = await createConversation(app, token);
    conversationId = conv.id;
  });

  afterEach(async () => {
    await teardownE2EApp(app);
  });

  it('创建消息', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        conversation_id: conversationId,
        role: 'user',
        content: '你好世界',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.role).toBe('user');
    expect(body.content).toBe('你好世界');
    expect(body.conversation_id).toBe(conversationId);
  });

  it('获取会话的消息列表', async () => {
    await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { conversation_id: conversationId, role: 'user', content: '消息1' },
    });
    await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { conversation_id: conversationId, role: 'assistant', content: '消息2' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/messages?conversationId=${conversationId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });

  it('更新消息内容', async () => {
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

  it('删除单条消息', async () => {
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

  it('删除会话的所有消息', async () => {
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

  // 验证消息按创建时间升序排列（先创建的在前）
  it('消息按创建时间排序', async () => {
    await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { conversation_id: conversationId, role: 'user', content: '第一条' },
    });
    await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { conversation_id: conversationId, role: 'assistant', content: '第二条' },
    });
    await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { conversation_id: conversationId, role: 'user', content: '第三条' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/messages?conversationId=${conversationId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.length).toBe(3);
    expect(body[0].content).toBe('第一条');
    expect(body[1].content).toBe('第二条');
    expect(body[2].content).toBe('第三条');
  });

  it('不存在的消息返回 404', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/messages/99999',
      headers: { authorization: `Bearer ${token}` },
      payload: { content: '不存在' },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toContain('不存在或无权限');
  });
});
