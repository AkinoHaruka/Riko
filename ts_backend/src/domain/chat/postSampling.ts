/**
 * 后采样钩子系统。
 * 流式响应结束后通过 EventBus 分阶段发布事件：
 *   1. CHAT_POST_SAMPLING  → autoDream（fire-and-forget，不阻塞）
 *   2. CHAT_POST_COMPACT   → compact（串行，先执行，可能改写 messages 表）
 *   3. CHAT_POST_SESSION_MEMORY → sessionMemory（串行，等 compact 完成后执行）
 *
 * 分阶段串行避免 compact 与 sessionMemory 并发写 messages 表导致冲突。
 */
import { createLogger } from '../../core/logger/index.js';
import { eventManager } from '../../core/events/manager.js';
import { PluginEvents } from '../../core/events/types.js';

const logger = createLogger('PostSampling');

/** 后采样钩子上下文，包含当前会话和用户信息 */
export interface PostSamplingContext {
  conversationId: string;
  userId: string;
  model: string;
  toolCallCountThisTurn: number;
}

/**
 * 后采样钩子入口。stream.ts 在流式响应完成后调用。
 * 分阶段串行触发各插件，避免并发写库冲突。
 * @param context - 后采样上下文
 * @param onSseEvent - SSE 事件回调，传递给事件订阅方
 */
export async function runPostSamplingHooks(
  context: PostSamplingContext,
  onSseEvent: (eventData: string) => void,
): Promise<void> {
  const { conversationId, userId, model, toolCallCountThisTurn } = context;
  const payload = { conversationId, userId, model, toolCallCountThisTurn, onSseEvent };

  // 阶段 1：触发 autoDream（fire-and-forget，不阻塞主流程）
  eventManager.emit(PluginEvents.CHAT_POST_SAMPLING, payload);

  // 阶段 2：触发 compact（等待完成，可能改写 messages 表释放上下文）
  await eventManager.emitAsync(PluginEvents.CHAT_POST_COMPACT, payload);

  // 阶段 3：compact 完成后，触发 sessionMemory（读取最新的 messages 数据）
  await eventManager.emitAsync(PluginEvents.CHAT_POST_SESSION_MEMORY, payload);

  logger.info('PostSampling 钩子全部完成 conversation=%s', conversationId);
}
