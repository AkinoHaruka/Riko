/**
 * 压缩标识符保留校验。
 *
 * 提取对话中出现的关键不透明标识符（UUID、文件路径、URL、IP、端口、会话 ID、Git hash），
 * 校验压缩摘要是否保留了这些标识符，防止压缩后 AI 失去对历史资源的引用能力。
 *
 * @module domain/compact/identifierValidator
 */

/** 标识符类型 */
export type IdentifierType =
  | 'uuid'
  | 'filepath'
  | 'url'
  | 'ip_port'
  | 'session_id'
  | 'git_hash';

/** 单个标识符 */
export interface Identifier {
  type: IdentifierType;
  value: string;
}

/** 保留校验报告 */
export interface PreservationReport {
  /** 原始文本中的标识符 */
  original: Identifier[];
  /** 摘要中保留的标识符 */
  preserved: Identifier[];
  /** 摘要中丢失的标识符 */
  lost: Identifier[];
  /** 保留率（0~1） */
  preservationRate: number;
}

/** 标识符正则模式（按优先级排序，避免短模式误匹配长模式） */
const IDENTIFIER_PATTERNS: Array<{ type: IdentifierType; regex: RegExp }> = [
  // UUID：550e8400-e29b-41d4-a716-446655440000
  { type: 'uuid', regex: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi },
  // URL：https://example.com/path（优先于 filepath，避免 URL 被误识别为路径）
  { type: 'url', regex: /https?:\/\/[^\s<>"')\]]+/gi },
  // 文件绝对路径：/home/user/file.ts 或 C:\Users\file.ts
  { type: 'filepath', regex: /(?:\/[\w.-]+){2,}|[A-Za-z]:\\[\w\\.-]+/g },
  // IP:端口：192.168.1.1:8080
  { type: 'ip_port', regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+\b/g },
  // 会话/任务 ID：sess_abc123、task_xyz789、conv_xxx、msg_xxx
  { type: 'session_id', regex: /\b(?:sess|task|conv|msg)_[a-zA-Z0-9]{6,}\b/g },
  // Git commit hash：7-40 位十六进制（需在单词边界内，避免误匹配 UUID 片段）
  { type: 'git_hash', regex: /\b[0-9a-f]{7,40}\b/g },
];

/**
 * 从文本中提取所有标识符。
 * 同一标识符多次出现只保留一次（去重）。
 *
 * @param text - 输入文本
 * @returns 去重后的标识符列表
 */
export function extractIdentifiers(text: string): Identifier[] {
  if (!text) return [];

  const seen = new Set<string>();
  const identifiers: Identifier[] = [];

  for (const { type, regex } of IDENTIFIER_PATTERNS) {
    // 重置正则的 lastIndex（全局标志需手动重置）
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const value = match[0];
      // 去重键：类型 + 值（同值不同类型视为不同标识符）
      const key = `${type}:${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        identifiers.push({ type, value });
      }
    }
  }

  return identifiers;
}

/**
 * 校验压缩摘要是否保留了原始文本中的标识符。
 *
 * @param originalText - 原始对话文本
 * @param summaryText - 压缩摘要文本
 * @returns 保留校验报告
 */
export function validatePreservation(
  originalText: string,
  summaryText: string,
): PreservationReport {
  const original = extractIdentifiers(originalText);
  const summary = extractIdentifiers(summaryText);

  // 构建摘要标识符的值集合（跨类型，因为摘要可能以不同类型引用同一标识符）
  const summaryValues = new Set(summary.map((s) => s.value));

  const preserved: Identifier[] = [];
  const lost: Identifier[] = [];

  for (const id of original) {
    if (summaryValues.has(id.value)) {
      preserved.push(id);
    } else {
      lost.push(id);
    }
  }

  const preservationRate = original.length > 0 ? preserved.length / original.length : 1;

  return {
    original,
    preserved,
    lost,
    preservationRate,
  };
}

/** 丢失标识符超过此比例时触发压缩重试 */
const LOST_IDENTIFIER_RETRY_THRESHOLD = 0.2;

/**
 * 判断是否应因标识符丢失过多而触发压缩重试。
 *
 * @param report - 保留校验报告
 * @returns true 表示丢失率超过阈值，应重试压缩
 */
export function shouldRetryForLostIdentifiers(report: PreservationReport): boolean {
  if (report.original.length === 0) return false;
  const lostRate = 1 - report.preservationRate;
  return lostRate > LOST_IDENTIFIER_RETRY_THRESHOLD;
}
