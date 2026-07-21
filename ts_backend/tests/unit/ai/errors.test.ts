/**
 * classifyError 函数单元测试
 * 覆盖 15 类 FailoverReason 分类与决策字段
 *
 * 测试范围：
 * 1. HTTP 状态码分类（401/403/408/429/503/500/502/504）
 * 2. 关键词细分（ContextTooLong/QuotaExceeded/ModelNotFound/ContentFilter/Dns/Network/Ssl）
 * 3. 402 状态码优先映射到 QuotaExceeded
 * 4. 决策字段正确性（retryable/shouldCompress/shouldRotateCredential/shouldFallback）
 * 5. Retry-After 头解析
 * 6. 边界情况（null/字符串/无 status 对象）
 */
import { describe, it, expect } from 'vitest';
import { classifyError, FailoverReason } from '../../../src/core/ai/errors.js';

/**
 * 构造模拟的 OpenAI 风格错误对象。
 * classifyError 通过 error.status 提取状态码，error.message 提取消息，error.headers 提取 Retry-After。
 */
function makeError(
  status: number,
  message?: string,
  headers?: Record<string, string>,
): unknown {
  return { status, message: message ?? 'test error', headers };
}

describe('classifyError', () => {
  // ─── HTTP 状态码分类 ──────────────────────────────────────────

  describe('HTTP 状态码分类', () => {
    it('401 → AuthInvalid', () => {
      const result = classifyError(makeError(401));
      expect(result.reason).toBe(FailoverReason.AuthInvalid);
      expect(result.statusCode).toBe(401);
    });

    it('403 → AuthForbidden', () => {
      const result = classifyError(makeError(403));
      expect(result.reason).toBe(FailoverReason.AuthForbidden);
      expect(result.statusCode).toBe(403);
    });

    it('408 → Timeout', () => {
      const result = classifyError(makeError(408));
      expect(result.reason).toBe(FailoverReason.Timeout);
      expect(result.statusCode).toBe(408);
    });

    it('429 → RateLimit', () => {
      const result = classifyError(makeError(429));
      expect(result.reason).toBe(FailoverReason.RateLimit);
      expect(result.statusCode).toBe(429);
    });

    it('503 → ModelOverloaded', () => {
      const result = classifyError(makeError(503));
      expect(result.reason).toBe(FailoverReason.ModelOverloaded);
      expect(result.statusCode).toBe(503);
    });

    it('500 → ServerError', () => {
      const result = classifyError(makeError(500));
      expect(result.reason).toBe(FailoverReason.ServerError);
      expect(result.statusCode).toBe(500);
    });

    it('502 → ServerError', () => {
      const result = classifyError(makeError(502));
      expect(result.reason).toBe(FailoverReason.ServerError);
      expect(result.statusCode).toBe(502);
    });

    it('504 → ServerError', () => {
      const result = classifyError(makeError(504));
      expect(result.reason).toBe(FailoverReason.ServerError);
      expect(result.statusCode).toBe(504);
    });

    it('未知状态码（418）→ Unknown，statusCode 保持原值', () => {
      const result = classifyError(makeError(418, "I'm a teapot"));
      expect(result.reason).toBe(FailoverReason.Unknown);
      expect(result.statusCode).toBe(418);
    });
  });

  // ─── 关键词细分 ──────────────────────────────────────────────

  describe('关键词细分 - ContextTooLong', () => {
    it.each([
      'context length exceeded',
      'maximum context window reached',
      'input too long',
      'token limit exceeded',
    ])('消息含 "%s" → ContextTooLong', (msg) => {
      const result = classifyError(makeError(400, msg));
      expect(result.reason).toBe(FailoverReason.ContextTooLong);
    });
  });

  describe('关键词细分 - QuotaExceeded', () => {
    it.each([
      'insufficient quota',
      'billing issue',
      'insufficient_quota',
      '账户余额不足',
    ])('消息含 "%s" → QuotaExceeded', (msg) => {
      const result = classifyError(makeError(400, msg));
      expect(result.reason).toBe(FailoverReason.QuotaExceeded);
    });
  });

  describe('关键词细分 - ModelNotFound', () => {
    it.each([
      'model not found: deepseek-v4',
      'model does not exist',
      'model_unavailable',
    ])('消息含 "%s" → ModelNotFound', (msg) => {
      const result = classifyError(makeError(400, msg));
      expect(result.reason).toBe(FailoverReason.ModelNotFound);
    });
  });

  describe('关键词细分 - ContentFilter', () => {
    it.each([
      'content filter triggered',
      'content_policy violation',
      'safety check failed',
    ])('消息含 "%s" → ContentFilter', (msg) => {
      const result = classifyError(makeError(400, msg));
      expect(result.reason).toBe(FailoverReason.ContentFilter);
    });
  });

  describe('关键词细分 - Dns', () => {
    it.each([
      'getaddrinfo ENOTFOUND api.deepseek.com',
      'Error: getaddrinfo failed',
      'request failed: EAI_AGAIN',
    ])('消息含 "%s" → Dns', (msg) => {
      // statusCode=0 模拟无 HTTP 响应的网络层错误
      const result = classifyError(makeError(0, msg));
      expect(result.reason).toBe(FailoverReason.Dns);
    });
  });

  describe('关键词细分 - Network', () => {
    it.each([
      'ECONNRESET socket closed',
      'ETIMEDOUT connection timed out',
      'socket hang up',
      'ECONNREFUSED 127.0.0.1:3000',
      'fetch failed',
    ])('消息含 "%s" → Network', (msg) => {
      const result = classifyError(makeError(0, msg));
      expect(result.reason).toBe(FailoverReason.Network);
    });
  });

  describe('关键词细分 - Ssl', () => {
    it.each([
      'CERT_HAS_EXPIRED',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'EPROTO protocol error',
      'certificate verify failed',
    ])('消息含 "%s" → Ssl', (msg) => {
      const result = classifyError(makeError(0, msg));
      expect(result.reason).toBe(FailoverReason.Ssl);
    });
  });

  describe('关键词优先级：KEYWORD_RULES 按数组顺序匹配', () => {
    it('同时含 context length 和 quota → ContextTooLong（规则在前）', () => {
      // ContextTooLong 规则在 QuotaExceeded 之前
      const result = classifyError(makeError(400, 'context length and quota issue'));
      expect(result.reason).toBe(FailoverReason.ContextTooLong);
    });

    it('同时含 quota 和 model not found → QuotaExceeded（规则在前）', () => {
      const result = classifyError(makeError(400, 'quota exceeded, model not found'));
      expect(result.reason).toBe(FailoverReason.QuotaExceeded);
    });
  });

  // ─── 402 优先映射到 QuotaExceeded ─────────────────────────────

  describe('402 状态码优先映射到 QuotaExceeded', () => {
    it('402 无关键词匹配 → QuotaExceeded（402 特殊兜底）', () => {
      const result = classifyError(makeError(402, 'payment required'));
      expect(result.reason).toBe(FailoverReason.QuotaExceeded);
      expect(result.statusCode).toBe(402);
    });

    it('402 含 quota 关键词 → QuotaExceeded（关键词命中）', () => {
      const result = classifyError(makeError(402, 'quota exceeded'));
      expect(result.reason).toBe(FailoverReason.QuotaExceeded);
    });

    it('402 含 context length 关键词 → ContextTooLong（关键词优先于 402 兜底）', () => {
      // 关键词匹配优先于 402 的 QuotaExceeded 兜底
      const result = classifyError(makeError(402, 'context length too long'));
      expect(result.reason).toBe(FailoverReason.ContextTooLong);
    });
  });

  // ─── 决策字段正确性 ──────────────────────────────────────────

  describe('决策字段', () => {
    /**
     * 对每个可通过 classifyError 触发的 reason，
     * 断言其 retryable/shouldCompress/shouldRotateCredential/shouldFallback 四个决策字段。
     *
     * 注意：None 和 AuthExpired 在 DECISION_TABLE 中定义，
     * 但 classifyError 当前无路径产生这两个 reason（None 表示成功，AuthExpired 未接入），
     * 故在此记录其预期决策值作为契约文档，便于未来接入时验证。
     */

    it('AuthInvalid: 不可重试、不压缩、轮换凭证、不降级', () => {
      const result = classifyError(makeError(401));
      expect(result).toMatchObject({
        reason: FailoverReason.AuthInvalid,
        retryable: false,
        shouldCompress: false,
        shouldRotateCredential: true,
        shouldFallback: false,
      });
    });

    it('AuthForbidden: 不可重试、不压缩、不轮换、不降级', () => {
      const result = classifyError(makeError(403));
      expect(result).toMatchObject({
        reason: FailoverReason.AuthForbidden,
        retryable: false,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
      });
    });

    it('RateLimit: 可重试、不压缩、不轮换、不降级', () => {
      const result = classifyError(makeError(429));
      expect(result).toMatchObject({
        reason: FailoverReason.RateLimit,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
      });
    });

    it('QuotaExceeded: 不可重试、不压缩、不轮换、不降级', () => {
      const result = classifyError(makeError(402));
      expect(result).toMatchObject({
        reason: FailoverReason.QuotaExceeded,
        retryable: false,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
      });
    });

    it('ModelNotFound: 不可重试、不压缩、不轮换、应降级', () => {
      const result = classifyError(makeError(400, 'model not found'));
      expect(result).toMatchObject({
        reason: FailoverReason.ModelNotFound,
        retryable: false,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: true,
      });
    });

    it('ModelOverloaded: 可重试、不压缩、不轮换、应降级', () => {
      const result = classifyError(makeError(503));
      expect(result).toMatchObject({
        reason: FailoverReason.ModelOverloaded,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: true,
      });
    });

    it('ContextTooLong: 不可重试、应压缩、不轮换、不降级', () => {
      const result = classifyError(makeError(400, 'context length exceeded'));
      expect(result).toMatchObject({
        reason: FailoverReason.ContextTooLong,
        retryable: false,
        shouldCompress: true,
        shouldRotateCredential: false,
        shouldFallback: false,
      });
    });

    it('ContentFilter: 不可重试、不压缩、不轮换、不降级', () => {
      const result = classifyError(makeError(400, 'content filter triggered'));
      expect(result).toMatchObject({
        reason: FailoverReason.ContentFilter,
        retryable: false,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
      });
    });

    it('Timeout: 可重试、不压缩、不轮换、不降级', () => {
      const result = classifyError(makeError(408));
      expect(result).toMatchObject({
        reason: FailoverReason.Timeout,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
      });
    });

    it('Network: 可重试、不压缩、不轮换、不降级', () => {
      const result = classifyError(makeError(0, 'ECONNRESET'));
      expect(result).toMatchObject({
        reason: FailoverReason.Network,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
      });
    });

    it('Dns: 可重试、不压缩、不轮换、不降级', () => {
      const result = classifyError(makeError(0, 'ENOTFOUND api.deepseek.com'));
      expect(result).toMatchObject({
        reason: FailoverReason.Dns,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
      });
    });

    it('Ssl: 不可重试、不压缩、不轮换、不降级', () => {
      const result = classifyError(makeError(0, 'CERT_HAS_EXPIRED'));
      expect(result).toMatchObject({
        reason: FailoverReason.Ssl,
        retryable: false,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
      });
    });

    it('ServerError: 可重试、不压缩、不轮换、不降级', () => {
      const result = classifyError(makeError(500));
      expect(result).toMatchObject({
        reason: FailoverReason.ServerError,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
      });
    });

    it('Unknown: 不可重试、不压缩、不轮换、不降级', () => {
      const result = classifyError(makeError(418, "I'm a teapot"));
      expect(result).toMatchObject({
        reason: FailoverReason.Unknown,
        retryable: false,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
      });
    });

    /**
     * None 与 AuthExpired 在 classifyError 中不可达：
     * - None 表示成功，不应作为错误分类结果出现
     * - AuthExpired 在 KEYWORD_RULES 和 classifyByStatusCode 中均无入口
     *
     * 预期决策值（基于 DECISION_TABLE 源码，作为契约文档）：
     * - None: retryable=false, shouldCompress=false, shouldRotateCredential=false, shouldFallback=false
     * - AuthExpired: retryable=false, shouldCompress=false, shouldRotateCredential=true, shouldFallback=false
     *
     * 若未来 classifyError 接入 AuthExpired（如解析 JWT 过期），
     * 应补充对应的触发用例并验证 shouldRotateCredential=true。
     */
    it('None 与 AuthExpired 当前不可达（契约文档）', () => {
      // 验证 None 不会从 classifyError 返回（None 表示成功）
      expect(FailoverReason.None).toBe('none');
      // 验证 AuthExpired 枚举存在但当前无触发路径
      expect(FailoverReason.AuthExpired).toBe('auth_expired');
    });
  });

  // ─── Retry-After 头解析 ──────────────────────────────────────

  describe('Retry-After 头解析', () => {
    it('429 含 retry-after 秒数 → retryAfterMs 转换为毫秒', () => {
      const result = classifyError(makeError(429, 'rate limit', { 'retry-after': '30' }));
      expect(result.reason).toBe(FailoverReason.RateLimit);
      expect(result.retryAfterMs).toBe(30000);
    });

    it('429 含 Retry-After 大写头 → 仍可解析', () => {
      const result = classifyError(makeError(429, 'rate limit', { 'Retry-After': '60' }));
      expect(result.retryAfterMs).toBe(60000);
    });

    it('429 无 retry-after 头 → retryAfterMs 为 undefined', () => {
      const result = classifyError(makeError(429));
      expect(result.retryAfterMs).toBeUndefined();
    });

    it('非 RateLimit 原因 → retryAfterMs 始终为 undefined', () => {
      // 503 即使带 retry-after 头也不解析（仅 RateLimit 解析）
      const result = classifyError(makeError(503, 'overloaded', { 'retry-after': '10' }));
      expect(result.reason).not.toBe(FailoverReason.RateLimit);
      expect(result.retryAfterMs).toBeUndefined();
    });
  });

  // ─── 用户消息与内部消息 ──────────────────────────────────────

  describe('消息字段', () => {
    it('userMessage 与 reason 对应的中文消息一致', () => {
      const result = classifyError(makeError(401));
      expect(result.userMessage).toBe('API Key 无效或已过期');
    });

    it('internalMessage 含 reason、状态码与原始消息', () => {
      const result = classifyError(makeError(429, 'Too Many Requests'));
      expect(result.internalMessage).toContain(FailoverReason.RateLimit);
      expect(result.internalMessage).toContain('429');
      expect(result.internalMessage).toContain('Too Many Requests');
    });

    it('internalMessage 在无消息时显示"无错误消息"', () => {
      const result = classifyError({ status: 500 });
      expect(result.internalMessage).toContain('无错误消息');
    });
  });

  // ─── 边界情况 ────────────────────────────────────────────────

  describe('边界情况', () => {
    it('null 错误 → Unknown，statusCode 修正为 500', () => {
      const result = classifyError(null);
      expect(result.reason).toBe(FailoverReason.Unknown);
      expect(result.statusCode).toBe(500);
    });

    it('undefined 错误 → Unknown，statusCode 修正为 500', () => {
      const result = classifyError(undefined);
      expect(result.reason).toBe(FailoverReason.Unknown);
      expect(result.statusCode).toBe(500);
    });

    it('字符串错误 → Unknown，statusCode 修正为 500', () => {
      const result = classifyError('something went wrong');
      expect(result.reason).toBe(FailoverReason.Unknown);
      expect(result.statusCode).toBe(500);
    });

    it('无 status 属性的对象 → Unknown，statusCode 修正为 500', () => {
      const result = classifyError({ message: 'no status field' });
      expect(result.reason).toBe(FailoverReason.Unknown);
      expect(result.statusCode).toBe(500);
    });

    it('status 为非数字 → 视为 0，reason 为 Unknown，statusCode 修正为 500', () => {
      const result = classifyError({ status: 'bad', message: 'invalid status' });
      expect(result.reason).toBe(FailoverReason.Unknown);
      expect(result.statusCode).toBe(500);
    });

    it('网络错误（statusCode=0）匹配关键词后 statusCode 保持 0', () => {
      // Network/Dns/Ssl 等无 HTTP 响应的错误，statusCode 为 0 且不为 Unknown
      const result = classifyError(makeError(0, 'ECONNRESET'));
      expect(result.reason).toBe(FailoverReason.Network);
      expect(result.statusCode).toBe(0);
    });
  });
});
