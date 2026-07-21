/**
 * executeWithFailover 单元测试
 *
 * 覆盖两阶段 failover 流程：
 * 1. 阶段 1（同 Provider 重试）：对 retryable 错误，按 jittered backoff 重试
 * 2. 阶段 2（Model Fallback）：阶段 1 失败后切换到 fallback model
 *
 * 测试场景：
 * - 阶段 1 重试成功（首次失败 + 二次成功）
 * - 阶段 1 全部失败后阶段 2 降级成功
 * - shouldFallback=true 且 retryable=true 时立即切换 fallback（不等 backoff）
 * - 已处于 fallback 状态时直接从 fallback model 开始
 * - 返回结果字段完整性（含 lastClassifiedError）
 * - 无 fallbackModel 时不降级，抛出 MaxAttemptsExceededError
 * - 阶段 1 与阶段 2 均失败时抛出 MaxAttemptsExceededError
 *
 * 由于 failoverStateManager 是全局单例，每个用例前调用 clear() 重置状态。
 * 使用 vi.useFakeTimers() 控制 backoff 延迟，spy Math.random() 固定 jitter 比例为 0.5，
 * 使 jitteredBackoff 延迟可预测（FOREGROUND_RETRY_POLICY：attempt=1→500ms，attempt=2→1000ms）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeWithFailover } from '../../../src/core/ai/failoverExecutor.js';
import { failoverStateManager } from '../../../src/core/ai/failoverState.js';
import {
  FOREGROUND_RETRY_POLICY,
  MaxAttemptsExceededError,
} from '../../../src/core/ai/retry.js';
import { FailoverReason } from '../../../src/core/ai/errors.js';

const PROVIDER_ID = 'test-provider';
const PRIMARY_MODEL = 'primary-model';
const FALLBACK_MODEL = 'fallback-model';

/**
 * 构造可被 classifyError 正确分类的错误对象。
 * 通过 status 字段触发状态码分类路径。
 */
function makeApiError(statusCode: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = statusCode;
  return err;
}

describe('executeWithFailover', () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // 重置单例状态，确保用例间隔离
    failoverStateManager.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    // 固定 jitter 比例为 0.5，使 backoff 延迟可预测
    // jitteredBackoff: delay = floor(base * (0.5 + 0 * 0.5)) = floor(base * 0.5)
    mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    mathRandomSpy.mockRestore();
    vi.useRealTimers();
  });

  // ─── 阶段 1：同 Provider 重试 ─────────────────────────────────

  describe('阶段 1 同 Provider 重试', () => {
    it('首次失败（可重试错误）后重试成功', async () => {
      let calls = 0;
      const operation = async (model: string): Promise<string> => {
        calls++;
        // 阶段 1 始终使用 primary model
        expect(model).toBe(PRIMARY_MODEL);
        if (calls === 1) {
          // 429 → RateLimit，retryable=true，shouldFallback=false
          throw makeApiError(429, 'rate limited');
        }
        return 'success-data';
      };

      const promise = executeWithFailover(
        { providerId: PROVIDER_ID, primaryModel: PRIMARY_MODEL, fallbackModel: FALLBACK_MODEL },
        FOREGROUND_RETRY_POLICY,
        operation,
      );
      // 第一次失败后会 sleep(backoff)，推进时间触发重试
      // jitteredBackoff(1) with random=0: floor(1000 * 0.5) = 500ms
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(calls).toBe(2);
      expect(result.data).toBe('success-data');
      expect(result.modelUsed).toBe(PRIMARY_MODEL);
      expect(result.fellBack).toBe(false);
      expect(result.attempts).toBe(2);
      expect(result.modelOverrideSource).toBe('configured');
      // 成功后应重置 failover 状态
      expect(failoverStateManager.shouldUseFallback(PROVIDER_ID)).toBe(false);
    });

    it('首次即成功，attempts=1，无降级，无 lastClassifiedError', async () => {
      let calls = 0;
      const operation = async (model: string): Promise<string> => {
        calls++;
        return 'success-data';
      };

      const result = await executeWithFailover(
        { providerId: PROVIDER_ID, primaryModel: PRIMARY_MODEL, fallbackModel: FALLBACK_MODEL },
        FOREGROUND_RETRY_POLICY,
        operation,
      );

      expect(calls).toBe(1);
      expect(result.attempts).toBe(1);
      expect(result.fellBack).toBe(false);
      expect(result.modelUsed).toBe(PRIMARY_MODEL);
      expect(result.modelOverrideSource).toBe('configured');
      // 首次即成功，无 lastClassifiedError
      expect(result.lastClassifiedError).toBeUndefined();
    });
  });

  // ─── 阶段 2：模型降级 ─────────────────────────────────────────

  describe('阶段 2 模型降级', () => {
    it('阶段 1 全部失败后触发阶段 2 模型降级成功', async () => {
      const callsByModel: Record<string, number> = {};
      const operation = async (model: string): Promise<string> => {
        callsByModel[model] = (callsByModel[model] ?? 0) + 1;
        if (model === PRIMARY_MODEL) {
          // 500 → ServerError，retryable=true，shouldFallback=false
          // 阶段 1 会重试 maxAttempts 次
          throw makeApiError(500, 'server error');
        }
        // fallback model 立即成功
        return 'fallback-data';
      };

      const promise = executeWithFailover(
        { providerId: PROVIDER_ID, primaryModel: PRIMARY_MODEL, fallbackModel: FALLBACK_MODEL },
        FOREGROUND_RETRY_POLICY,
        operation,
      );
      // 推进足够时间覆盖所有 backoff（500 + 1000 = 1500ms）
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await promise;

      // primary 被尝试 maxAttempts 次，fallback 1 次
      expect(callsByModel[PRIMARY_MODEL]).toBe(FOREGROUND_RETRY_POLICY.maxAttempts);
      expect(callsByModel[FALLBACK_MODEL]).toBe(1);
      expect(result.data).toBe('fallback-data');
      expect(result.modelUsed).toBe(FALLBACK_MODEL);
      expect(result.fellBack).toBe(true);
      expect(result.modelOverrideSource).toBe('auto');
      // 阶段 1 maxAttempts + 阶段 2 1 次
      expect(result.attempts).toBe(FOREGROUND_RETRY_POLICY.maxAttempts + 1);
      // 应记录最后一次失败分类（ServerError）
      expect(result.lastClassifiedError).toBeDefined();
      expect(result.lastClassifiedError?.reason).toBe(FailoverReason.ServerError);
    });

    it('shouldFallback=true 且 retryable=true 时立即切换 fallback（不等 backoff）', async () => {
      const callsByModel: Record<string, number> = {};
      const operation = async (model: string): Promise<string> => {
        callsByModel[model] = (callsByModel[model] ?? 0) + 1;
        if (model === PRIMARY_MODEL) {
          // 503 → ModelOverloaded，retryable=true，shouldFallback=true
          // 应跳过 backoff 立即降级
          throw makeApiError(503, 'model overloaded');
        }
        return 'fallback-data';
      };

      // 不需要 advanceTimers：shouldFallback=true 跳过 backoff
      const result = await executeWithFailover(
        { providerId: PROVIDER_ID, primaryModel: PRIMARY_MODEL, fallbackModel: FALLBACK_MODEL },
        FOREGROUND_RETRY_POLICY,
        operation,
      );

      // 阶段 1 仅 1 次尝试即降级，阶段 2 1 次成功
      expect(callsByModel[PRIMARY_MODEL]).toBe(1);
      expect(callsByModel[FALLBACK_MODEL]).toBe(1);
      expect(result.attempts).toBe(2);
      expect(result.modelUsed).toBe(FALLBACK_MODEL);
      expect(result.fellBack).toBe(true);
      expect(result.modelOverrideSource).toBe('auto');
      expect(result.data).toBe('fallback-data');
      // 应记录最后一次失败分类（ModelOverloaded）
      expect(result.lastClassifiedError).toBeDefined();
      expect(result.lastClassifiedError?.reason).toBe(FailoverReason.ModelOverloaded);
      expect(result.lastClassifiedError?.shouldFallback).toBe(true);
    });

    it('阶段 1 与阶段 2 均失败时抛出 MaxAttemptsExceededError', async () => {
      const callsByModel: Record<string, number> = {};
      const operation = async (model: string): Promise<string> => {
        callsByModel[model] = (callsByModel[model] ?? 0) + 1;
        if (model === PRIMARY_MODEL) {
          // 500 → ServerError，retryable=true，shouldFallback=false
          throw makeApiError(500, 'server error');
        }
        // fallback 也失败
        throw makeApiError(500, 'fallback server error');
      };

      const promise = executeWithFailover(
        { providerId: PROVIDER_ID, primaryModel: PRIMARY_MODEL, fallbackModel: FALLBACK_MODEL },
        FOREGROUND_RETRY_POLICY,
        operation,
      );
      // 先附加 rejection handler 防止 advanceTimersByTimeAsync 推进时间时
      // promise 已 reject 但未被捕获，触发 UnhandledRejection 警告
      const assertion = expect(promise).rejects.toThrow(MaxAttemptsExceededError);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;

      // primary maxAttempts 次，fallback 1 次
      expect(callsByModel[PRIMARY_MODEL]).toBe(FOREGROUND_RETRY_POLICY.maxAttempts);
      expect(callsByModel[FALLBACK_MODEL]).toBe(1);
    });
  });

  // ─── 已处于 fallback 状态 ─────────────────────────────────────

  describe('已处于 fallback 状态', () => {
    it('已处于 fallback 状态时直接从 fallback model 开始', async () => {
      // 先让 Provider 进入 fallback 状态
      // shouldFallback=true 单次失败即可触发降级
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.ModelOverloaded, true);
      expect(failoverStateManager.shouldUseFallback(PROVIDER_ID)).toBe(true);

      const callsByModel: Record<string, number> = {};
      const operation = async (model: string): Promise<string> => {
        callsByModel[model] = (callsByModel[model] ?? 0) + 1;
        // 应直接使用 fallback model，不调用 primary
        expect(model).toBe(FALLBACK_MODEL);
        return 'fallback-data';
      };

      const result = await executeWithFailover(
        { providerId: PROVIDER_ID, primaryModel: PRIMARY_MODEL, fallbackModel: FALLBACK_MODEL },
        FOREGROUND_RETRY_POLICY,
        operation,
      );

      // primary 不应被调用
      expect(callsByModel[PRIMARY_MODEL]).toBeUndefined();
      expect(callsByModel[FALLBACK_MODEL]).toBe(1);
      expect(result.modelUsed).toBe(FALLBACK_MODEL);
      expect(result.modelOverrideSource).toBe('auto');
      // fellBack=false 因为从一开始就用 fallback，未发生运行时降级
      expect(result.fellBack).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.data).toBe('fallback-data');
    });
  });

  // ─── 返回结果字段完整性 ───────────────────────────────────────

  describe('返回结果字段完整性', () => {
    it('失败重试后成功的结果包含全部字段（含 lastClassifiedError）', async () => {
      let calls = 0;
      const operation = async (model: string): Promise<string> => {
        calls++;
        if (calls === 1) {
          // 429 → RateLimit，retryable=true
          throw makeApiError(429, 'rate limited');
        }
        return 'success-data';
      };

      const promise = executeWithFailover(
        { providerId: PROVIDER_ID, primaryModel: PRIMARY_MODEL, fallbackModel: FALLBACK_MODEL },
        FOREGROUND_RETRY_POLICY,
        operation,
      );
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      // 验证所有 FailoverExecutionResult 字段
      expect(result).toHaveProperty('data', 'success-data');
      expect(result).toHaveProperty('modelUsed', PRIMARY_MODEL);
      expect(result).toHaveProperty('modelOverrideSource', 'configured');
      expect(result).toHaveProperty('attempts', 2);
      expect(result).toHaveProperty('fellBack', false);
      expect(result).toHaveProperty('lastClassifiedError');
      // lastClassifiedError 应记录最后一次失败分类（RateLimit）
      expect(result.lastClassifiedError).toBeDefined();
      expect(result.lastClassifiedError?.reason).toBe(FailoverReason.RateLimit);
      expect(result.lastClassifiedError?.statusCode).toBe(429);
      expect(result.lastClassifiedError?.retryable).toBe(true);
      expect(result.lastClassifiedError?.shouldFallback).toBe(false);
    });
  });

  // ─── 无 fallbackModel ─────────────────────────────────────────

  describe('无 fallbackModel', () => {
    it('fallbackModel=undefined 时阶段 1 全部失败直接抛出 MaxAttemptsExceededError', async () => {
      let calls = 0;
      const operation = async (model: string): Promise<string> => {
        calls++;
        expect(model).toBe(PRIMARY_MODEL);
        // 500 → ServerError，retryable=true，shouldFallback=false
        throw makeApiError(500, 'server error');
      };

      const promise = executeWithFailover(
        { providerId: PROVIDER_ID, primaryModel: PRIMARY_MODEL, fallbackModel: undefined },
        FOREGROUND_RETRY_POLICY,
        operation,
      );
      // 先附加 rejection handler 防止 advanceTimersByTimeAsync 推进时间时
      // promise 已 reject 但未被捕获，触发 UnhandledRejection 警告
      const assertion = expect(promise).rejects.toThrow(MaxAttemptsExceededError);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
      // 应尝试 maxAttempts 次，无降级
      expect(calls).toBe(FOREGROUND_RETRY_POLICY.maxAttempts);
    });
  });
});
