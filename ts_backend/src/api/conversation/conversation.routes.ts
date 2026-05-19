// 会话 CRUD API：创建、列表、更新、删除会话
import type { FastifyInstance } from 'fastify';
import { getCurrentUser } from '../../core/middleware/index.js';
import { HttpError } from '../../core/utils/index.js';
import { createLogger } from '../../core/logger/index.js';
import {
  createConversation,
  listConversations,
  updateConversation,
  deleteConversation,
} from '../../domain/conversation/index.js';
import type { UpdateConversationRequest } from '../../domain/conversation/types.js';

const logger = createLogger('conversation-routes');

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.post('', async (request, reply) => {
    const user = getCurrentUser(request);
    const { title } = request.body as { title: string };

    try {
      const conversation = createConversation(user.userId, title);
      return reply.status(201).send(conversation);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      logger.error('创建会话失败 userId=%s title=%s error=%s', user.userId, title, err);
      return reply.status(500).send({ error: err instanceof Error ? err.message : '创建会话失败' });
    }
  });

  app.get('', async (request, reply) => {
    const user = getCurrentUser(request);
    const conversations = listConversations(user.userId);
    return reply.send(conversations);
  });

  app.put('/:id', async (request, reply) => {
    const user = getCurrentUser(request);
    const { id } = request.params as { id: string };
    const body = request.body as UpdateConversationRequest;

    try {
      const conversation = updateConversation(id, user.userId, body);
      return reply.send(conversation);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      logger.error('更新会话失败 id=%s userId=%s error=%s', id, user.userId, err);
      return reply.status(500).send({ error: err instanceof Error ? err.message : '更新会话失败' });
    }
  });

  app.delete('/:id', async (request, reply) => {
    const user = getCurrentUser(request);
    const { id } = request.params as { id: string };

    try {
      const result = deleteConversation(id, user.userId);
      return reply.send(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      logger.error('删除会话失败 id=%s userId=%s error=%s', id, user.userId, err);
      return reply.status(500).send({ error: err instanceof Error ? err.message : '删除会话失败' });
    }
  });
}
