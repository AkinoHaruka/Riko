/**
 * 数据库连接管理。
 *
 * 启动策略（优先 better-sqlite3，兜底 sql.js WASM）：
 * better-sqlite3 是原生 C++ 扩展，性能更好；
 * sql.js 是 WASM 版本，兼容性更好（适用于 Web/部分移动端场景）。
 *
 * 初始化流程：建表 → 增量迁移 → 索引创建 → 默认用户（由 auth 中间件按需创建）。
 *
 * @module core/database/connection
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
  migrateMemoriesUserId,
  migrateMemoriesUniqueConstraint,
  migrateToV1,
} from './migrations.js';

/** 数据库统一接口，抽象 better-sqlite3 与 sql.js 的差异 */
interface DatabaseLike {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  };
  exec(sql: string): void;
  pragma(input: string, options?: { simple?: boolean }): unknown;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

let db: DatabaseLike | null = null;
/** 初始化 Promise，防止并发调用 initDb() 时重复初始化 */
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

    let nativeDb: DatabaseLike | undefined;
    /** 通过环境变量 DB_ENGINE=wasm 强制使用 WASM 引擎 */
    const useWasm = process.env.DB_ENGINE === 'wasm';

    if (!useWasm) {
      try {
        const BetterSqlite3 = await import('better-sqlite3');
        const Database = BetterSqlite3.default;
        nativeDb = new Database(dbPath) as unknown as DatabaseLike;
        nativeDb.pragma('journal_mode = WAL');
      } catch {
        // better-sqlite3 加载失败（如无原生编译产物），回退到 WASM 引擎
      }
    }

    if (useWasm || nativeDb === undefined) {
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
      migrateMemoriesUserId(nativeDb);

      const versionResult = nativeDb.pragma('user_version') as { user_version: number }[];
      const currentVersion = versionResult[0]?.user_version ?? 0;
      // 已有数据库且版本为 0：需要执行 V1 迁移（INTEGER id → TEXT id）
      if (currentVersion === 0 && existed) {
        migrateToV1(nativeDb);
      }
      // 新数据库直接设为 V1，无需迁移
      if (currentVersion === 0 && !existed) {
        nativeDb.pragma('user_version = 1');
      }

      // memories UNIQUE 约束迁移：清理重复数据并创建唯一索引
      // @security 迁移前备份数据库，防止清理操作导致数据丢失
      if (existed) {
        try {
          const backupPath = `${dbPath}.backup.${Date.now()}`;
          fs.copyFileSync(dbPath, backupPath);
          console.log(`[Database] 迁移前备份: ${backupPath}`);
        } catch (backupError) {
          console.warn('[Database] 迁移前备份失败，继续执行迁移:', backupError);
        }
      }
      migrateMemoriesUniqueConstraint(nativeDb);

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

/** 关闭数据库连接并重置状态（WASM 引擎下需 await 确保数据刷盘） */
export async function closeDb(): Promise<void> {
  if (db !== null) {
    const dbToClose = db;
    db = null;
    dbInitPromise = null;
    try {
      await (dbToClose as unknown as { close: () => Promise<void> | void }).close();
    } catch {
      // close() 可能同步返回，忽略类型差异
    }
  }
}

/**
 * 获取数据库实例。
 * 必须在 initDb() 完成后调用，否则抛出错误。
 *
 * @returns 数据库实例
 * @throws 数据库未初始化时抛出错误
 */
export function getDb(): DatabaseLike {
  if (db === null) {
    throw new Error('数据库未初始化，请先调用 initDb()');
  }
  return db;
}

export type { DatabaseLike as Database };
