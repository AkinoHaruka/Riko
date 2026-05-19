/** gzip 压缩中间件，响应体超过 500 字节时自动压缩 */
import type { FastifyInstance } from 'fastify';
import compress from '@fastify/compress';

export async function registerCompress(app: FastifyInstance): Promise<void> {
  await app.register(compress, { threshold: 500 });
}
