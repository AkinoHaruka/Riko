/**
 * Compact 上下文压缩单元测试
 *
 * 测试压缩后恢复最近消息标记的逻辑，验证基于 Map 的内容匹配算法。
 * 直接导入 src/domain/compact 的真实实现，确保源码变更会被测试捕获。
 */
import { describe, it, expect } from 'vitest';
import { restoreRecentMessages } from '../../src/domain/compact/service.js';

describe('Compact content matching', () => {
  it('restores messages with unique content', () => {
    const recent = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'How are you?' },
    ];
    // allMessages 按 created_at DESC 排列（ newest 在前），与路由中 DB 查询一致
    const all = [
      { id: '4', role: 'user', content: 'Hello' },
      { id: '3', role: 'assistant', content: 'Hi there' },
      { id: '2', role: 'user', content: 'How are you?' },
      { id: '1', role: 'user', content: 'Old message' },
    ];

    const restored = restoreRecentMessages(recent, all);
    expect(restored).toContain('2');
    expect(restored).toContain('3');
    expect(restored).toContain('4');
    expect(restored).not.toContain('1');
  });

  // 关键测试：验证重复内容消息能被全部恢复（旧版 Set 方案只会恢复一条）
  it('correctly handles duplicate content messages', () => {
    const recent = [
      { role: 'user', content: 'Continue' },
      { role: 'user', content: 'Continue' },
    ];
    const all = [
      { id: '2', role: 'user', content: 'Continue' },
      { id: '1', role: 'user', content: 'Continue' },
    ];

    const restored = restoreRecentMessages(recent, all);
    // 两条消息都应被恢复（旧版 Set 方案只会恢复一条）
    expect(restored.size).toBe(2);
    expect(restored).toContain('1');
    expect(restored).toContain('2');
  });

  it('handles empty recent messages', () => {
    const recent: Array<{ role: string; content: string }> = [];
    const all = [{ id: '1', role: 'user', content: 'Hello' }];

    const restored = restoreRecentMessages(recent, all);
    expect(restored.size).toBe(0);
  });

  it('handles empty all messages', () => {
    const recent = [{ role: 'user', content: 'Hello' }];
    const all: Array<{ id: string; role: string; content: string }> = [];

    const restored = restoreRecentMessages(recent, all);
    expect(restored.size).toBe(0);
  });

  // 验证恢复数量不超过最近消息中的实际出现次数
  it('restores only up to the count in recent messages', () => {
    // DB 中有 3 条 "Continue" 消息，但 recent 只有 2 条
    const recent = [
      { role: 'user', content: 'Continue' },
      { role: 'user', content: 'Continue' },
    ];
    // allMessages 按 created_at DESC 排列，遍历时优先遇到较新的消息
    const all = [
      { id: '3', role: 'user', content: 'Continue' },
      { id: '2', role: 'user', content: 'Continue' },
      { id: '1', role: 'user', content: 'Continue' },
    ];

    const restored = restoreRecentMessages(recent, all);
    // recent 只有 2 条，故只恢复前 2 条（最新的 2 条）
    expect(restored.size).toBe(2);
    expect(restored).toContain('3');
    expect(restored).toContain('2');
    expect(restored).not.toContain('1');
  });
});
