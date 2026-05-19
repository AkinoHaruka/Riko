// 会话笔记 API：AI 提取的会话记忆笔记的读取、手动提取、删除
import type { FastifyInstance } from 'fastify';
import { getCurrentUser } from '../../core/middleware/index.js';
import { SessionMemoryService } from '../../domain/sessionMemory/index.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('SessionMemoryRoutes');
const service = new SessionMemoryService();

export async function sessionMemoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/:conversationId', async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    try {
      const result = service.getNotes(conversationId);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : '读取会话笔记失败';
      logger.error('[GET /:conversationId] 读取会话笔记失败: %s', message);
      return reply.status(500).send({ error: message });
    }
  });

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

        if (message === '该会话没有消息记录') {
          return reply.status(404).send({ error: message });
        }
        if (message.includes('API Key') || message.includes('客户端')) {
          return reply.status(400).send({ error: message });
        }
        if (message.includes('调用失败') || message.includes('空响应') || message.includes('API')) {
          return reply.status(502).send({ error: `DeepSeek API 调用失败: ${message}` });
        }
        if (message.includes('数据库')) {
          return reply.status(500).send({ error: `数据库错误: ${message}` });
        }
        return reply.status(500).send({ error: `会话记忆提取失败: ${message}` });
      }
    },
  );

  app.delete('/:conversationId', async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    try {
      const result = service.deleteNotes(conversationId);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除会话笔记失败';
      logger.error('[DELETE /:conversationId] 删除会话笔记失败: %s', message);
      return reply.status(500).send({ error: message });
    }
  });
}
