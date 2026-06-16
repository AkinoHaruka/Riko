/**
 * Auth 领域单元测试
 * 测试用户注册、登录、JWT 令牌生成与验证等认证核心逻辑
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getDb } from '../../src/core/database/index.js';
import { register, login, generateToken, verifyToken } from '../../src/domain/auth/index.js';
import { generateId } from '../../src/core/utils/id.js';

/** 创建测试用户，直接向数据库插入一条用户记录（跳过 bcrypt 以提升测试速度） */
function createTestUser(username = 'testuser'): string {
  const db = getDb();
  const id = generateId('users');
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(id, username, '$2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  return id;
}

describe('Auth 领域', () => {
  beforeEach(async () => {
    closeDb();
    await initDb();
  });

  afterEach(() => {
    closeDb();
  });

  it('register() 成功注册返回 AuthResponse', async () => {
    const result = await register('testuser', 'password123');
    expect(result).toHaveProperty('token');
    expect(result).toHaveProperty('user');
    expect(result.user.username).toBe('testuser');
    expect(result.user.id).toBeTypeOf('string');
  });

  it('register() 重复用户名抛出"用户名已被注册"', async () => {
    await register('testuser', 'password123');
    await expect(() => register('testuser', 'another')).rejects.toThrow('用户名已被注册');
  });

  it('login() 成功登录返回 AuthResponse', async () => {
    await register('testuser', 'password123');
    const result = await login('testuser', 'password123');
    expect(result).toHaveProperty('token');
    expect(result.user.username).toBe('testuser');
  });

  it('login() 错误密码抛出"用户名或密码错误"', async () => {
    await register('testuser', 'password123');
    await expect(() => login('testuser', 'wrongpassword')).rejects.toThrow('用户名或密码错误');
  });

  it('login() 不存在的用户抛出"用户名或密码错误"', async () => {
    await expect(() => login('nonexistent', 'password123')).rejects.toThrow('用户名或密码错误');
  });

  // JWT 令牌生成与验证的往返测试
  it('generateToken()/verifyToken() JWT 往返验证', () => {
    const userId = 'test-uuid-123';
    const token = generateToken(userId, 'testuser');
    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe(userId);
    expect(payload!.username).toBe('testuser');
  });

  it('verifyToken() 无效 token 返回 null', () => {
    const result = verifyToken('invalid-token');
    expect(result).toBeNull();
  });
});
