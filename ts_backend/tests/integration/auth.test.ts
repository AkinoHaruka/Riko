process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/memories';
process.env.SYSTEM_PROMPTS_DIR = './data/system_prompts';
process.env.LOG_LEVEL = 'ERROR';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, teardownApp } from './helpers.js';

describe('Auth Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await teardownApp(app);
  });

  describe('POST /auth/register', () => {
    it('200 - 注册成功返回 token 和 user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username: 'testuser', password: 'password123' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('token');
      expect(body).toHaveProperty('user');
      expect(body.user).toHaveProperty('id');
      expect(body.user.username).toBe('testuser');
    });

    it('409 - 重复用户名注册失败', async () => {
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username: 'duplicate', password: 'password123' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username: 'duplicate', password: 'password456' },
      });

      expect(response.statusCode).toBe(409);
      const body = response.json();
      expect(body.error).toContain('已被注册');
    });

    it('400 - 用户名过短', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username: 'ab', password: 'password123' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.message).toBeDefined();
    });

    it('400 - 密码过短', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username: 'validuser', password: '12345' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.message).toBeDefined();
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username: 'loginuser', password: 'password123' },
      });
    });

    it('200 - 正确凭据登录成功', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'loginuser', password: 'password123' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('token');
      expect(body.user.username).toBe('loginuser');
    });

    it('401 - 错误密码登录失败', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'loginuser', password: 'wrongpassword' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error).toContain('用户名或密码错误');
    });

    it('400 - 缺少用户名或密码', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: '', password: '' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.message).toBeDefined();
    });
  });
});
