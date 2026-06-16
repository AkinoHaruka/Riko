/**
 * SSE 事件格式化单元测试
 * 测试 formatSseEvent 函数：SSE 事件格式生成、CJK 字符保留、多字段组合等
 */
import { describe, it, expect } from 'vitest';
import { formatSseEvent } from '../../../src/domain/chat/stream.js';

describe('formatSseEvent', () => {
  it('仅传入 type 和 content 时，生成正确的 SSE 事件', () => {
    const result = formatSseEvent('connected', 'ok');
    expect(result).toBe('data: {"type":"connected","content":"ok"}\n\n');
  });

  it('传入 type 和 data（无 content）时，生成包含 data 字段的 SSE 事件', () => {
    const result = formatSseEvent('finish', undefined, { finish_reason: 'stop' });
    expect(result).toBe('data: {"type":"finish","data":{"finish_reason":"stop"}}\n\n');
  });

  it('仅传入 type（无 content、无 data）时，生成仅包含 type 的 SSE 事件', () => {
    const result = formatSseEvent('error');
    expect(result).toBe('data: {"type":"error"}\n\n');
  });

  // CJK 字符不应被转义为 \uXXXX，确保前端可直接显示
  it('CJK 字符不被转义，应保留原文', () => {
    const result = formatSseEvent('content', '你好世界');
    // 确保 CJK 字符原样输出，而非被转义为 \uXXXX 形式
    expect(result).toContain('你好世界');
    expect(result).not.toContain('\\u');
  });

  it('同时传入 type、content 和 data 时，三者均出现在输出中', () => {
    const result = formatSseEvent('tool_call', '正在执行工具', { tool_name: 'grep' });
    expect(result).toContain('"type":"tool_call"');
    expect(result).toContain('"content":"正在执行工具"');
    expect(result).toContain('"data":{"tool_name":"grep"}');
    expect(result).toMatch(/^data: .+\n\n$/);
  });

  it('content 为空字符串时仍包含 content 字段', () => {
    const result = formatSseEvent('content', '');
    expect(result).toBe('data: {"type":"content","content":""}\n\n');
  });
});
