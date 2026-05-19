/**
 * 会话记忆触发策略。
 * - 初始化触发：基于当前对话的总消息数是否达到用户配置的阈值。
 * - 更新触发：同时满足两个条件——Token 增量达到阈值，且（本轮无工具调用 或 工具调用间隔次数达到阈值）。
 *   "本轮无工具调用"条件是为了在有工具调用时积累足够上下文再更新，避免每轮都触发。
 */
import { createLogger } from '../../core/logger/index.js';
import { getParamNumberWithDefault, PARAM_KEYS } from '../setting/index.js';

const logger = createLogger('SessionMemoryTrigger');

export function shouldTriggerSessionMemoryInit(messageCount: number, userId: string): boolean {
  const minMessages = getParamNumberWithDefault(userId, PARAM_KEYS.SESSION_MEMORY_MIN_MESSAGES);
  const result = messageCount >= minMessages;
  logger.info(
    '会话记忆初始化检查 messageCount=%d minMessages=%d result=%s',
    messageCount,
    minMessages,
    result,
  );
  return result;
}

export function shouldTriggerSessionMemoryUpdate(
  tokenGrowthSinceLastUpdate: number,
  toolCallCountSinceLastUpdate: number,
  lastTurnHadToolCalls: boolean,
  userId: string,
): boolean {
  const minTokens = getParamNumberWithDefault(
    userId,
    PARAM_KEYS.SESSION_MEMORY_MIN_TOKENS_BETWEEN_UPDATE,
  );
  const minToolCalls = getParamNumberWithDefault(
    userId,
    PARAM_KEYS.SESSION_MEMORY_TOOL_CALLS_BETWEEN_UPDATES,
  );

  const tokenThresholdMet = tokenGrowthSinceLastUpdate >= minTokens;
  const toolCallThresholdMet =
    !lastTurnHadToolCalls || toolCallCountSinceLastUpdate >= minToolCalls;

  return tokenThresholdMet && toolCallThresholdMet;
}
