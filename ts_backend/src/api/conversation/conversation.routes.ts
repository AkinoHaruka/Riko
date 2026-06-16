/**
 * 会话 CRUD 路由模块
 *
 * 职责：提供会话（Conversation）的创建、列表查询、更新和删除操作。
 * 所有端点需要认证，通过 userId 实现数据隔离。
 *
 * 端点概览：
 *   POST   /conversations       — 创建新会话
 *   GET    /conversations       — 获取当前用户的所有会话列表
 *   PUT    /conversations/:id   — 更新指定会话
 *   DELETE /conversations/:id   — 删除指定会话
 */
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
import {
  createConversationSchema,
  updateConversationSchema,
  errorResponse,
} from '../../core/validation/schemas.js';

const logger = createLogger('conversation-routes');

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /conversations
   * 创建新会话。
   *
   * 请求体：{ title: string }
   * 响应：201 — Conversation 对象
   *
   * @security 通过 user.userId 隔离，会话绑定到当前认证用户
   */
  app.post('', async (request, reply) => {
    const user = getCurrentUser(request);
    const parsed = createConversationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const { title } = parsed.data;

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

  /**
   * GET /conversations
   * 获取当前用户的所有会话列表（按更新时间降序）。
   *
   * 响应：Conversation[]
   */
  app.get('', async (request, reply) => {
    const user = getCurrentUser(request);
    const conversations = listConversations(user.userId);
    return reply.send(conversations);
  });

  /**
   * PUT /conversations/:id
   * 更新指定会话的属性（如标题）。
   *
   * 路径参数：id — 会话 ID
   * 请求体：UpdateConversationRequest（如 { title: string }）
   * 响应：更新后的 Conversation 对象
   *
   * @security service 层通过 userId 校验会话所有权
   */
  app.put('/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const { id } = request.params as { id: string };
    const parsed = updateConversationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data as UpdateConversationRequest;

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

  /**
   * DELETE /conversations/:id
   * 删除指定会话及其关联的所有消息。
   *
   * 路径参数：id — 会话 ID
   * 响应：{ success: boolean }
   *
   * @security service 层通过 userId 校验会话所有权
   */
  app.delete('/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
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
