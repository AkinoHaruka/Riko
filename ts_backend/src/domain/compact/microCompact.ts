/**
 * 微型压缩：清理旧的工具调用结果消息，减少 Token 占用而不影响对话内容。
 * 与完整压缩不同，微型压缩不生成摘要，仅将旧的工具结果替换为占位文本。
 * 当前默认关闭，主要使用 sub_agent 策略，micro_compact 作为备选。
 */
import type { CompactMessage } from './types.js';

/** 基于时间的微型压缩配置 */
export const TIME_BASED_MC_CONFIG: Record<string, unknown> = {
  enabled: false,
  gap_threshold_minutes: 60,
  keep_recent: 5,
};

/** 工具结果消息的关键词列表，用于识别短小的工具执行结果 */
const _TOOL_RESULT_KEYWORDS = [
  '成功',
  '完成',
  '已更新',
  '已创建',
  '已删除',
  'result',
  'success',
  'done',
  'error',
];

/**
 * 判断消息是否为工具调用结果的简短回复。
 * 仅匹配 assistant 角色、内容长度 < 100 且包含工具结果关键词的消息。
 * @param message - 待判断的消息
 * @returns 是否为工具结果消息
 */
export function isToolResultMessage(message: CompactMessage): boolean {
  if (message.role !== 'assistant') {
    return false;
  }
  const content = message.content ?? '';
  if (typeof content !== 'string' || content.length >= 100) {
    return false;
  }
  const lower = content.toLowerCase();
  return _TOOL_RESULT_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * 清理旧的工具结果消息，将其内容替换为占位文本。
 * @param messages - 消息列表
 * @param keepRecent - 保留最近 N 条工具结果消息不清理
 * @returns [清理后的消息列表, 是否有变更]
 */
export function clearOldToolResults(
  messages: CompactMessage[],
  keepRecent: number = 5,
): [CompactMessage[], boolean] {
  const result: CompactMessage[] = messages.map((m) => ({ ...m }));
  const toolIndices: number[] = [];
  for (let i = 0; i < result.length; i++) {
    if (isToolResultMessage(result[i])) {
      toolIndices.push(i);
    }
  }
  if (toolIndices.length <= keepRecent) {
    return [result, false];
  }
  const indicesToClear = toolIndices.slice(0, toolIndices.length - keepRecent);
  for (const idx of indicesToClear) {
    result[idx] = {
      ...result[idx],
      content: '[Old tool result content cleared]',
      reasoning_content: '',
    };
  }
  return [result, true];
}

/**
 * 解析 ISO 日期字符串，处理无时区信息的情况。
 * 仅当字符串不含时区信息时，才视为本地时间并修正为 UTC。
 * @param tsStr - ISO 日期字符串
 * @returns 解析后的 Date 对象，解析失败返回 null
 */
function parseISODate(tsStr: string): Date | null {
  try {
    const d = new Date(tsStr);
    if (isNaN(d.getTime())) {
      return null;
    }
    // 判断字符串是否包含时区信息：以 'Z' 结尾或包含 '+'/'-' 时区偏移
    const hasTimezoneInfo = tsStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(tsStr);
    if (!hasTimezoneInfo) {
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    }
    return d;
  } catch {
    return null;
  }
}

/**
 * 基于时间间隔的微型压缩。
 * 若最近一条 assistant 消息距当前时间超过阈值，则清理旧的工具结果。
 * @param messages - 消息列表
 * @param config - 微型压缩配置，默认使用 TIME_BASED_MC_CONFIG
 * @returns 压缩后的消息列表，无需压缩时返回 null
 */
export function maybeTimeBasedMicroCompact(
  messages: CompactMessage[],
  config?: Record<string, unknown>,
): CompactMessage[] | null {
  const cfg = config ?? TIME_BASED_MC_CONFIG;
  if (!cfg.enabled) {
    return null;
  }
  let lastTs: string | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      if (msg.created_at != null) {
        lastTs = msg.created_at;
        break;
      }
    }
  }
  if (lastTs == null) {
    return null;
  }
  let lastDt: Date;
  if (typeof lastTs === 'string') {
    const parsed = parseISODate(lastTs);
    if (parsed == null) {
      return null;
    }
    lastDt = parsed;
  } else {
    return null;
  }
  const now = new Date();
  const gapMinutes = (now.getTime() - lastDt.getTime()) / 1000 / 60;
  const threshold = (cfg.gap_threshold_minutes as number) ?? 60;
  if (gapMinutes < threshold) {
    return null;
  }
  const keepRecent = (cfg.keep_recent as number) ?? 5;
  const [compacted, hasChanged] = clearOldToolResults(messages, keepRecent);
  if (!hasChanged) {
    return null;
  }
  return compacted;
}
