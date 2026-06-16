/**
 * gzip 压缩中间件。
 * 响应体超过 500 字节时自动压缩，减少网络传输量。
 *
 * @module core/middleware/gzip
 */
import type { FastifyInstance } from 'fastify';
import compress from '@fastify/compress';

/**
 * 注册 gzip 压缩中间件。
 *
 * @param app - Fastify 应用实例
 */
export async function registerCompress(app: FastifyInstance): Promise<void> {
  await app.register(compress, { threshold: 500 });
}
