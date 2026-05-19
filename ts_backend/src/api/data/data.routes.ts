// 数据导入导出 API：导出(.riko zip包，含数据库+memories)、导入预检与合并
import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { databaseConfig } from '../../config/database.js';
import { getDb } from '../../core/database/connection.js';
import { eventManager } from '../../core/events/index.js';
import { getMemoryRoot } from '../../memoryStorage/paths.js';
import { logger } from '../../core/logger/index.js';

function getDbPath(): string {
  return path.resolve(databaseConfig.DB_PATH);
}

function timestamp(): string {
  const now = new Date();
  const y = now.getFullYear().toString();
  const M = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');
  return `${y}${M}${d}${h}${m}${s}`;
}

interface TableInfo {
  name: string;
  mergeKey: string;
  hasUpdatedAt: boolean;
  updatedAtCol: string | null;
  label: string;
}

const MERGE_TABLES: TableInfo[] = [
  { name: 'users', mergeKey: 'id', hasUpdatedAt: false, updatedAtCol: null, label: '用户' },
  { name: 'conversations', mergeKey: 'id', hasUpdatedAt: true, updatedAtCol: 'updated_at', label: '对话' },
  { name: 'messages', mergeKey: 'id', hasUpdatedAt: false, updatedAtCol: null, label: '消息' },
  { name: 'memories', mergeKey: 'id', hasUpdatedAt: false, updatedAtCol: null, label: '记忆' },
  { name: 'settings', mergeKey: 'id', hasUpdatedAt: true, updatedAtCol: 'updated_at', label: '设置' },
  { name: 'session_notes_state', mergeKey: 'conversation_id', hasUpdatedAt: true, updatedAtCol: 'last_updated_at', label: '会话笔记状态' },
  { name: 'sub_agent_activities', mergeKey: 'id', hasUpdatedAt: false, updatedAtCol: null, label: '子代理活动' },
  { name: 'api_monitor_records', mergeKey: 'id', hasUpdatedAt: false, updatedAtCol: null, label: 'API监控记录' },
];

const AGENT_TITLES = ['主代理', '记忆提取', '上下文压缩', '梦境整理'];

/** 检查库中某张表是否存在（兼容跨版本表差异） */
function tableExists(db: ReturnType<typeof getDb>, tableName: string): boolean {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    ).get(tableName) as { name: string } | undefined;
    return !!row;
  } catch {
    return false;
  }
}

/** 获取两张表共有的列名列表（按导入表的顺序排序） */
function getCommonColumns(
  importDb: ReturnType<typeof getDb>,
  currentDb: ReturnType<typeof getDb>,
  tableName: string,
): string[] {
  const importCols = (
    importDb.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]
  ).map((c) => c.name);
  const currentCols = new Set(
    (currentDb.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]).map((c) => c.name),
  );
  return importCols.filter((c) => currentCols.has(c));
}

/** 过滤出导入库和当前库都存在的表 */
function getMergeableTables(
  importDb: ReturnType<typeof getDb>,
  currentDb: ReturnType<typeof getDb>,
): TableInfo[] {
  return MERGE_TABLES.filter(
    (t) => tableExists(importDb, t.name) && tableExists(currentDb, t.name),
  );
}

// Zip 文件魔数: PK\x03\x04
const ZIP_MAGIC = 0x504b0304;

function isZipFormat(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  return buffer.readUInt32BE(0) === ZIP_MAGIC;
}

/** 清理重复的 Agent 对话：保留有消息（或最近更新）的，删除空的 */
function cleanupDuplicateAgentConversations(db: ReturnType<typeof getDb>): string[] {
  const keptIds: string[] = [];
  for (const title of AGENT_TITLES) {
    const dups = db.prepare(
      'SELECT id, updated_at FROM conversations WHERE title = ? ORDER BY updated_at DESC',
    ).all(title) as { id: string; updated_at: string }[];
    if (dups.length <= 1) {
      if (dups.length === 1) keptIds.push(dups[0].id);
      continue;
    }

    let bestId = dups[0].id;
    let bestMsgCount = -1;
    for (const c of dups) {
      const { cnt } = db.prepare(
        'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?',
      ).get(c.id) as { cnt: number };
      if (cnt > bestMsgCount) {
        bestMsgCount = cnt;
        bestId = c.id;
      }
    }

    keptIds.push(bestId);

    for (const c of dups) {
      if (c.id === bestId) continue;
      db.prepare('DELETE FROM session_notes_state WHERE conversation_id = ?').run(c.id);
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(c.id);
      db.prepare('DELETE FROM api_monitor_records WHERE conversation_id = ?').run(c.id);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(c.id);
    }
  }
  return keptIds;
}

async function openImportDb(dbPath: string) {
  if (process.env.DB_ENGINE === 'wasm') {
    const { getSqlJs, DatabaseWrapper } = await import('../../core/database/adapter.js');
    const SQL = await getSqlJs();
    const raw = new SQL.Database(fs.readFileSync(dbPath));
    return new DatabaseWrapper(raw, dbPath);
  }
  const BetterSqlite3 = await import('better-sqlite3');
  const Database = BetterSqlite3.default;
  return new Database(dbPath, { readonly: true });
}

/** 从导入的 buffer 中提取 DB 文件 buffer 和记忆文件列表 */
async function extractImportData(
  buffer: Buffer,
  tmpDir: string,
): Promise<{ dbBuffer: Buffer; memoryFiles: { relPath: string; buffer: Buffer }[]; tmpDbPath: string }> {
  if (isZipFormat(buffer)) {
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(buffer);

    // 提取 app.db
    const dbEntry = zip.getEntry('app.db');
    if (!dbEntry) {
      throw new Error('zip 中未找到 app.db');
    }
    const dbBuffer = dbEntry.getData();

    // 提取 memories/ 目录下的所有文件
    const memoryFiles: { relPath: string; buffer: Buffer }[] = [];
    const entries = zip.getEntries();
    for (const entry of entries) {
      if (entry.entryName.startsWith('memories/') && !entry.isDirectory) {
        const relPath = entry.entryName.slice('memories/'.length);
        if (relPath) {
          memoryFiles.push({ relPath, buffer: entry.getData() });
        }
      }
    }

    const tmpDbPath = path.join(tmpDir, 'app.db');
    fs.writeFileSync(tmpDbPath, dbBuffer);
    return { dbBuffer, memoryFiles, tmpDbPath };
  }

  // 旧格式：纯 .db 文件
  const tmpDbPath = path.join(tmpDir, 'app.db');
  fs.writeFileSync(tmpDbPath, buffer);
  return { dbBuffer: buffer, memoryFiles: [], tmpDbPath };
}

/** 将记忆文件还原到指定目录（不覆盖已存在的文件） */
function restoreMemories(memoryFiles: { relPath: string; buffer: Buffer }[], targetRoot: string): number {
  let restored = 0;
  for (const { relPath, buffer } of memoryFiles) {
    const destPath = path.join(targetRoot, relPath);
    if (fs.existsSync(destPath)) continue; // 不覆盖已有文件
    const destDir = path.dirname(destPath);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(destPath, buffer);
    restored++;
  }
  return restored;
}

export async function dataRoutes(app: FastifyInstance): Promise<void> {
  app.get('/export', async (_request, reply) => {
    const dbPath = getDbPath();

    // Force flush in-memory DB (sql.js) / WAL checkpoint (better-sqlite3) to disk
    const db = getDb();
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch { /* sql.js doesn't support WAL */ }
    const d = db as unknown as { persist?: () => void };
    if (typeof d.persist === 'function') {
      d.persist();
    }

    if (!fs.existsSync(dbPath)) {
      return reply.status(500).send({ error: '数据库文件不存在' });
    }

    // 创建 zip 包：app.db + memories/ 目录
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();

    zip.addLocalFile(dbPath);

    const memoryRoot = getMemoryRoot();
    const absMemoryRoot = path.resolve(memoryRoot);
    if (fs.existsSync(absMemoryRoot)) {
      zip.addLocalFolder(absMemoryRoot, 'memories');
    }

    const filename = `riko_${timestamp()}.riko`;
    const zipBuffer = zip.toBuffer();

    logger.info(`导出完成: ${filename} (${(zipBuffer.length / 1024).toFixed(1)} KB), 包含记忆目录: ${fs.existsSync(absMemoryRoot) ? '是' : '否(目录不存在)'}`);

    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', zipBuffer.length)
      .send(zipBuffer);
  });

  app.post('/import/preview', {

  }, async (request, reply) => {
    const body = request.body as Buffer;
    if (!body || body.length === 0) {
      return reply.status(400).send({ error: '上传文件为空' });
    }

    const tmpDir = path.join(os.tmpdir(), `riko_import_${crypto.randomBytes(8).toString('hex')}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let importDb: any = null;

    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      const { memoryFiles, tmpDbPath } = await extractImportData(body, tmpDir);

      importDb = await openImportDb(tmpDbPath);
      const currentDb = getDb();

      const mergeableTables = getMergeableTables(importDb, currentDb);
      const summary: Record<string, { label: string; importCount: number; currentCount: number; willInsert: number; willUpdate: number }> = {};

      for (const table of mergeableTables) {
        const importCount = (importDb.prepare(`SELECT COUNT(*) as cnt FROM ${table.name}`).get() as { cnt: number }).cnt;
        const currentCount = (currentDb.prepare(`SELECT COUNT(*) as cnt FROM ${table.name}`).get() as { cnt: number }).cnt;

        let willInsert = 0;
        let willUpdate = 0;

        if (importCount > 0) {
          const importIds = importDb.prepare(`SELECT ${table.mergeKey} as mk FROM ${table.name}`).all() as { mk: string }[];
          for (const row of importIds) {
            const exists = currentDb.prepare(`SELECT 1 FROM ${table.name} WHERE ${table.mergeKey} = ?`).get(row.mk);
            if (exists) {
              willUpdate++;
            } else {
              willInsert++;
            }
          }
        }

        summary[table.name] = { label: table.label, importCount, currentCount, willInsert, willUpdate };
      }

      return reply.send({
        summary,
        totalWillInsert: Object.values(summary).reduce((s, v) => s + v.willInsert, 0),
        totalWillUpdate: Object.values(summary).reduce((s, v) => s + v.willUpdate, 0),
        memoryFileCount: memoryFiles.length,
      });
    } catch (err) {
      return reply.status(400).send({
        error: `导入文件无效: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      if (importDb) importDb.close();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  app.post('/import/merge', {

  }, async (request, reply) => {
    const body = request.body as Buffer;
    if (!body || body.length === 0) {
      return reply.status(400).send({ error: '上传文件为空' });
    }

    const tmpDir = path.join(os.tmpdir(), `riko_import_${crypto.randomBytes(8).toString('hex')}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let importDb: any = null;

    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      const { memoryFiles, tmpDbPath } = await extractImportData(body, tmpDir);

      importDb = await openImportDb(tmpDbPath);
      const currentDb = getDb();

      // Merge inside a transaction
      currentDb.pragma('foreign_keys = OFF');
      const mergeableTables = getMergeableTables(importDb, currentDb);
      const mergeTxn = currentDb.transaction(() => {
        let totalInserted = 0;
        let totalUpdated = 0;

        for (const table of mergeableTables) {
          const commonCols = getCommonColumns(importDb!, currentDb, table.name);
          const importRows = importDb!.prepare(`SELECT ${commonCols.join(', ')} FROM ${table.name}`).all() as Record<string, unknown>[];

          for (const row of importRows) {
            const mergeValue = row[table.mergeKey] as string;
            const exists = currentDb.prepare(
              `SELECT 1 FROM ${table.name} WHERE ${table.mergeKey} = ?`,
            ).get(mergeValue);

            if (!exists) {
              // INSERT — 只用交集列，新列让 SQLite 填 DEFAULT
              const placeholders = commonCols.map(() => '?').join(', ');
              currentDb.prepare(
                `INSERT OR IGNORE INTO ${table.name} (${commonCols.join(', ')}) VALUES (${placeholders})`,
              ).run(...commonCols.map((c) => row[c]));
              totalInserted++;
            } else if (table.hasUpdatedAt && table.updatedAtCol) {
              const importUpdated = row[table.updatedAtCol] as string | null;
              const localRow = currentDb.prepare(
                `SELECT ${table.updatedAtCol} FROM ${table.name} WHERE ${table.mergeKey} = ?`,
              ).get(mergeValue) as Record<string, unknown>;
              const localUpdated = localRow?.[table.updatedAtCol] as string | null;

              if (importUpdated && (!localUpdated || importUpdated > localUpdated)) {
                const setCols = commonCols.filter((c) => c !== table.mergeKey);
                const setClauses = setCols.map((c) => `${c} = ?`);
                currentDb.prepare(
                  `UPDATE ${table.name} SET ${setClauses.join(', ')} WHERE ${table.mergeKey} = ?`,
                ).run(...setCols.map((c) => row[c]), mergeValue);
                totalUpdated++;
              }
            }
          }
        }

        return { totalInserted, totalUpdated };
      });

      const result = mergeTxn();
      currentDb.pragma('foreign_keys = ON');

      // 还原记忆文件（不覆盖已有）
      const memoryRoot = getMemoryRoot();
      const absMemoryRoot = path.resolve(memoryRoot);
      const restoredCount = memoryFiles.length > 0
        ? restoreMemories(memoryFiles, absMemoryRoot)
        : 0;

      // 清理重复的 Agent 对话
      const keptAgentIds = cleanupDuplicateAgentConversations(currentDb);

      eventManager.broadcast('data_imported', {
        inserted: result.totalInserted,
        updated: result.totalUpdated,
        keptAgentIds,
        restoredMemories: restoredCount,
      });

      return reply.send({
        success: true,
        inserted: result.totalInserted,
        updated: result.totalUpdated,
        keptAgentIds,
        restoredMemories: restoredCount,
      });
    } catch (err) {
      return reply.status(500).send({
        error: `导入合并失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      if (importDb) importDb.close();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });
}
