// 监控 API：子代理活动记录和 API 调用监控记录的 CRUD
import type { FastifyInstance } from 'fastify';
import { getCurrentUser } from '../../core/middleware/index.js';
import { HttpError } from '../../core/utils/index.js';
import { getMonitorService, deleteAllActivities } from '../../domain/monitor/service.js';

export async function monitorRoutes(app: FastifyInstance): Promise<void> {
  // ─── Sub-agent 活动记录 ────────────────────────────────────────

  app.delete('/monitor/activities', async (request, reply) => {
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
    const query = request.query as {
      type?: string;
      limit?: string;
      offset?: string;
    };

    try {
      const service = getMonitorService();
      const activities = service.getActivities(user.userId, {
        type: query.type,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });

      return { activities };
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '获取活动记录失败' });
    }
  });

  app.get('/monitor/activities/latest', async (request, reply) => {
    const user = getCurrentUser(request);

    try {
      const service = getMonitorService();
      return service.getLatestActivities(user.userId);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '获取最新活动记录失败' });
    }
  });

  // ─── API 监控记录 ──────────────────────────────────────────────

  app.get('/monitor/records', async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as {
      conversationId?: string;
      limit?: string;
      offset?: string;
    };

    const conversationId = query.conversationId ?? '';
    if (!conversationId) {
      return reply.status(400).send({ error: 'conversationId 为必填参数' });
    }

    try {
      const service = getMonitorService();
      const records = service.getMonitorRecords(user.userId, {
        conversationId,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
      return { records };
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '获取监控记录失败' });
    }
  });

  app.get('/monitor/records/count', async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as { conversationId?: string };

    const conversationId = query.conversationId ?? '';
    if (!conversationId) {
      return reply.status(400).send({ error: 'conversationId 为必填参数' });
    }

    try {
      const service = getMonitorService();
      const count = service.getMonitorRecordCount(user.userId, conversationId);
      return { count };
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '获取监控记录总数失败' });
    }
  });

  app.post('/monitor/records', async (request, reply) => {
    const user = getCurrentUser(request);
    const body = request.body as {
      conversationId?: string;
      requestJson?: string;
      responseRawText?: string;
      isComplete?: boolean;
      promptTokens?: number | null;
      completionTokens?: number | null;
      totalTokens?: number | null;
      errorCategory?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      errorSuggestion?: string | null;
      internalEvents?: string | null;
    };

    if (!body.conversationId) {
      return reply.status(400).send({ error: 'conversationId 为必填参数' });
    }

    try {
      const service = getMonitorService();
      const id = service.insertMonitorRecord(user.userId, body as Required<typeof body>);
      return reply.status(201).send({ id });
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '插入监控记录失败' });
    }
  });

  app.put('/monitor/records/:id', async (request, reply) => {
    const user = getCurrentUser(request);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

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
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '更新监控记录失败' });
    }
  });

  app.put('/monitor/records/:id/internal-events', async (request, reply) => {
    const user = getCurrentUser(request);
    const { id } = request.params as { id: string };
    const body = request.body as { internalEvents?: string };

    if (!body.internalEvents) {
      return reply.status(400).send({ error: 'internalEvents 为必填参数' });
    }

    try {
      const service = getMonitorService();
      const updated = service.updateMonitorRecordInternalEvents(
        user.userId,
        id,
        body.internalEvents,
      );
      return { updated };
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '更新内部事件失败' });
    }
  });

  app.delete('/monitor/records', async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as { conversationId?: string };

    const conversationId = query.conversationId ?? '';
    if (!conversationId) {
      return reply.status(400).send({ error: 'conversationId 为必填参数' });
    }

    try {
      const service = getMonitorService();
      const deleted = service.deleteMonitorRecordsByConversation(user.userId, conversationId);
      return { deleted };
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '删除监控记录失败' });
    }
  });

  app.delete('/monitor/records/all', async (request, reply) => {
    const user = getCurrentUser(request);

    try {
      const service = getMonitorService();
      const deleted = service.deleteAllMonitorRecords(user.userId);
      return { deleted };
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '清空监控记录失败' });
    }
  });
}
