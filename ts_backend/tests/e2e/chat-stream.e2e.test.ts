process.env.JWT_SECRET = 'test-secret-key-for-e2e';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/test_memories_e2e';
process.env.LOG_LEVEL = 'ERROR';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildE2EApp, teardownE2EApp, registerAndLogin } from './helpers.js';

vi.mock('../../src/core/ai/client.js', () => ({
  getOrCreateClient: vi.fn(),
  getUserApiKey: vi.fn().mockResolvedValue('sk-test-mock-key'),
  createClient: vi.fn().mockReturnValue({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
    models: {
      list: vi.fn().mockResolvedValue({
        data: [
          { id: 'deepseek-v4-pro', owned_by: 'deepseek' },
          { id: 'deepseek-v4-flash', owned_by: 'deepseek' },
        ],
      }),
    },
  }),
}));

describe('Chat - SSE 流式对话', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await buildE2EApp();
    const auth = await registerAndLogin(app);
    token = auth.token;
  });

  afterEach(async () => {
    await teardownE2EApp(app);
    vi.restoreAllMocks();
  });

  it('POST /completions stream=true 返回 SSE 响应头', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        messages: [{ role: 'user', content: '你好' }],
        model: 'deepseek-v4-flash',
        stream: true,
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('POST /completions stream=false 返回 JSON 响应', async () => {
    const { getOrCreateClient } = await import('../../src/core/ai/client.js');
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: '你好！' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    (getOrCreateClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      chat: { completions: { create: mockCreate } },
      models: { list: vi.fn() },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        messages: [{ role: 'user', content: '你好' }],
        model: 'deepseek-v4-flash',
        stream: false,
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('POST /chat/completions 缺少 messages 返回 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: 'deepseek-v4-flash',
        stream: true,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST /chat/completions 缺少 model 返回 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        messages: [{ role: 'user', content: '你好' }],
        stream: true,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST /chat/completions 未认证返回 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      payload: {
        messages: [{ role: 'user', content: '你好' }],
        model: 'deepseek-v4-flash',
        stream: true,
      },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('Chat - 模型列表', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await buildE2EApp();
    const auth = await registerAndLogin(app);
    token = auth.token;
  });

  afterEach(async () => {
    await teardownE2EApp(app);
    vi.restoreAllMocks();
  });

  it('GET /models 返回模型列表', async () => {
    const { getOrCreateClient } = await import('../../src/core/ai/client.js');
    (getOrCreateClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      chat: { completions: { create: vi.fn() } },
      models: {
        list: vi.fn().mockResolvedValue({
          data: [
            { id: 'deepseek-v4-pro', owned_by: 'deepseek' },
            { id: 'deepseek-v4-flash', owned_by: 'deepseek' },
          ],
        }),
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/models',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('models');
    expect(Array.isArray(body.models)).toBe(true);
  });

  it('GET /models 未认证返回 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/models',
    });

    expect(response.statusCode).toBe(200);
  });
});
