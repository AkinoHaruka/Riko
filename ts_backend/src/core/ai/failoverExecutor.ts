/**
 * Failover 执行器。
 *
 * 封装两阶段 failover 流程：
 * 1. 阶段 1（同 Provider 重试）：对 retryable 错误，按 jittered backoff 重试
 * 2. 阶段 2（Model Fallback）：阶段 1 失败且 shouldFallback=true 时，切换到 fallback model
 *
 * fallback 后由 FailoverStateManager 定期探测原 primary 恢复。
 *
 * @module core/ai/failoverExecutor
 */
import { classifyError } from './errors.js';
import type { ClassifiedError } from './errors.js';
import {
  jitteredBackoff,
  sleep,
  MaxAttemptsExceededError,
} from './retry.js';
import type { RetryOptions } from './retry.js';
import { failoverStateManager } from './failoverState.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('FailoverExecutor');

/** 模型覆盖来源 */
export type ModelOverrideSource = 'configured' | 'auto' | 'user' | 'legacy';

/** Failover 执行参数 */
export interface FailoverParams {
  /** Provider 标识 */
  providerId: string;
  /** 主模型 ID */
  primaryModel: string;
  /** 降级模型 ID（可选，未配置则不降级） */
  fallbackModel?: string;
  /** Retry-After 头值（从错误响应中提取） */
  retryAfterHeader?: string;
}

/** Failover 执行结果 */
export interface FailoverExecutionResult<T> {
  /** 操作返回的数据 */
  data: T;
  /** 实际使用的模型 ID */
  modelUsed: string;
  /** 模型覆盖来源 */
  modelOverrideSource: ModelOverrideSource;
  /** 总尝试次数（含首次调用） */
  attempts: number;
  /** 是否发生了模型降级 */
  fellBack: boolean;
  /** 最后一次错误分类（成功时为 undefined） */
  lastClassifiedError?: ClassifiedError;
}

/**
 * 带两阶段 failover 的执行器。
 *
 * @param params - Failover 参数
 * @param policy - 重试策略（FOREGROUND_RETRY_POLICY 或 BACKGROUND_RETRY_POLICY）
 * @param operation - 实际执行的操作，接收当前应使用的 model ID，返回 Promise<T>
 * @returns Failover 执行结果
 * @throws MaxAttemptsExceededError 当所有重试和降级均失败时抛出
 */
export async function executeWithFailover<T>(
  params: FailoverParams,
  policy: RetryOptions,
  operation: (model: string) => Promise<T>,
): Promise<FailoverExecutionResult<T>> {
  const { providerId, primaryModel, fallbackModel } = params;

  // 判断是否应直接使用 fallback model（之前失败已进入 fallback 状态）
  const shouldStartWithFallback =
    fallbackModel !== undefined && failoverStateManager.shouldUseFallback(providerId);

  let currentModel = shouldStartWithFallback ? fallbackModel! : primaryModel;
  let modelOverrideSource: ModelOverrideSource = shouldStartWithFallback ? 'auto' : 'configured';
  let attempts = 0;
  let fellBack = false;
  let lastClassifiedError: ClassifiedError | undefined;

  // 阶段 1：同 Provider 重试（使用当前 model）
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    attempts++;
    try {
      const data = await operation(currentModel);
      // 成功：记录成功，重置状态
      failoverStateManager.recordSuccess(providerId);
      logger.debug(
        'Provider %s 操作成功 (model=%s, attempts=%d)',
        providerId,
        currentModel,
        attempts,
      );
      return {
        data,
        modelUsed: currentModel,
        modelOverrideSource,
        attempts,
        fellBack,
        lastClassifiedError,
      };
    } catch (error) {
      lastClassifiedError = classifyError(error);
      logger.warn(
        'Provider %s 操作失败 (model=%s, attempt=%d/%d, reason=%s): %s',
        providerId,
        currentModel,
        attempt + 1,
        policy.maxAttempts,
        lastClassifiedError.reason,
        lastClassifiedError.internalMessage,
      );

      // 不可重试错误：记录失败并终止
      if (!lastClassifiedError.retryable) {
        failoverStateManager.recordFailure(
          providerId,
          lastClassifiedError.reason,
          lastClassifiedError.shouldFallback,
        );
        throw new MaxAttemptsExceededError(attempts, error);
      }

      // 记录失败（但不触发降级，除非 shouldFallback）
      failoverStateManager.recordFailure(
        providerId,
        lastClassifiedError.reason,
        lastClassifiedError.shouldFallback,
      );

      // shouldFallback 且有 fallback model：立即进入阶段 2
      if (lastClassifiedError.shouldFallback && fallbackModel && !fellBack) {
        logger.info(
          'Provider %s 触发模型降级: %s → %s (reason=%s)',
          providerId,
          currentModel,
          fallbackModel,
          lastClassifiedError.reason,
        );
        currentModel = fallbackModel;
        modelOverrideSource = 'auto';
        fellBack = true;
        // 降级后立即重试，不等待 backoff
        continue;
      }

      // 可重试但非降级：计算 backoff 延迟
      const retryAfterMs = lastClassifiedError.retryAfterMs;
      const delay = jitteredBackoff(attempt + 1, policy, retryAfterMs);
      if (delay > 0) {
        logger.debug('Provider %s 等待 %dms 后重试', providerId, delay);
        await sleep(delay);
      }
    }
  }

  // 阶段 1 全部失败，尝试阶段 2（若尚未降级且有 fallback model）
  if (!fellBack && fallbackModel) {
    logger.info(
      'Provider %s 阶段 1 失败，尝试降级到 fallback model: %s',
      providerId,
      fallbackModel,
    );
    currentModel = fallbackModel;
    modelOverrideSource = 'auto';
    fellBack = true;
    attempts++;

    try {
      const data = await operation(currentModel);
      failoverStateManager.recordSuccess(providerId);
      logger.info(
        'Provider %s fallback model 成功 (model=%s)',
        providerId,
        currentModel,
      );
      return {
        data,
        modelUsed: currentModel,
        modelOverrideSource,
        attempts,
        fellBack,
        lastClassifiedError,
      };
    } catch (error) {
      lastClassifiedError = classifyError(error);
      logger.error(
        'Provider %s fallback model 也失败 (model=%s, reason=%s): %s',
        providerId,
        currentModel,
        lastClassifiedError.reason,
        lastClassifiedError.internalMessage,
      );
    }
  }

  // 所有尝试均失败
  throw new MaxAttemptsExceededError(attempts, lastClassifiedError);
}
