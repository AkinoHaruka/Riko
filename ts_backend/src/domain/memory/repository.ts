/**
 * 记忆数据访问层。封装 memories 表的 CRUD，支持关键字模糊搜索和按来源批量删除。
 */
import { getDb } from '../../core/database/index.js';
import type { Memory, MemoryCreateRequest } from './types.js';
import { rowToDict } from '../../core/utils/index.js';
import { generateId } from '../../core/utils/id.js';

export function findAll(type?: string, limit = 500): Memory[] {
  const db = getDb();
  if (type) {
    const rows = db
      .prepare('SELECT * FROM memories WHERE type = ? ORDER BY created_at DESC LIMIT ?')
      .all(type, limit) as Record<string, unknown>[];
    return rows.map((row) => rowToDict<Memory>(row));
  }
  const rows = db
    .prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
  return rows.map((row) => rowToDict<Memory>(row));
}

export function search(keyword: string, limit = 500): Memory[] {
  const db = getDb();
  const escaped = keyword.replace(/([%_])/g, '\\$1');
  const likePattern = `%${escaped}%`;
  const rows = db
    .prepare(
      "SELECT * FROM memories WHERE key LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?",
    )
    .all(likePattern, likePattern, limit) as Record<string, unknown>[];
  return rows.map((row) => rowToDict<Memory>(row));
}

export function create(data: MemoryCreateRequest): Memory {
  const db = getDb();
  const id = generateId('memories');
  const source = data.source ?? '';
  const type = data.type ?? 'fact';

  db.prepare('INSERT INTO memories (id, key, content, source, type) VALUES (?, ?, ?, ?, ?)').run(
    id,
    data.key,
    data.content,
    source,
    type,
  );

  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown>;

  return rowToDict<Memory>(row);
}

export function findById(id: string): Memory | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return rowToDict<Memory>(row);
}

export function deleteById(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  return result.changes > 0;
}

export function deleteBySource(source: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM memories WHERE source = ?').run(source);
  return result.changes;
}

export function clearAll(): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM memories').run();
  return result.changes;
}
