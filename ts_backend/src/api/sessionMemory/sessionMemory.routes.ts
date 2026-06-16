/**
 * 会话笔记路由模块
 *
 * 职责：提供 AI 提取的会话记忆笔记的读取、手动触发提取和删除操作。
 * 会话笔记是对单个对话内容的自动摘要，由 AI 从对话中提取关键信息。
 *
 * 端点概览：
 *   GET    /session-notes/:conversationId          — 读取会话笔记
 *   POST   /session-notes/:conversationId/extract  — 手动触发笔记提取
 *   DELETE /session-notes/:conversationId          — 删除会话笔记
 */
import type { FastifyInstance } from 'fastify';
import { getCurrentUser } from '../../core/middleware/index.js';
import { SessionMemoryService } from '../../domain/sessionMemory/index.js';
import { HttpError } from '../../core/utils/index.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('SessionMemoryRoutes');
const service = new SessionMemoryService();

export async function sessionMemoryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /session-notes/:conversationId
   * 读取指定会话的笔记。
   *
   * 路径参数：conversationId — 会话 ID
   * 响应：笔记内容对象
   *
   * @security 通过 user.userId 隔离，只能读取自己会话的笔记
   */
  app.get('/:conversationId', async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    const user = getCurrentUser(request);
    try {
      const result = service.getNotes(conversationId, user.userId);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : '读取会话笔记失败';
      logger.error('[GET /:conversationId] 读取会话笔记失败: %s', message);
      return reply.status(500).send({ error: message });
    }
  });

  /**
   * POST /session-notes/:conversationId/extract
   * 手动触发 AI 从对话中提取会话笔记。
   *
   * 限流：每分钟最多 5 次（AI 调用成本较高）
   *
   * 路径参数：conversationId — 会话 ID
   * 响应：{ success: boolean, notes?: string }
   * 错误：404 会话不存在 / 500 提取失败
   *
   * @security 通过 user.userId 隔离，只能提取自己会话的笔记
   */
  app.post(
    '/:conversationId/extract',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const user = getCurrentUser(request);
      logger.info(
        '[POST /:conversationId/extract] 开始提取, conversationId=%s, userId=%s',
        conversationId,
        user.userId,
      );

      try {
        const result = await service.extractNotes(conversationId, user.userId);
        logger.info('[POST /:conversationId/extract] 提取完成, success=%s', result.success);
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : '';
        logger.error('[POST /:conversationId/extract] 提取失败: %s', message);
        if (stack) {
          logger.debug('[POST /:conversationId/extract] 错误堆栈: %s', stack);
        }

        // service 层抛出 HttpError 时直接使用其 statusCode
        if (err instanceof HttpError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }

        // 兜底：非 HttpError 的未知错误统一 500
        return reply.status(500).send({ error: `会话记忆提取失败: ${message}` });
      }
    },
  );

  /**
   * DELETE /session-notes/:conversationId
   * 删除指定会话的笔记。
   *
   * 路径参数：conversationId — 会话 ID
   * 响应：删除结果
   *
   * @security 通过 user.userId 隔离，只能删除自己会话的笔记
   */
  app.delete('/:conversationId', async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    const user = getCurrentUser(request);
    try {
      const result = service.deleteNotes(conversationId, user.userId);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除会话笔记失败';
      logger.error('[DELETE /:conversationId] 删除会话笔记失败: %s', message);
      return reply.status(500).send({ error: message });
    }
  });
}
