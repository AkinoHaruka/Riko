/**
 * 上下文压缩工具函数集。
 *
 * 纯工具函数为主，包含消息格式转换、图片剥离、
 * API 轮次分组、截断重试、边界标记创建和最近消息选择。
 * 注意: selectRecentMessages() 会读取数据库中的用户设置（compact_recent_dialogue_tokens），
 * 调用方需确保数据库已初始化。
 *
 * @module domain/compact/helpers
 */
import type { CompactMessage, CompactBoundaryMetadata } from './types.js';
import type { Message } from '../../domain/message/types.js';
import { estimateTextTokens, estimateMessageTokens } from './tokenEstimator.js';
import { getParamNumberWithDefault, PARAM_KEYS } from '../../domain/setting/index.js';

/** 截断头部时插入的合成用户消息，保持消息序列的 role 交替合法性 */
const SYNTHETIC_USER_MARKER: CompactMessage = {
  role: 'user',
  content: '[Previous conversation truncated]',
};

/**
 * 将数据库 Message 对象转换为 CompactMessage 格式。
 */
export function messagesToCompactMessages(messages: Message[]): CompactMessage[] {
  return messages.map((m) => {
    const result: CompactMessage = { role: m.role, content: m.content };
    if (m.reasoning_content) {
      result.reasoning_content = m.reasoning_content;
    }
    if (m.is_compact_summary) {
      result.is_compact_summary = Boolean(m.is_compact_summary);
    }
    if (m.compact_metadata) {
      result.compact_metadata = m.compact_metadata;
    }
    if (m.created_at) {
      result.created_at = m.created_at;
    }
    return result;
  });
}

/**
 * 剥离消息中的 base64 图片数据，替换为 [image] 占位符。
 */
export function stripImagesFromMessages(messages: CompactMessage[]): CompactMessage[] {
  const result: CompactMessage[] = messages.map((m) => ({ ...m }));
  for (const msg of result) {
    if (msg.role !== 'user') continue;
    let content = msg.content;
    if (typeof content !== 'string') continue;
    content = content.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[image]');
    if (content.length > 10000 && /[A-Za-z0-9+/=]{10000,}/.test(content)) {
      content = content.replace(/[A-Za-z0-9+/=]{10000,}/g, '[image]');
    }
    msg.content = content;
  }
  return result;
}

/**
 * 按用户消息将消息列表分组为 API 轮次。
 */
export function groupMessagesByApiRound(messages: CompactMessage[]): CompactMessage[][] {
  if (messages.length === 0) return [];
  const groups: CompactMessage[][] = [];
  let current: CompactMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'user' && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * 为 PromptTooLong 重试截断消息头部。
 */
export function truncateHeadForPtlRetry(
  messages: CompactMessage[],
  tokenGap?: number,
): CompactMessage[] | null {
  const groups = groupMessagesByApiRound(messages);
  if (groups.length < 2) return null;
  let remaining: CompactMessage[][];
  if (tokenGap !== undefined) {
    let dropCount = 0;
    let accumulated = 0;
    for (let i = 0; i < groups.length; i++) {
      if (accumulated >= tokenGap) break;
      accumulated += groups[i].reduce((sum, m) => sum + estimateTextTokens(m.content ?? ''), 0);
      dropCount = i + 1;
    }
    remaining = groups.slice(dropCount);
  } else {
    const dropCount = Math.max(1, Math.floor(groups.length / 5));
    remaining = groups.slice(dropCount);
  }
  if (remaining.length === 0) remaining = [groups[groups.length - 1]];
  const flat: CompactMessage[] = remaining.flat();
  if (flat.length > 0 && flat[0].role === 'assistant') {
    return [{ ...SYNTHETIC_USER_MARKER }, ...flat];
  }
  return flat;
}

/**
 * 创建压缩边界标记消息。
 */
export function createCompactBoundaryMessage(
  trigger: 'auto' | 'manual',
  preCompactTokens: number,
  preCompactMessageCount: number,
  postCompactRecentTokens?: number,
): CompactMessage {
  const metadata: CompactBoundaryMetadata = {
    type: 'compact_boundary',
    trigger,
    preCompactTokenCount: preCompactTokens,
    preCompactMessageCount,
    timestamp: new Date().toISOString(),
    compactStrategy: 'sub_agent',
    post_compact_recent_tokens: postCompactRecentTokens,
  };
  return {
    role: 'system',
    content: '',
    compact_metadata: JSON.stringify(metadata),
  };
}

/**
 * 从未压缩消息中选择保留的最近对话消息。
 */
export function selectRecentMessages(messages: CompactMessage[], userId: string): CompactMessage[] {
  const recentDialogueTokens = getParamNumberWithDefault(
    userId,
    PARAM_KEYS.COMPACT_RECENT_DIALOGUE_TOKENS,
  );
  if (messages.length === 0) return [];
  let accumulated = 0;
  let cutIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    accumulated += estimateMessageTokens(messages[i]);
    if (Math.ceil((accumulated * 4) / 3) >= recentDialogueTokens) {
      cutIndex = i;
      break;
    }
  }
  return messages.slice(cutIndex);
}
