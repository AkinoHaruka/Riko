/**
 * 设置数据访问层。支持单 key 和批量 key 查询，以及 upsert（插入或更新）操作。
 */
import { getDb } from '../../core/database/index.js';
import { rowToDict } from '../../core/utils/index.js';
import { generateId } from '../../core/utils/id.js';
import type { Setting } from './types.js';

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

export function findAllByUserId(userId: string): Setting[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT id, user_id, key, value, is_encrypted, created_at, updated_at FROM settings WHERE user_id = ?',
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map(rowToDict<Setting>);
}

export function upsert(userId: string, key: string, value: string, isEncrypted: number): void {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM settings WHERE user_id = ? AND key = ?')
    .get(userId, key) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE settings SET value = ?, is_encrypted = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND key = ?',
    ).run(value, isEncrypted, userId, key);
  } else {
    const id = generateId('settings');
    db.prepare(
      'INSERT INTO settings (id, user_id, key, value, is_encrypted) VALUES (?, ?, ?, ?, ?)',
    ).run(id, userId, key, value, isEncrypted);
  }
}

export function deleteByKey(userId: string, key: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM settings WHERE user_id = ? AND key = ?').run(userId, key);
  return result.changes > 0;
}
