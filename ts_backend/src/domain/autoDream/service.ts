/**
 * 自动梦境服务：后台知识整固任务。
 * 定期检查是否满足触发条件（时间间隔 + 会话数），获取分布式锁后，
 * 通过 SubAgent 驱动 AI 整理和归纳跨会话信息。
 * 整固完成后更新常驻记忆并广播事件通知前端。
 */
import { createLogger } from '../../core/logger/index.js';
import { getAutoDreamConfig, autoDreamConfig } from '../../config/index.js';
import { isAutoMemoryEnabled, getAutoDreamRoot } from '../../memoryStorage/paths.js';
import type { DreamContext, DreamTaskState } from './types.js';
import { registerDreamTask, addDreamTurn, completeDreamTask, failDreamTask } from './task.js';
import {
  readLastConsolidatedAt,
  listSessionsTouchedSince,
  tryAcquireConsolidationLock,
  rollbackConsolidationLock,
  recordConsolidation,
} from './lock.js';
import { executeDreamSubAgent } from './client.js';
import { buildDreamTools } from './toolExecutor.js';
import { buildDreamSubAgentPrompt } from './prompt.js';
import { getDreamTriggerParams } from './trigger.js';
import { updatePersistentMemoryFromDream } from './memorySync.js';
import { eventManager } from '../../core/events/manager.js';
import { recordActivity } from '../../domain/monitor/service.js';
import { isFeatureEnabled } from '../../domain/setting/index.js';
import { SSE_EVENT_DREAM_ACTIVITY } from '../chat/types.js';
import { getPersistentMemoryPath } from '../../memoryStorage/paths.js';
import { getDb } from '../../core/database/index.js';
import { buildSubAgentPromptParts } from '../subAgent/promptBuilder.js';
import {
  loadMainPrompt,
  loadToolRules,
  loadPersistentMemory,
  loadFile,
} from '../../prompts/loader.js';
import { listByConversation } from '../message/repository.js';
import { findByUserId } from '../conversation/repository.js';

const logger = createLogger('AutoDream');

type DreamCompleteCallback = (task: DreamTaskState) => void;

let runner: ((context: DreamContext, onComplete?: DreamCompleteCallback) => Promise<void>) | null =
  null;
let currentTask: DreamTaskState | null = null;
let isRunning = false;
let _initialized = false;

/**
 * 从数据库中收集最近的非梦境对话消息，作为梦境整合的上下文。
 * 取最近 2 条活跃对话，每条对话取最近若干条消息，总计不超过 maxMessages 条。
 * @param userId - 用户 ID
 * @param maxMessages - 最大消息数，默认 30
 */
function collectRecentConversationContext(
  userId: string,
  maxMessages: number = 30,
): string {
  try {
    const allConvs = findByUserId(userId, 50);
    // 按更新时间倒序，排除梦境整理对话，取最近两条活跃对话
    const recent = allConvs
      .filter((c) => c.title !== '梦境整理')
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 2);

    const parts: string[] = [];
    for (const conv of recent) {
      const messages = listByConversation(conv.id, userId);
      const recentMsgs = messages.slice(-Math.ceil(maxMessages / recent.length));
      if (recentMsgs.length === 0) continue;
      const lines = recentMsgs.map((m) => `[${m.role}] ${m.content}`);
      parts.push(`## 对话「${conv.title}」(${conv.id}) — 最近 ${recentMsgs.length} 条\n${lines.join('\n')}`);
    }
    return parts.join('\n\n');
  } catch (e) {
    logger.warn('收集对话上下文失败: %s', e instanceof Error ? e.message : String(e));
    return '';
  }
}

/** 获取当前正在执行的梦境任务状态，无任务时返回 null */
export function getCurrentDreamTask(): DreamTaskState | null {
  return currentTask;
}

/**
 * 初始化自动梦境服务。注册内部运行函数，但不立即执行。
 * 实际触发由外部定时调用 executeAutoDream 控制。
 */
export function initAutoDream(): void {
  // HMR 守卫：防止模块热替换时重复初始化
  if (_initialized) {
    logger.debug('AutoDream 已初始化，跳过重复调用');
    return;
  }
  _initialized = true;

  let lastSessionScanAt = 0;

  async function runAutoDream(
    context: DreamContext,
    onComplete?: DreamCompleteCallback,
  ): Promise<void> {
    const cfg = getAutoDreamConfig();
    const userRow = getDb().prepare('SELECT id FROM users LIMIT 1').get() as
      | { id: string }
      | undefined;
    if (!userRow) {
      logger.warn('AutoDream 跳过：无用户记录');
      return;
    }
    const userId = userRow.id;

    // 非强制模式下检查全局开关
    if (!context.force && !(isAutoMemoryEnabled() && getAutoDreamConfig().enabled)) {
      return;
    }

    // 非强制模式下检查用户级功能开关
    if (!context.force) {
      try {
        if (!isFeatureEnabled(userId, 'feature_auto_dream')) {
          return;
        }
      } catch {
        // 读取设置失败时不阻断
      }
    }

    // 检查时间间隔是否满足最小触发条件
    const triggerParams = getDreamTriggerParams(userId);
    const lastAt = readLastConsolidatedAt();
    const hoursSince = (Date.now() - lastAt) / 3_600_000;
    if (!context.force && hoursSince < triggerParams.minHours) {
      return;
    }

    // 扫描间隔限流，避免频繁查询数据库
    const sinceScanMs = Date.now() - lastSessionScanAt;
    if (!context.force && sinceScanMs < cfg.scanIntervalMs) {
      return;
    }
    lastSessionScanAt = Date.now();

    // 检查新增会话数是否满足最小触发条件
    const sessionIds = listSessionsTouchedSince(lastAt);
    const filteredIds = sessionIds.filter((id) => id !== context.currentSessionId);
    if (!context.force && filteredIds.length < triggerParams.minSessions) {
      return;
    }

    // 获取分布式锁（强制模式跳过锁检查）
    let priorMtime: number | null;
    if (context.force) {
      priorMtime = lastAt;
    } else {
      priorMtime = tryAcquireConsolidationLock();
      if (priorMtime === null) return;
    }

    logger.info(
      { hoursSince, sessionCount: filteredIds.length },
      `Dream 触发 — 距上次 ${hoursSince.toFixed(1)}h, ${filteredIds.length} 个会话待审查`,
    );

    const taskRef = { current: registerDreamTask(filteredIds.length, priorMtime) };
    currentTask = taskRef.current;
    const memoryRoot = getAutoDreamRoot();

    eventManager.broadcast('dream_started', {
      sessionsReviewing: filteredIds.length,
      timestamp: new Date().toISOString(),
    });

    const wrappedOnComplete = (t: DreamTaskState) => {
      currentTask = t;
      onComplete?.(t);
    };

    /** 整固成功后的收尾工作：记录完成状态、更新常驻记忆、广播事件 */
    const finalizeSuccess = (output: string, dreamTrace?: unknown) => {
      taskRef.current = completeDreamTask(taskRef.current);
      currentTask = taskRef.current;
      recordConsolidation();
      updatePersistentMemoryFromDream(memoryRoot);
      eventManager.broadcast(SSE_EVENT_DREAM_ACTIVITY, {
        status: 'completed',
        sessionsReviewed: filteredIds.length,
        hoursSince: hoursSince.toFixed(1),
        summary: output.slice(0, 2000),
        trace: dreamTrace ?? null,
      });
      recordActivity(userId, {
        type: 'dream',
        timestamp: new Date().toISOString(),
        success: true,
        metadata: {
          sessionsReviewed: filteredIds.length,
          hoursSince: hoursSince.toFixed(1),
        },
        summary: `Dream completed: reviewed ${filteredIds.length} sessions`,
      });
      wrappedOnComplete(taskRef.current);
    };

    try {
      const residentMemoryPath = getPersistentMemoryPath();
      const residentMemoryContent = loadFile(residentMemoryPath, '');
      const subAgentPrompt = buildDreamSubAgentPrompt(
        memoryRoot,
        filteredIds,
        autoDreamConfig.logTranscriptDir,
        residentMemoryPath,
        residentMemoryContent,
      );
      const mainPrompt = loadMainPrompt();
      const toolRules = loadToolRules();
      const persistentMemory = loadPersistentMemory();

      const recentContext = collectRecentConversationContext(userId);

      const promptParts = buildSubAgentPromptParts(
        mainPrompt,
        toolRules,
        persistentMemory,
        '',
        recentContext,
        subAgentPrompt,
      );

      const tools = buildDreamTools() as unknown as Record<string, unknown>[];
      const result = await executeDreamSubAgent(promptParts, tools, userId, {
        conversationId: '0',
        memoryRoot,
      });

      if (result.success) {
        taskRef.current = addDreamTurn(taskRef.current, result.output.slice(0, 500), 0, []);
        finalizeSuccess(result.output, result.trace);
      } else {
        logger.warn('Dream 子代理执行失败: %s', result.error);
        taskRef.current = failDreamTask(taskRef.current);
        currentTask = taskRef.current;
        if (!context.force) {
          rollbackConsolidationLock(priorMtime);
        }
        wrappedOnComplete(taskRef.current);
      }
    } catch (e) {
      logger.error('Dream 执行失败: %s', e instanceof Error ? e.message : String(e));
      taskRef.current = failDreamTask(taskRef.current);
      currentTask = taskRef.current;
      if (!context.force) {
        rollbackConsolidationLock(priorMtime);
      }
      wrappedOnComplete(taskRef.current);
    }
  }

  runner = runAutoDream;
}

/**
 * 执行自动梦境。若已有任务在运行则跳过。
 * @param context - 梦境执行上下文，默认为非强制模式
 * @param onComplete - 任务完成后的回调
 */
export async function executeAutoDream(
  context?: DreamContext,
  onComplete?: DreamCompleteCallback,
): Promise<void> {
  if (!runner || isRunning) return;
  // 在任何 await 之前立即设置标志，防止并发调用竞态
  isRunning = true;
  const ctx = context || { force: false, currentSessionId: '' };
  try {
    await runner(ctx, onComplete);
  } finally {
    isRunning = false;
  }
}

/**
 * 手动触发梦境整固（强制模式，跳过触发条件检查和锁获取）。
 * @param onComplete - 任务完成后的回调
 */
export async function manualDream(onComplete?: DreamCompleteCallback): Promise<void> {
  const context: DreamContext = { force: true, currentSessionId: '' };
  await executeAutoDream(context, onComplete);
}
