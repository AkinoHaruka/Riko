/**
 * 消息数据访问层。通过 JOIN conversations 表校验所有权，支持分页查询。
 * 注意：每次创建消息后更新会话的 updated_at 时间戳，确保会话列表按最新活动排序。
 */
import { getDb } from '../../core/database/index.js';
import { rowToDict } from '../../core/utils/index.js';
import { generateId } from '../../core/utils/id.js';
import type { Message, CreateMessageRequest } from './types.js';

export function verifyConversationOwnership(conversationId: string, userId: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId) as { id: string } | undefined;
  return row !== undefined;
}

export function create(data: CreateMessageRequest): Message {
  const db = getDb();
  const id = generateId('messages');
  const reasoningContent = data.reasoning_content ?? '';
  const isCompactSummary = data.is_compact_summary ? 1 : 0;
  const compactMetadata = data.compact_metadata ?? null;

  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, reasoning_content, is_compact_summary, compact_metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).run(
    id,
    data.conversation_id,
    data.role,
    data.content,
    reasoningContent,
    isCompactSummary,
    compactMetadata,
  );

  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown>;

  return rowToDict(row);
}

export function updateConversationTimestamp(conversationId: string): void {
  const db = getDb();
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    conversationId,
  );
}

export function listByConversation(conversationId: string, userId: string): Message[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.* FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE m.conversation_id = ? AND c.user_id = ?
     ORDER BY m.created_at ASC`,
    )
    .all(conversationId, userId) as Record<string, unknown>[];

  return rows.map(rowToDict<Message>);
}

export function listByConversationPaginated(
  conversationId: string,
  userId: string,
  limit: number,
  offset: number,
): { messages: Message[]; total: number } {
  const db = getDb();

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE m.conversation_id = ? AND c.user_id = ?`,
    )
    .get(conversationId, userId) as { total: number };

  const rows = db
    .prepare(
      `SELECT m.* FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE m.conversation_id = ? AND c.user_id = ?
     ORDER BY m.created_at ASC
     LIMIT ? OFFSET ?`,
    )
    .all(conversationId, userId, limit, offset) as Record<string, unknown>[];

  return {
    messages: rows.map((row) => rowToDict<Message>(row)),
    total: totalRow.total,
  };
}

export function findById(id: string, userId: string): Message | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.* FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE m.id = ? AND c.user_id = ?`,
    )
    .get(id, userId) as Record<string, unknown> | undefined;

  if (!row) return null;
  return rowToDict<Message>(row);
}

export function findMessageWithConversationId(
  id: string,
  userId: string,
): { message: Message; conversation_id: string } | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.* FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE m.id = ? AND c.user_id = ?`,
    )
    .get(id, userId) as Record<string, unknown> | undefined;

  if (!row) return null;
  const message = rowToDict<Message>(row);
  return { message, conversation_id: row.conversation_id as string };
}

export function update(
  id: string,
  fields: Partial<Pick<Message, 'content' | 'reasoning_content'>>,
): void {
  const db = getDb();
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (fields.content !== undefined && fields.content !== null) {
    setClauses.push('content = ?');
    params.push(fields.content);
  }
  if (fields.reasoning_content !== undefined && fields.reasoning_content !== null) {
    setClauses.push('reasoning_content = ?');
    params.push(fields.reasoning_content);
  }

  if (setClauses.length === 0) return;

  params.push(id);
  db.prepare(`UPDATE messages SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteById(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
}

export function deleteByConversationId(conversationId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  return result.changes;
}
