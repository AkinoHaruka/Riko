/** 中间件注册入口，按顺序注册：gzip → CORS → 限流 → JWT 认证 → 请求日志 */
import type { FastifyInstance } from 'fastify';
import { registerRateLimit } from './rateLimit.js';
import { registerCors } from './cors.js';
import { registerCompress } from './gzip.js';
import { registerRequestLog } from './requestLog.js';
import { authMiddleware } from './auth.js';

export { authMiddleware, getCurrentUser } from './auth.js';
export type { AuthUser } from './auth.js';

export async function registerAllMiddleware(app: FastifyInstance): Promise<void> {
  await registerCompress(app);
  await registerCors(app);
  await registerRateLimit(app);
  app.addHook('onRequest', authMiddleware);
  await registerRequestLog(app);
}
