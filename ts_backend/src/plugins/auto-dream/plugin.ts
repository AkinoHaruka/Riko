/**
 * 自动梦境插件。
 *
 * 订阅 CHAT_POST_SAMPLING 事件，在流式响应结束后检查是否满足梦境整固条件。
 * 满足条件时异步触发（fire-and-forget），不阻塞响应返回。
 *
 * @module plugins/auto-dream/plugin
 */
import type { Plugin, PluginContext, PluginLogger } from '../../core/runtime/types.js';
import { PluginEvents } from '../../core/events/types.js';
import { getAutoDreamConfig } from '../../config/index.js';
import { readLastConsolidatedAt, listSessionsTouchedSince } from '../../domain/autoDream/lock.js';
import { getDreamTriggerParams } from '../../domain/autoDream/trigger.js';
import { isFeatureEnabled } from '../../domain/setting/service.js';
import { manualDream } from '../../domain/autoDream/service.js';

interface PostSamplingPayload {
  conversationId: string;
  userId: string;
  model: string;
  toolCallCountThisTurn: number;
  onSseEvent: (eventData: string) => void;
}

export const autoDreamPlugin: Plugin = {
  id: 'auto-dream',
  version: '1.0.0',
  name: '自动梦境插件',
  dependencies: [],

  async install(ctx: PluginContext) {
    const log = ctx.getLogger();

    ctx.on<PostSamplingPayload>(PluginEvents.CHAT_POST_SAMPLING, (payload) => {
      // fire-and-forget，不阻塞响应返回
      runDreamCheck(payload.conversationId, payload.userId, log).catch((e) => {
        log.warn('Dream hook 失败: %s', String(e));
      });
    });

    log.info('已订阅 CHAT_POST_SAMPLING 事件（自动梦境）');
  },
};

async function runDreamCheck(
  currentSessionId: string,
  userId: string,
  log: PluginLogger,
): Promise<void> {
  const config = getAutoDreamConfig();
  if (!config.enabled) return;

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

  log.info('梦境触发条件满足，启动整固 currentSession=%s', currentSessionId);
  manualDream().catch((e) => log.warn('Dream 执行失败: %s', String(e)));
}
