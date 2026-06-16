/**
 * 认证插件。
 *
 * 封装 domain/auth 和 api/auth，通过 PluginContext 注册路由。
 * 提供注册、登录、bootstrap 自动登录等功能。
 *
 * @module plugins/auth/plugin
 */
import type { Plugin, PluginContext } from '../../core/runtime/types.js';
import type { FastifyInstance } from 'fastify';
import { register, login } from '../../domain/auth/index.js';
import { generateToken, refreshToken } from '../../domain/auth/jwt.js';
import { getDb } from '../../core/database/connection.js';
import { HttpError } from '../../core/utils/index.js';
import { generateId } from '../../core/utils/id.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { loginSchema, registerSchema, errorResponse } from '../../core/validation/schemas.js';

async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /bootstrap — 首次引导：若库中无用户则自动创建默认用户，返回 JWT
   */
  app.get(
    '/bootstrap',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (_request, reply) => {
      const db = getDb();
      let userId: string;
      let username: string;

      const existing = db.prepare('SELECT id, username FROM users LIMIT 1').get() as
        | { id: string; username: string }
        | undefined;
      if (existing) {
        userId = existing.id;
        username = existing.username;
      } else {
        const id = generateId('users');
        const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
        db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(
          id,
          'default',
          passwordHash,
        );
        userId = id;
        username = 'default';
      }

      const token = generateToken(userId, username);
      return reply.send({ token, user: { id: userId, username } });
    },
  );

  /**
   * POST /register — 注册新用户
   */
  app.post(
    '/register',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
      }
      const { username, password } = parsed.data;
      try {
        const result = await register(username, password);
        return reply.send(result);
      } catch (err) {
        if (err instanceof HttpError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        return reply.status(500).send({ error: '注册失败' });
      }
    },
  );

  /**
   * POST /login — 用户登录
   */
  app.post(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
      }
      const { username, password } = parsed.data;
      try {
        const result = await login(username, password);
        return reply.send(result);
      } catch (err) {
        if (err instanceof HttpError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        return reply.status(500).send({ error: '登录失败' });
      }
    },
  );

  /**
   * POST /refresh — 刷新过期的 JWT 令牌
   *
   * 从 Authorization header 解析当前 token（即使已过期），
   * 验证签名有效性后签发新 token。过期超过 30 天的令牌不可刷新。
   */
  app.post(
    '/refresh',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: '缺少认证令牌' });
      }

      const token = authHeader.slice(7);
      const newToken = refreshToken(token);

      if (!newToken) {
        return reply.status(401).send({ error: '令牌无效或已过期过久，请重新登录' });
      }

      // 解码新 token 获取用户信息返回给前端
      const { verifyToken } = await import('../../domain/auth/jwt.js');
      const user = verifyToken(newToken);

      return reply.send({
        token: newToken,
        user: user ? { id: user.userId, username: user.username } : null,
      });
    },
  );
}

/** 认证插件定义 */
export const authPlugin: Plugin = {
  id: 'auth',
  version: '1.0.0',
  name: '认证插件',
  dependencies: [],

  async install(ctx: PluginContext) {
    ctx.registerRoutes('/auth', authRoutes);
    ctx.getLogger().info('认证路由已注册');
  },
};
