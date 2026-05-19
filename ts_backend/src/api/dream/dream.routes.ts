// 梦境(Dream) API：触发后台记忆整合任务、查询任务状态
import type { FastifyInstance } from 'fastify';
import { createLogger } from '../../core/logger/index.js';
import { getCurrentUser } from '../../core/middleware/index.js';
import { manualDream, getCurrentDreamTask } from '../../domain/autoDream/service.js';
import { getTaskSummary } from '../../domain/autoDream/task.js';

const logger = createLogger('DreamRoutes');

export async function dreamRoutes(app: FastifyInstance): Promise<void> {
  app.post('/dream', async (request, reply) => {
    try {
      getCurrentUser(request);

      const existingTask = getCurrentDreamTask();
      if (existingTask && existingTask.status === 'running') {
        return reply
          .code(409)
          .send({ error: '已有 Dream 任务正在运行', task: getTaskSummary(existingTask) });
      }

      manualDream((task) => {
        logger.info('Dream 任务完成: id=%s status=%s', task.id, task.status);
      }).catch((e) => {
        logger.error('Dream 任务异常: %s', e instanceof Error ? e.message : String(e));
      });

      const currentTask = getCurrentDreamTask();
      if (currentTask) {
        return { status: 'started', task: getTaskSummary(currentTask) };
      }

      return { status: 'started', message: 'Dream 任务已启动' };
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/dream/status', async (request, _reply) => {
    getCurrentUser(request);

    const currentTask = getCurrentDreamTask();
    if (currentTask) {
      return getTaskSummary(currentTask);
    }

    return { status: 'idle', message: '没有正在运行或最近完成的 Dream 任务' };
  });
}
