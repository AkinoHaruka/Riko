/**
 * 后采样钩子系统。流式响应结束后依次执行：上下文压缩、会话笔记提取、梦境触发。
 * 每个钩子独立 try-catch，单个失败不影响后续执行。
 */
import { createLogger } from '../../core/logger/index.js';
import { SessionMemoryService } from '../sessionMemory/service.js';
import { SessionMemoryManager } from '../sessionMemory/manager.js';
import { estimateTokenCount } from '../sessionMemory/promptBuilder.js';
import { getDb } from '../../core/database/index.js';
import { SSE_EVENT_COMPACT } from './types.js';

const logger = createLogger('PostSampling');

export interface PostSamplingContext {
  conversationId: string;
  userId: string;
  model: string;
  toolCallCountThisTurn: number;
}

/**
 * 后采样钩子入口。stream.ts 在流式响应完成后调用。
 * sseEvents 收集钩子产生的 SSE 事件数据，由 stream.ts 统一发送。
 */
export async function runPostSamplingHooks(
  context: PostSamplingContext,
  onSseEvent: (eventData: string) => void,
): Promise<void> {
  const { conversationId, userId, model, toolCallCountThisTurn } = context;

  // 1. 压缩钩子（优先释放上下文空间）
  try {
    await runCompactHook(conversationId, model, userId, onSseEvent);
  } catch (e) {
    logger.warn('Compact hook 失败: %s', e);
  }

  // 2. 会话记忆钩子
  try {
    await runSessionMemoryHook(conversationId, userId, toolCallCountThisTurn, onSseEvent);
  } catch (e) {
    logger.warn('SessionMemory hook 失败: %s', e);
  }

  // 3. 梦境钩子（fire-and-forget）
  runDreamHook(conversationId, userId).catch((e) => {
    logger.warn('Dream hook 失败: %s', e);
  });
}

async function runCompactHook(
  conversationId: string,
  model: string,
  userId: string,
  onSseEvent: (eventData: string) => void,
): Promise<void> {
  const compactModule = (await import('../compact/service.js')) as {
    autoCompactIfNeeded: typeof import('../compact/service.js').autoCompactIfNeeded;
  };
  if (typeof compactModule.autoCompactIfNeeded !== 'function') return;

  const result = await compactModule.autoCompactIfNeeded(conversationId, model, userId);
  if (result?.was_compacted) {
    const cr = result.compaction_result;
    onSseEvent(
      JSON.stringify({
        type: SSE_EVENT_COMPACT,
        data: {
          strategy: result.strategy,
          conversation_id: conversationId,
          pre_compact_tokens: cr?.preCompactTokenCount ?? 0,
          post_compact_tokens: cr?.truePostCompactTokenCount ?? 0,
          pre_compact_message_count: result.pre_compact_message_count ?? 0,
          post_compact_message_count: result.messages?.length ?? 0,
          is_auto: cr?.isAutoCompact ?? true,
        },
      }),
    );
    logger.info(
      '自动压缩完成 conversation=%s strategy=%s pre=%d post=%d',
      conversationId,
      result.strategy,
      cr?.preCompactTokenCount ?? 0,
      cr?.truePostCompactTokenCount ?? 0,
    );
  }
}

async function runSessionMemoryHook(
  conversationId: string,
  userId: string,
  toolCallCountThisTurn: number,
  onSseEvent: (eventData: string) => void,
): Promise<void> {
  const manager = new SessionMemoryManager();

  const db = getDb();
  const messageCountRow = db
    .prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
    .get(conversationId) as { count: number } | undefined;
  const messageCount = messageCountRow?.count ?? 0;

  const enabled = manager.shouldEnable(conversationId, messageCount, userId);
  if (!enabled) {
    logger.info('会话记忆未启用 conversation=%s messageCount=%d', conversationId, messageCount);
    return;
  }

  const currentNotes = manager.readSessionMemory(conversationId);
  const currentTokenCount = estimateTokenCount(currentNotes);

  const triggerState = manager.getTriggerState(conversationId);
  const wasInitialized = triggerState.lastUpdateTokenCount > 0;

  if (wasInitialized) {
    const hasToolCalls = toolCallCountThisTurn > 0;
    const shouldUpdate = manager.shouldTriggerUpdate(
      conversationId,
      currentTokenCount,
      toolCallCountThisTurn,
      hasToolCalls,
      userId,
    );
    if (!shouldUpdate) {
      logger.info(
        '会话记忆更新条件未满足 conversation=%s currentTokens=%d lastTokens=%d toolCalls=%d',
        conversationId,
        currentTokenCount,
        triggerState.lastUpdateTokenCount,
        toolCallCountThisTurn,
      );
      return;
    }
  }

  const beforeTokens = currentTokenCount;
  const service = new SessionMemoryService();
  const result = await service.extractNotes(conversationId, userId);

  const afterNotes = manager.readSessionMemory(conversationId);
  const afterTokens = estimateTokenCount(afterNotes);
  manager.updateState(conversationId, afterTokens);

  if (result.success) {
    onSseEvent(
      JSON.stringify({
        type: 'session_memory_activity',
        data: {
          conversation_id: conversationId,
          trigger_type: wasInitialized ? 'update' : 'init',
          tokens_before: beforeTokens,
          tokens_after: afterTokens,
        },
      }),
    );
    logger.info(
      '会话记忆更新完成 conversation=%s type=%s tokens=%d→%d',
      conversationId,
      wasInitialized ? 'update' : 'init',
      beforeTokens,
      afterTokens,
    );
  }
}

async function runDreamHook(currentSessionId: string, userId: string): Promise<void> {
  try {
    const { getAutoDreamConfig } = await import('../../config/auto_dream.js');
    const config = getAutoDreamConfig();
    if (!config.enabled) return;

    const { readLastConsolidatedAt, listSessionsTouchedSince } =
      await import('../autoDream/lock.js');
    const { getDreamTriggerParams } = await import('../autoDream/trigger.js');
    const { isFeatureEnabled } = await import('../../domain/setting/service.js');

    try {
      if (!(await isFeatureEnabled(userId, 'feature_auto_dream'))) return;
    } catch {
      return;
    }

    const triggerParams = getDreamTriggerParams(userId);
    const lastAt = readLastConsolidatedAt();
    const hoursSince = (Date.now() - lastAt) / 3600000;
    if (hoursSince < triggerParams.minHours) return;

    const sessionIds = listSessionsTouchedSince(lastAt);
    const filteredIds = sessionIds.filter((id) => id !== currentSessionId);
    if (filteredIds.length < triggerParams.minSessions) return;

    const { manualDream } = await import('../autoDream/service.js');
    manualDream().catch((e) => logger.warn('Dream 执行失败: %s', e));
  } catch (e) {
    logger.warn('Dream hook 触发检查失败: %s', e);
  }
}
