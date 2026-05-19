// 认证 API：首次引导(自动注册/登录用户)、注册、登录
import type { FastifyInstance } from 'fastify';
import { register, login } from '../../domain/auth/index.js';
import { getDb } from '../../core/database/connection.js';
import { generateToken } from '../../domain/auth/jwt.js';
import { HttpError } from '../../core/utils/index.js';
import { generateId } from '../../core/utils/id.js';
import bcrypt from 'bcryptjs';
import { loginSchema, registerSchema, errorResponse } from '../../core/validation/schemas.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/bootstrap', async (_request, reply) => {
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
      const passwordHash = await bcrypt.hash('default', 10);
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
  });

  app.post('/register', async (request, reply) => {
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
      return reply.status(500).send({ error: err instanceof Error ? err.message : '注册失败' });
    }
  });

  app.post('/login', async (request, reply) => {
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
      return reply.status(500).send({ error: err instanceof Error ? err.message : '登录失败' });
    }
  });
}
