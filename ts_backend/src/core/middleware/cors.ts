/**
 * CORS 中间件。
 * 从 ALLOWED_ORIGINS 环境变量读取允许的域名列表（逗号分隔），
 * 支持通配符。注意通配符模式下不能启用 credentials。
 */
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from '../../config/index.js';

export async function registerCors(app: FastifyInstance): Promise<void> {
  const allowedOriginsStr = env.ALLOWED_ORIGINS;
  const origins = allowedOriginsStr.trim()
    ? allowedOriginsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : ['*'];

  // credentials: true + origin: ['*'] 违反 CORS 规范，浏览器会拒绝响应
  // 因此仅当 origins 为具体域名列表时才启用 credentials
  const isWildcard = origins.length === 1 && origins[0] === '*';

  await app.register(cors, {
    origin: origins,
    credentials: !isWildcard,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });
}
