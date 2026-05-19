import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDb, closeDb, getDb } from '../../src/core/database/index.js';
import { generateId } from '../../src/core/utils/id.js';
import {
  createMessage,
  listMessages,
  updateMessage,
  deleteMessage,
  batchDeleteMessages,
} from '../../src/domain/message/index.js';
import { eventManager } from '../../src/core/events/index.js';

function createTestUser(username = 'testuser'): string {
  const db = getDb();
  const id = generateId('users');
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(id, username, 'testhash');
  return id;
}

function createTestConversation(userId: string, title = 'test'): string {
  const db = getDb();
  const id = generateId('conversations');
  db.prepare(
    'INSERT INTO conversations (id, user_id, title, is_archived, created_at, updated_at) VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
  ).run(id, userId, title);
  return id;
}

describe('Message 领域', () => {
  let userId: string;
  let conversationId: string;

  beforeEach(async () => {
    closeDb();
    await initDb();
    userId = createTestUser();
    conversationId = createTestConversation(userId);
  });

  afterEach(() => {
    closeDb();
  });

  it('createMessage() 创建消息并更新会话时间戳', () => {
    const db = getDb();
    db.prepare("UPDATE conversations SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(conversationId);

    const msg = createMessage(userId, {
      conversation_id: conversationId,
      role: 'user',
      content: 'hello',
    });

    expect(msg.content).toBe('hello');
    expect(msg.role).toBe('user');
    expect(msg.conversation_id).toBe(conversationId);

    const conv = db.prepare('SELECT updated_at FROM conversations WHERE id = ?').get(conversationId) as {
      updated_at: string;
    };
    expect(conv.updated_at).not.toBe('2020-01-01 00:00:00');
  });

  it('createMessage() 不存在的会话抛出"不存在或无权限"', () => {
    expect(() =>
      createMessage(userId, {
        conversation_id: 'nonexistent-id',
        role: 'user',
        content: 'hello',
      }),
    ).toThrow('会话不存在或无权限');
  });

  it('listMessages() 不分页返回数组', () => {
    createMessage(userId, { conversation_id: conversationId, role: 'user', content: 'a' });
    createMessage(userId, { conversation_id: conversationId, role: 'assistant', content: 'b' });

    const result = listMessages(userId, conversationId);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('listMessages() 分页返回 {messages, total, limit, offset}', () => {
    createMessage(userId, { conversation_id: conversationId, role: 'user', content: 'a' });
    createMessage(userId, { conversation_id: conversationId, role: 'assistant', content: 'b' });
    createMessage(userId, { conversation_id: conversationId, role: 'user', content: 'c' });

    const result = listMessages(userId, conversationId, 2, 0) as {
      messages: unknown[];
      total: number;
      limit: number;
      offset: number;
    };
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('total');
    expect(result.limit).toBe(2);
    expect(result.offset).toBe(0);
    expect(result.total).toBe(3);
    expect(result.messages).toHaveLength(2);
  });

  it('updateMessage() 更新内容', () => {
    const msg = createMessage(userId, { conversation_id: conversationId, role: 'user', content: 'old' });

    updateMessage(userId, msg.id, { content: 'new' });

    const db = getDb();
    const updated = db.prepare('SELECT content FROM messages WHERE id = ?').get(msg.id) as { content: string };
    expect(updated.content).toBe('new');
  });

  it('updateMessage() skip_broadcast=true 跳过事件广播', () => {
    const msg = createMessage(userId, { conversation_id: conversationId, role: 'user', content: 'hello' });

    const broadcastSpy = vi.spyOn(eventManager, 'broadcast');

    updateMessage(userId, msg.id, { content: 'updated' }, true);

    expect(broadcastSpy).not.toHaveBeenCalled();
    broadcastSpy.mockRestore();
  });

  it('deleteMessage() 删除单条消息', () => {
    const msg = createMessage(userId, { conversation_id: conversationId, role: 'user', content: 'hello' });

    deleteMessage(userId, msg.id);

    const db = getDb();
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
    expect(row).toBeUndefined();
  });

  it('batchDeleteMessages() 删除会话下所有消息', () => {
    createMessage(userId, { conversation_id: conversationId, role: 'user', content: 'a' });
    createMessage(userId, { conversation_id: conversationId, role: 'assistant', content: 'b' });

    const result = batchDeleteMessages(userId, conversationId);
    expect(result.deleted_count).toBe(2);

    const db = getDb();
    const msgs = db.prepare('SELECT * FROM messages WHERE conversation_id = ?').all(conversationId);
    expect(msgs).toHaveLength(0);
  });
});
