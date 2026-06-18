/**
 * AI API 错误分类与映射。
 *
 * 提供两层 API：
 * 1. `mapApiError(error)` — 向后兼容的轻量映射，返回 HTTP 状态码 + 中文消息
 * 2. `classifyError(error)` — 结构化错误分类，返回含重试/降级/凭证轮换决策的 ClassifiedError
 *
 * classifyError 是 Failover 决策的权威来源，mapApiError 内部委托 classifyError
 * 并降级为 MappedApiError 结构，确保现有调用点无需修改。
 *
 * @module core/ai/errors
 */

// ─── 向后兼容：轻量映射结构 ─────────────────────────────────────

/** 映射后的 API 错误结构，包含 HTTP 状态码与用户可读的中文消息 */
export interface MappedApiError {
  statusCode: number;
  message: string;
}

// ─── 结构化错误分类 ─────────────────────────────────────────────

/**
 * Failover 原因枚举（15 类）。
 * 用于驱动重试、压缩、凭证轮换、模型降级等决策。
 */
export enum FailoverReason {
  None = 'none',
  RateLimit = 'rate_limit',
  QuotaExceeded = 'quota_exceeded',
  AuthInvalid = 'auth_invalid',
  AuthExpired = 'auth_expired',
  AuthForbidden = 'auth_forbidden',
  ModelNotFound = 'model_not_found',
  ModelOverloaded = 'model_overloaded',
  ContextTooLong = 'context_too_long',
  ContentFilter = 'content_filter',
  Timeout = 'timeout',
  Network = 'network',
  Dns = 'dns',
  Ssl = 'ssl',
  ServerError = 'server_error',
  Unknown = 'unknown',
}

/**
 * 结构化分类错误。
 * 含 5 个决策字段，供 FailoverExecutor 驱动两阶段 failover。
 */
export interface ClassifiedError {
  /** 错误原因分类 */
  reason: FailoverReason;
  /** HTTP 状态码（无 HTTP 响应时为 0） */
  statusCode: number;
  /** 是否可重试（rate_limit/timeout/network/dns/server_error/model_overloaded） */
  retryable: boolean;
  /** 是否应压缩上下文（context_too_long） */
  shouldCompress: boolean;
  /** 是否应轮换凭证（auth_invalid/auth_expired） */
  shouldRotateCredential: boolean;
  /** 是否应降级模型（model_overloaded/model_not_found） */
  shouldFallback: boolean;
  /** Retry-After 头解析值（毫秒），仅 rate_limit 时可能存在 */
  retryAfterMs?: number;
  /** 用户可读消息（不含内部细节） */
  userMessage: string;
  /** 内部日志消息（含调试细节，用于日志记录） */
  internalMessage: string;
}

// ─── 决策字段映射表 ─────────────────────────────────────────────

/**
 * 各 FailoverReason 对应的决策字段。
 * 集中定义避免散落 switch case，便于审计与测试覆盖。
 */
const DECISION_TABLE: Record<
  FailoverReason,
  { retryable: boolean; shouldCompress: boolean; shouldRotateCredential: boolean; shouldFallback: boolean }
> = {
  [FailoverReason.None]: {
    retryable: false,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: false,
  },
  [FailoverReason.RateLimit]: {
    retryable: true,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: false,
  },
  [FailoverReason.QuotaExceeded]: {
    retryable: false,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: false,
  },
  [FailoverReason.AuthInvalid]: {
    retryable: false,
    shouldCompress: false,
    shouldRotateCredential: true,
    shouldFallback: false,
  },
  [FailoverReason.AuthExpired]: {
    retryable: false,
    shouldCompress: false,
    shouldRotateCredential: true,
    shouldFallback: false,
  },
  [FailoverReason.AuthForbidden]: {
    retryable: false,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: false,
  },
  [FailoverReason.ModelNotFound]: {
    retryable: false,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: true,
  },
  [FailoverReason.ModelOverloaded]: {
    retryable: true,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: true,
  },
  [FailoverReason.ContextTooLong]: {
    retryable: false,
    shouldCompress: true,
    shouldRotateCredential: false,
    shouldFallback: false,
  },
  [FailoverReason.ContentFilter]: {
    retryable: false,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: false,
  },
  [FailoverReason.Timeout]: {
    retryable: true,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: false,
  },
  [FailoverReason.Network]: {
    retryable: true,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: false,
  },
  [FailoverReason.Dns]: {
    retryable: true,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: false,
  },
  [FailoverReason.Ssl]: {
    retryable: false,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: false,
  },
  [FailoverReason.ServerError]: {
    retryable: true,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: false,
  },
  [FailoverReason.Unknown]: {
    retryable: false,
    shouldCompress: false,
    shouldRotateCredential: false,
    shouldFallback: false,
  },
};

// ─── 用户可读消息映射 ───────────────────────────────────────────

/** 各 FailoverReason 对应的用户可读中文消息 */
const USER_MESSAGE_TABLE: Record<FailoverReason, string> = {
  [FailoverReason.None]: '请求成功',
  [FailoverReason.RateLimit]: 'API 请求速率已达上限，请稍后重试',
  [FailoverReason.QuotaExceeded]: 'API 余额不足或配额已用尽，请充值后重试',
  [FailoverReason.AuthInvalid]: 'API Key 无效或已过期',
  [FailoverReason.AuthExpired]: 'API Key 已过期，请重新配置',
  [FailoverReason.AuthForbidden]: '无权访问该 AI 资源',
  [FailoverReason.ModelNotFound]: '指定的模型不存在或不可用',
  [FailoverReason.ModelOverloaded]: 'AI 服务暂时过载，正在尝试降级处理',
  [FailoverReason.ContextTooLong]: '对话上下文过长，正在自动压缩',
  [FailoverReason.ContentFilter]: '请求内容被安全策略拦截',
  [FailoverReason.Timeout]: 'AI 请求超时，请稍后重试',
  [FailoverReason.Network]: '网络连接异常，请检查网络后重试',
  [FailoverReason.Dns]: '域名解析失败，请检查网络配置',
  [FailoverReason.Ssl]: 'SSL 证书验证失败，请检查系统时间或证书配置',
  [FailoverReason.ServerError]: 'AI 服务内部错误，请稍后重试',
  [FailoverReason.Unknown]: 'AI API 调用失败，请稍后重试',
};

// ─── 关键词匹配规则（按优先级） ─────────────────────────────────

/**
 * 错误消息关键词匹配规则。
 * 当 HTTP 状态码不明确时（如 400 可能是 context_too_long 或 content_filter），
 * 按关键词进一步细分。
 */
interface KeywordRule {
  reason: FailoverReason;
  patterns: RegExp[];
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    reason: FailoverReason.ContextTooLong,
    patterns: [/context length/i, /maximum context/i, /too long/i, /token limit/i],
  },
  {
    reason: FailoverReason.QuotaExceeded,
    patterns: [/quota/i, /billing/i, /insufficient_quota/i, /余额不足/],
  },
  {
    reason: FailoverReason.ModelNotFound,
    patterns: [/model not found/i, /does not exist/i, /model_unavailable/i],
  },
  {
    reason: FailoverReason.ContentFilter,
    patterns: [/content filter/i, /content_policy/i, /safety/i],
  },
  {
    reason: FailoverReason.Dns,
    patterns: [/ENOTFOUND/i, /getaddrinfo/i, /EAI_AGAIN/i],
  },
  {
    reason: FailoverReason.Network,
    patterns: [/ECONNRESET/i, /ETIMEDOUT/i, /socket hang up/i, /ECONNREFUSED/i, /fetch failed/i],
  },
  {
    reason: FailoverReason.Ssl,
    patterns: [/CERT_HAS_EXPIRED/i, /UNABLE_TO_VERIFY_LEAF_SIGNATURE/i, /EPROTO/i, /certificate/i],
  },
];

// ─── 辅助函数 ───────────────────────────────────────────────────

/**
 * 从错误对象中安全提取 HTTP 状态码。
 * 支持 OpenAI SDK 错误（含 status 字段）和标准 Error（无 status）。
 */
function extractStatusCode(error: unknown): number {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: number }).status;
    if (typeof status === 'number' && status > 0) {
      return status;
    }
  }
  return 0;
}

/**
 * 从错误对象中安全提取错误消息字符串。
 */
function extractMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') {
      return msg;
    }
  }
  if (typeof error === 'string') {
    return error;
  }
  return '';
}

/**
 * 从错误对象中提取 Retry-After 头的值（毫秒）。
 * 支持 OpenAI SDK 的 headers 字段和原始 Response 的 headers。
 * @returns 毫秒数，未找到返回 undefined
 */
function extractRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;

  // OpenAI SDK 错误对象可能含 headers 字段
  const headers = (error as { headers?: Record<string, string | undefined> }).headers;
  if (!headers) return undefined;

  const retryAfter = headers['retry-after'] ?? headers['Retry-After'];
  if (!retryAfter) return undefined;

  // 尝试解析为秒数
  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // 尝试解析为 HTTP-date
  const date = Date.parse(retryAfter);
  if (!Number.isNaN(date)) {
    const delta = date - Date.now();
    return delta > 0 ? delta : undefined;
  }

  return undefined;
}

/**
 * 按 HTTP 状态码进行初步分类。
 * 状态码明确时直接返回原因，不明确时返回 Unknown 交由关键词匹配进一步细分。
 */
function classifyByStatusCode(statusCode: number): FailoverReason {
  switch (statusCode) {
    case 401:
      return FailoverReason.AuthInvalid;
    case 403:
      return FailoverReason.AuthForbidden;
    case 408:
      return FailoverReason.Timeout;
    case 429:
      return FailoverReason.RateLimit;
    case 503:
      return FailoverReason.ModelOverloaded;
    case 500:
    case 502:
    case 504:
      return FailoverReason.ServerError;
    default:
      return FailoverReason.Unknown;
  }
}

/**
 * 按错误消息关键词进一步细分原因。
 * 仅在状态码分类为 Unknown 或需要进一步区分时调用。
 */
function classifyByMessage(message: string, fallback: FailoverReason): FailoverReason {
  if (!message) return fallback;
  for (const rule of KEYWORD_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(message)) {
        return rule.reason;
      }
    }
  }
  return fallback;
}

// ─── 公共 API ───────────────────────────────────────────────────

/**
 * 将未知错误分类为结构化的 ClassifiedError。
 *
 * 分类优先级：
 * 1. HTTP 状态码优先（401/403/408/429/503/5xx）
 * 2. 错误消息关键词（context_too_long/quota_exceeded/model_not_found 等）
 * 3. 默认 Unknown
 *
 * @param error - 任意类型的错误对象
 * @returns 含决策字段的 ClassifiedError
 */
export function classifyError(error: unknown): ClassifiedError {
  const statusCode = extractStatusCode(error);
  const message = extractMessage(error);

  // 阶段 1：按状态码初步分类
  let reason = classifyByStatusCode(statusCode);

  // 阶段 2：状态码不明确时按关键词细分
  // 400 可能是 context_too_long/content_filter/quota_exceeded，需进一步判断
  if (reason === FailoverReason.Unknown || statusCode === 400 || statusCode === 402) {
    reason = classifyByMessage(message, reason);
    // 402 优先映射到 quota_exceeded
    if (statusCode === 402 && reason === FailoverReason.Unknown) {
      reason = FailoverReason.QuotaExceeded;
    }
  }

  const decisions = DECISION_TABLE[reason];
  const retryAfterMs = reason === FailoverReason.RateLimit ? extractRetryAfterMs(error) : undefined;

  return {
    reason,
    statusCode: statusCode || (reason === FailoverReason.Unknown ? 500 : statusCode),
    retryable: decisions.retryable,
    shouldCompress: decisions.shouldCompress,
    shouldRotateCredential: decisions.shouldRotateCredential,
    shouldFallback: decisions.shouldFallback,
    retryAfterMs,
    userMessage: USER_MESSAGE_TABLE[reason],
    internalMessage: `[${reason}] ${statusCode || 'N/A'}: ${message || '无错误消息'}`,
  };
}

/**
 * 将未知错误映射为结构化的 API 错误（向后兼容）。
 *
 * 内部委托 classifyError 并降级为 MappedApiError 结构，
 * 确保现有调用点（stream.ts/service.ts）无需修改。
 *
 * @param error - 任意类型的错误对象
 * @returns 包含状态码和中文提示的 MappedApiError
 */
export function mapApiError(error: unknown): MappedApiError {
  const classified = classifyError(error);
  return {
    statusCode: classified.statusCode,
    message: classified.userMessage,
  };
}
