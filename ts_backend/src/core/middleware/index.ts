/**
 * 中间件模块入口。
 * 按顺序注册：gzip → CORS → 限流 → JWT 认证 → 请求日志。
 * 注册顺序很重要：压缩和 CORS 需在其他中间件之前，认证需在业务逻辑之前。
 *
 * @module core/middleware
 */
import type { FastifyInstance } from 'fastify';
import { registerRateLimit } from './rateLimit.js';
import { registerCors } from './cors.js';
import { registerCompress } from './gzip.js';
import { registerRequestLog } from './requestLog.js';
import { authMiddleware } from './auth.js';

export { authMiddleware, getCurrentUser, setupAuth } from './auth.js';
export type { AuthUser } from './auth.js';

/**
 * 按正确顺序注册所有中间件。
 * 顺序：压缩 → CORS → 限流 → 认证 → 请求日志。
 *
 * @param app - Fastify 应用实例
 */
export async function registerAllMiddleware(app: FastifyInstance): Promise<void> {
  await registerCompress(app);
  await registerCors(app);
  await registerRateLimit(app);
  app.addHook('onRequest', authMiddleware);
  await registerRequestLog(app);
}
