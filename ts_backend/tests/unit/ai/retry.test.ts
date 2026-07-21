/**
 * jitteredBackoff 重试策略单元测试
 *
 * 覆盖范围：
 * 1. 指数退避基准值计算（attempt=1/2/3 → base/2base/4base）
 * 2. symmetric 抖动范围（[50%, 100%) 区间）
 * 3. positive 抖动优先取 Retry-After 值
 * 4. maxDelayMs 上限生效
 * 5. attempt<=0 首次调用不延迟
 * 6. parseRetryAfterHeader 秒数与 HTTP-date 格式解析
 * 7. MaxAttemptsExceededError 构造字段
 * 8. FOREGROUND_RETRY_POLICY / BACKGROUND_RETRY_POLICY 常量值
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  jitteredBackoff,
  parseRetryAfterHeader,
  MaxAttemptsExceededError,
  FOREGROUND_RETRY_POLICY,
  BACKGROUND_RETRY_POLICY,
  type RetryOptions,
} from '../../../src/core/ai/retry.js';

/**
 * 构造 RetryOptions 的辅助函数，避免每个用例重复书写完整对象。
 */
function makeOptions(overrides: Partial<RetryOptions> = {}): RetryOptions {
  return {
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30_000,
    jitter: 'symmetric',
    ...overrides,
  };
}

// 每个用例后恢复 Math.random，避免 spy 泄漏到后续测试
afterEach(() => {
  vi.restoreAllMocks();
});

describe('jitteredBackoff', () => {
  // ─── 指数退避基准值计算 ──────────────────────────────────────

  describe('指数退避基准值计算', () => {
    /**
     * 固定 Math.random()=0.5 → jitterFactor = 0.5 + 0.5*0.5 = 0.75
     * 此时 delay = floor(base * 0.75)，可精确断言各 attempt 的延迟值，
     * 从而验证 base = baseDelayMs * 2^(attempt-1) 的指数递增关系。
     */
    it('attempt=1 → base=baseDelayMs，delay=floor(base*0.75)', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const delay = jitteredBackoff(1, makeOptions({ baseDelayMs: 1000, maxDelayMs: 30_000 }));
      // base = 1000 * 2^0 = 1000，delay = floor(1000 * 0.75) = 750
      expect(delay).toBe(750);
    });

    it('attempt=2 → base=baseDelayMs*2，delay=floor(base*0.75)', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const delay = jitteredBackoff(2, makeOptions({ baseDelayMs: 1000, maxDelayMs: 30_000 }));
      // base = 1000 * 2^1 = 2000，delay = floor(2000 * 0.75) = 1500
      expect(delay).toBe(1500);
    });

    it('attempt=3 → base=baseDelayMs*4，delay=floor(base*0.75)', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const delay = jitteredBackoff(3, makeOptions({ baseDelayMs: 1000, maxDelayMs: 30_000 }));
      // base = 1000 * 2^2 = 4000，delay = floor(4000 * 0.75) = 3000
      expect(delay).toBe(3000);
    });

    it('三次 attempt 的延迟呈 1:2:4 指数比例', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const opts = makeOptions({ baseDelayMs: 1000, maxDelayMs: 30_000 });
      const d1 = jitteredBackoff(1, opts);
      const d2 = jitteredBackoff(2, opts);
      const d3 = jitteredBackoff(3, opts);
      // 固定抖动因子后，延迟比例应严格等于 base 比例 1:2:4
      expect(d2 / d1).toBe(2);
      expect(d3 / d1).toBe(4);
    });
  });

  // ─── symmetric 抖动范围 ──────────────────────────────────────

  describe('symmetric 抖动范围', () => {
    /**
     * attempt=2, baseDelayMs=1000, maxDelayMs=30000
     * base = 1000 * 2^1 = 2000
     * jitterFactor = 0.5 + random()*0.5 ∈ [0.5, 1.0)
     * delay = floor(2000 * jitterFactor) ∈ [1000, 2000)
     */

    it('random=0 时取下界 1000（含）', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const delay = jitteredBackoff(2, makeOptions({ baseDelayMs: 1000, maxDelayMs: 30_000 }));
      // jitterFactor = 0.5，delay = floor(2000 * 0.5) = 1000
      expect(delay).toBe(1000);
    });

    it('random 趋近 1 时取上界 1999（不含 2000）', () => {
      // random() ∈ [0,1)，取 0.9999999 模拟接近上界
      vi.spyOn(Math, 'random').mockReturnValue(0.9999999);
      const delay = jitteredBackoff(2, makeOptions({ baseDelayMs: 1000, maxDelayMs: 30_000 }));
      // jitterFactor = 0.5 + 0.9999999*0.5 = 0.99999995
      // delay = floor(2000 * 0.99999995) = floor(1999.9999) = 1999
      expect(delay).toBe(1999);
      expect(delay).toBeLessThan(2000);
    });

    it('random=0.5 时 delay=1500（中点）', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const delay = jitteredBackoff(2, makeOptions({ baseDelayMs: 1000, maxDelayMs: 30_000 }));
      // jitterFactor = 0.75，delay = floor(2000 * 0.75) = 1500
      expect(delay).toBe(1500);
    });

    it('真实随机下运行 1000 次，所有值落在 [1000, 2000) 范围内', () => {
      // 不 mock random，使用真实随机数验证范围稳定性
      const opts = makeOptions({ baseDelayMs: 1000, maxDelayMs: 30_000 });
      const delays = Array.from({ length: 1000 }, () => jitteredBackoff(2, opts));
      for (const d of delays) {
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThan(2000);
      }
      // 额外验证分布非退化：至少出现 2 个不同值
      const unique = new Set(delays);
      expect(unique.size).toBeGreaterThan(1);
    });
  });

  // ─── positive 抖动优先取 Retry-After 值 ──────────────────────

  describe('positive 抖动优先取 Retry-After 值', () => {
    it('retryAfterMs > 计算延迟 → delay = retryAfterMs', () => {
      // 固定 random=0.5，attempt=1 时计算延迟 = floor(1000*0.75) = 750
      // retryAfterMs=5000 > 750 → delay = max(750, 5000) = 5000
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const delay = jitteredBackoff(
        1,
        makeOptions({ baseDelayMs: 1000, maxDelayMs: 30_000, jitter: 'positive' }),
        5000,
      );
      expect(delay).toBe(5000);
    });

    it('retryAfterMs < 计算延迟 → delay = 计算延迟（忽略 retryAfterMs）', () => {
      // attempt=5, base=1000*2^4=16000, delay=floor(16000*0.75)=12000
      // retryAfterMs=100 < 12000 → delay = max(12000, 100) = 12000
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const delay = jitteredBackoff(
        5,
        makeOptions({ baseDelayMs: 1000, maxDelayMs: 30_000, jitter: 'positive' }),
        100,
      );
      expect(delay).toBe(12000);
    });

    it('retryAfterMs > maxDelayMs → delay 被 maxDelayMs 截断', () => {
      // attempt=1, 计算延迟=750, retryAfterMs=100000 > maxDelayMs=5000
      // delay = max(750, 100000) = 100000，再 min(100000, 5000) = 5000
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const delay = jitteredBackoff(
        1,
        makeOptions({ baseDelayMs: 1000, maxDelayMs: 5000, jitter: 'positive' }),
        100_000,
      );
      expect(delay).toBe(5000);
    });

    it('positive 模式不传 retryAfterMs → 退化为 symmetric 行为', () => {
      // 不传 retryAfterMs 时，positive 与 symmetric 计算逻辑一致
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const delay = jitteredBackoff(
        2,
        makeOptions({ baseDelayMs: 1000, maxDelayMs: 30_000, jitter: 'positive' }),
      );
      // base=2000, delay=floor(2000*0.75)=1500
      expect(delay).toBe(1500);
    });

    it('symmetric 模式传 retryAfterMs → retryAfterMs 被忽略', () => {
      // symmetric 模式下 retryAfterMs 不生效，仅使用计算延迟
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const delay = jitteredBackoff(
        1,
        makeOptions({ baseDelayMs: 1000, maxDelayMs: 30_000, jitter: 'symmetric' }),
        5000,
      );
      // delay = floor(1000*0.75) = 750，retryAfterMs=5000 被忽略
      expect(delay).toBe(750);
    });
  });

  // ─── maxDelayMs 上限生效 ─────────────────────────────────────

  describe('maxDelayMs 上限生效', () => {
    it('高 attempt 时 base 被 maxDelayMs 截断，delay 不超过 maxDelayMs', () => {
      // attempt=20 → exponential=1000*2^19 极大，base=min(5000, 极大)=5000
      // delay=floor(5000*jitterFactor) ∈ [2500, 5000)，始终 < maxDelayMs
      const opts = makeOptions({ baseDelayMs: 1000, maxDelayMs: 5000, jitter: 'symmetric' });
      const delays = Array.from({ length: 500 }, () => jitteredBackoff(20, opts));
      for (const d of delays) {
        expect(d).toBeLessThanOrEqual(5000);
        expect(d).toBeGreaterThanOrEqual(2500);
      }
    });

    it('maxDelayMs 恰好等于 baseDelayMs 时 delay 不超过 maxDelayMs', () => {
      // baseDelayMs=maxDelayMs=2000，任意 attempt 的 base=min(2000, ...)=2000
      // delay=floor(2000*jitterFactor) ∈ [1000, 2000)
      vi.spyOn(Math, 'random').mockReturnValue(0.999);
      const delay = jitteredBackoff(10, makeOptions({ baseDelayMs: 2000, maxDelayMs: 2000 }));
      // jitterFactor=0.9995, delay=floor(2000*0.9995)=1999
      expect(delay).toBeLessThanOrEqual(2000);
    });

    it('positive 模式 retryAfterMs 超过 maxDelayMs 时仍被截断为 maxDelayMs', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const delay = jitteredBackoff(
        1,
        makeOptions({ baseDelayMs: 1000, maxDelayMs: 3000, jitter: 'positive' }),
        999_999,
      );
      expect(delay).toBe(3000);
    });
  });

  // ─── 首次调用不延迟 ──────────────────────────────────────────

  describe('attempt<=0 首次调用不延迟', () => {
    it('attempt=0 → 返回 0', () => {
      expect(jitteredBackoff(0, makeOptions())).toBe(0);
    });

    it('attempt=-1 → 返回 0', () => {
      expect(jitteredBackoff(-1, makeOptions())).toBe(0);
    });
  });
});

// ─── parseRetryAfterHeader ─────────────────────────────────────

describe('parseRetryAfterHeader', () => {
  describe('秒数格式', () => {
    it('"30" → 30000 毫秒', () => {
      expect(parseRetryAfterHeader('30')).toBe(30000);
    });

    it('"1" → 1000 毫秒', () => {
      expect(parseRetryAfterHeader('1')).toBe(1000);
    });

    it('"  30  " → 去空格后解析为 30000', () => {
      expect(parseRetryAfterHeader('  30  ')).toBe(30000);
    });

    it('"0" → seconds=0 不满足 >0，回退到 Date.parse 解析为 epoch（过去）→ 返回 0', () => {
      // V8 的 Date.parse("0") 将 "0" 解析为 Unix 时间戳 0（1970-01-01），属于过去时间
      // delta = 0 - now < 0 → 返回 0（非 undefined）
      expect(parseRetryAfterHeader('0')).toBe(0);
    });

    it('负数 "-5" → seconds=-5 不满足 >0，回退到 Date.parse 解析为过去时间 → 返回 0', () => {
      // V8 的 Date.parse("-5") 将 "-5" 解析为时间戳 -5（epoch 前 5ms），属于过去时间
      // delta < 0 → 返回 0
      expect(parseRetryAfterHeader('-5')).toBe(0);
    });
  });

  describe('HTTP-date 格式', () => {
    it('未来时间的 HTTP-date → 返回正数毫秒', () => {
      // 构造一个未来的 HTTP-date（当前为 2026-07-13，使用 2027 年）
      const futureDate = new Date('2027-01-01T00:00:00Z');
      const httpDate = futureDate.toUTCString();
      const result = parseRetryAfterHeader(httpDate);
      expect(result).toBeDefined();
      expect(typeof result).toBe('number');
      expect(result!).toBeGreaterThan(0);
      // 验证大致正确：约 173 天 ≈ 14_947_200_000 ms（允许一定误差）
      expect(result!).toBeGreaterThan(10_000_000_000);
    });

    it('未来 10 秒的 HTTP-date → 返回约 10000 毫秒（允许误差）', () => {
      const futureDate = new Date(Date.now() + 10_000);
      const httpDate = futureDate.toUTCString();
      const result = parseRetryAfterHeader(httpDate);
      expect(result).toBeDefined();
      expect(result!).toBeGreaterThan(8000);
      expect(result!).toBeLessThanOrEqual(10_000);
    });

    it('过去时间的 HTTP-date → 返回 0（非 undefined）', () => {
      const pastDate = new Date('2020-01-01T00:00:00Z');
      const result = parseRetryAfterHeader(pastDate.toUTCString());
      expect(result).toBe(0);
    });
  });

  describe('无效输入', () => {
    it('undefined → undefined', () => {
      expect(parseRetryAfterHeader(undefined)).toBeUndefined();
    });

    it('空字符串 → undefined', () => {
      expect(parseRetryAfterHeader('')).toBeUndefined();
    });

    it('纯空格 → undefined', () => {
      expect(parseRetryAfterHeader('   ')).toBeUndefined();
    });

    it('非数字非日期的乱码 → undefined', () => {
      expect(parseRetryAfterHeader('not-a-date-or-number')).toBeUndefined();
    });
  });
});

// ─── MaxAttemptsExceededError ──────────────────────────────────

describe('MaxAttemptsExceededError', () => {
  it('构造时 attempts 和 lastError 字段正确赋值', () => {
    const cause = new Error('connection refused');
    const err = new MaxAttemptsExceededError(3, cause);
    expect(err.attempts).toBe(3);
    expect(err.lastError).toBe(cause);
  });

  it('name 属性为 MaxAttemptsExceededError', () => {
    const err = new MaxAttemptsExceededError(1, null);
    expect(err.name).toBe('MaxAttemptsExceededError');
  });

  it('message 包含尝试次数', () => {
    const err = new MaxAttemptsExceededError(5, 'timeout');
    expect(err.message).toContain('5');
    expect(err.message).toContain('最大尝试次数');
  });

  it('lastError 可为任意类型（含原始值）', () => {
    const err = new MaxAttemptsExceededError(2, 'string error');
    expect(err.lastError).toBe('string error');
  });

  it('lastError 可为 undefined', () => {
    const err = new MaxAttemptsExceededError(2, undefined);
    expect(err.lastError).toBeUndefined();
  });

  it('是 Error 的实例', () => {
    const err = new MaxAttemptsExceededError(1, null);
    expect(err).toBeInstanceOf(Error);
  });
});

// ─── 重试策略常量 ──────────────────────────────────────────────

describe('FOREGROUND_RETRY_POLICY', () => {
  it('maxAttempts=3（快速失败，含首次共 3 次）', () => {
    expect(FOREGROUND_RETRY_POLICY.maxAttempts).toBe(3);
  });

  it('baseDelayMs=1000（1 秒基准延迟）', () => {
    expect(FOREGROUND_RETRY_POLICY.baseDelayMs).toBe(1000);
  });

  it('maxDelayMs=30000（30 秒上限）', () => {
    expect(FOREGROUND_RETRY_POLICY.maxDelayMs).toBe(30_000);
  });

  it('jitter=symmetric（对称抖动）', () => {
    expect(FOREGROUND_RETRY_POLICY.jitter).toBe('symmetric');
  });
});

describe('BACKGROUND_RETRY_POLICY', () => {
  it('maxAttempts=5（容忍更多重试）', () => {
    expect(BACKGROUND_RETRY_POLICY.maxAttempts).toBe(5);
  });

  it('baseDelayMs=2000（2 秒基准延迟）', () => {
    expect(BACKGROUND_RETRY_POLICY.baseDelayMs).toBe(2000);
  });

  it('maxDelayMs=60000（60 秒上限）', () => {
    expect(BACKGROUND_RETRY_POLICY.maxDelayMs).toBe(60_000);
  });

  it('jitter=positive（正向抖动，尊重 Retry-After）', () => {
    expect(BACKGROUND_RETRY_POLICY.jitter).toBe('positive');
  });
});

describe('前后台策略对比', () => {
  it('后台策略 maxAttempts 不少于前台', () => {
    expect(BACKGROUND_RETRY_POLICY.maxAttempts).toBeGreaterThanOrEqual(
      FOREGROUND_RETRY_POLICY.maxAttempts,
    );
  });

  it('后台策略 baseDelayMs 不小于前台', () => {
    expect(BACKGROUND_RETRY_POLICY.baseDelayMs).toBeGreaterThanOrEqual(
      FOREGROUND_RETRY_POLICY.baseDelayMs,
    );
  });

  it('后台策略 maxDelayMs 不小于前台', () => {
    expect(BACKGROUND_RETRY_POLICY.maxDelayMs).toBeGreaterThanOrEqual(
      FOREGROUND_RETRY_POLICY.maxDelayMs,
    );
  });

  it('前台用 symmetric，后台用 positive', () => {
    expect(FOREGROUND_RETRY_POLICY.jitter).toBe('symmetric');
    expect(BACKGROUND_RETRY_POLICY.jitter).toBe('positive');
    expect(FOREGROUND_RETRY_POLICY.jitter).not.toBe(BACKGROUND_RETRY_POLICY.jitter);
  });
});
