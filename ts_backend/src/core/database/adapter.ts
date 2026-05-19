/**
 * sql.js (WASM) 数据库适配器。
 *
 * 实现与 better-sqlite3 兼容的 API 表面（prepare/run/get/all/exec/pragma/transaction），
 * 使 connection.ts 可以透明切换底层引擎。
 *
 * 关键差异处理：
 * - WAL 模式不支持 → 静默降级为默认 journal 模式
 * - 数据持久化 → 通过 debounce 定时 export() 写回磁盘
 * - 事务 → 显式 BEGIN / COMMIT / ROLLBACK
 */
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

let SQL: SqlJsStatic | null = null;

function resolveWasmDir(): string {
  const bootDir = (globalThis as Record<string, unknown>).BOOT_DIR as string | undefined;
  if (bootDir) return bootDir;
  const require = createRequire(import.meta.url);
  // require.resolve('sql.js') → …/sql.js/dist/sql-wasm.js → dirname gives …/dist
  return path.dirname(require.resolve('sql.js'));
}

export async function getSqlJs(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  const wasmDir = resolveWasmDir();
  SQL = await initSqlJs({
    locateFile: (file: string) => path.join(wasmDir, file),
  });
  return SQL;
}

/** Wraps a sql.js prepared statement to match better-sqlite3's chaining API. */
export class StatementWrapper {
  private stmt: ReturnType<SqlJsDatabase['prepare']> | null = null;

  constructor(
    private readonly owner: DatabaseWrapper,
    private readonly sql: string,
  ) {}

  private ensure(): ReturnType<SqlJsDatabase['prepare']> {
    if (!this.stmt) {
      this.stmt = this.owner.raw.prepare(this.sql);
    }
    return this.stmt;
  }

  private free(): void {
    if (this.stmt) {
      this.stmt.free();
      this.stmt = null;
    }
  }

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
 * Wraps a sql.js Database to provide a better-sqlite3 compatible API surface.
 * Handles the WAL-mode limitation and automatic disk persistence.
 */
export class DatabaseWrapper {
  readonly raw: SqlJsDatabase;
  private dbPath: string;
  private dirty = false;
  private _persistTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly PERSIST_DEBOUNCE_MS = 2000;

  constructor(raw: SqlJsDatabase, dbPath: string) {
    this.raw = raw;
    this.dbPath = dbPath;
  }

  prepare(sql: string): StatementWrapper {
    return new StatementWrapper(this, sql);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  pragma(input: string, options?: { simple?: boolean } | string): unknown {
    if (input.includes('=')) {
      const [key, val] = input.split('=').map((s) => s.trim());
      if (key === 'journal_mode' && val.toUpperCase() === 'WAL') {
        // sql.js (WASM-based SQLite) does not support WAL journal mode.
        // The database uses periodic export() to persist changes instead.
        console.warn(
          '[Database] WAL journal mode is not supported by sql.js — using default rollback journal',
        );
        return;
      }
      this.raw.exec(`PRAGMA ${key} = ${val}`);
      return;
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

    // Support { simple: true } like better-sqlite3: return scalar value
    const simple = typeof options === 'object' && options !== null && options.simple === true;
    if (simple && rows.length > 0) {
      return (rows[0] as Record<string, unknown>)[cols[0]];
    }

    return rows;
  }

  // better-sqlite3's transaction() RETURNS a function that the caller invokes
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

  close(): void {
    this.persist();
    this.raw.close();
  }

  /** Called after every write. Debounces persist; close() flushes immediately. */
  markDirty(): void {
    this.dirty = true;
    this._schedulePersist();
  }

  /** Resets the debounce timer. Persist fires after PERSIST_DEBOUNCE_MS of inactivity. */
  private _schedulePersist(): void {
    if (this._persistTimer !== null) {
      clearTimeout(this._persistTimer);
    }
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.persist();
    }, DatabaseWrapper.PERSIST_DEBOUNCE_MS);
  }

  /** Export the WASM buffer to disk. Clears any pending timer, then writes if dirty. */
  persist(): void {
    if (this._persistTimer !== null) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (!this.dirty) return;
    try {
      const data = this.raw.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
      this.dirty = false;
    } catch (e: unknown) {
      const errMsg = (e as Error).message ?? String(e);
      console.error('[Database] persist failed:', errMsg);
      try {
        fs.appendFileSync(
          this.dbPath + '.errors',
          `[persist] ${new Date().toISOString()} ERROR: ${errMsg}\n`,
        );
      } catch {
        /* last resort */
      }
    }
  }
}

export type Database = DatabaseWrapper;
