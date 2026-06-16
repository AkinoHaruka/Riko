/**
 * 设置数据访问层。支持单 key 和批量 key 查询，以及 upsert（插入或更新）操作。
 * @security 所有查询均通过 user_id 过滤，确保数据隔离。
 */
import { getDb } from '../../core/database/index.js';
import { rowToDict } from '../../core/utils/index.js';
import { generateId } from '../../core/utils/id.js';
import type { Setting } from './types.js';

/**
 * @security 按 user_id + key 查询单条设置，自动过滤其他用户的数据。
 * @returns 设置对象或 null
 */
export function findByKey(userId: string, key: string): Setting | null {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT id, user_id, key, value, is_encrypted, created_at, updated_at FROM settings WHERE user_id = ? AND key = ?',
    )
    .get(userId, key) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToDict<Setting>(row);
}

/**
 * 批量查询多个 key 的设置值。使用 IN 子句一次查询，比逐个查询更高效。
 * @security WHERE 条件包含 user_id，确保数据隔离。
 * @returns key → Setting 的映射
 */
export function findByKeys(userId: string, keys: string[]): Map<string, Setting> {
  if (keys.length === 0) return new Map();
  const db = getDb();
  const placeholders = keys.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, user_id, key, value, is_encrypted, created_at, updated_at FROM settings WHERE user_id = ? AND key IN (${placeholders})`,
    )
    .all(userId, ...keys) as Record<string, unknown>[];
  const map = new Map<string, Setting>();
  for (const row of rows) {
    const setting = rowToDict<Setting>(row);
    map.set(setting.key, setting);
  }
  return map;
}

/** 查询用户的所有设置项 */
export function findAllByUserId(userId: string): Setting[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT id, user_id, key, value, is_encrypted, created_at, updated_at FROM settings WHERE user_id = ?',
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map(rowToDict<Setting>);
}

/**
 * 插入或更新设置项。使用 SQLite UPSERT 保证原子性，避免 SELECT + INSERT/UPDATE 的竞态问题。
 * @security user_id 作为联合唯一键的一部分，确保用户只能操作自己的设置。
 */
export function upsert(userId: string, key: string, value: string, isEncrypted: number): void {
  const db = getDb();
  // 使用 SQLite UPSERT 保证原子性，避免 SELECT + INSERT/UPDATE 的竞态问题
  const id = generateId('settings');
  db.prepare(
    `INSERT INTO settings (id, user_id, key, value, is_encrypted)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET
       value = excluded.value,
       is_encrypted = excluded.is_encrypted,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(id, userId, key, value, isEncrypted);
}

/**
 * @security 按 user_id + key 删除设置项，确保只能删除自己的设置。
 * @returns 是否有记录被删除
 */
export function deleteByKey(userId: string, key: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM settings WHERE user_id = ? AND key = ?').run(userId, key);
  return result.changes > 0;
}
