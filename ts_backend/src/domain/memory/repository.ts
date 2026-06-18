/**
 * 记忆数据访问层。
 * 封装 memories 表的 CRUD 操作，支持按关键词搜索和按来源删除。
 * 创建/删除时自动同步 FTS5 全文搜索索引。
 * @security 所有操作均通过 user_id 过滤，确保用户间数据隔离。
 */
import { getDb } from '../../core/database/index.js';
import type { Memory, MemoryCreateRequest } from './types.js';
import { rowToDict } from '../../core/utils/index.js';
import { generateId } from '../../core/utils/id.js';
import { syncDbMemoriesToFts, deleteFromFts } from './ftsSearch.js';

/**
 * 查询用户的所有记忆，支持按类型过滤。
 * @param userId - 用户 ID
 * @param type - 记忆类型（可选）
 * @param limit - 返回数量上限，默认 500
 * @returns 记忆列表
 */
export function findAll(userId: string, type?: string, limit = 500): Memory[] {
  const db = getDb();
  if (type) {
    const rows = db
      .prepare('SELECT * FROM memories WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, type, limit) as Record<string, unknown>[];
    return rows.map((row) => rowToDict<Memory>(row));
  }
  const rows = db
    .prepare('SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as Record<string, unknown>[];
  return rows.map((row) => rowToDict<Memory>(row));
}

/**
 * 按关键词搜索记忆，匹配 key 或 content 字段。
 * @security 仅搜索当前用户的记忆。
 * @param keyword - 搜索关键词
 * @param userId - 用户 ID
 * @param limit - 返回数量上限
 * @returns 匹配的记忆列表
 */
export function search(keyword: string, userId: string, limit = 500): Memory[] {
  const db = getDb();
  const escaped = keyword.replace(/([%_])/g, '\\$1');
  const likePattern = `%${escaped}%`;
  const rows = db
    .prepare(
      "SELECT * FROM memories WHERE user_id = ? AND (key LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT ?",
    )
    .all(userId, likePattern, likePattern, limit) as Record<string, unknown>[];
  return rows.map((row) => rowToDict<Memory>(row));
}

/**
 * 创建新记忆。若同 user_id + key 已存在则先删除旧记录（upsert 语义）。
 * @security DELETE + INSERT 操作用事务包裹，防止并发竞态导致数据丢失。
 * @param data - 创建请求数据
 * @returns 创建后的记忆对象
 */
export function create(data: MemoryCreateRequest): Memory {
  const db = getDb();
  const id = generateId('memories');
  const source = data.source ?? '';
  const type = data.type ?? 'fact';
  const userId = data.user_id ?? '';

  // 用事务包裹 DELETE + INSERT，确保 upsert 原子性
  // 防止并发请求在 DELETE 和 INSERT 之间交错导致数据丢失或重复
  const upsertTxn = db.transaction(() => {
    db.prepare('DELETE FROM memories WHERE user_id = ? AND key = ?').run(userId, data.key);
    db.prepare('INSERT INTO memories (id, user_id, key, content, source, type) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      userId,
      data.key,
      data.content,
      source,
      type,
    );
  });
  upsertTxn();

  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown>;

  // 同步到 FTS 索引（失败不影响主流程）
  try {
    syncDbMemoriesToFts(userId);
  } catch {
    // FTS 索引同步失败时静默降级，不影响记忆创建
  }

  return rowToDict<Memory>(row);
}

/**
 * 按 ID 和用户 ID 查找记忆。
 * @param id - 记忆 ID
 * @param userId - 用户 ID
 * @returns 记忆对象，未找到返回 null
 */
export function findById(id: string, userId: string): Memory | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM memories WHERE id = ? AND user_id = ?').get(id, userId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return rowToDict<Memory>(row);
}

/**
 * 按 ID 和用户 ID 删除记忆。
 * @param id - 记忆 ID
 * @param userId - 用户 ID
 * @returns 是否成功删除
 */
export function deleteById(id: string, userId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').run(id, userId);
  if (result.changes > 0) {
    try {
      deleteFromFts(id, 'db');
    } catch {
      // FTS 索引删除失败时静默降级
    }
  }
  return result.changes > 0;
}

/**
 * 按来源删除用户的所有记忆。
 * @param source - 记忆来源标识
 * @param userId - 用户 ID
 * @returns 删除的记录数
 */
export function deleteBySource(source: string, userId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM memories WHERE source = ? AND user_id = ?').run(source, userId);
  return result.changes;
}

/**
 * 清空用户的所有记忆。
 * @param userId - 用户 ID
 * @returns 删除的记录数
 */
export function clearAll(userId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM memories WHERE user_id = ?').run(userId);
  return result.changes;
}
