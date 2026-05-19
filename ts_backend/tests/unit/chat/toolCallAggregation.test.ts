import { describe, it, expect } from 'vitest';
import { accumulateToolCall } from '../../../src/domain/chat/types.js';
import type { ToolCallAccumulator, ToolCallDelta } from '../../../src/domain/chat/types.js';

describe('accumulateToolCall', () => {
  it('单个工具调用的累积：id、name、arguments 片段正确拼接', () => {
    const accumulator: ToolCallAccumulator = {};
    const chunks: ToolCallDelta[] = [
      { index: 0, id: 'call_abc123', function: { name: 'grep_tool', arguments: '{"pat' } },
      { index: 0, function: { arguments: 'tern":"hello' } },
      { index: 0, function: { arguments: '","path":"/src"}' } },
    ];

    for (const tc of chunks) {
      accumulateToolCall(accumulator, tc);
    }

    expect(accumulator[0]).toBeDefined();
    expect(accumulator[0].id).toBe('call_abc123');
    expect(accumulator[0].function.name).toBe('grep_tool');
    expect(accumulator[0].function.arguments).toBe('{"pattern":"hello","path":"/src"}');
  });

  it('多个工具调用按不同 index 分别累积', () => {
    const accumulator: ToolCallAccumulator = {};
    const chunks: ToolCallDelta[] = [
      { index: 0, id: 'call_001', function: { name: 'grep_tool', arguments: '{"pattern":"test"}' } },
      { index: 1, id: 'call_002', function: { name: 'cat_tool', arguments: '{"file_p' } },
      { index: 1, function: { arguments: 'ath":"/tmp/a.txt"}' } },
    ];

    for (const tc of chunks) {
      accumulateToolCall(accumulator, tc);
    }

    expect(Object.keys(accumulator)).toHaveLength(2);
    expect(accumulator[0].id).toBe('call_001');
    expect(accumulator[0].function.name).toBe('grep_tool');
    expect(accumulator[0].function.arguments).toBe('{"pattern":"test"}');

    expect(accumulator[1].id).toBe('call_002');
    expect(accumulator[1].function.name).toBe('cat_tool');
    expect(accumulator[1].function.arguments).toBe('{"file_path":"/tmp/a.txt"}');
  });

  it('arguments 片段按顺序正确拼接', () => {
    const accumulator: ToolCallAccumulator = {};
    const chunks: ToolCallDelta[] = [
      { index: 0, id: 'call_x', function: { name: 'edit_tool', arguments: '{"file' } },
      { index: 0, function: { arguments: '_path":"/a",' } },
      { index: 0, function: { arguments: '"old_string":"foo",' } },
      { index: 0, function: { arguments: '"new_string":"bar"}' } },
    ];

    for (const tc of chunks) {
      accumulateToolCall(accumulator, tc);
    }

    const merged = JSON.parse(accumulator[0].function.arguments);
    expect(merged.file_path).toBe('/a');
    expect(merged.old_string).toBe('foo');
    expect(merged.new_string).toBe('bar');
  });

  it('id 和 name 在首个片段设置后，后续片段不会覆盖', () => {
    const accumulator: ToolCallAccumulator = {};
    const chunks: ToolCallDelta[] = [
      { index: 0, id: 'call_first', function: { name: 'write_tool', arguments: '{"con' } },
      { index: 0, function: { arguments: 'tent":"hi"}' } },
    ];

    for (const tc of chunks) {
      accumulateToolCall(accumulator, tc);
    }

    expect(accumulator[0].id).toBe('call_first');
    expect(accumulator[0].function.name).toBe('write_tool');
    expect(accumulator[0].function.arguments).toBe('{"content":"hi"}');
  });

  it('首个片段 id 为空字符串时，后续非空 id 会正确赋值', () => {
    const accumulator: ToolCallAccumulator = {};
    const chunks: ToolCallDelta[] = [
      { index: 0, function: { name: 'grep_tool', arguments: '{"pat' } },
      { index: 0, id: 'call_delayed', function: { arguments: 'tern":"x"}' } },
    ];

    for (const tc of chunks) {
      accumulateToolCall(accumulator, tc);
    }

    expect(accumulator[0].id).toBe('call_delayed');
    expect(accumulator[0].function.name).toBe('grep_tool');
    expect(accumulator[0].function.arguments).toBe('{"pattern":"x"}');
  });
});
