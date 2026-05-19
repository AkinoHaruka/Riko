import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getDb } from '../../src/core/database/index.js';
import { generateId } from '../../src/core/utils/id.js';
import {
  createConversation,
  listConversations,
  updateConversation,
  deleteConversation,
} from '../../src/domain/conversation/index.js';

function createTestUser(username = 'testuser'): string {
  const db = getDb();
  const id = generateId('users');
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(id, username, 'testhash');
  return id;
}

describe('Conversation 领域', () => {
  let userId: string;

  beforeEach(async () => {
    closeDb();
    await initDb();
    userId = createTestUser();
  });

  afterEach(() => {
    closeDb();
  });

  it('createConversation() 创建会话并修剪标题', () => {
    const conv = createConversation(userId, '  hello  ');
    expect(conv.title).toBe('hello');
    expect(conv.user_id).toBe(userId);
    expect(conv.id).toBeTypeOf('string');
  });

  it('createConversation() 空标题抛出错误', () => {
    expect(() => createConversation(userId, '   ')).toThrow('会话标题不能为空');
  });

  it('listConversations() 按 updated_at DESC 排序返回会话列表', () => {
    const conv1 = createConversation(userId, 'first');
    const conv2 = createConversation(userId, 'second');

    const db = getDb();
    db.prepare("UPDATE conversations SET updated_at = '2024-01-01 00:00:00' WHERE id = ?").run(conv1.id);
    db.prepare("UPDATE conversations SET updated_at = '2024-01-02 00:00:00' WHERE id = ?").run(conv2.id);

    const list = listConversations(userId);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(conv2.id);
    expect(list[1].id).toBe(conv1.id);
  });

  it('updateConversation() 更新标题', () => {
    const conv = createConversation(userId, 'old title');
    const updated = updateConversation(conv.id, userId, { title: 'new title' });
    expect(updated.title).toBe('new title');
  });

  it('updateConversation() 更新 is_archived', () => {
    const conv = createConversation(userId, 'title');
    const updated = updateConversation(conv.id, userId, { is_archived: 1 });
    expect(updated.is_archived).toBe(1);
  });

  it('updateConversation() 未提供字段抛出错误', () => {
    const conv = createConversation(userId, 'title');
    expect(() => updateConversation(conv.id, userId, {})).toThrow('请提供需要更新的字段');
  });

  it('updateConversation() 不存在的会话抛出"不存在或无权访问"', () => {
    expect(() => updateConversation('nonexistent-id', userId, { title: 'x' })).toThrow('会话不存在或无权访问');
  });

  it('deleteConversation() 原子删除会话及其消息', () => {
    const conv = createConversation(userId, 'title');
    const db = getDb();
    db.prepare('INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)')
      .run(generateId('messages'), conv.id, 'user', 'hello');

    deleteConversation(conv.id, userId);

    const convRow = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id);
    const msgs = db.prepare('SELECT * FROM messages WHERE conversation_id = ?').all(conv.id);
    expect(convRow).toBeUndefined();
    expect(msgs).toHaveLength(0);
  });

  it('deleteConversation() 不存在的会话抛出错误', () => {
    expect(() => deleteConversation('nonexistent-id', userId)).toThrow('会话不存在或无权访问');
  });
});
