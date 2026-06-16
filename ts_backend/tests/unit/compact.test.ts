/**
 * Compact 上下文压缩单元测试
 * 测试压缩后恢复最近消息标记的逻辑，验证基于 Map 的内容匹配算法
 */
import { describe, it, expect } from 'vitest';

describe('Compact content matching', () => {
  /**
   * 模拟压缩后恢复最近消息标记的逻辑
   * 使用 Map<string, number> 统计最近消息的 role|content 组合出现次数，
   * 逐条匹配全量消息并标记，确保重复内容也能正确恢复
   */
  function restoreRecentMessages(
    recentMessages: Array<{ role: string; content: string }>,
    allMessages: Array<{ id: number; role: string; content: string }>,
  ): Set<number> {
    const recentContentCounts = new Map<string, number>();
    for (const m of recentMessages) {
      const key = `${m.role}|${m.content}`;
      recentContentCounts.set(key, (recentContentCounts.get(key) ?? 0) + 1);
    }

    const restored = new Set<number>();
    for (const msg of allMessages) {
      if (recentContentCounts.size === 0) break;
      const key = `${msg.role}|${msg.content}`;
      const count = recentContentCounts.get(key);
      if (count !== undefined) {
        restored.add(msg.id);
        if (count > 1) {
          recentContentCounts.set(key, count - 1);
        } else {
          recentContentCounts.delete(key);
        }
      }
    }
    return restored;
  }

  it('restores messages with unique content', () => {
    const recent = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'How are you?' },
    ];
    const all = [
      { id: 1, role: 'user', content: 'Old message' },
      { id: 2, role: 'user', content: 'How are you?' },
      { id: 3, role: 'assistant', content: 'Hi there' },
      { id: 4, role: 'user', content: 'Hello' },
    ];

    const restored = restoreRecentMessages(recent, all);
    expect(restored).toContain(2);
    expect(restored).toContain(3);
    expect(restored).toContain(4);
    expect(restored).not.toContain(1);
  });

  // 关键测试：验证重复内容消息能被全部恢复（旧版 Set 方案只会恢复一条）
  it('correctly handles duplicate content messages', () => {
    const recent = [
      { role: 'user', content: 'Continue' },
      { role: 'user', content: 'Continue' },
    ];
    const all = [
      { id: 1, role: 'user', content: 'Continue' },
      { id: 2, role: 'user', content: 'Continue' },
    ];

    const restored = restoreRecentMessages(recent, all);
    // Both messages should be restored (the old Set approach would only restore one)
    expect(restored.size).toBe(2);
    expect(restored).toContain(1);
    expect(restored).toContain(2);
  });

  it('handles empty recent messages', () => {
    const recent: Array<{ role: string; content: string }> = [];
    const all = [
      { id: 1, role: 'user', content: 'Hello' },
    ];

    const restored = restoreRecentMessages(recent, all);
    expect(restored.size).toBe(0);
  });

  it('handles empty all messages', () => {
    const recent = [{ role: 'user', content: 'Hello' }];
    const all: Array<{ id: number; role: string; content: string }> = [];

    const restored = restoreRecentMessages(recent, all);
    expect(restored.size).toBe(0);
  });

  // 验证恢复数量不超过最近消息中的实际出现次数
  it('restores only up to the count in recent messages', () => {
    // DB has 3 "Continue" messages, but recent only has 2
    const recent = [
      { role: 'user', content: 'Continue' },
      { role: 'user', content: 'Continue' },
    ];
    const all = [
      { id: 1, role: 'user', content: 'Continue' },
      { id: 2, role: 'user', content: 'Continue' },
      { id: 3, role: 'user', content: 'Continue' },
    ];

    const restored = restoreRecentMessages(recent, all);
    // Only 2 out of 3 should be restored (oldest first since all are sorted DESC)
    expect(restored.size).toBe(2);
  });
});
