/**
 * 消息 CRUD 路由模块
 *
 * 职责：提供消息（Message）的创建、分页查询、更新、删除及批量删除操作。
 * 所有端点需要认证，通过 userId 实现数据隔离。
 *
 * 端点概览：
 *   POST   /messages              — 创建新消息
 *   GET    /messages              — 分页查询消息（按会话 ID 筛选）
 *   PUT    /messages/:id          — 更新指定消息
 *   DELETE /messages/:id          — 删除指定消息
 *   DELETE /messages              — 批量删除指定会话的所有消息
 */
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
import {
  createMessageSchema,
  updateMessageSchema,
  errorResponse,
} from '../../core/validation/schemas.js';

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /messages
   * 创建新消息。
   *
   * 请求体：CreateMessageRequest（Zod schema 校验）
   * 响应：201 — Message 对象
   *
   * @security 通过 user.userId 隔离，消息绑定到当前用户
   */
  app.post('', async (request, reply) => {
    const user = getCurrentUser(request);
    const parsed = createMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data as CreateMessageRequest;

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

  /**
   * GET /messages
   * 分页查询消息，可按会话 ID 筛选。
   *
   * 查询参数：
   *   - conversationId: string — 会话 ID（可选，不传则返回所有消息）
   *   - limit: number — 每页数量（可选）
   *   - offset: number — 偏移量（可选）
   *
   * 响应：Message[]
   *
   * @security 通过 user.userId 隔离，只能查询自己的消息
   */
  app.get('', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          conversationId: { type: 'string' },
          limit: { type: 'integer', minimum: 1 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCurrentUser(request);
    const query = request.query as {
      conversationId?: string;
      limit?: number;
      offset?: number;
    };

    const conversationId = query.conversationId ?? '';
    const limit = query.limit;
    const offset = query.offset;

    const result = listMessages(user.userId, conversationId, limit, offset);
    return reply.send(result);
  });

  /**
   * PUT /messages/:id
   * 更新指定消息（内容、推理内容等）。
   *
   * 限流：每分钟最多 300 次（流式聊天时频繁更新消息内容）
   *
   * 路径参数：id — 消息 ID
   * 请求体：UpdateMessageRequest（Zod schema 校验）
   * 查询参数：skip_broadcast: 'true' — 跳过 WebSocket 事件广播（流式更新时减少推送频率）
   * 响应：更新后的 Message 对象
   *
   * @security service 层通过 userId 校验消息所有权
   */
  app.put(
    '/:id',
    {
      config: {
        rateLimit: {
          max: 300,
          timeWindow: '1 minute',
        },
      },
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', minLength: 1 },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            skip_broadcast: { type: 'string', enum: ['true', 'false'] },
          },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request);
      const { id } = request.params as { id: string };
      const parsed = updateMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
      }
      const body = parsed.data as UpdateMessageRequest;
      const query = request.query as { skip_broadcast?: string };
      // 流式更新时前端设置 skip_broadcast=true，避免每次更新都推送 WebSocket 事件
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

  /**
   * DELETE /messages/:id
   * 删除指定消息。
   *
   * 限流：每分钟最多 300 次
   *
   * 路径参数：id — 消息 ID
   * 响应：删除结果
   *
   * @security service 层通过 userId 校验消息所有权
   */
  app.delete(
    '/:id',
    {
      config: {
        rateLimit: {
          max: 300,
          timeWindow: '1 minute',
        },
      },
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', minLength: 1 },
          },
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

  /**
   * DELETE /messages
   * 批量删除指定会话的所有消息。
   *
   * 查询参数：conversationId: string — 会话 ID（必填）
   * 响应：删除结果
   *
   * @security 通过 user.userId 隔离，只能删除自己的消息
   */
  app.delete('', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          conversationId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
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
