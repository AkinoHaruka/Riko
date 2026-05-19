import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildE2EApp, teardownE2EApp, registerAndLogin } from './helpers.js';

process.env.JWT_SECRET = 'test-secret-key-for-e2e';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/test_memories_e2e';
process.env.LOG_LEVEL = 'ERROR';

describe('Session Memory E2E', () => {
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

  it('GET /session-notes/:conversationId — returns uninitialised state for non-existent notes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/session-notes/99999',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.conversation_id).toBe('99999');
    expect(body.initialized).toBe(false);
    expect(body.content).toBe('');
    expect(body.file_path).toBe('');
  });

  it('POST /session-notes/:conversationId/extract — returns 404 for conversation without messages', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/session-notes/99999/extract',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBeDefined();
  });

  it('DELETE /session-notes/:conversationId — deletes session notes', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/session-notes/99999',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
  });

  it('GET /session-notes/:conversationId — returns 404-style response for non-existent conversation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/session-notes/88888',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.initialized).toBe(false);
  });

  it('unauthenticated GET /session-notes/:conversationId - single-user mode', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/session-notes/1',
    });

    expect(res.statusCode).toBe(200);
  });

  it('unauthenticated POST /session-notes/:conversationId/extract - single-user mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/session-notes/1/extract',
    });

    expect(res.statusCode).toBe(404);
  });

  it('unauthenticated DELETE /session-notes/:conversationId - single-user mode', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/session-notes/1',
    });

    expect(res.statusCode).toBe(200);
  });
});
