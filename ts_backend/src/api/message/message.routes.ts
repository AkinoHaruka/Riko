// 消息 CRUD API：创建、分页查询、更新、删除及批量删除消息
import type { FastifyInstance } from 'fastify';
import { getCurrentUser } from '../../core/middleware/index.js';
import { HttpError } from '../../core/utils/index.js';
import {
  createMessage,
  listMessages,
  updateMessage,
  deleteMessage,
  batchDeleteMessages,
} from '../../domain/message/index.js';
import type { CreateMessageRequest, UpdateMessageRequest } from '../../domain/message/types.js';

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.post('', async (request, reply) => {
    const user = getCurrentUser(request);
    const body = request.body as CreateMessageRequest;

    try {
      const message = createMessage(user.userId, body);
      return reply.status(201).send(message);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply.status(400).send({ error: err instanceof Error ? err.message : '创建消息失败' });
    }
  });

  app.get('', async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as {
      conversationId?: string;
      limit?: string;
      offset?: string;
    };

    const conversationId = query.conversationId ?? '';
    const limit = query.limit !== undefined ? Number(query.limit) : undefined;
    const offset = query.offset !== undefined ? Number(query.offset) : undefined;

    const result = listMessages(user.userId, conversationId, limit, offset);
    return reply.send(result);
  });

  app.put(
    '/:id',
    {
      config: {
        rateLimit: {
          max: 300,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request);
      const { id } = request.params as { id: string };
      const body = request.body as UpdateMessageRequest;
      const query = request.query as { skip_broadcast?: string };
      const skipBroadcast = query.skip_broadcast === 'true';

      try {
        const result = updateMessage(user.userId, id, body, skipBroadcast);
        return reply.send(result);
      } catch (err) {
        if (err instanceof HttpError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : '更新消息失败' });
      }
    },
  );

  app.delete(
    '/:id',
    {
      config: {
        rateLimit: {
          max: 300,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request);
      const { id } = request.params as { id: string };

      try {
        const result = deleteMessage(user.userId, id);
        return reply.send(result);
      } catch (err) {
        if (err instanceof HttpError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        return reply
          .status(500)
          .send({ error: err instanceof Error ? err.message : '删除消息失败' });
      }
    },
  );

  app.delete('', async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as { conversationId?: string };
    const conversationId = query.conversationId ?? '';

    try {
      const result = batchDeleteMessages(user.userId, conversationId);
      return reply.send(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply.status(500).send({ error: err instanceof Error ? err.message : '删除消息失败' });
    }
  });
}
