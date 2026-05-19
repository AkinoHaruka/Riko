/**
 * 数据库连接管理。
 *
 * 启动策略（优先 better-sqlite3，兜底 sql.js WASM）：
 * better-sqlite3 是原生 C++ 扩展，性能更好；
 * sql.js 是 WASM 版本，兼容性更好（适用于 Web/部分移动端场景）。
 */
import path from 'path';
import fs from 'fs';
import { databaseConfig } from '../../config/database.js';
import {
  CREATE_USERS,
  CREATE_SETTINGS,
  CREATE_CONVERSATIONS,
  CREATE_MESSAGES,
  CREATE_MEMORIES,
  CREATE_SESSION_NOTES_STATE,
  CREATE_SUB_AGENT_ACTIVITIES,
  CREATE_API_MONITOR_RECORDS,
  CREATE_INDEXES,
} from './schema.js';
import {
  migrateCompactFields,
  migrateConversationBackground,
  migrateSessionNotesState,
  migrateToV1,
} from './migrations.js';

interface DatabaseLike {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  };
  exec(sql: string): void;
  pragma(input: string, value?: unknown): unknown;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

let db: DatabaseLike | null = null;
let dbInitPromise: Promise<void> | null = null;

/**
 * 等待数据库初始化完成。
 * initDb() 未调用时返回 rejected Promise，调用者应据此拒绝请求。
 */
export function waitForDb(): Promise<void> {
  if (db !== null) return Promise.resolve();
  if (dbInitPromise !== null) return dbInitPromise.then(() => {});
  return Promise.reject(new Error('initDb() has not been called'));
}

/**
 * 初始化数据库连接。
 * 优先加载 better-sqlite3，不可用时回退到 sql.js（WASM 模式）。
 * 执行建表、迁移、索引创建，最后插入默认用户。
 */
export async function initDb(): Promise<void> {
  if (db !== null) return;
  if (dbInitPromise !== null) return dbInitPromise;

  dbInitPromise = (async () => {
    const dbPath = databaseConfig.DB_PATH;
    const dataDir = path.dirname(dbPath);
    fs.mkdirSync(dataDir, { recursive: true });

    const existed = fs.existsSync(dbPath);
    try {
      fs.writeFileSync(
        path.join(dataDir, 'db_init.txt'),
        `${new Date().toISOString()} db_existed=${existed} db_size=${existed ? fs.statSync(dbPath).size : 0}\n`,
      );
    } catch {
      /* ignore */
    }

    let nativeDb: DatabaseLike;
    const useWasm = process.env.DB_ENGINE === 'wasm';

    if (!useWasm) {
      try {
        const BetterSqlite3 = await import('better-sqlite3');
        const Database = BetterSqlite3.default;
        nativeDb = new Database(dbPath) as unknown as DatabaseLike;
        nativeDb.pragma('journal_mode = WAL');
      } catch {
        // Fall through to WASM
      }
    }

    if (useWasm || !nativeDb!) {
      const { DatabaseWrapper, getSqlJs } = await import('./adapter.js');
      const SQL = await getSqlJs();
      const sqlJsDb = existed ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
      nativeDb = new DatabaseWrapper(sqlJsDb, dbPath);
      console.warn('[Database] using sql.js WASM engine');
    }

    try {
      nativeDb.pragma('foreign_keys = ON');

      nativeDb.exec(CREATE_USERS);
      nativeDb.exec(CREATE_SETTINGS);
      nativeDb.exec(CREATE_CONVERSATIONS);
      nativeDb.exec(CREATE_MESSAGES);
      nativeDb.exec(CREATE_MEMORIES);
      nativeDb.exec(CREATE_SESSION_NOTES_STATE);
      nativeDb.exec(CREATE_SUB_AGENT_ACTIVITIES);
      nativeDb.exec(CREATE_API_MONITOR_RECORDS);

      migrateCompactFields(nativeDb);
      migrateSessionNotesState(nativeDb);
      migrateConversationBackground(nativeDb);

      const currentVersion = nativeDb.pragma('user_version') as number;
      if (currentVersion === 0 && existed) {
        migrateToV1(nativeDb);
      }
      if (currentVersion === 0 && !existed) {
        nativeDb.pragma('user_version', 1);
      }

      for (const idx of CREATE_INDEXES) {
        nativeDb.exec(idx);
      }

      // 默认用户由 auth 中间件的 getOrCreateDefaultUser() 按需创建，
      // 使用 generateId('users') 生成 TEXT 主键，不再硬编码 id=1

      db = nativeDb;
    } catch (error) {
      nativeDb.close();
      throw error;
    }
  })();

  return dbInitPromise;
}

/** 关闭数据库连接并重置状态 */
export function closeDb(): void {
  if (db !== null) {
    db.close();
    db = null;
    dbInitPromise = null;
  }
}

export function getDb(): DatabaseLike {
  if (db === null) {
    throw new Error('数据库未初始化，请先调用 initDb()');
  }
  return db;
}

export type { DatabaseLike as Database };
