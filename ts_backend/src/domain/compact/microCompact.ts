/**
 * 微型压缩：清理旧的工具调用结果消息，减少 Token 占用而不影响对话内容。
 */
import type { CompactMessage } from './types.js';

export const TIME_BASED_MC_CONFIG: Record<string, unknown> = {
  enabled: false, // 默认关闭——当前主要使用 sub_agent 策略，micro_compact 作为备选
  gap_threshold_minutes: 60,
  keep_recent: 5,
};

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

function parseISODate(tsStr: string): Date | null {
  try {
    const d = new Date(tsStr);
    if (isNaN(d.getTime())) {
      return null;
    }
    if (d.getTimezoneOffset() === 0 && !tsStr.includes('+') && !tsStr.endsWith('Z')) {
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    }
    return d;
  } catch {
    return null;
  }
}

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
