/**
 * JWT 认证中间件。
 *
 * 设计决策：
 * - 如果请求头携带有效的 Bearer token，则从中解析用户。
 * - 如果没有 token 或 token 无效，自动以默认用户登录（单用户模式），
 *   避免首次使用时需要手动注册/登录。
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../../domain/auth/jwt.js';
import { getDb, waitForDb } from '../database/connection.js';
import { generateId } from '../utils/id.js';
import bcrypt from 'bcryptjs';
import type { AuthUser } from '../../domain/auth/types.js';

export type { AuthUser };

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: AuthUser;
  }
}

/** 获取或创建默认用户（单用户模式下的自动注册逻辑） */
function getOrCreateDefaultUser(): AuthUser {
  const db = getDb();
  const row = db.prepare('SELECT id, username FROM users LIMIT 1').get() as
    | { id: string; username: string }
    | undefined;
  if (row) {
    return { userId: row.id, username: row.username };
  }
  const id = generateId('users');
  const hash = bcrypt.hashSync('default', 10);
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(
    id,
    'default',
    hash,
  );
  return { userId: id, username: 'default' };
}

export async function authMiddleware(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  await waitForDb();
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7);
    const user = verifyToken(token);
    if (user) {
      request.currentUser = user;
      return;
    }
  }

  // No valid token — auto-login as default user
  request.currentUser = getOrCreateDefaultUser();
}

export function getCurrentUser(request: FastifyRequest): AuthUser {
  if (!request.currentUser) {
    throw new Error('User not authenticated');
  }
  return request.currentUser;
}
