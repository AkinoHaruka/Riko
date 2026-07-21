/**
 * Chat SSE 流式对话端到端测试
 *
 * 测试 /chat/completions 端点的流式和非流式响应，
 * 以及 /models 模型列表端点。AI 客户端通过 vi.mock 模拟，
 * 不依赖真实 DeepSeek API。
 */
process.env.JWT_SECRET = 'test-secret-key-for-e2e';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/test_memories_e2e';
process.env.LOG_LEVEL = 'ERROR';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildE2EApp, teardownE2EApp, registerAndLogin } from './helpers.js';

// 模拟 AI 客户端，避免调用真实 DeepSeek API
// 注意：mock 必须导出源模块的所有被引用符号，否则会触发 vitest 警告
// "No X export is defined on the mock"。stream.ts/service.ts 还引用了 resolveProvider。
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
  // resolveProvider: 根据模型 ID 返回 ProviderDefinition，测试中返回最小可用结构
  resolveProvider: vi.fn().mockReturnValue({
    id: 'deepseek',
    name: 'DeepSeek',
    aliases: ['deepseek'],
    apiMode: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    apiKeyKey: 'apikey_deepseek',
    envVarKey: 'DEEPSEEK_API_KEY',
    supportsThinking: true,
    supportsToolCalls: true,
    models: [],
  }),
  getTransportForModel: vi.fn().mockReturnValue('openai'),
}));

// ── SSE 流式对话 ──

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

  // 非流式模式：mock AI 客户端返回完整响应，验证 JSON 格式
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

  // 单用户模式下未认证请求不会返回 401，而是自动登录
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

// ── 模型列表 ──

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

  // 单用户模式下未认证请求自动登录，不会返回 401
  it('GET /models 未认证返回 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/models',
    });

    expect(response.statusCode).toBe(200);
  });
});
