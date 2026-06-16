/**
 * 设置路由集成测试
 *
 * 测试 /settings 端点的 CRUD 操作，包括：
 * - 普通设置的保存、查询、按 key 查询
 * - API Key 的加密存储、解密读取和空字符串清除逻辑
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

describe('Setting Routes', () => {
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

  it('POST /settings - 200 保存设置', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'theme', value: 'dark' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBe('设置已保存');
    expect(body.key).toBe('theme');
    expect(body.is_encrypted).toBe(0);
  });

  it('GET /settings - 200 返回所有设置', async () => {
    await app.inject({
      method: 'POST',
      url: '/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'theme', value: 'dark' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/settings',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('settings');
    expect(Array.isArray(body.settings)).toBe(true);
    expect(body.settings.length).toBe(1);
    expect(body.settings[0].key).toBe('theme');
  });

  it('GET /settings/:key - 200 返回特定设置', async () => {
    await app.inject({
      method: 'POST',
      url: '/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'language', value: 'zh-CN' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/settings/language',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.key).toBe('language');
    expect(body.value).toBe('zh-CN');
  });

  // API Key 端点独立于普通设置，使用加密存储
  it('GET /settings/apikey - 200 返回 API Key', async () => {
    await app.inject({
      method: 'POST',
      url: '/settings/apikey',
      headers: { authorization: `Bearer ${token}` },
      payload: { api_key: 'sk-test-key-123' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/settings/apikey',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.api_key).toBe('sk-test-key-123');
  });

  // API Key 在数据库中加密存储，读取时自动解密
  it('POST /settings/apikey - 200 保存加密的 API Key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/settings/apikey',
      headers: { authorization: `Bearer ${token}` },
      payload: { api_key: 'sk-my-secret-key' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBe('API Key 已保存');
  });

  // 传入空字符串表示清除 API Key，而非存储空值
  it('POST /settings/apikey - 200 空字符串清除 API Key', async () => {
    await app.inject({
      method: 'POST',
      url: '/settings/apikey',
      headers: { authorization: `Bearer ${token}` },
      payload: { api_key: 'sk-to-be-cleared' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/settings/apikey',
      headers: { authorization: `Bearer ${token}` },
      payload: { api_key: '' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBe('API Key 已清除');

    const getRes = await app.inject({
      method: 'GET',
      url: '/settings/apikey',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.json().api_key).toBe('');
  });
});
