/**
 * JWT 认证中间件。
 *
 * 设计决策：
 * - 如果请求头携带有效的 Bearer token，则从中解析用户。
 * - 如果没有 token 或 token 无效，行为由 AUTH_STRICT_MODE 环境变量控制：
 *   - AUTH_STRICT_MODE=true：返回 401，拒绝无有效 token 的请求（多用户部署场景）。
 *   - 默认（未设置或非 'true'）：自动以默认用户登录（单用户桌面场景）。
 * - Token 验证逻辑通过 setupAuth() 在启动时注入，
 *   中间件不直接依赖 domain 层。
 *
 * @security 此中间件为所有请求注入 currentUser。
 *           无有效 token 时默认自动降级为默认用户，适用于单用户桌面场景。
 *           设置 AUTH_STRICT_MODE=true 可强制要求有效 token，适用于多用户部署。
 *
 * @module core/middleware/auth
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthUser, TokenVerifier } from '../types/auth.js';
import { getDb, waitForDb } from '../database/connection.js';
import { generateId } from '../utils/id.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export type { AuthUser };

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: AuthUser;
  }
}

/** 启动时注入的 token 验证函数 */
let verifyTokenFn: TokenVerifier | null = null;

/**
 * 在应用启动时配置认证中间件。
 * 注入 token 验证函数，解耦中间件对 domain/auth 的直接依赖。
 *
 * @param verifier - 来自 domain/auth/jwt.verifyToken 的实现
 */
export function setupAuth(verifier: TokenVerifier): void {
  verifyTokenFn = verifier;
}

/**
 * @security 获取或创建默认用户（单用户模式下的自动注册逻辑）。
 * 使用 INSERT OR IGNORE 防止并发时 UNIQUE 约束冲突，创建后重新查询确保获取实际行。
 * 默认用户密码为随机生成的 24 字节十六进制字符串，不可预测。
 */
async function getOrCreateDefaultUser(): Promise<AuthUser> {
  const db = getDb();
  const row = db.prepare('SELECT id, username FROM users LIMIT 1').get() as
    | { id: string; username: string }
    | undefined;
  if (row) {
    return { userId: row.id, username: row.username };
  }

  // 使用 INSERT OR IGNORE 防止并发时 UNIQUE 约束冲突
  const id = generateId('users');
  const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  db.prepare(
    'INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (?, ?, ?)',
  ).run(id, 'default', hash);

  // 重新查询以获取实际插入的行（可能是并发请求先插入的）
  const actualRow = db.prepare('SELECT id, username FROM users LIMIT 1').get() as
    | { id: string; username: string }
    | undefined;
  if (!actualRow) {
    throw new Error('Failed to create or retrieve default user');
  }
  return { userId: actualRow.id, username: actualRow.username };
}

/**
 * JWT 认证中间件。
 * 优先从 Authorization 头解析 Bearer token。
 * 无有效 token 时，根据 AUTH_STRICT_MODE 环境变量决定行为：
 *   - AUTH_STRICT_MODE=true：返回 401 拒绝请求
 *   - 默认：自动降级为默认用户（单用户桌面场景）
 *
 * @security 无有效 token 时默认自动降级为默认用户，适用于单用户桌面场景。
 *           设置 AUTH_STRICT_MODE=true 可强制要求有效 token。
 * @param request - Fastify 请求对象
 * @param reply - Fastify 响应对象
 */
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await waitForDb();
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ') && verifyTokenFn) {
    const token = header.slice(7);
    const user = verifyTokenFn(token);
    if (user) {
      request.currentUser = user;
      return;
    }
  }

  // 严格模式下拒绝无有效 token 的请求
  if (process.env.AUTH_STRICT_MODE === 'true') {
    return reply.status(401).send({ error: '认证 required' });
  }

  // 无有效 token — 自动以默认用户登录（单用户桌面场景）
  request.currentUser = await getOrCreateDefaultUser();
}

/**
 * 从请求对象中获取当前认证用户。
 * 必须在 authMiddleware 之后调用。
 *
 * @param request - Fastify 请求对象
 * @returns 当前认证用户信息
 * @throws 用户未认证时抛出错误
 */
export function getCurrentUser(request: FastifyRequest): AuthUser {
  if (!request.currentUser) {
    throw new Error('User not authenticated');
  }
  return request.currentUser;
}
