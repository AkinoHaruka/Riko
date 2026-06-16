/**
 * 梦境(Dream)路由模块
 *
 * 职责：提供手动触发后台记忆整合任务（Dream）和查询当前 Dream 任务状态的端点。
 * Dream 任务在后台异步执行，对记忆进行整理和合并。
 *
 * 端点概览：
 *   POST /dream         — 手动触发 Dream 任务
 *   GET  /dream/status  — 查询当前 Dream 任务状态
 */
import type { FastifyInstance } from 'fastify';
import { createLogger } from '../../core/logger/index.js';
import { getCurrentUser } from '../../core/middleware/index.js';
import { manualDream, getCurrentDreamTask } from '../../domain/autoDream/service.js';
import { getTaskSummary } from '../../domain/autoDream/task.js';

const logger = createLogger('DreamRoutes');

/** manualDream 的超时时间（毫秒），等待任务注册后即返回 */
const MANUAL_DREAM_TIMEOUT_MS = 5_000;

export async function dreamRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /dream
   * 手动触发 Dream 记忆整合任务。
   * 若已有任务在运行则返回 409；否则启动任务，等待最多 5 秒确认注册后返回。
   * 任务在后台继续执行，不会因 HTTP 响应返回而中断。
   *
   * 响应：{ status: 'started', task?: TaskSummary, message?: string }
   * 错误：409 已有任务运行中 / 500 启动失败
   *
   * @security 需要认证
   * @TODO Dream 任务应绑定到 userId，当前为全局单例任务。
   *        多用户场景下需将 Dream 任务按 userId 隔离，
   *        确保每个用户只能触发和查看自己的 Dream 任务。
   */
  app.post('/dream', async (request, reply) => {
    try {
      getCurrentUser(request);

      const existingTask = getCurrentDreamTask();
      if (existingTask && existingTask.status === 'running') {
        return reply
          .code(409)
          .send({ error: '已有 Dream 任务正在运行', task: getTaskSummary(existingTask) });
      }

      // 使用超时 await manualDream，确保任务注册后再查询状态
      // 超时后仍返回 started，任务在后台继续执行
      const dreamPromise = manualDream((task) => {
        logger.info('Dream 任务完成: id=%s status=%s', task.id, task.status);
      });

      const timeoutPromise = new Promise<void>((resolve) =>
        setTimeout(resolve, MANUAL_DREAM_TIMEOUT_MS),
      );

      await Promise.race([dreamPromise, timeoutPromise]).catch((e) => {
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

  /**
   * GET /dream/status
   * 查询当前 Dream 任务的状态。若无运行中的任务则返回 idle。
   *
   * 响应：TaskSummary | { status: 'idle', message: string }
   *
   * @security 需要认证
   * @TODO Dream 任务应绑定到 userId，当前返回全局任务状态。
   *        多用户场景下需按 userId 过滤，仅返回该用户的 Dream 任务状态。
   */
  app.get('/dream/status', async (request, _reply) => {
    getCurrentUser(request);

    const currentTask = getCurrentDreamTask();
    if (currentTask) {
      return getTaskSummary(currentTask);
    }

    return { status: 'idle', message: '没有正在运行或最近完成的 Dream 任务' };
  });
}
