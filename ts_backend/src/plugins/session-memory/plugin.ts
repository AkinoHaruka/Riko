/**
 * 会话记忆插件。
 *
 * 订阅 CHAT_POST_SESSION_MEMORY 事件，在 compact 完成后自动检查并执行会话笔记提取。
 *
 * @module plugins/session-memory/plugin
 */
import type { Plugin, PluginContext } from '../../core/runtime/types.js';
import { PluginEvents } from '../../core/events/types.js';
import { SessionMemoryService } from '../../domain/sessionMemory/service.js';
import { SessionMemoryManager } from '../../domain/sessionMemory/manager.js';
import { estimateTokenCount } from '../../domain/sessionMemory/promptBuilder.js';
import { getDb } from '../../core/database/index.js';

interface PostSamplingPayload {
  conversationId: string;
  userId: string;
  model: string;
  toolCallCountThisTurn: number;
  onSseEvent: (eventData: string) => void;
}

export const sessionMemoryPlugin: Plugin = {
  id: 'session-memory',
  version: '1.0.0',
  name: '会话记忆插件',
  dependencies: [],

  async install(ctx: PluginContext) {
    const log = ctx.getLogger();
    const manager = new SessionMemoryManager();
    const service = new SessionMemoryService();

    ctx.on<PostSamplingPayload>(PluginEvents.CHAT_POST_SESSION_MEMORY, async (payload) => {
      try {
        const { conversationId, userId, toolCallCountThisTurn } = payload;

        const db = getDb();
        const messageCountRow = db
          .prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
          .get(conversationId) as { count: number } | undefined;
        const messageCount = messageCountRow?.count ?? 0;

        const enabled = manager.shouldEnable(conversationId, messageCount, userId);
        if (!enabled) {
          log.info('会话记忆未启用 conversation=%s messageCount=%d', conversationId, messageCount);
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
            log.info(
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
        const result = await service.extractNotes(conversationId, userId);

        const afterNotes = manager.readSessionMemory(conversationId);
        const afterTokens = estimateTokenCount(afterNotes);
        manager.updateState(conversationId, afterTokens);

        if (result.success) {
          // session_memory_activity 已由 SessionMemoryService 通过 WebSocket 广播，
          // 不再通过 onSseEvent 重复推送，避免前端收到双重通知
          log.info(
            '会话记忆更新完成 conversation=%s type=%s tokens=%d->%d',
            conversationId,
            wasInitialized ? 'update' : 'init',
            beforeTokens,
            afterTokens,
          );
        }
      } catch (e) {
        log.warn('SessionMemory hook 失败: %s', String(e));
      }
    });

    log.info('已订阅 CHAT_POST_SESSION_MEMORY 事件（会话记忆）');
  },
};
