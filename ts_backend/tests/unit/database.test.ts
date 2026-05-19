import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_DIR = path.join(os.tmpdir(), 'ts-backend-test-db');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

describe('数据库连接层', () => {
  let db: Database.Database;

  beforeAll(() => {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    db = new Database(TEST_DB_PATH);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
  });

  afterAll(() => {
    db.close();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('应正确创建 users 表', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    const columns = db.pragma('table_info(users)') as Array<{ name: string }>;
    const names = columns.map(c => c.name);
    expect(names).toContain('id');
    expect(names).toContain('username');
    expect(names).toContain('password_hash');
    expect(names).toContain('created_at');
  });

  it('应正确创建 settings 表', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      is_encrypted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, key)
    )`);
    const columns = db.pragma('table_info(settings)') as Array<{ name: string }>;
    const names = columns.map(c => c.name);
    expect(names).toContain('id');
    expect(names).toContain('user_id');
    expect(names).toContain('key');
    expect(names).toContain('value');
    expect(names).toContain('is_encrypted');
  });

  it('应正确创建 conversations 表', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_archived INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    const columns = db.pragma('table_info(conversations)') as Array<{ name: string }>;
    const names = columns.map(c => c.name);
    expect(names).toContain('id');
    expect(names).toContain('user_id');
    expect(names).toContain('title');
    expect(names).toContain('is_archived');
  });

  it('应正确创建 messages 表', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning_content TEXT DEFAULT '',
      is_compact_summary INTEGER DEFAULT 0,
      compact_metadata TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`);
    const columns = db.pragma('table_info(messages)') as Array<{ name: string }>;
    const names = columns.map(c => c.name);
    expect(names).toContain('reasoning_content');
    expect(names).toContain('is_compact_summary');
    expect(names).toContain('compact_metadata');
  });

  it('应正确创建 memories 表', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT DEFAULT '',
      type TEXT NOT NULL DEFAULT 'fact',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    const columns = db.pragma('table_info(memories)') as Array<{ name: string }>;
    const names = columns.map(c => c.name);
    expect(names).toContain('key');
    expect(names).toContain('content');
    expect(names).toContain('source');
    expect(names).toContain('type');
  });

  it('应正确创建 session_notes_state 表', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS session_notes_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL UNIQUE,
      is_initialized INTEGER DEFAULT 0,
      notes_token_count INTEGER DEFAULT 0,
      last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`);
    const columns = db.pragma('table_info(session_notes_state)') as Array<{ name: string }>;
    const names = columns.map(c => c.name);
    expect(names).toContain('conversation_id');
    expect(names).toContain('is_initialized');
    expect(names).toContain('notes_token_count');
  });

  it('应支持基础 CRUD 操作', () => {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('testuser', 'hash123');
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get('testuser') as { username: string; password_hash: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.username).toBe('testuser');
    expect(row!.password_hash).toBe('hash123');
  });

  it('应启用外键约束', () => {
    const result = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
    expect(result[0].foreign_keys).toBe(1);
  });

  it('应启用 WAL 模式', () => {
    const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(result[0].journal_mode).toBe('wal');
  });
});
