/**
 * 对话数据访问层。
 * 封装 conversations 表的 CRUD 操作，含级联删除。
 * @security 所有查询和修改操作均通过 user_id 过滤，确保数据隔离。
 */
import { getDb } from '../../core/database/index.js';
import { rowToDict } from '../../core/utils/index.js';
import { generateId } from '../../core/utils/id.js';
import type { Conversation } from './types.js';

/**
 * 按 ID 和用户 ID 查找对话。
 * @security 通过 user_id 过滤确保用户只能访问自己的对话。
 * @param id - 对话 ID
 * @param userId - 用户 ID
 * @returns 对话对象，未找到返回 null
 */
export function findById(id: string, userId: string): Conversation | null {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT id, user_id, title, is_archived, background, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?',
    )
    .get(id, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToDict<Conversation>(row);
}

/**
 * 按用户 ID 查找所有对话，按更新时间倒序排列。
 * @param userId - 用户 ID
 * @param limit - 返回数量上限，默认 200
 * @returns 对话列表
 */
export function findByUserId(userId: string, limit = 200): Conversation[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT id, user_id, title, is_archived, background, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?',
    )
    .all(userId, limit) as Record<string, unknown>[];
  return rows.map((row) => rowToDict<Conversation>(row));
}

/**
 * 创建新对话。
 * @param userId - 用户 ID
 * @param title - 对话标题
 * @returns 创建后的对话对象
 */
export function create(userId: string, title: string): Conversation {
  const db = getDb();
  const id = generateId('conversations');
  db.prepare(
    'INSERT INTO conversations (id, user_id, title, is_archived, created_at, updated_at) VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
  ).run(id, userId, title);

  const row = db
    .prepare(
      'SELECT id, user_id, title, is_archived, background, created_at, updated_at FROM conversations WHERE id = ?',
    )
    .get(id) as Record<string, unknown>;

  return rowToDict<Conversation>(row);
}

/**
 * 更新对话的指定字段。
 * @security 先验证对话属于当前用户，再执行更新。
 * @param id - 对话 ID
 * @param userId - 用户 ID
 * @param fields - 待更新的字段
 * @returns 更新后的对话对象，对话不存在或不属于当前用户时返回 null
 */
export function update(
  id: string,
  userId: string,
  fields: Partial<Pick<Conversation, 'title' | 'is_archived' | 'background'>>,
): Conversation | null {
  const db = getDb();

  const existing = db
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(id, userId) as { id: string } | undefined;

  if (!existing) return null;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (fields.title !== undefined && fields.title !== null) {
    updates.push('title = ?');
    params.push(fields.title);
  }
  if (fields.is_archived !== undefined && fields.is_archived !== null) {
    updates.push('is_archived = ?');
    params.push(fields.is_archived);
  }
  if (fields.background !== undefined) {
    updates.push('background = ?');
    params.push(fields.background);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');

  params.push(id);
  params.push(userId);

  db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(
    ...params,
  );

  const row = db
    .prepare(
      'SELECT id, user_id, title, is_archived, background, created_at, updated_at FROM conversations WHERE id = ?',
    )
    .get(id) as Record<string, unknown>;

  return rowToDict<Conversation>(row);
}

/**
 * 级联删除对话及其关联的所有消息、会话笔记状态和监控记录。
 * @security 先验证对话属于当前用户，再在事务中执行级联删除。
 * @param id - 对话 ID
 * @param userId - 用户 ID
 * @returns 是否成功删除
 */
export function deleteWithMessages(id: string, userId: string): boolean {
  const db = getDb();

  const existing = db
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(id, userId) as { id: string } | undefined;

  if (!existing) return false;

  // 事务性级联删除：先删除关联数据，再删除对话本身
  const deleteTransaction = db.transaction(() => {
    db.prepare('DELETE FROM session_notes_state WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM api_monitor_records WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(id, userId);
  });

  deleteTransaction();
  return true;
}
