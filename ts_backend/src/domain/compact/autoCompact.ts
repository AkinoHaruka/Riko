/**
 * 自动压缩决策引擎。
 * 综合环境变量、功能开关、连续失败次数和 Token 阈值决定是否触发压缩。
 * 环境变量 DISABLE_COMPACT / DISABLE_AUTO_COMPACT 用于调试或临时关闭，不通过用户配置。
 * 连续失败超过 MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES 次后暂停自动压缩，避免反复尝试浪费资源。
 */
import type { CompactMessage } from './types.js';
import {
  shouldTriggerCompact,
  calculateUncompactTokens,
  isAutoCompactFeatureEnabled,
} from './trigger.js';

/** 连续压缩失败的最大次数，超过后暂停该会话的自动压缩 */
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

/** 各会话的连续压缩失败计数 */
const consecutiveFailures: Map<string, number> = new Map();

/**
 * 检查环境变量是否设置为禁用状态。
 * 支持 1/true/yes/on 四种值。
 * @param key - 环境变量名
 */
function isEnvDisabled(key: string): boolean {
  const val = (process.env[key] ?? '').trim().toLowerCase();
  return val === '1' || val === 'true' || val === 'yes' || val === 'on';
}

/**
 * 综合判断是否应执行自动压缩。
 * 检查顺序：环境变量禁用 → 用户功能开关 → 连续失败次数 → Token 阈值。
 * @param messages - 消息列表
 * @param _model - 模型名称（当前未使用）
 * @param conversationId - 会话 ID，用于跟踪连续失败次数
 * @param userId - 用户 ID，用于检查功能开关和触发阈值
 * @returns 是否应执行自动压缩
 */
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

/**
 * 重置指定会话的连续压缩失败计数（压缩成功后调用）。
 * @param conversationId - 会话 ID
 */
export function resetCompactFailures(conversationId: string): void {
  consecutiveFailures.set(conversationId, 0);
}

/**
 * 递增指定会话的连续压缩失败计数。
 * Map 超过 100 条时自动清理最早的条目，防止内存泄漏。
 * @param conversationId - 会话 ID
 */
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
