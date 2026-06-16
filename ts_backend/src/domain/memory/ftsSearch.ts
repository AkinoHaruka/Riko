/**
 * FTS5 全文搜索服务
 *
 * 为 Riko 的记忆系统提供高质量的全文搜索能力。
 * 同时索引数据库中的 memories 表和文件系统中的 auto_dream/ .md 文件。
 *
 * 核心设计（移植自 MiMo-Code）：
 * - FTS5 外部内容虚拟表 + 触发器自动同步
 * - OR 连接 + BM25 排序 + 相对分数底线
 * - snippet() 高亮摘要
 * - 过取 3x + 底线过滤 + 截断 limit
 *
 * @module domain/memory/ftsSearch
 */

import { getDb } from '../../core/database/index.js';
import { buildFtsQuery } from './ftsQuery.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('FtsSearch');

/** FTS5 搜索结果 */
export interface FtsSearchResult {
  /** 记忆 ID（数据库记录）或文件路径（.md 文件） */
  id: string;
  /** 数据来源：db = 数据库 memories 表，file = auto_dream .md 文件 */
  source: 'db' | 'file';
  /** 记忆类型 */
  type: string;
  /** 匹配的内容摘要（高亮标记） */
  snippet: string;
  /** BM25 相关性分数（越大越相关） */
  score: number;
  /** 记忆 key（仅 db 来源） */
  key?: string;
  /** 完整内容（仅 db 来源） */
  content?: string;
}

/** 搜索选项 */
export interface FtsSearchOptions {
  /** 返回数量上限，默认 10 */
  limit?: number;
  /** 相对分数底线比例，默认 0.15（即保留分数 >= 最高分 * 0.15 的结果） */
  scoreFloor?: number;
  /** 按类型过滤 */
  type?: string;
  /** 按用户过滤 */
  userId?: string;
}

// ── FTS5 表初始化 ─────────────────────────────────────────────────

/** FTS5 是否已初始化的标志 */
let ftsInitialized = false;

/** 查询 FTS5 是否已初始化 */
export function isFtsInitialized(): boolean {
  return ftsInitialized;
}

/**
 * 初始化 FTS5 虚拟表和触发器。
 * 使用外部内容模式，FTS5 只存倒排索引，不存 body 副本。
 * 幂等操作，重复调用安全。
 */
export function initializeFts(): void {
  if (ftsInitialized) return;

  const db = getDb();

  // 内容表：统一存储数据库记忆和文件记忆的索引
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_fts_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'db',
      user_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'fact',
      key TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      fingerprint TEXT NOT NULL DEFAULT '',
      UNIQUE(memory_id, source)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_fts_content_user ON memory_fts_content (user_id);
    CREATE INDEX IF NOT EXISTS idx_fts_content_type ON memory_fts_content (type);
  `);

  // FTS5 外部内容虚拟表
  // tokenize='unicode61 remove_diacritics 1' 确保 CJK 和变音符号支持
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts_idx USING fts5(
      body,
      content='memory_fts_content',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 1'
    )
  `);

  // 触发器：插入时同步到 FTS 索引
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_ai AFTER INSERT ON memory_fts_content BEGIN
      INSERT INTO memory_fts_idx(rowid, body) VALUES (NEW.id, NEW.body);
    END
  `);

  // 触发器：删除时使用 'delete' 魔术命令同步（外部内容模式必须如此）
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_ad AFTER DELETE ON memory_fts_content BEGIN
      INSERT INTO memory_fts_idx(memory_fts_idx, rowid, body) VALUES('delete', OLD.id, OLD.body);
    END
  `);

  // 触发器：更新时先删后插
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_au AFTER UPDATE ON memory_fts_content BEGIN
      INSERT INTO memory_fts_idx(memory_fts_idx, rowid, body) VALUES('delete', OLD.id, OLD.body);
      INSERT INTO memory_fts_idx(rowid, body) VALUES (NEW.id, NEW.body);
    END
  `);

  ftsInitialized = true;
  logger.info('FTS5 全文搜索索引已初始化');
}

// ── 索引管理 ──────────────────────────────────────────────────────

/**
 * 将数据库 memories 表的记录同步到 FTS 索引。
 * 使用 UPSERT 语义，已索引的记录会更新。
 *
 * @param userId - 用户 ID，为空时同步所有用户
 */
export function syncDbMemoriesToFts(userId?: string): number {
  initializeFts();
  const db = getDb();

  // 查出未索引或指纹变化的 memories
  const query = userId
    ? 'SELECT id, user_id, key, content, type FROM memories WHERE user_id = ?'
    : 'SELECT id, user_id, key, content, type FROM memories';
  const params = userId ? [userId] : [];
  const memories = db.prepare(query).all(...params) as Array<{
    id: string; user_id: string; key: string; content: string; type: string;
  }>;

  const upsert = db.prepare(`
    INSERT INTO memory_fts_content (memory_id, source, user_id, type, key, body, fingerprint)
    VALUES (?, 'db', ?, ?, ?, ?, ?)
    ON CONFLICT(memory_id, source) DO UPDATE SET
      user_id = excluded.user_id,
      type = excluded.type,
      key = excluded.key,
      body = excluded.body,
      fingerprint = excluded.fingerprint
  `);

  let count = 0;
  const transaction = db.transaction(() => {
    for (const mem of memories) {
      // 指纹：内容长度 + 内容前 100 字符的哈希（简化版，避免 crypto 开销）
      const fingerprint = `${mem.content.length}-${mem.content.slice(0, 100)}`;
      upsert.run(mem.id, mem.user_id, mem.type, mem.key, mem.content, fingerprint);
      count++;
    }
  });
  transaction();

  logger.info('同步 %d 条数据库记忆到 FTS 索引', count);
  return count;
}

/**
 * 将文件内容同步到 FTS 索引。
 *
 * @param memoryId - 唯一标识符（通常为文件路径）
 * @param userId - 用户 ID
 * @param type - 记忆类型
 * @param body - 文件内容
 * @param fingerprint - 文件指纹（如 "大小-mtimeMs"）
 */
export function syncFileToFts(
  memoryId: string,
  userId: string,
  type: string,
  body: string,
  fingerprint: string,
): void {
  initializeFts();
  const db = getDb();

  db.prepare(`
    INSERT INTO memory_fts_content (memory_id, source, user_id, type, key, body, fingerprint)
    VALUES (?, 'file', ?, ?, '', ?, ?)
    ON CONFLICT(memory_id, source) DO UPDATE SET
      user_id = excluded.user_id,
      type = excluded.type,
      body = excluded.body,
      fingerprint = excluded.fingerprint
  `).run(memoryId, userId, type, body, fingerprint);
}

/**
 * 从 FTS 索引中删除指定记录。
 *
 * @param memoryId - 记忆 ID
 * @param source - 数据来源
 */
export function deleteFromFts(memoryId: string, source: 'db' | 'file'): void {
  initializeFts();
  const db = getDb();
  db.prepare('DELETE FROM memory_fts_content WHERE memory_id = ? AND source = ?').run(memoryId, source);
}

// ── 搜索 ──────────────────────────────────────────────────────────

/**
 * 执行 FTS5 全文搜索。
 *
 * 搜索流程：
 * 1. 将查询文本转为 FTS5 MATCH 表达式
 * 2. 过取 3x 条结果
 * 3. 应用相对分数底线过滤
 * 4. 截断到 limit 条
 *
 * @param query - 搜索文本
 * @param options - 搜索选项
 * @returns 搜索结果列表
 */
export function ftsSearch(query: string, options: FtsSearchOptions = {}): FtsSearchResult[] {
  initializeFts();
  const db = getDb();

  const limit = options.limit ?? 10;
  const scoreFloor = options.scoreFloor ?? 0.15;

  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  // 过取 3x 条，经分数底线过滤后再截断
  const overfetchLimit = Math.min(limit * 3, 50);

  // 构建过滤条件
  const conditions: string[] = [];
  const params: unknown[] = [ftsQuery];

  if (options.userId) {
    conditions.push('c.user_id = ?');
    params.push(options.userId);
  }
  if (options.type) {
    conditions.push('c.type = ?');
    params.push(options.type);
  }

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT c.memory_id, c.source, c.type, c.key, c.body,
           snippet(memory_fts_idx, 0, '<<', '>>', '...', 32) AS snippet,
           -bm25(memory_fts_idx) AS score
    FROM memory_fts_idx
    JOIN memory_fts_content c ON c.id = memory_fts_idx.rowid
    WHERE memory_fts_idx MATCH ?
    ${whereClause}
    ORDER BY score
    LIMIT ?
  `;

  params.push(overfetchLimit);

  const rows = db.prepare(sql).all(...params) as Array<{
    memory_id: string;
    source: string;
    type: string;
    key: string;
    body: string;
    snippet: string;
    score: number;
  }>;

  if (rows.length === 0) return [];

  // 相对分数底线：保留分数 >= 最高分 * floorRatio 的结果，第 1 名始终保留
  const topScore = rows[0].score;
  const minScore = topScore * scoreFloor;

  const filtered = rows.filter((r) => r.score >= minScore);
  const results = filtered.slice(0, limit);

  return results.map((r) => ({
    id: r.memory_id,
    source: r.source as 'db' | 'file',
    type: r.type,
    snippet: r.snippet,
    score: r.score,
    key: r.source === 'db' ? r.key : undefined,
    content: r.source === 'db' ? r.body : undefined,
  }));
}

/**
 * 重建整个 FTS 索引（删除并重新创建）。
 * 适用于索引损坏或大规模数据变更后的修复。
 *
 * @param userId - 用户 ID，为空时重建所有用户的索引
 */
export function rebuildFtsIndex(userId?: string): number {
  const db = getDb();

  // 清空旧索引
  if (userId) {
    db.prepare('DELETE FROM memory_fts_content WHERE user_id = ?').run(userId);
  } else {
    db.prepare('DELETE FROM memory_fts_content').run();
  }

  // 重新同步
  ftsInitialized = true; // 防止 initializeFts 重复建表
  return syncDbMemoriesToFts(userId);
}
