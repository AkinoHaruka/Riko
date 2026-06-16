/**
 * 记忆 CRUD 路由模块
 *
 * 职责：提供记忆（Memory）的搜索、列表查询、创建、删除和批量清理操作。
 * 所有端点需要认证，通过 userId 实现数据隔离——每个用户只能访问自己的记忆。
 *
 * 端点概览：
 *   GET    /memories/search     — 按关键词搜索记忆
 *   DELETE /memories/by-source  — 按来源批量删除记忆
 *   DELETE /memories/clear      — 清空当前用户所有记忆
 *   GET    /memories            — 获取记忆列表（可按类型筛选）
 *   POST   /memories            — 创建新记忆
 *   DELETE /memories/:id        — 删除指定记忆
 */
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
import { getCurrentUser } from '../../core/middleware/index.js';
import { memoryCreateSchema, errorResponse } from '../../core/validation/schemas.js';

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /memories/search
   * 按关键词搜索记忆（向量语义搜索）。
   *
   * 查询参数：keyword: string — 搜索关键词（必填）
   * 响应：搜索结果数组
   *
   * @security 通过 user.userId 隔离，只能搜索自己的记忆
   */
  app.get('/search', async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as { keyword?: string };
    if (!query.keyword) {
      return reply.status(400).send({ error: 'keyword 参数不能为空' });
    }
    const result = searchMemories(query.keyword, user.userId);
    return reply.send(result);
  });

  /**
   * DELETE /memories/by-source
   * 按来源批量删除记忆。
   *
   * 查询参数：source: string — 记忆来源标识（必填）
   * 响应：删除结果
   *
   * @security 通过 user.userId 隔离
   */
  app.delete('/by-source', async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as { source?: string };
    if (!query.source) {
      return reply.status(400).send({ error: 'source 参数不能为空' });
    }
    const result = deleteMemoriesBySource(query.source, user.userId);
    return reply.send(result);
  });

  /**
   * DELETE /memories/clear
   * 清空当前用户的所有记忆。
   *
   * 限流：每分钟最多 5 次，防止滥用清空操作
   *
   * 响应：清空结果
   *
   * @security 通过 user.userId 隔离，只清空自己的记忆
   */
  app.delete('/clear', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const result = await clearMemories(user.userId);
    return reply.send(result);
  });

  /**
   * GET /memories
   * 获取当前用户的记忆列表，可按类型筛选。
   *
   * 查询参数：type: string — 记忆类型（可选）
   * 响应：Memory[]
   *
   * @security 通过 user.userId 隔离
   */
  app.get('', async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as { type?: string };
    const result = getMemories(user.userId, query.type);
    return reply.send(result);
  });

  /**
   * POST /memories
   * 创建新记忆。
   *
   * 请求体：MemoryCreateRequest（Zod schema 校验）
   * 响应：创建的 Memory 对象
   *
   * @security 通过 user.userId 隔离，记忆绑定到当前用户
   */
  app.post('', async (request, reply) => {
    const user = getCurrentUser(request);
    const parsed = memoryCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data as MemoryCreateRequest;

    const result = createMemory(body, user.userId);
    return reply.send(result);
  });

  /**
   * DELETE /memories/:id
   * 删除指定记忆。
   *
   * 路径参数：id — 记忆 ID
   * 响应：删除结果
   *
   * @security service 层通过 userId 校验记忆所有权
   */
  app.delete('/:id', async (request, reply) => {
    const user = getCurrentUser(request);
    const { id } = request.params as { id: string };

    try {
      const result = deleteMemory(id, user.userId);
      return reply.send(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply.status(500).send({ error: err instanceof Error ? err.message : '删除记忆失败' });
    }
  });
}
