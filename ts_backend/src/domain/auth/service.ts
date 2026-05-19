/**
 * 用户注册与登录服务。密码使用 bcrypt 加盐哈希存储。
 */
import bcrypt from 'bcryptjs';
import { getDb } from '../../core/database/connection.js';
import { createLogger } from '../../core/logger/index.js';
import { HttpError } from '../../core/utils/index.js';
import { generateToken } from './jwt.js';
import { generateId } from '../../core/utils/id.js';
import type { AuthResponse } from './types.js';

const logger = createLogger('auth');

export async function register(username: string, password: string): Promise<AuthResponse> {
  const db = getDb();

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as
    | { id: string }
    | undefined;
  if (existing) {
    throw new HttpError(409, '用户名已被注册');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = generateId('users');

  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(
    userId,
    username,
    passwordHash,
  );

  const token = generateToken(userId, username);

  logger.info(`[审计] 用户 ${username} 执行了 注册 操作`);

  return { token, user: { id: userId, username } };
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const db = getDb();

  const user = db
    .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .get(username) as { id: string; username: string; password_hash: string } | undefined;

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, '用户名或密码错误');
  }

  const token = generateToken(user.id, user.username);

  logger.info(`[审计] 用户 ${user.username} 执行了 登录 操作`);

  return { token, user: { id: user.id, username: user.username } };
}
