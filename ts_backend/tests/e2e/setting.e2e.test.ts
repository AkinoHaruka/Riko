process.env.JWT_SECRET = 'test-secret-key-for-e2e';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/test_memories_e2e';
process.env.LOG_LEVEL = 'ERROR';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildE2EApp, teardownE2EApp, registerAndLogin } from './helpers.js';

describe('Setting E2E', () => {
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

  it('保存设置', async () => {
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

  it('获取所有设置', async () => {
    await app.inject({
      method: 'POST',
      url: '/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'theme', value: 'dark' },
    });
    await app.inject({
      method: 'POST',
      url: '/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'language', value: 'zh-CN' },
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
    expect(body.settings.length).toBe(2);
  });

  it('获取特定设置', async () => {
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

  it('删除设置', async () => {
    await app.inject({
      method: 'POST',
      url: '/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'to_delete', value: 'value' },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/settings/to_delete',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBe('设置已删除');

    const getRes = await app.inject({
      method: 'GET',
      url: '/settings/to_delete',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('保存 API Key（加密存储）', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/settings/apikey',
      headers: { authorization: `Bearer ${token}` },
      payload: { api_key: 'sk-my-secret-key-12345' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBe('API Key 已保存');
  });

  it('获取 API Key（解密返回）', async () => {
    await app.inject({
      method: 'POST',
      url: '/settings/apikey',
      headers: { authorization: `Bearer ${token}` },
      payload: { api_key: 'sk-test-key-abcde' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/settings/apikey',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.api_key).toBe('sk-test-key-abcde');
  });

  it('清除 API Key', async () => {
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

  it('不存在的设置返回 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/settings/nonexistent_key',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toContain('设置不存在');
  });
});
