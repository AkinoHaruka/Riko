/**
 * CORS 中间件。
 *
 * 从 ALLOWED_ORIGINS 环境变量读取允许的域名列表（逗号分隔），
 * 支持通配符。注意通配符模式下不能启用 credentials（CORS 规范限制）。
 *
 * 未配置 ALLOWED_ORIGINS 时默认仅允许 localhost 来源，
 * 避免在多用户部署场景下意外暴露 API。
 *
 * @module core/middleware/cors
 */
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from '../../config/index.js';

/**
 * 注册 CORS 中间件。
 * 未配置 ALLOWED_ORIGINS 时默认仅允许 localhost 来源（安全默认值）。
 *
 * @param app - Fastify 应用实例
 */
export async function registerCors(app: FastifyInstance): Promise<void> {
  const allowedOriginsStr = env.ALLOWED_ORIGINS;
  const origins = allowedOriginsStr.trim()
    ? allowedOriginsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

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
