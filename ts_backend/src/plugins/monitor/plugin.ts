/**
 * 监控插件。
 *
 * 封装 domain/monitor 和 api/monitor，通过 PluginContext 注册路由。
 * 提供 API 监控记录和子代理活动记录的 CRUD 操作。
 *
 * @module plugins/monitor/plugin
 */
import type { Plugin, PluginContext } from '../../core/runtime/types.js';
import type { FastifyInstance } from 'fastify';
import { getCurrentUser } from '../../core/middleware/index.js';
import { HttpError } from '../../core/utils/index.js';
import { getMonitorService, deleteAllActivities } from '../../domain/monitor/service.js';
import { getDb } from '../../core/database/connection.js';

async function monitorRoutes(app: FastifyInstance): Promise<void> {
  // ─── 子代理活动记录 ────────────────────────────────────────

  app.delete('/monitor/activities', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    try {
      const deleted = deleteAllActivities(user.userId);
      return { message: '活动记录已清空', deleted };
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '清空活动记录失败' });
    }
  });

  app.get('/monitor/activities', async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as { type?: string; limit?: string; offset?: string };
    try {
      const service = getMonitorService();
      const activities = service.getActivities(user.userId, {
        type: query.type,
        limit: query.limit != null && !Number.isNaN(Number(query.limit)) ? Number(query.limit) : undefined,
        offset: query.offset != null && !Number.isNaN(Number(query.offset)) ? Number(query.offset) : undefined,
      });
      return { activities };
    } catch (err) {
      if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
      return reply.status(500).send({ error: err instanceof Error ? err.message : '获取活动记录失败' });
    }
  });

  app.get('/monitor/activities/latest', async (request, reply) => {
    const user = getCurrentUser(request);
    try {
      const service = getMonitorService();
      return service.getLatestActivities(user.userId);
    } catch (err) {
      if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
      return reply.status(500).send({ error: err instanceof Error ? err.message : '获取最新活动记录失败' });
    }
  });

  // ─── API 监控记录 ──────────────────────────────────────────────

  app.get('/monitor/records', async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as { conversationId?: string; limit?: string; offset?: string };
    const conversationId = query.conversationId ?? '';
    if (!conversationId) return reply.status(400).send({ error: 'conversationId 为必填参数' });
    try {
      const service = getMonitorService();
      const records = service.getMonitorRecords(user.userId, {
        conversationId,
        limit: query.limit != null && !Number.isNaN(Number(query.limit)) ? Number(query.limit) : undefined,
        offset: query.offset != null && !Number.isNaN(Number(query.offset)) ? Number(query.offset) : undefined,
      });
      return { records };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : '获取监控记录失败' });
    }
  });

  app.get('/monitor/records/count', async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as { conversationId?: string };
    const conversationId = query.conversationId ?? '';
    if (!conversationId) return reply.status(400).send({ error: 'conversationId 为必填参数' });
    try {
      const service = getMonitorService();
      const count = service.getMonitorRecordCount(user.userId, conversationId);
      return { count };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : '获取监控记录总数失败' });
    }
  });

  app.post('/monitor/records', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const body = request.body as Record<string, unknown>;
    if (!body.conversationId || typeof body.conversationId !== 'string') {
      return reply.status(400).send({ error: 'conversationId 为必填参数且必须为字符串' });
    }
    const db = getDb();
    const convRow = db.prepare('SELECT user_id FROM conversations WHERE id = ?').get(body.conversationId) as
      | { user_id: string }
      | undefined;
    if (!convRow) return reply.status(404).send({ error: '会话不存在' });
    if (convRow.user_id !== user.userId) return reply.status(403).send({ error: '无权访问此会话' });
    const numericFields = ['promptTokens', 'completionTokens', 'totalTokens'] as const;
    for (const field of numericFields) {
      const val = body[field];
      if (val !== undefined && val !== null && typeof val !== 'number') {
        return reply.status(400).send({ error: `${field} 必须为数字或 null` });
      }
    }
    try {
      const service = getMonitorService();
      const id = service.insertMonitorRecord(user.userId, body as Parameters<typeof service.insertMonitorRecord>[1]);
      return reply.status(201).send({ id });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : '插入监控记录失败' });
    }
  });

  app.put('/monitor/records/:id', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const numericFields = ['promptTokens', 'completionTokens', 'totalTokens'] as const;
    for (const field of numericFields) {
      const val = body[field];
      if (val !== undefined && val !== null && typeof val !== 'number') {
        return reply.status(400).send({ error: `${field} 必须为数字或 null` });
      }
    }
    try {
      const service = getMonitorService();
      const updated = service.updateMonitorRecord(user.userId, id, {
        requestJson: body.requestJson as string | undefined,
        responseRawText: body.responseRawText as string | undefined,
        isComplete: body.isComplete as boolean | undefined,
        promptTokens: body.promptTokens as number | null | undefined,
        completionTokens: body.completionTokens as number | null | undefined,
        totalTokens: body.totalTokens as number | null | undefined,
        errorCategory: body.errorCategory as string | null | undefined,
        errorCode: body.errorCode as string | null | undefined,
        errorMessage: body.errorMessage as string | null | undefined,
        errorSuggestion: body.errorSuggestion as string | null | undefined,
      });
      return { updated };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : '更新监控记录失败' });
    }
  });

  app.put('/monitor/records/:id/internal-events', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { id } = request.params as { id: string };
    const body = request.body as { internalEvents?: string };
    if (!body.internalEvents) return reply.status(400).send({ error: 'internalEvents 为必填参数' });
    try {
      const service = getMonitorService();
      const updated = service.updateMonitorRecordInternalEvents(user.userId, id, body.internalEvents);
      return { updated };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : '更新内部事件失败' });
    }
  });

  app.delete('/monitor/records/old', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as { conversationId?: string; keepCount?: string };
    const conversationId = query.conversationId ?? '';
    if (!conversationId) return reply.status(400).send({ error: 'conversationId 为必填参数' });
    const keepCount = Number(query.keepCount) || 50;
    try {
      const service = getMonitorService();
      const deleted = service.deleteOldMonitorRecords(user.userId, conversationId, keepCount);
      return { deleted };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : '删除旧监控记录失败' });
    }
  });

  app.delete('/monitor/records', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as { conversationId?: string };
    const conversationId = query.conversationId ?? '';
    if (!conversationId) return reply.status(400).send({ error: 'conversationId 为必填参数' });
    try {
      const service = getMonitorService();
      const deleted = service.deleteMonitorRecordsByConversation(user.userId, conversationId);
      return { deleted };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : '删除监控记录失败' });
    }
  });

  app.delete('/monitor/records/all', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    try {
      const service = getMonitorService();
      const deleted = service.deleteAllMonitorRecords(user.userId);
      return { deleted };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : '清空监控记录失败' });
    }
  });
}

/** 监控插件定义 */
export const monitorPlugin: Plugin = {
  id: 'monitor',
  version: '1.0.0',
  name: '监控插件',
  dependencies: [],

  async install(ctx: PluginContext) {
    ctx.registerRoutes('', monitorRoutes);
    ctx.getLogger().info('监控路由已注册');
  },
};
