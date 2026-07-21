/**
 * sql.js (WASM) 数据库适配器。
 *
 * 实现与 better-sqlite3 兼容的 API 表面（prepare/run/get/all/exec/pragma/transaction），
 * 使 connection.ts 可以透明切换底层引擎而无需修改上层代码。
 *
 * 关键差异处理：
 * - WAL 模式不支持 → 静默降级为默认 journal 模式
 * - 数据持久化 → 通过 debounce 定时 export() 写回磁盘（非 WAL 场景下的替代方案）
 * - 事务 → 显式 BEGIN / COMMIT / ROLLBACK（sql.js 不支持 savepoint）
 *
 * @module core/database/adapter
 */
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { createLogger } from '../logger/index.js';

const logger = createLogger('DatabaseAdapter');

let SQL: SqlJsStatic | null = null;

/**
 * 解析 sql.js WASM 文件所在目录。
 * 优先使用全局 BOOT_DIR（Android 嵌入式环境），否则从 sql.js 包路径推断。
 */
function resolveWasmDir(): string {
  const bootDir = (globalThis as Record<string, unknown>).BOOT_DIR as string | undefined;
  if (bootDir) return bootDir;
  const require = createRequire(import.meta.url);
  // require.resolve('sql.js') → …/sql.js/dist/sql-wasm.js → dirname gives …/dist
  return path.dirname(require.resolve('sql.js'));
}

/**
 * 获取或初始化 sql.js 静态实例（单例）。
 * 首次调用时加载 WASM 文件，后续调用直接返回缓存。
 */
export async function getSqlJs(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  const wasmDir = resolveWasmDir();
  SQL = await initSqlJs({
    locateFile: (file: string) => path.join(wasmDir, file),
  });
  return SQL;
}

/**
 * sql.js 预处理语句包装器。
 * 模拟 better-sqlite3 的链式调用 API（run/get/all），
 * 内部在每次操作后释放底层语句以避免内存泄漏。
 */
export class StatementWrapper {
  private stmt: ReturnType<SqlJsDatabase['prepare']> | null = null;

  constructor(
    private readonly owner: DatabaseWrapper,
    private readonly sql: string,
  ) {}

  /** 惰性绑定预处理语句，仅在首次使用时创建 */
  private ensure(): ReturnType<SqlJsDatabase['prepare']> {
    if (!this.stmt) {
      this.stmt = this.owner.raw.prepare(this.sql);
    }
    return this.stmt;
  }

  /** 释放底层预处理语句，防止 WASM 内存泄漏 */
  private free(): void {
    if (this.stmt) {
      this.stmt.free();
      this.stmt = null;
    }
  }

  /**
   * 执行写操作（INSERT/UPDATE/DELETE）。
   * @param params - SQL 参数
   * @returns 影响行数与最后插入行 ID
   */
  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const s = this.ensure();
    s.bind(params as import('sql.js').BindParams);
    s.step();
    this.free();
    const changes = this.owner.raw.getRowsModified();
    const lastIdResult = this.owner.raw.exec('SELECT last_insert_rowid()');
    const lastInsertRowid = lastIdResult.length > 0 ? Number(lastIdResult[0].values[0][0]) : 0;
    this.owner.markDirty();
    return { changes, lastInsertRowid };
  }

  /**
   * 查询单行记录。
   * @param params - SQL 参数
   * @returns 匹配的行对象，无结果时返回 undefined
   */
  get(...params: unknown[]): Record<string, unknown> | undefined {
    const s = this.ensure();
    s.bind(params as import('sql.js').BindParams);
    if (s.step()) {
      const row = s.getAsObject() as Record<string, unknown>;
      this.free();
      return row;
    }
    this.free();
    return undefined;
  }

  /**
   * 查询所有匹配行。
   * @param params - SQL 参数
   * @returns 行对象数组
   */
  all(...params: unknown[]): Record<string, unknown>[] {
    const s = this.ensure();
    s.bind(params as import('sql.js').BindParams);
    const rows: Record<string, unknown>[] = [];
    while (s.step()) {
      rows.push(s.getAsObject() as Record<string, unknown>);
    }
    this.free();
    return rows;
  }
}

/**
 * sql.js 数据库包装器。
 * 提供 better-sqlite3 兼容的 API 表面，处理 WAL 模式限制和自动磁盘持久化。
 * 写操作通过 markDirty() 标记脏数据，由 debounce 定时器触发 persist() 写回磁盘。
 */
export class DatabaseWrapper {
  readonly raw: SqlJsDatabase;
  private dbPath: string;
  private dirty = false;
  private _persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** 持久化防抖间隔（毫秒），写操作后等待此时间无新操作再写盘 */
  private static readonly PERSIST_DEBOUNCE_MS = 2000;

  constructor(raw: SqlJsDatabase, dbPath: string) {
    this.raw = raw;
    this.dbPath = dbPath;
  }

  /** 创建预处理语句包装器 */
  prepare(sql: string): StatementWrapper {
    return new StatementWrapper(this, sql);
  }

  /** 执行原始 SQL 语句（无返回值） */
  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /**
   * 执行 PRAGMA 命令。
   * WAL 模式在 sql.js 中不可用，会静默降级为默认 journal 模式。
   * 支持 { simple: true } 选项，与 better-sqlite3 行为一致：返回标量值。
   *
   * @security 对 key 进行 allowlist 校验，防止 SQL 注入
   */
  pragma(input: string, options?: { simple?: boolean } | string): unknown {
    const ALLOWED_PRAGMAS = new Set([
      'journal_mode', 'cache_size', 'synchronous', 'foreign_keys',
      'busy_timeout', 'wal_checkpoint', 'auto_vacuum', 'encoding',
      'page_size', 'page_count', 'freelist_count', 'user_version',
      'table_info', 'index_list', 'integrity_check',
    ]);

    if (input.includes('=')) {
      const [key, val] = input.split('=').map((s) => s.trim());
      if (!ALLOWED_PRAGMAS.has(key.toLowerCase())) {
        throw new Error(`PRAGMA ${key} is not allowed`);
      }
      if (key.toLowerCase() === 'journal_mode' && val.toUpperCase() === 'WAL') {
        // sql.js 基于 WASM 的 SQLite 不支持 WAL 日志模式，
        // 改用定期 export() 持久化数据作为替代方案
        logger.warn(
          'WAL journal mode is not supported by sql.js — using default rollback journal',
        );
        return;
      }
      // 值只允许数字、布尔值和简单标识符，防止 SQL 注入
      if (!/^[\w.]+$/.test(val)) {
        throw new Error(`PRAGMA value contains invalid characters: ${val}`);
      }
      this.raw.exec(`PRAGMA ${key} = ${val}`);
      return;
    }
    const trimmed = input.trim();
    // 严格整体格式校验：只允许 "pragma_name" 或 "pragma_name(identifier)" 两种形态，
    // 其中 identifier 仅含字母/数字/下划线。任何尾随内容（如分号、注释、第二段语句）
    // 都会导致整体不匹配，从而在源头杜绝 SQL 注入。
    const pragmaMatch = /^([a-zA-Z_][\w]*)(?:\(([\w]+)\))?$/.exec(trimmed);
    if (!pragmaMatch) {
      throw new Error(`PRAGMA contains invalid characters: ${input}`);
    }
    const pragmaName = pragmaMatch[1].toLowerCase();
    if (!ALLOWED_PRAGMAS.has(pragmaName)) {
      throw new Error(`PRAGMA ${input} is not allowed`);
    }
    const result = this.raw.exec(`PRAGMA ${input}`);
    if (result.length === 0) return [];
    const cols = result[0].columns;
    const rows = result[0].values.map((row) => {
      const obj: Record<string, unknown> = {};
      cols.forEach((c, i) => {
        obj[c] = row[i];
      });
      return obj;
    });

    // 支持 { simple: true }，与 better-sqlite3 行为一致：返回标量值
    const simple = typeof options === 'object' && options !== null && options.simple === true;
    if (simple && rows.length > 0) {
      return (rows[0] as Record<string, unknown>)[cols[0]];
    }

    return rows;
  }

  /**
   * 创建事务函数（与 better-sqlite3 的 transaction() API 兼容）。
   * 返回一个函数，调用时在 BEGIN/COMMIT/ROLLBACK 中执行传入的回调。
   */
  transaction<T>(fn: () => T): () => T {
    const { raw } = this;
    return () => {
      raw.exec('BEGIN');
      try {
        const result = fn();
        raw.exec('COMMIT');
        this.markDirty();
        return result;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    };
  }

  /** 关闭数据库，先刷盘再关闭底层连接 */
  async close(): Promise<void> {
    await this.persist();
    try {
      this.raw.close();
    } catch (e: unknown) {
      const errMsg = (e as Error).message ?? String(e);
      logger.error('close failed: %s', errMsg);
    }
  }

  /** 标记数据已变更，触发防抖持久化。close() 会立即刷盘。 */
  markDirty(): void {
    this.dirty = true;
    this._schedulePersist();
  }

  /** 重置防抖计时器，在 PERSIST_DEBOUNCE_MS 无新写操作后触发持久化 */
  private _schedulePersist(): void {
    if (this._persistTimer !== null) {
      clearTimeout(this._persistTimer);
    }
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.persist();
    }, DatabaseWrapper.PERSIST_DEBOUNCE_MS);
  }

  /**
   * 将 WASM 缓冲区导出到磁盘文件。
   * 清除待执行的防抖计时器，仅在数据有变更时执行写入。
   * 写入失败时将错误追加到 .errors 日志文件，不中断流程。
   */
  async persist(): Promise<void> {
    if (this._persistTimer !== null) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (!this.dirty) return;
    // 内存数据库（:memory:）无磁盘文件，跳过持久化（常见于单元测试）
    if (this.dbPath === ':memory:') {
      this.dirty = false;
      return;
    }
    try {
      const data = this.raw.export();
      await fs.promises.writeFile(this.dbPath, Buffer.from(data));
      this.dirty = false;
    } catch (e: unknown) {
      const errMsg = (e as Error).message ?? String(e);
      logger.error('persist failed: %s', errMsg);
      try {
        fs.appendFileSync(
          this.dbPath + '.errors',
          `[persist] ${new Date().toISOString()} ERROR: ${errMsg}\n`,
        );
      } catch (e) {
        logger.warn('Failed to write error log: %s', e);
      }
    }
  }
}

/** 数据库类型别名，便于上层统一引用 */
export type Database = DatabaseWrapper;
