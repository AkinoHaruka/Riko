/**
 * 压缩触发策略。
 * 基于用户可配置的触发阈值和分界点检测，决定是否执行压缩。
 * 所有阈值均从用户设置中读取，支持不同用户有不同的压缩策略。
 */
import type { CompactMessage } from './types.js';
import { estimateMessagesTokens, splitMessagesByCompactBoundary } from './tokenEstimator.js';
import {
  getParamNumberWithDefault,
  PARAM_KEYS,
  isFeatureEnabled,
} from '../../domain/setting/index.js';

/**
 * 判断未压缩消息的 Token 数是否达到触发阈值。
 * @param uncompactTokenCount - 未压缩部分的 Token 估算数
 * @param userId - 用户 ID，用于读取该用户的触发阈值
 * @returns 是否应触发压缩
 */
export function shouldTriggerCompact(uncompactTokenCount: number, userId: string): boolean {
  const threshold = getParamNumberWithDefault(userId, PARAM_KEYS.COMPACT_TRIGGER_TOKENS);
  return uncompactTokenCount >= threshold;
}

/**
 * 计算消息列表中未压缩部分的 Token 数。
 * @param messages - 完整消息列表
 * @returns 未压缩部分的 Token 估算数
 */
export function calculateUncompactTokens(messages: CompactMessage[]): number {
  const { uncompactMessages } = splitMessagesByCompactBoundary(messages);
  return estimateMessagesTokens(uncompactMessages);
}

/**
 * 从后向前查找最后一个压缩边界消息的索引。
 * @param messages - 消息列表
 * @returns 最后一个压缩边界的索引，未找到返回 -1
 */
export function findLastCompactBoundaryIndex(messages: CompactMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.compact_metadata) {
      try {
        const metadata = JSON.parse(msg.compact_metadata);
        if (metadata.type === 'compact_boundary') {
          return i;
        }
      } catch {
        // 忽略解析失败的 metadata
      }
    }
  }
  return -1;
}

/**
 * 检查用户是否启用了自动压缩功能。
 * @param userId - 用户 ID
 * @returns 是否启用
 */
export function isAutoCompactFeatureEnabled(userId: string): boolean {
  return isFeatureEnabled(userId, 'feature_auto_compact');
}
