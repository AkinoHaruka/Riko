/**
 * toolCallLoop 模块基础测试
 * 验证 formatSseEvent 和 extractUsageData 的导出和基本行为
 */
import { describe, it, expect } from 'vitest';
import { formatSseEvent, extractUsageData } from '../../../src/domain/chat/toolCallLoop.js';

describe('formatSseEvent', () => {
  it('仅 type 时生成最简 SSE 事件', () => {
    const result = formatSseEvent('connected');
    expect(result).toBe('data: {"type":"connected"}\n\n');
  });

  it('带 content 时包含 content 字段', () => {
    const result = formatSseEvent('content', 'hello');
    const parsed = JSON.parse(result.replace('data: ', '').trim());
    expect(parsed.type).toBe('content');
    expect(parsed.content).toBe('hello');
  });

  it('带 data 时包含 data 字段', () => {
    const result = formatSseEvent('usage', undefined, { prompt_tokens: 10 });
    const parsed = JSON.parse(result.replace('data: ', '').trim());
    expect(parsed.type).toBe('usage');
    expect(parsed.data).toEqual({ prompt_tokens: 10 });
  });
});

describe('extractUsageData', () => {
  it('提取基础用量字段', () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    };
    const result = extractUsageData(usage as Parameters<typeof extractUsageData>[0]);
    expect(result.prompt_tokens).toBe(100);
    expect(result.completion_tokens).toBe(50);
    expect(result.total_tokens).toBe(150);
  });

  it('提取缓存命中字段（如存在）', () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 20,
    };
    const result = extractUsageData(usage as Parameters<typeof extractUsageData>[0]);
    expect(result.prompt_cache_hit_tokens).toBe(80);
    expect(result.prompt_cache_miss_tokens).toBe(20);
  });
});
