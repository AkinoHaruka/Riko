import { describe, it, expect } from 'vitest';

describe('Compact content matching', () => {
  /**
   * Simulates the restoration logic that marks recent messages as
   * is_compact_summary=0. Uses the fixed Map<string, number> approach.
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
