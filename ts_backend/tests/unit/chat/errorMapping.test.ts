/**
 * AI API 错误映射单元测试
 * 测试 mapApiError 函数：将 OpenAI 风格的 HTTP 错误映射为用户友好的中文错误消息
 */
import { describe, it, expect } from 'vitest';
import { mapApiError } from '../../../src/core/ai/errors.js';

/**
 * 构造一个模拟的 OpenAI 风格错误对象
 * mapApiError 检查 error 是否为对象且包含 status 属性
 */
function makeOpenAiError(status: number, message?: string): unknown {
  return { status, message: message ?? 'test error' };
}

describe('mapApiError', () => {
  it('401 → API Key 无效或已过期', () => {
    const result = mapApiError(makeOpenAiError(401));
    expect(result.statusCode).toBe(401);
    expect(result.message).toBe('API Key 无效或已过期');
  });

  it('402 → API 余额不足', () => {
    const result = mapApiError(makeOpenAiError(402));
    expect(result.statusCode).toBe(402);
    expect(result.message).toContain('余额不足');
  });

  it('429 → 请求速率上限', () => {
    const result = mapApiError(makeOpenAiError(429));
    expect(result.statusCode).toBe(429);
    expect(result.message).toContain('速率');
  });

  it('500 → 服务内部错误', () => {
    const result = mapApiError(makeOpenAiError(500));
    expect(result.statusCode).toBe(500);
    expect(result.message).toContain('内部错误');
  });

  it('503 → 服务暂时不可用', () => {
    const result = mapApiError(makeOpenAiError(503));
    expect(result.statusCode).toBe(503);
    expect(result.message).toContain('暂时不可用');
  });

  it('400 → 请求参数错误', () => {
    const result = mapApiError(makeOpenAiError(400));
    expect(result.statusCode).toBe(400);
    expect(result.message).toContain('参数错误');
  });

  it('403 → 无权访问', () => {
    const result = mapApiError(makeOpenAiError(403));
    expect(result.statusCode).toBe(403);
    expect(result.message).toContain('无权访问');
  });

  it('未知状态码 → 返回原始状态码和默认消息', () => {
    const result = mapApiError(makeOpenAiError(418, 'I am a teapot'));
    expect(result.statusCode).toBe(418);
    expect(result.message).toBe('AI API 调用失败，请稍后重试');
  });

  it('非对象错误 → 返回 500 和默认消息', () => {
    const result = mapApiError('something went wrong');
    expect(result.statusCode).toBe(500);
    expect(result.message).toBe('AI API 调用失败');
  });

  it('null 错误 → 返回 500 和默认消息', () => {
    const result = mapApiError(null);
    expect(result.statusCode).toBe(500);
    expect(result.message).toBe('AI API 调用失败');
  });

  it('无 status 属性的对象 → 返回 500 和默认消息', () => {
    const result = mapApiError({ message: 'no status field' });
    expect(result.statusCode).toBe(500);
    expect(result.message).toBe('AI API 调用失败');
  });
});
