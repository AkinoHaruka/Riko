/**
 * 速率限制中间件。
 * 每分钟最多 300 个请求，超出返回友好中文提示。
 * 防止单个客户端过度消耗服务器资源。
 *
 * @module core/middleware/rateLimit
 */
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

/**
 * 注册速率限制中间件。
 *
 * @param app - Fastify 应用实例
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: '请求速率已达上限，请稍后重试',
    }),
  });
}

/**
 * 认证端点专用的严格速率限制（10 次/分钟）。
 * 可通过 app.register(authRateLimitPlugin) 应用到 auth 路由组。
 */
export const authRateLimitPlugin = {
  rateLimit: {
    max: 10,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: '认证请求过于频繁，请稍后重试',
    }),
  },
};
