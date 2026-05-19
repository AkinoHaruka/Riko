// 记忆 CRUD API：搜索关键词、按来源删除、清空、按类型查询、创建、按 ID 删除
import type { FastifyInstance } from 'fastify';
import {
  getMemories,
  searchMemories,
  createMemory,
  deleteMemory,
  deleteMemoriesBySource,
  clearMemories,
} from '../../domain/memory/index.js';
import type { MemoryCreateRequest } from '../../domain/memory/types.js';
import { HttpError } from '../../core/utils/index.js';

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/search', async (request, reply) => {
    const query = request.query as { keyword?: string };
    if (!query.keyword) {
      return reply.status(400).send({ error: 'keyword 参数不能为空' });
    }
    const result = searchMemories(query.keyword);
    return reply.send(result);
  });

  app.delete('/by-source', async (request, reply) => {
    const query = request.query as { source?: string };
    if (!query.source) {
      return reply.status(400).send({ error: 'source 参数不能为空' });
    }
    const result = deleteMemoriesBySource(query.source);
    return reply.send(result);
  });

  app.delete('/clear', async (request, reply) => {
    const result = clearMemories();
    return reply.send(result);
  });

  app.get('', async (request, reply) => {
    const query = request.query as { type?: string };
    const result = getMemories(query.type);
    return reply.send(result);
  });

  app.post('', async (request, reply) => {
    const body = request.body as MemoryCreateRequest;

    if (!body.key || !body.content) {
      return reply.status(400).send({ error: 'key 和 content 不能为空' });
    }

    const result = createMemory(body);
    return reply.send(result);
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const result = deleteMemory(id);
      return reply.send(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply.status(500).send({ error: err instanceof Error ? err.message : '删除记忆失败' });
    }
  });
}
