/**
 * 压缩触发策略。基于用户可配置的触发阈值和分界点检测，决定是否执行压缩。
 */
import type { CompactMessage } from './types.js';
import { estimateMessagesTokens, splitMessagesByCompactBoundary } from './tokenEstimator.js';
import {
  getParamNumberWithDefault,
  PARAM_KEYS,
  isFeatureEnabled,
} from '../../domain/setting/index.js';

export function shouldTriggerCompact(uncompactTokenCount: number, userId: string): boolean {
  const threshold = getParamNumberWithDefault(userId, PARAM_KEYS.COMPACT_TRIGGER_TOKENS);
  return uncompactTokenCount >= threshold;
}

export function calculateUncompactTokens(messages: CompactMessage[]): number {
  const { uncompactMessages } = splitMessagesByCompactBoundary(messages);
  return estimateMessagesTokens(uncompactMessages);
}

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

export function isAutoCompactFeatureEnabled(userId: string): boolean {
  return isFeatureEnabled(userId, 'feature_auto_compact');
}
