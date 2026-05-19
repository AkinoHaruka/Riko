/**
 * 自动梦境服务：后台知识整固任务。定期检查是否满足触发条件（时间间隔 + 会话数），
 * 获取分布式锁后，通过 SubAgent 驱动 AI 整理和归纳跨会话信息。
 */
import { createLogger } from '../../core/logger/index.js';
import { isAutoDreamEnabled, getAutoDreamConfig, autoDreamConfig } from '../../config/index.js';
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

/** 从数据库中收集最近的非梦境对话消息，作为梦境整合的上下文 */
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

export function getCurrentDreamTask(): DreamTaskState | null {
  return currentTask;
}

export function initAutoDream(): void {
  let lastSessionScanAt = 0;

  async function runAutoDream(
    context: DreamContext,
    onComplete?: DreamCompleteCallback,
  ): Promise<void> {
    const cfg = getAutoDreamConfig();
    const userRow = getDb().prepare('SELECT id FROM users LIMIT 1').get() as
      | { id: string }
      | undefined;
    const userId = userRow?.id ?? '1';

    if (!context.force && !(isAutoMemoryEnabled() && isAutoDreamEnabled())) {
      return;
    }

    if (!context.force) {
      try {
        if (!isFeatureEnabled(userId, 'feature_auto_dream')) {
          return;
        }
      } catch {
        // 读取设置失败时不阻断
      }
    }

    const triggerParams = getDreamTriggerParams(userId);
    const lastAt = readLastConsolidatedAt();
    const hoursSince = (Date.now() - lastAt) / 3_600_000;
    if (!context.force && hoursSince < triggerParams.minHours) {
      return;
    }

    const sinceScanMs = Date.now() - lastSessionScanAt;
    if (!context.force && sinceScanMs < cfg.scanIntervalMs) {
      return;
    }
    lastSessionScanAt = Date.now();

    const sessionIds = listSessionsTouchedSince(lastAt);
    const filteredIds = sessionIds.filter((id) => id !== context.currentSessionId);
    if (!context.force && filteredIds.length < triggerParams.minSessions) {
      return;
    }

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

    let task = registerDreamTask(filteredIds.length, priorMtime);
    currentTask = task;
    const memoryRoot = getAutoDreamRoot();

    eventManager.broadcast('dream_started', {
      sessionsReviewing: filteredIds.length,
      timestamp: new Date().toISOString(),
    });

    const wrappedOnComplete = (t: DreamTaskState) => {
      currentTask = t;
      onComplete?.(t);
    };

    const finalizeSuccess = (output: string, dreamTrace?: unknown) => {
      task = completeDreamTask(task);
      currentTask = task;
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
      wrappedOnComplete(task);
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
        task = addDreamTurn(task, result.output.slice(0, 500), 0, []);
        finalizeSuccess(result.output, result.trace);
      } else {
        logger.warn('Dream 子代理执行失败: %s', result.error);
        task = failDreamTask(task);
        currentTask = task;
        if (!context.force) {
          rollbackConsolidationLock(priorMtime);
        }
        wrappedOnComplete(task);
      }
    } catch (e) {
      logger.error('Dream 执行失败: %s', e instanceof Error ? e.message : String(e));
      task = failDreamTask(task);
      currentTask = task;
      if (!context.force) {
        rollbackConsolidationLock(priorMtime);
      }
      wrappedOnComplete(task);
    }
  }

  runner = runAutoDream;
}

export async function executeAutoDream(
  context?: DreamContext,
  onComplete?: DreamCompleteCallback,
): Promise<void> {
  if (!runner) return;
  const ctx = context || { force: false, currentSessionId: '' };
  await runner(ctx, onComplete);
}

export async function manualDream(onComplete?: DreamCompleteCallback): Promise<void> {
  const context: DreamContext = { force: true, currentSessionId: '' };
  await executeAutoDream(context, onComplete);
}
