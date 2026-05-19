/** 速率限制中间件：每分钟最多 300 个请求，超出返回友好提示 */
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: '请求速率已达上限，请稍后重试',
    }),
  });
}
