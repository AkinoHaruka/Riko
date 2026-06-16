/**
 * 消息数据访问层。通过 JOIN conversations 表校验所有权，支持分页查询。
 * 注意：每次创建消息后更新会话的 updated_at 时间戳，确保会话列表按最新活动排序。
 */
import { getDb } from '../../core/database/index.js';
import { rowToDict } from '../../core/utils/index.js';
import { generateId } from '../../core/utils/id.js';
import type { Message, CreateMessageRequest } from './types.js';

/**
 * @security 验证会话是否属于指定用户，防止越权访问他人消息。
 * @param conversationId 会话 ID
 * @param userId 用户 ID
 * @returns true=拥有所有权，false=无权限或会话不存在
 */
export function verifyConversationOwnership(conversationId: string, userId: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId) as { id: string } | undefined;
  return row !== undefined;
}

/** 创建消息并返回完整记录 */
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

/** 更新会话的 updated_at 时间戳，确保会话列表按最新活动排序 */
export function updateConversationTimestamp(conversationId: string): void {
  const db = getDb();
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    conversationId,
  );
}

/**
 * @security 通过 JOIN conversations 校验 user_id，确保只能查询自己会话下的消息。
 * @param conversationId 会话 ID
 * @param userId 用户 ID
 * @returns 按创建时间升序排列的消息列表
 */
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

/**
 * @security 分页查询会话消息，通过 JOIN conversations 校验 user_id。
 * @param conversationId 会话 ID
 * @param userId 用户 ID
 * @param limit 每页数量
 * @param offset 偏移量
 * @returns 包含消息列表和总数的分页结果
 */
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

/**
 * @security 通过 JOIN conversations 校验 user_id，确保只能查询自己的消息。
 * @param id 消息 ID
 * @param userId 用户 ID
 * @returns 消息对象或 null
 */
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

/**
 * 查找消息并返回其所属会话 ID。用于 service 层在删除/更新时获取 conversation_id 以广播事件。
 * @security 通过 JOIN conversations 校验 user_id。
 */
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

/**
 * 更新消息的 content 和/或 reasoning_content 字段。
 * @security 若提供 userId，先校验消息所有权再执行更新；无权限时静默返回（与 service 层 404 配合）。
 */
export function update(
  id: string,
  fields: Partial<Pick<Message, 'content' | 'reasoning_content'>>,
  userId?: string,
): void {
  const db = getDb();

  // 如果提供了 userId，通过 JOIN conversations 验证消息所有权
  if (userId) {
    const owned = db
      .prepare(
        `SELECT 1 FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE m.id = ? AND c.user_id = ?`,
      )
      .get(id, userId);
    if (!owned) return; // 无权限则静默返回，与 service 层 404 逻辑配合
  }

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

/**
 * 删除指定消息。
 * @security 若提供 userId，先校验消息所有权再执行删除；无权限时静默返回。
 */
export function deleteById(id: string, userId?: string): void {
  const db = getDb();

  // 如果提供了 userId，通过 JOIN conversations 验证消息所有权
  if (userId) {
    const owned = db
      .prepare(
        `SELECT 1 FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE m.id = ? AND c.user_id = ?`,
      )
      .get(id, userId);
    if (!owned) return; // 无权限则静默返回
  }

  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
}

/**
 * 删除指定会话下的所有消息。用于级联删除会话时调用，无需 user_id 校验（由调用方保证权限）。
 * @param conversationId 会话 ID
 * @returns 删除的行数
 */
export function deleteByConversationId(conversationId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  return result.changes;
}
