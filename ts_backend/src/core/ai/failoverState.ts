/**
 * Failover 状态管理器。
 *
 * 维护各 Provider 的健康状态，驱动两阶段 failover 决策：
 * - healthy：正常状态，使用 primary model
 * - degraded：连续失败但未触发降级，继续重试 primary
 * - fallback：已降级到 fallback model，定期探测 primary 恢复
 *
 * 探测窗口设计为 4 分钟，避开 transportCache 的 5 分钟 TTL，
 * 留 1 分钟缓冲避免探测请求因缓存过期而重新创建 transport。
 *
 * @module core/ai/failoverState
 */
import { FailoverReason } from './errors.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('FailoverState');

/** Provider 健康状态 */
export type FailoverStatus = 'healthy' | 'degraded' | 'fallback';

/** 单个 Provider 的 Failover 状态 */
export interface FailoverState {
  /** 当前状态 */
  status: FailoverStatus;
  /** 降级到期时间戳（毫秒），fallback 状态下有效 */
  fallbackUntil: number;
  /** 下次探测 primary 的时间戳（毫秒），fallback 状态下有效 */
  probeAt: number;
  /** 连续失败次数 */
  consecutiveFailures: number;
  /** 最后一次失败原因 */
  lastReason: FailoverReason;
  /** 最后一次状态更新时间戳（毫秒） */
  updatedAt: number;
}

/** 进入 degraded 状态的连续失败阈值 */
const DEGRADED_THRESHOLD = 2;
/** 进入 fallback 状态的连续失败阈值 */
const FALLBACK_THRESHOLD = 3;
/** 探测窗口：4 分钟（避开 transportCache 5 分钟 TTL，留 1 分钟缓冲） */
const PROBE_INTERVAL_MS = 4 * 60 * 1000;
/** 降级最短持续时间：5 分钟（与探测窗口对齐） */
const FALLBACK_MIN_DURATION_MS = 5 * 60 * 1000;

/**
 * Failover 状态管理器。
 *
 * 单例模式，维护所有 Provider 的健康状态。
 * 线程安全：所有方法同步执行，Node.js 单线程模型下无需锁。
 */
export class FailoverStateManager {
  private readonly states = new Map<string, FailoverState>();

  /** 获取指定 Provider 的状态，不存在时返回默认 healthy 状态 */
  getState(providerId: string): FailoverState {
    return (
      this.states.get(providerId) ?? {
        status: 'healthy',
        fallbackUntil: 0,
        probeAt: 0,
        consecutiveFailures: 0,
        lastReason: FailoverReason.None,
        updatedAt: Date.now(),
      }
    );
  }

  /**
   * 记录 Provider 失败。
   *
   * 状态转换：
   * - healthy → degraded：连续失败达 DEGRADED_THRESHOLD
   * - degraded → fallback：连续失败达 FALLBACK_THRESHOLD 或 shouldFallback=true
   * - fallback → fallback：重置 probeAt
   *
   * @param providerId - Provider 标识
   * @param reason - 失败原因
   * @param shouldFallback - 是否应触发模型降级（来自 ClassifiedError）
   */
  recordFailure(providerId: string, reason: FailoverReason, shouldFallback: boolean): void {
    const current = this.getState(providerId);
    const now = Date.now();
    const consecutiveFailures = current.consecutiveFailures + 1;

    let newStatus: FailoverStatus = current.status;

    // shouldFallback 直接触发降级，无需等待阈值
    if (shouldFallback) {
      newStatus = 'fallback';
    } else if (consecutiveFailures >= FALLBACK_THRESHOLD) {
      newStatus = 'fallback';
    } else if (consecutiveFailures >= DEGRADED_THRESHOLD) {
      newStatus = 'degraded';
    }

    const newState: FailoverState = {
      status: newStatus,
      fallbackUntil: newStatus === 'fallback' ? now + FALLBACK_MIN_DURATION_MS : 0,
      probeAt: newStatus === 'fallback' ? now + PROBE_INTERVAL_MS : 0,
      consecutiveFailures,
      lastReason: reason,
      updatedAt: now,
    };

    this.states.set(providerId, newState);

    if (newStatus !== current.status) {
      logger.warn(
        'Provider %s 状态转换: %s → %s (连续失败 %d 次, 原因: %s)',
        providerId,
        current.status,
        newStatus,
        consecutiveFailures,
        reason,
      );
    }
  }

  /**
   * 记录 Provider 成功。
   *
   * 任何成功调用都会重置连续失败计数。
   * fallback 状态下成功调用视为 primary 已恢复，状态回到 healthy。
   *
   * @param providerId - Provider 标识
   */
  recordSuccess(providerId: string): void {
    const current = this.states.get(providerId);
    if (!current) return;

    const wasFallback = current.status === 'fallback';
    const newState: FailoverState = {
      ...current,
      status: 'healthy',
      fallbackUntil: 0,
      probeAt: 0,
      consecutiveFailures: 0,
      lastReason: FailoverReason.None,
      updatedAt: Date.now(),
    };
    this.states.set(providerId, newState);

    if (wasFallback) {
      logger.info('Provider %s 已从 fallback 恢复到 healthy', providerId);
    }
  }

  /**
   * 判断是否应使用 fallback model。
   *
   * @param providerId - Provider 标识
   * @returns true 表示当前应使用 fallback model
   */
  shouldUseFallback(providerId: string): boolean {
    const state = this.getState(providerId);
    return state.status === 'fallback';
  }

  /**
   * 判断是否应探测 primary model 是否恢复。
   *
   * 仅在 fallback 状态下且当前时间已过 probeAt 时返回 true。
   *
   * @param providerId - Provider 标识
   * @returns true 表示应发起探测请求
   */
  shouldProbePrimary(providerId: string): boolean {
    const state = this.getState(providerId);
    if (state.status !== 'fallback') return false;
    return Date.now() >= state.probeAt;
  }

  /**
   * 探测失败后重置 probeAt，等待下一轮探测窗口。
   *
   * @param providerId - Provider 标识
   */
  recordProbeFailure(providerId: string): void {
    const current = this.states.get(providerId);
    if (!current || current.status !== 'fallback') return;

    this.states.set(providerId, {
      ...current,
      probeAt: Date.now() + PROBE_INTERVAL_MS,
      updatedAt: Date.now(),
    });
  }

  /** 清除所有 Provider 的状态（用于测试） */
  clear(): void {
    this.states.clear();
  }
}

/** 全局单例 */
export const failoverStateManager = new FailoverStateManager();
