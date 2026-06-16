/**
 * 上下文压缩（Compact）端到端测试
 *
 * 测试 /compact 和 /compact/status 端点，包括：
 * - 缺少 conversation_id 参数校验（400）
 * - 不存在的会话返回 404
 * - 有效会话的 token 用量查询
 * - 单用户模式下未认证请求的行为
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildE2EApp, teardownE2EApp, registerAndLogin } from './helpers.js';
import { getDb } from '../../src/core/database/index.js';
import { generateId } from '../../src/core/utils/id.js';

process.env.JWT_SECRET = 'test-secret-key-for-e2e';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/test_memories_e2e';
process.env.LOG_LEVEL = 'ERROR';

describe('Compact E2E', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;
  let conversationId: string;

  beforeAll(async () => {
    app = await buildE2EApp();
    const auth = await registerAndLogin(app);
    token = auth.token;
    userId = auth.userId;

    // 直接向数据库插入会话和消息，避免依赖其他 API
    const db = getDb();
    conversationId = generateId('conversations');
    db.prepare(
      'INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)',
    ).run(conversationId, userId, 'Compact Test Conversation');

    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)',
    ).run(generateId('messages'), conversationId, 'user', 'Hello from user');
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)',
    ).run(generateId('messages'), conversationId, 'assistant', 'Hello from assistant');
  });

  afterAll(async () => {
    await teardownE2EApp(app);
  });

  // ── POST /compact ──

  it('POST /compact — returns error for missing conversation_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/compact',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message || body.error).toBeDefined();
  });

  it('POST /compact — returns 404 for non-existent conversation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/compact',
      headers: { authorization: `Bearer ${token}` },
      payload: { conversation_id: 'nonexistent-id' },
    });

    expect(res.statusCode).toBe(404);
  });

  // ── GET /compact/status ──

  it('GET /compact/status — returns token usage for valid conversation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/compact/status?conversation_id=${conversationId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token_usage).toBeDefined();
    expect(body.warning_state).toBeDefined();
    expect(body.message_count).toBeDefined();
  });

  it('GET /compact/status — returns 400 for missing conversation_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/compact/status',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message || body.error).toBeDefined();
  });

  it('GET /compact/status — returns 404 for non-existent conversation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/compact/status?conversation_id=nonexistent-id',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  // 单用户模式下未认证请求通过认证，但因会话不存在返回 404
  it('POST /compact — unauthenticated (single-user mode passes auth, returns 404)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/compact',
      payload: { conversation_id: 'some-id' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('GET /compact/status — unauthenticated (single-user mode passes auth, returns 404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/compact/status?conversation_id=some-id',
    });

    expect(res.statusCode).toBe(404);
  });
});
