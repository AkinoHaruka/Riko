/**
 * Token 估算工具。
 * 基于字符类型（CJK 与非 CJK）粗略估算文本 Token 数。
 * 这是经验公式，非确切计数，仅供触发判断和预算分配使用，不可替代模型实际的 Token 化结果。
 */
import type { CompactMessage, TokenWarningState } from './types.js';
import { getModelContextWindow } from '../../core/ai/providers/index.js';

/** CJK 字符 Unicode 范围表，用于区分中日韩文字和拉丁文字 */
const _CJK_RANGES: [number, number][] = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0xf900, 0xfaff],
  [0x3000, 0x303f],
  [0xff00, 0xffef],
];

/**
 * 估算文本的 Token 数。
 * DeepSeek 官方标准：1 英文字符 ≈ 0.3 token，1 中文字符 ≈ 0.6 token。
 * @param text - 待估算的文本
 * @returns 估算的 Token 数
 */
export function estimateTextTokens(text: string): number {
  let cjkCount = 0;
  let otherCount = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const isCjk = _CJK_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
    if (isCjk) {
      cjkCount += 1;
    } else {
      otherCount += 1;
    }
  }
  return Math.floor(cjkCount * 0.6 + otherCount * 0.3);
}

/**
 * 估算单条消息的 Token 数，包含 role、content、reasoning_content 及格式开销。
 * @param message - 待估算的消息
 * @returns 估算的 Token 数
 */
export function estimateMessageTokens(message: CompactMessage): number {
  const role = message.role ?? '';
  const content = message.content ?? '';
  const reasoning = message.reasoning_content ?? '';
  const parts = [role, content, reasoning];
  const total = parts.reduce((sum, p) => sum + estimateTextTokens(p), 0);
  // +4 为消息格式开销（role 标签、分隔符等）
  return total + 4;
}

/**
 * 估算消息列表的总 Token 数。
 * 消息间有 role 分隔符、格式开销，合计约 4/3 倍的单条消息 Token 数。
 * @param messages - 消息列表
 * @returns 估算的总 Token 数
 */
export function estimateMessagesTokens(messages: CompactMessage[]): number {
  const total = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  return Math.ceil((total * 4) / 3);
}

/** 上下文窗口的兜底默认值，当 providers 注册表中找不到模型时使用 */
const DEFAULT_CONTEXT_WINDOW = 1_000_000;

// 压缩摘要最大输出 Token 数（AI 单次生成的摘要内容上限）
export const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20000;
// 触发自动压缩后、压缩执行前还需预留的缓冲 Token，防止压缩过程中超出上下文窗口
export const AUTOCOMPACT_BUFFER_TOKENS = 13000;
// 超过此缓冲值后在前端显示黄色警告提示
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20000;
// 红线阈值：逼近此值后阻止发送新消息，防止上下文溢出
export const BLOCKING_LIMIT_BUFFER_TOKENS = 3000;

/**
 * 获取模型的有效上下文窗口大小。
 * 从模型上下文窗口中扣除摘要输出预留，并支持环境变量覆盖（用于调试）。
 * @param model - 模型名称
 * @returns 有效上下文窗口 Token 数
 */
export function getEffectiveContextWindow(model: string): number {
  const window = getModelContextWindow(model, DEFAULT_CONTEXT_WINDOW);
  let effective = window - MAX_OUTPUT_TOKENS_FOR_SUMMARY;
  const envOverride = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  if (envOverride !== undefined) {
    try {
      const overrideVal = parseInt(envOverride, 10);
      if (overrideVal > 0) {
        effective = Math.min(effective, overrideVal);
      }
    } catch {
      // 忽略环境变量解析错误，使用计算值
    }
  }
  return effective;
}

/**
 * 获取自动压缩触发阈值。等于有效上下文窗口减去缓冲 Token。
 * @param model - 模型名称
 * @returns 自动压缩触发阈值
 */
export function getAutoCompactThreshold(model: string): number {
  return getEffectiveContextWindow(model) - AUTOCOMPACT_BUFFER_TOKENS;
}

/**
 * 按压缩边界将消息列表分为已压缩和未压缩两部分。
 * 从后向前查找最后一个 compact_boundary 标记，其之前为已压缩部分，之后为未压缩部分。
 * @param messages - 完整消息列表
 * @returns compactMessages: 已压缩部分（含边界和摘要），uncompactMessages: 未压缩部分
 */
export function splitMessagesByCompactBoundary(messages: CompactMessage[]): {
  compactMessages: CompactMessage[];
  uncompactMessages: CompactMessage[];
} {
  let lastBoundaryIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.compact_metadata) {
      try {
        const metadata = JSON.parse(msg.compact_metadata);
        if (metadata.type === 'compact_boundary') {
          lastBoundaryIndex = i;
          break;
        }
      } catch {
        // 忽略解析失败的 metadata
      }
    }
  }
  if (lastBoundaryIndex === -1) {
    return { compactMessages: [], uncompactMessages: messages };
  }
  // compactMessages 包含 boundary 及其后的 compact summary 消息
  // uncompactMessages 为 boundary + summary 之后的所有消息
  let summaryEndIndex = lastBoundaryIndex;
  for (let i = lastBoundaryIndex + 1; i < messages.length; i++) {
    if (messages[i].is_compact_summary) {
      summaryEndIndex = i;
    } else {
      break;
    }
  }
  return {
    compactMessages: messages.slice(0, summaryEndIndex + 1),
    uncompactMessages: messages.slice(summaryEndIndex + 1),
  };
}

/**
 * 计算 Token 用量警告状态，用于前端展示不同级别的上下文剩余提示。
 * @param tokenUsage - 当前 Token 用量
 * @param model - 模型名称
 * @returns 包含各级别阈值的警告状态
 */
export function calculateTokenWarningState(tokenUsage: number, model: string): TokenWarningState {
  const threshold = getAutoCompactThreshold(model);
  const effectiveWindow = getEffectiveContextWindow(model);
  const percentLeft = Math.max(0, ((threshold - tokenUsage) / threshold) * 100);
  const isAboveWarning = tokenUsage >= threshold - WARNING_THRESHOLD_BUFFER_TOKENS;
  const isAboveAutoCompact = tokenUsage >= threshold;
  const isAtBlocking = tokenUsage >= effectiveWindow - BLOCKING_LIMIT_BUFFER_TOKENS;
  return {
    percent_left: percentLeft,
    is_above_warning_threshold: isAboveWarning,
    is_above_auto_compact_threshold: isAboveAutoCompact,
    is_at_blocking_limit: isAtBlocking,
  };
}
