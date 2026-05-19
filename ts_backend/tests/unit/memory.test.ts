import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '../../src/core/database/index.js';
import {
  getMemories,
  searchMemories,
  createMemory,
  deleteMemory,
  deleteMemoriesBySource,
  clearMemories,
} from '../../src/domain/memory/index.js';

describe('Memory 领域', () => {
  beforeEach(async () => {
    closeDb();
    await initDb();
  });

  afterEach(() => {
    closeDb();
  });

  it('getMemories() 返回所有记忆', () => {
    createMemory({ key: 'k1', content: 'c1' });
    createMemory({ key: 'k2', content: 'c2' });

    const { memories } = getMemories();
    expect(memories).toHaveLength(2);
  });

  it('getMemories() 按 type 过滤', () => {
    createMemory({ key: 'k1', content: 'c1', type: 'fact' });
    createMemory({ key: 'k2', content: 'c2', type: 'preference' });

    const { memories } = getMemories('fact');
    expect(memories).toHaveLength(1);
    expect(memories[0].type).toBe('fact');
  });

  it('searchMemories() 按 keyword 在 key 和 content 中搜索', () => {
    createMemory({ key: 'user_name', content: 'Alice' });
    createMemory({ key: 'location', content: 'user_home' });
    createMemory({ key: 'age', content: '25' });

    const { memories } = searchMemories('user');
    expect(memories).toHaveLength(2);
  });

  it('createMemory() 使用默认值 (source="", type="fact")', () => {
    const mem = createMemory({ key: 'k1', content: 'c1' });
    expect(mem.source).toBe('');
    expect(mem.type).toBe('fact');
  });

  it('deleteMemory() 按 id 删除', () => {
    const mem = createMemory({ key: 'k1', content: 'c1' });
    const result = deleteMemory(mem.id);
    expect(result.message).toBe('记忆已删除');
    expect(result.id).toBe(mem.id);

    const { memories } = getMemories();
    expect(memories).toHaveLength(0);
  });

  it('deleteMemory() 不存在的 id 抛出 404', () => {
    try {
      deleteMemory('nonexistent-id');
      expect.unreachable('应该抛出错误');
    } catch (e: unknown) {
      expect((e as Error).message).toBe('记忆不存在');
      expect((e as { statusCode?: number }).statusCode).toBe(404);
    }
  });

  it('deleteBySource() 按来源删除并返回计数', () => {
    createMemory({ key: 'k1', content: 'c1', source: 'chat' });
    createMemory({ key: 'k2', content: 'c2', source: 'chat' });
    createMemory({ key: 'k3', content: 'c3', source: 'manual' });

    const result = deleteMemoriesBySource('chat');
    expect(result.deleted_count).toBe(2);

    const { memories } = getMemories();
    expect(memories).toHaveLength(1);
  });

  it('clearMemories() 清空所有记忆并返回计数', () => {
    createMemory({ key: 'k1', content: 'c1' });
    createMemory({ key: 'k2', content: 'c2' });

    const result = clearMemories();
    expect(result.deleted_count).toBe(2);

    const { memories } = getMemories();
    expect(memories).toHaveLength(0);
  });
});
