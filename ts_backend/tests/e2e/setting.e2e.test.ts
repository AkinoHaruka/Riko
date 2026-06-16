/**
 * 设置端到端测试
 *
 * 测试 /settings 端点的完整 CRUD 流程，包括：
 * - 普通设置的保存、查询、按 key 查询、删除
 * - API Key 的加密存储、解密读取和空字符串清除
 * - 不存在的设置返回 404
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

  // 删除设置后再次查询应返回 404
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

  // API Key 在数据库中加密存储，读取时自动解密返回明文
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

  // 传入空字符串表示清除 API Key
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
