/**
 * 自动压缩决策引擎。综合环境变量、功能开关、连续失败次数和 Token 阈值决定是否触发压缩。
 * 环境变量 DISABLE_COMPACT / DISABLE_AUTO_COMPACT 用于调试或临时关闭，不通过用户配置。
 * 连续失败超过 MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES 次后暂停自动压缩，避免反复尝试浪费资源。
 */
import type { CompactMessage } from './types.js';
import {
  shouldTriggerCompact,
  calculateUncompactTokens,
  isAutoCompactFeatureEnabled,
} from './trigger.js';

export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

const consecutiveFailures: Map<string, number> = new Map();

function isEnvDisabled(key: string): boolean {
  const val = (process.env[key] ?? '').trim().toLowerCase();
  return val === '1' || val === 'true' || val === 'yes' || val === 'on';
}

export function shouldAutoCompact(
  messages: CompactMessage[],
  _model: string,
  conversationId: string,
  userId?: string,
): boolean {
  if (isEnvDisabled('DISABLE_COMPACT')) {
    return false;
  }
  if (isEnvDisabled('DISABLE_AUTO_COMPACT')) {
    return false;
  }
  if (userId !== undefined) {
    if (!isAutoCompactFeatureEnabled(userId)) {
      return false;
    }
  }
  if ((consecutiveFailures.get(conversationId) ?? 0) >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    return false;
  }
  const uncompactTokenCount = calculateUncompactTokens(messages);
  if (userId === undefined) {
    return false;
  }
  return shouldTriggerCompact(uncompactTokenCount, userId);
}

export function resetCompactFailures(conversationId: string): void {
  consecutiveFailures.set(conversationId, 0);
}

export function incrementCompactFailures(conversationId: string): void {
  const current = consecutiveFailures.get(conversationId) ?? 0;
  consecutiveFailures.set(conversationId, current + 1);
  if (consecutiveFailures.size > 100) {
    const firstInserted = consecutiveFailures.keys().next().value;
    if (firstInserted !== undefined) {
      consecutiveFailures.delete(firstInserted);
    }
  }
}
