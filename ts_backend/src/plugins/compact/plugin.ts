/**
 * 上下文压缩插件。
 *
 * 订阅 CHAT_POST_COMPACT 事件，在流式响应结束后优先执行上下文压缩（串行先于 sessionMemory）。
 *
 * @module plugins/compact/plugin
 */
import type { Plugin, PluginContext } from '../../core/runtime/types.js';
import { PluginEvents } from '../../core/events/types.js';
import { autoCompactIfNeeded } from '../../domain/compact/service.js';
import { SSE_EVENT_COMPACT } from '../../domain/chat/types.js';

interface PostSamplingPayload {
  conversationId: string;
  userId: string;
  model: string;
  toolCallCountThisTurn: number;
  onSseEvent: (eventData: string) => void;
}

export const compactPlugin: Plugin = {
  id: 'compact',
  version: '1.0.0',
  name: '上下文压缩插件',
  dependencies: [],

  async install(ctx: PluginContext) {
    const log = ctx.getLogger();

    ctx.on<PostSamplingPayload>(PluginEvents.CHAT_POST_COMPACT, async (payload) => {
      try {
        const { conversationId, userId, model, onSseEvent } = payload;
        const result = await autoCompactIfNeeded(conversationId, model, userId);
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
          log.info(
            '自动压缩完成 conversation=%s strategy=%s pre=%d post=%d',
            conversationId,
            result.strategy,
            cr?.preCompactTokenCount ?? 0,
            cr?.truePostCompactTokenCount ?? 0,
          );
        }
      } catch (e) {
        log.warn('Compact hook 失败: %s', String(e));
      }
    });

    log.info('已订阅 CHAT_POST_COMPACT 事件（自动压缩）');
  },
};
