/**
 * failoverStateManager 单元测试
 *
 * 覆盖三态状态机转换逻辑：
 * - healthy → degraded：连续失败达 DEGRADED_THRESHOLD(2)
 * - degraded → fallback：连续失败达 FALLBACK_THRESHOLD(3) 或 shouldFallback=true
 * - fallback → healthy：recordSuccess 重置
 *
 * 同时测试 shouldUseFallback / shouldProbePrimary / recordProbeFailure 的时间窗口行为。
 *
 * 由于 failoverStateManager 是全局单例，每个用例前调用 clear() 重置状态。
 * 使用 vi.useFakeTimers() 控制时间推进，确保 probeAt 时间窗口的断言确定性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  failoverStateManager,
  FailoverStateManager,
} from '../../../src/core/ai/failoverState.js';
import { FailoverReason } from '../../../src/core/ai/errors.js';

/** 探测窗口：4 分钟（与实现常量保持一致，便于时间推进断言） */
const PROBE_INTERVAL_MS = 4 * 60 * 1000;
/** 降级最短持续：5 分钟 */
const FALLBACK_MIN_DURATION_MS = 5 * 60 * 1000;

const PROVIDER_ID = 'test-provider';

describe('failoverStateManager', () => {
  beforeEach(() => {
    // 重置单例状态，确保用例间隔离
    failoverStateManager.clear();
    // 使用假定时器，确保 Date.now() 推进可控
    vi.useFakeTimers();
    // 固定起点时间，避免跨用例漂移
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── 初始状态 ──────────────────────────────────────────────────

  describe('初始状态', () => {
    it('未记录任何事件的 Provider 默认为 healthy', () => {
      const state = failoverStateManager.getState(PROVIDER_ID);
      expect(state.status).toBe('healthy');
      expect(state.consecutiveFailures).toBe(0);
      expect(state.fallbackUntil).toBe(0);
      expect(state.probeAt).toBe(0);
      expect(state.lastReason).toBe(FailoverReason.None);
    });

    it('新构造的 FailoverStateManager 实例同样默认 healthy', () => {
      // 验证非单例路径，确保类本身行为正确
      const fresh = new FailoverStateManager();
      expect(fresh.getState(PROVIDER_ID).status).toBe('healthy');
    });

    it('clear() 后状态回到 healthy', () => {
      // 先制造 2 次失败进入 degraded，确保状态已偏离 healthy
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      expect(failoverStateManager.getState(PROVIDER_ID).status).toBe('degraded');

      failoverStateManager.clear();
      const state = failoverStateManager.getState(PROVIDER_ID);
      expect(state.status).toBe('healthy');
      expect(state.consecutiveFailures).toBe(0);
    });
  });

  // ─── 失败累计与状态转换 ────────────────────────────────────────

  describe('recordFailure 状态转换', () => {
    it('连续失败 1 次仍保持 healthy', () => {
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);

      const state = failoverStateManager.getState(PROVIDER_ID);
      expect(state.status).toBe('healthy');
      expect(state.consecutiveFailures).toBe(1);
      expect(state.lastReason).toBe(FailoverReason.Network);
      // healthy 状态不应设置降级相关时间戳
      expect(state.fallbackUntil).toBe(0);
      expect(state.probeAt).toBe(0);
    });

    it('连续失败 2 次进入 degraded，shouldUseFallback 仍为 false', () => {
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Timeout, false);

      const state = failoverStateManager.getState(PROVIDER_ID);
      expect(state.status).toBe('degraded');
      expect(state.consecutiveFailures).toBe(2);
      expect(state.lastReason).toBe(FailoverReason.Timeout);
      // degraded 不应触发降级
      expect(failoverStateManager.shouldUseFallback(PROVIDER_ID)).toBe(false);
      // degraded 不应设置降级时间戳
      expect(state.fallbackUntil).toBe(0);
      expect(state.probeAt).toBe(0);
    });

    it('连续失败 3 次进入 fallback，shouldUseFallback 返回 true', () => {
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);

      const state = failoverStateManager.getState(PROVIDER_ID);
      expect(state.status).toBe('fallback');
      expect(state.consecutiveFailures).toBe(3);
      expect(failoverStateManager.shouldUseFallback(PROVIDER_ID)).toBe(true);
      // fallback 状态应设置降级到期与探测时间戳
      expect(state.fallbackUntil).toBe(Date.now() + FALLBACK_MIN_DURATION_MS);
      expect(state.probeAt).toBe(Date.now() + PROBE_INTERVAL_MS);
    });

    it('shouldFallback=true（如 ModelNotFound）单次失败直接进入 fallback', () => {
      // 模拟 classifyError 对 ModelNotFound 的决策：shouldFallback=true
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.ModelNotFound, true);

      const state = failoverStateManager.getState(PROVIDER_ID);
      expect(state.status).toBe('fallback');
      expect(state.consecutiveFailures).toBe(1);
      expect(state.lastReason).toBe(FailoverReason.ModelNotFound);
      expect(failoverStateManager.shouldUseFallback(PROVIDER_ID)).toBe(true);
      // 即使只失败 1 次也应设置探测窗口
      expect(state.probeAt).toBe(Date.now() + PROBE_INTERVAL_MS);
    });

    it('shouldFallback=true 在 degraded 状态下也立即进入 fallback', () => {
      // 先进入 degraded
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      expect(failoverStateManager.getState(PROVIDER_ID).status).toBe('degraded');

      // 第 3 次失败带 shouldFallback=true，应直接进入 fallback（即便失败次数未达 3 也成立，这里恰好 3 次）
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.ModelOverloaded, true);
      const state = failoverStateManager.getState(PROVIDER_ID);
      expect(state.status).toBe('fallback');
      expect(state.consecutiveFailures).toBe(3);
    });

    it('fallback 状态下继续失败会刷新 probeAt 与 fallbackUntil', () => {
      // 进入 fallback
      for (let i = 0; i < 3; i++) {
        failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      }
      const firstState = failoverStateManager.getState(PROVIDER_ID);
      const firstProbeAt = firstState.probeAt;
      const firstFallbackUntil = firstState.fallbackUntil;

      // 推进时间 1 分钟后再失败
      vi.advanceTimersByTime(60 * 1000);
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);

      const newState = failoverStateManager.getState(PROVIDER_ID);
      expect(newState.status).toBe('fallback');
      expect(newState.consecutiveFailures).toBe(4);
      // probeAt 应基于新的 Date.now() 重新计算
      expect(newState.probeAt).toBe(Date.now() + PROBE_INTERVAL_MS);
      expect(newState.probeAt).toBeGreaterThan(firstProbeAt);
      expect(newState.fallbackUntil).toBe(Date.now() + FALLBACK_MIN_DURATION_MS);
      expect(newState.fallbackUntil).toBeGreaterThan(firstFallbackUntil);
    });
  });

  // ─── 成功恢复 ──────────────────────────────────────────────────

  describe('recordSuccess 状态恢复', () => {
    it('fallback 状态下 recordSuccess 恢复到 healthy', () => {
      // 先进入 fallback
      for (let i = 0; i < 3; i++) {
        failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      }
      expect(failoverStateManager.getState(PROVIDER_ID).status).toBe('fallback');

      failoverStateManager.recordSuccess(PROVIDER_ID);

      const state = failoverStateManager.getState(PROVIDER_ID);
      expect(state.status).toBe('healthy');
      expect(state.consecutiveFailures).toBe(0);
      expect(state.fallbackUntil).toBe(0);
      expect(state.probeAt).toBe(0);
      expect(state.lastReason).toBe(FailoverReason.None);
      expect(failoverStateManager.shouldUseFallback(PROVIDER_ID)).toBe(false);
    });

    it('degraded 状态下 recordSuccess 恢复到 healthy', () => {
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      expect(failoverStateManager.getState(PROVIDER_ID).status).toBe('degraded');

      failoverStateManager.recordSuccess(PROVIDER_ID);

      const state = failoverStateManager.getState(PROVIDER_ID);
      expect(state.status).toBe('healthy');
      expect(state.consecutiveFailures).toBe(0);
    });

    it('对未记录状态的 Provider 调用 recordSuccess 是无操作（不抛错）', () => {
      expect(() => failoverStateManager.recordSuccess(PROVIDER_ID)).not.toThrow();
      // 状态仍为默认 healthy
      expect(failoverStateManager.getState(PROVIDER_ID).status).toBe('healthy');
    });
  });

  // ─── shouldProbePrimary 时间窗口 ───────────────────────────────

  describe('shouldProbePrimary 探测窗口', () => {
    it('healthy 状态返回 false', () => {
      expect(failoverStateManager.shouldProbePrimary(PROVIDER_ID)).toBe(false);
    });

    it('degraded 状态返回 false', () => {
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      expect(failoverStateManager.getState(PROVIDER_ID).status).toBe('degraded');
      expect(failoverStateManager.shouldProbePrimary(PROVIDER_ID)).toBe(false);
    });

    it('fallback 状态未过 probeAt 返回 false', () => {
      // 进入 fallback
      for (let i = 0; i < 3; i++) {
        failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      }
      expect(failoverStateManager.getState(PROVIDER_ID).status).toBe('fallback');

      // 推进时间略少于 PROBE_INTERVAL_MS，仍未到探测窗口
      vi.advanceTimersByTime(PROBE_INTERVAL_MS - 1);
      expect(failoverStateManager.shouldProbePrimary(PROVIDER_ID)).toBe(false);
    });

    it('fallback 状态过 probeAt 返回 true', () => {
      const startTime = Date.now();
      for (let i = 0; i < 3; i++) {
        failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      }
      const expectedProbeAt = startTime + PROBE_INTERVAL_MS;
      expect(failoverStateManager.getState(PROVIDER_ID).probeAt).toBe(expectedProbeAt);

      // 推进到恰好 probeAt，应触发探测
      vi.advanceTimersByTime(PROBE_INTERVAL_MS);
      expect(Date.now()).toBe(expectedProbeAt);
      expect(failoverStateManager.shouldProbePrimary(PROVIDER_ID)).toBe(true);
    });

    it('fallback 状态远超 probeAt 也返回 true', () => {
      for (let i = 0; i < 3; i++) {
        failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      }
      // 推进 1 小时
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(failoverStateManager.shouldProbePrimary(PROVIDER_ID)).toBe(true);
    });
  });

  // ─── recordProbeFailure 重置探测窗口 ───────────────────────────

  describe('recordProbeFailure 探测失败处理', () => {
    it('探测失败后 shouldProbePrimary 再次返回 false', () => {
      // 进入 fallback 并推进到探测窗口
      for (let i = 0; i < 3; i++) {
        failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      }
      vi.advanceTimersByTime(PROBE_INTERVAL_MS);
      expect(failoverStateManager.shouldProbePrimary(PROVIDER_ID)).toBe(true);

      // 探测失败
      failoverStateManager.recordProbeFailure(PROVIDER_ID);

      // 应重新计算 probeAt，当前时间未到新窗口
      const state = failoverStateManager.getState(PROVIDER_ID);
      expect(state.status).toBe('fallback');
      expect(state.probeAt).toBe(Date.now() + PROBE_INTERVAL_MS);
      expect(failoverStateManager.shouldProbePrimary(PROVIDER_ID)).toBe(false);
    });

    it('探测失败后再过 PROBE_INTERVAL_MS 应再次允许探测', () => {
      for (let i = 0; i < 3; i++) {
        failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      }
      vi.advanceTimersByTime(PROBE_INTERVAL_MS);
      failoverStateManager.recordProbeFailure(PROVIDER_ID);
      expect(failoverStateManager.shouldProbePrimary(PROVIDER_ID)).toBe(false);

      // 再推进一个探测窗口
      vi.advanceTimersByTime(PROBE_INTERVAL_MS);
      expect(failoverStateManager.shouldProbePrimary(PROVIDER_ID)).toBe(true);
    });

    it('对非 fallback 状态调用 recordProbeFailure 是无操作', () => {
      // healthy 状态调用不应抛错也不应改变状态
      expect(() => failoverStateManager.recordProbeFailure(PROVIDER_ID)).not.toThrow();
      expect(failoverStateManager.getState(PROVIDER_ID).status).toBe('healthy');
      expect(failoverStateManager.getState(PROVIDER_ID).probeAt).toBe(0);
    });

    it('对未记录的 Provider 调用 recordProbeFailure 是无操作', () => {
      expect(() => failoverStateManager.recordProbeFailure('unknown-provider')).not.toThrow();
    });

    it('探测失败不会改变 status 与 consecutiveFailures', () => {
      for (let i = 0; i < 3; i++) {
        failoverStateManager.recordFailure(PROVIDER_ID, FailoverReason.Network, false);
      }
      const before = failoverStateManager.getState(PROVIDER_ID);
      vi.advanceTimersByTime(PROBE_INTERVAL_MS);

      failoverStateManager.recordProbeFailure(PROVIDER_ID);

      const after = failoverStateManager.getState(PROVIDER_ID);
      expect(after.status).toBe('fallback');
      expect(after.consecutiveFailures).toBe(before.consecutiveFailures);
      expect(after.lastReason).toBe(before.lastReason);
    });
  });

  // ─── 多 Provider 隔离 ──────────────────────────────────────────

  describe('多 Provider 隔离', () => {
    it('不同 Provider 的状态相互独立', () => {
      // provider-a 进入 fallback
      for (let i = 0; i < 3; i++) {
        failoverStateManager.recordFailure('provider-a', FailoverReason.Network, false);
      }
      // provider-b 仅失败 1 次
      failoverStateManager.recordFailure('provider-b', FailoverReason.Network, false);

      expect(failoverStateManager.getState('provider-a').status).toBe('fallback');
      expect(failoverStateManager.getState('provider-b').status).toBe('healthy');
      expect(failoverStateManager.shouldUseFallback('provider-a')).toBe(true);
      expect(failoverStateManager.shouldUseFallback('provider-b')).toBe(false);
    });
  });
});
