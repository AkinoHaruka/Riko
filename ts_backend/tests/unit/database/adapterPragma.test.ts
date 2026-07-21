/**
 * DatabaseWrapper.pragma() 参数化查询单元测试
 *
 * 针对 sql.js (WASM) 路径的 PRAGMA 白名单校验逻辑：
 * - 带参数形式（table_info(messages)）应正确提取 pragma 名并通过白名单
 * - 参数仅允许安全标识符（表名/索引名），防止 SQL 注入
 * - 无参数形式（user_version）保持原有行为
 *
 * 修复背景：原实现将 'table_info(messages)' 整体作为 pragma 名匹配白名单，
 * 导致带参数的合法调用被误判为不允许，迁移函数 migrateCompactFields 等全部失败。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getSqlJs, DatabaseWrapper } from '../../../src/core/database/adapter.js';

describe('DatabaseWrapper.pragma() 参数化查询', () => {
  let db: DatabaseWrapper;

  beforeAll(async () => {
    const SQL = await getSqlJs();
    const raw = new SQL.Database();
    raw.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, content TEXT, is_compact_summary INTEGER DEFAULT 0)');
    db = new DatabaseWrapper(raw, ':memory:');
  });

  it('table_info(messages) 带参数形式应正常返回列信息', () => {
    const columns = db.pragma('table_info(messages)') as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('content');
    expect(names).toContain('is_compact_summary');
  });

  it('index_list(messages) 带参数形式应正常执行', () => {
    // 不应抛出 "not allowed" 错误
    expect(() => db.pragma('index_list(messages)')).not.toThrow();
  });

  it('user_version 无参数形式保持原有行为', () => {
    expect(() => db.pragma('user_version')).not.toThrow();
  });

  it('user_version = 1 赋值形式保持原有行为', () => {
    expect(() => db.pragma('user_version = 1')).not.toThrow();
  });

  it('table_info 参数含非法字符时拒绝执行（防注入）', () => {
    expect(() => db.pragma("table_info(messages); DROP TABLE users--")).toThrow(
      /invalid characters/,
    );
  });

  it('table_info 参数含引号时拒绝执行（防注入）', () => {
    expect(() => db.pragma("table_info('messages')")).toThrow(/invalid characters/);
  });

  it('未在白名单中的 pragma 仍被拒绝', () => {
    expect(() => db.pragma('compile_options')).toThrow(/not allowed/);
  });

  it(':memory: 数据库 persist 不尝试写盘', async () => {
    db.markDirty();
    // :memory: 路径应静默跳过持久化，不产生 ENOENT 错误
    await expect(db.persist()).resolves.toBeUndefined();
  });
});
