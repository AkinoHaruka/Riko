/**
 * Jittered Backoff 重试策略。
 *
 * 提供指数退避 + 抖动（jitter）的延迟计算，支持两种抖动模式：
 * - symmetric：对称抖动，延迟在 [50%, 100%) 基准值范围内
 * - positive：正向抖动，与 symmetric 相同，但 Retry-After 头优先级最高
 *
 * 同时提供 Retry-After 头解析（秒数或 HTTP-date），
 * 以及前台/后台任务的重试策略预设。
 *
 * @module core/ai/retry
 */

/** 抖动模式 */
export type JitterMode = 'symmetric' | 'positive';

/** 重试策略配置 */
export interface RetryOptions {
  /** 最大尝试次数（含首次调用） */
  maxAttempts: number;
  /** 基准延迟（毫秒） */
  baseDelayMs: number;
  /** 最大延迟上限（毫秒） */
  maxDelayMs: number;
  /** 抖动模式 */
  jitter: JitterMode;
}

/**
 * 前台任务重试策略（用户交互场景，快速失败）。
 * 最多 3 次尝试，1 秒基准延迟，30 秒上限。
 */
export const FOREGROUND_RETRY_POLICY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitter: 'symmetric',
};

/**
 * 后台任务重试策略（压缩/梦境整固等，容忍较长延迟）。
 * 最多 5 次尝试，2 秒基准延迟，60 秒上限。
 */
export const BACKGROUND_RETRY_POLICY: RetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 2000,
  maxDelayMs: 60_000,
  jitter: 'positive',
};

/**
 * 超过最大尝试次数时抛出的错误。
 */
export class MaxAttemptsExceededError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastError: unknown,
  ) {
    super(`已达到最大尝试次数 ${attempts}，放弃重试`);
    this.name = 'MaxAttemptsExceededError';
  }
}

/**
 * 解析 Retry-After 头值。
 *
 * 支持两种格式：
 * 1. 秒数：如 "30" 表示 30 秒后重试
 * 2. HTTP-date：如 "Wed, 21 Oct 2026 07:28:00 GMT" 表示在该时间点后重试
 *
 * @param headerValue - Retry-After 头的原始字符串值
 * @returns 延迟毫秒数（相对于当前时间），无效返回 undefined
 */
export function parseRetryAfterHeader(headerValue: string | undefined): number | undefined {
  if (!headerValue) return undefined;

  const trimmed = headerValue.trim();

  // 尝试解析为秒数
  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return Math.floor(seconds * 1000);
  }

  // 尝试解析为 HTTP-date
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    const delta = date - Date.now();
    return delta > 0 ? delta : 0;
  }

  return undefined;
}

/**
 * 计算 jittered backoff 延迟。
 *
 * Symmetric Jitter（对称抖动）：
 *   delay = min(maxDelayMs, baseDelayMs * 2^attempt) * (0.5 + random() * 0.5)
 *   即基准延迟的 [50%, 100%) 范围
 *
 * Positive Jitter（正向抖动）：
 *   与 symmetric 相同，但 Retry-After 头优先级最高
 *   delay = max(delay, retryAfterMs)
 *
 * @param attempt - 当前尝试次数（0 表示首次调用，不延迟）
 * @param options - 重试策略配置
 * @param retryAfterMs - Retry-After 头解析值（毫秒），仅 positive 模式生效
 * @returns 延迟毫秒数
 */
export function jitteredBackoff(
  attempt: number,
  options: RetryOptions,
  retryAfterMs?: number,
): number {
  // 首次调用不延迟
  if (attempt <= 0) return 0;

  // 计算指数退避基准值，溢出时使用 maxDelayMs
  const exponential = options.baseDelayMs * Math.pow(2, attempt - 1);
  const base = Math.min(options.maxDelayMs, exponential);

  // 对称抖动：[50%, 100%) 范围
  const jitterFactor = 0.5 + Math.random() * 0.5;
  let delay = Math.floor(base * jitterFactor);

  // 正向抖动：Retry-After 头优先级最高
  if (options.jitter === 'positive' && retryAfterMs !== undefined) {
    delay = Math.max(delay, retryAfterMs);
  }

  // 确保不超过最大延迟上限
  return Math.min(delay, options.maxDelayMs);
}

/**
 * 异步延迟工具函数。
 * @param ms - 延迟毫秒数
 */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
