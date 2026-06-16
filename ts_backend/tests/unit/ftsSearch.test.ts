/**
 * FTS5 全文搜索单元测试
 *
 * 测试 FTS5 索引的初始化、同步、搜索和删除等核心操作。
 * 使用内存数据库（:memory:），每个测试前重新初始化。
 *
 * 注意：ftsSearch.ts 中的 ftsInitialized 是模块级变量，
 * 需要通过 vi.resetModules() 在每个测试前重置模块缓存，
 * 否则 closeDb + initDb 后 ftsInitialized 仍为 true，FTS 表不会重建。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 每个测试前重置模块缓存，确保 ftsInitialized 重新初始化为 false
beforeEach(() => {
  vi.resetModules();
});

afterEach(async () => {
  // 动态导入以获取最新模块状态
  const { closeDb } = await import('../../src/core/database/index.js');
  closeDb();
});

/** 辅助函数：初始化数据库并插入测试记忆 */
async function setupDbWithMemories(
  memories: Array<{ id: string; user_id: string; key: string; content: string; type: string }>,
) {
  const { initDb, getDb } = await import('../../src/core/database/index.js');
  await initDb();
  const db = getDb();

  // 插入测试记忆
  const insert = db.prepare(
    'INSERT INTO memories (id, user_id, key, content, type) VALUES (?, ?, ?, ?, ?)',
  );
  for (const m of memories) {
    insert.run(m.id, m.user_id, m.key, m.content, m.type);
  }

  return db;
}

describe('FTS5 全文搜索', () => {
  // ---- initializeFts ----

  describe('initializeFts()', () => {
    it('幂等性：重复调用不报错', async () => {
      const { initDb } = await import('../../src/core/database/index.js');
      const { initializeFts } = await import('../../src/domain/memory/ftsSearch.js');

      await initDb();

      // 连续调用两次，不应抛出异常
      initializeFts();
      initializeFts();

      const { isFtsInitialized } = await import('../../src/domain/memory/ftsSearch.js');
      expect(isFtsInitialized()).toBe(true);
    });
  });

  // ---- syncDbMemoriesToFts ----

  describe('syncDbMemoriesToFts()', () => {
    it('空数据库返回 0', async () => {
      const { initDb } = await import('../../src/core/database/index.js');
      const { syncDbMemoriesToFts } = await import('../../src/domain/memory/ftsSearch.js');

      await initDb();

      const count = syncDbMemoriesToFts();
      expect(count).toBe(0);
    });

    it('同步记忆到 FTS 索引并返回正确数量', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'name', content: 'Alice likes programming', type: 'fact' },
        { id: 'm2', user_id: 'user1', key: 'hobby', content: 'Bob enjoys reading', type: 'preference' },
      ]);

      const { syncDbMemoriesToFts } = await import('../../src/domain/memory/ftsSearch.js');
      const count = syncDbMemoriesToFts();
      expect(count).toBe(2);
    });

    it('按 userId 过滤同步', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'name', content: 'Alice data', type: 'fact' },
        { id: 'm2', user_id: 'user2', key: 'name', content: 'Bob data', type: 'fact' },
      ]);

      const { syncDbMemoriesToFts } = await import('../../src/domain/memory/ftsSearch.js');
      const count = syncDbMemoriesToFts('user1');
      expect(count).toBe(1);
    });
  });

  // ---- ftsSearch ----

  describe('ftsSearch()', () => {
    it('基本搜索返回结果', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'lang', content: 'Python is a great programming language', type: 'fact' },
        { id: 'm2', user_id: 'user1', key: 'food', content: 'I like sushi and ramen', type: 'preference' },
      ]);

      const { syncDbMemoriesToFts, ftsSearch } = await import('../../src/domain/memory/ftsSearch.js');
      syncDbMemoriesToFts();

      const results = ftsSearch('Python', { userId: 'user1' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('m1');
      expect(results[0].source).toBe('db');
      expect(results[0].type).toBe('fact');
      // db 来源应包含 key 和 content
      expect(results[0].key).toBe('lang');
      expect(results[0].content).toContain('Python');
    });

    it('空查询返回空数组', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'test', content: 'some content', type: 'fact' },
      ]);

      const { syncDbMemoriesToFts, ftsSearch } = await import('../../src/domain/memory/ftsSearch.js');
      syncDbMemoriesToFts();

      const results = ftsSearch('');
      expect(results).toEqual([]);
    });

    it('userId 过滤：只返回指定用户的记忆', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'lang', content: 'Python programming', type: 'fact' },
        { id: 'm2', user_id: 'user2', key: 'lang', content: 'Python programming', type: 'fact' },
      ]);

      const { syncDbMemoriesToFts, ftsSearch } = await import('../../src/domain/memory/ftsSearch.js');
      syncDbMemoriesToFts();

      // 搜索 user1 的记忆
      const results1 = ftsSearch('Python', { userId: 'user1' });
      expect(results1.every((r) => r.id === 'm1')).toBe(true);

      // 搜索 user2 的记忆
      const results2 = ftsSearch('Python', { userId: 'user2' });
      expect(results2.every((r) => r.id === 'm2')).toBe(true);
    });

    it('type 过滤：只返回指定类型的记忆', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'lang', content: 'Python programming language', type: 'fact' },
        { id: 'm2', user_id: 'user1', key: 'food', content: 'Python snake is an animal', type: 'preference' },
      ]);

      const { syncDbMemoriesToFts, ftsSearch } = await import('../../src/domain/memory/ftsSearch.js');
      syncDbMemoriesToFts();

      // 只搜索 fact 类型
      const results = ftsSearch('Python', { userId: 'user1', type: 'fact' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every((r) => r.type === 'fact')).toBe(true);
    });

    it('无匹配结果返回空数组', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'test', content: 'hello world', type: 'fact' },
      ]);

      const { syncDbMemoriesToFts, ftsSearch } = await import('../../src/domain/memory/ftsSearch.js');
      syncDbMemoriesToFts();

      const results = ftsSearch('xyznonexistent');
      expect(results).toEqual([]);
    });
  });

  // ---- deleteFromFts ----

  describe('deleteFromFts()', () => {
    it('正常删除后搜索不到该记录', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'lang', content: 'TypeScript is a typed language', type: 'fact' },
        { id: 'm2', user_id: 'user1', key: 'food', content: 'I enjoy cooking', type: 'preference' },
      ]);

      const { syncDbMemoriesToFts, ftsSearch, deleteFromFts } = await import('../../src/domain/memory/ftsSearch.js');
      syncDbMemoriesToFts();

      // 删除前能搜到
      const before = ftsSearch('TypeScript', { userId: 'user1' });
      expect(before.length).toBeGreaterThanOrEqual(1);

      // 删除 m1
      deleteFromFts('m1', 'db');

      // 删除后搜不到
      const after = ftsSearch('TypeScript', { userId: 'user1' });
      expect(after).toEqual([]);
    });
  });

  // ---- 补充测试 ----

  describe('snippet 高亮标记', () => {
    it('搜索结果 snippet 包含高亮标记 << >>', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'lang', content: 'Python is a great programming language for data science', type: 'fact' },
      ]);

      const { syncDbMemoriesToFts, ftsSearch } = await import('../../src/domain/memory/ftsSearch.js');
      syncDbMemoriesToFts();

      const results = ftsSearch('Python', { userId: 'user1' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      // snippet 使用 << >> 作为高亮标记
      expect(results[0].snippet).toContain('<<');
      expect(results[0].snippet).toContain('>>');
    });
  });

  describe('scoreFloor 过滤低分结果', () => {
    it('scoreFloor=1.0 只保留最高分结果', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'exact', content: 'Python Python Python Python Python', type: 'fact' },
        { id: 'm2', user_id: 'user1', key: 'partial', content: 'Python is mentioned once', type: 'fact' },
      ]);

      const { syncDbMemoriesToFts, ftsSearch } = await import('../../src/domain/memory/ftsSearch.js');
      syncDbMemoriesToFts();

      // scoreFloor=1.0 表示只保留分数等于最高分的结果
      const results = ftsSearch('Python', { userId: 'user1', scoreFloor: 1.0 });
      // 至少应返回 1 条（最高分的那条）
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('scoreFloor=0 保留所有结果', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'exact', content: 'Python Python Python', type: 'fact' },
        { id: 'm2', user_id: 'user1', key: 'partial', content: 'Python is mentioned once', type: 'fact' },
      ]);

      const { syncDbMemoriesToFts, ftsSearch } = await import('../../src/domain/memory/ftsSearch.js');
      syncDbMemoriesToFts();

      const results = ftsSearch('Python', { userId: 'user1', scoreFloor: 0, limit: 10 });
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('limit 截断结果数量', () => {
    it('limit=1 只返回 1 条结果', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'a', content: 'Python programming language A', type: 'fact' },
        { id: 'm2', user_id: 'user1', key: 'b', content: 'Python programming language B', type: 'fact' },
        { id: 'm3', user_id: 'user1', key: 'c', content: 'Python programming language C', type: 'fact' },
      ]);

      const { syncDbMemoriesToFts, ftsSearch } = await import('../../src/domain/memory/ftsSearch.js');
      syncDbMemoriesToFts();

      const results = ftsSearch('Python', { userId: 'user1', limit: 1 });
      expect(results.length).toBe(1);
    });
  });

  describe('rebuildFtsIndex 重建索引', () => {
    it('重建后搜索结果不变', async () => {
      await setupDbWithMemories([
        { id: 'm1', user_id: 'user1', key: 'lang', content: 'Rust is a systems programming language', type: 'fact' },
      ]);

      const { syncDbMemoriesToFts, ftsSearch, rebuildFtsIndex } = await import('../../src/domain/memory/ftsSearch.js');
      syncDbMemoriesToFts();

      // 重建前能搜到
      const before = ftsSearch('Rust', { userId: 'user1' });
      expect(before.length).toBeGreaterThanOrEqual(1);

      // 重建索引
      const count = rebuildFtsIndex('user1');
      expect(count).toBe(1);

      // 重建后仍能搜到
      const after = ftsSearch('Rust', { userId: 'user1' });
      expect(after.length).toBeGreaterThanOrEqual(1);
      expect(after[0].id).toBe('m1');
    });
  });

  describe('空数据库搜索', () => {
    it('未插入任何记忆时搜索返回空结果', async () => {
      const { initDb } = await import('../../src/core/database/index.js');
      const { ftsSearch } = await import('../../src/domain/memory/ftsSearch.js');

      await initDb();

      const results = ftsSearch('anything', { userId: 'user1' });
      expect(results).toEqual([]);
    });
  });
});
