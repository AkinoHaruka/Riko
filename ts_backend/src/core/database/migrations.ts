/**
 * 数据库迁移脚本。
 *
 * 包括小版本模式（migrateCompactFields / migrateSessionNotesState 直接 ALTER TABLE ADD COLUMN）
 * 和大版本模式（migrateToV1：INTEGER id → TEXT id 的完整重迁移）。
 *
 * V1 迁移策略：
 * 1. 建 _new 临时表，生成 TEXT 主键并复制数据
 * 2. 通过 _id_mapping 表将旧 INTEGER FK 更新为新 TEXT FK
 * 3. 删旧表，_new 表 RENAME 为正式表名
 * 4. 清理 _id_mapping 临时表，更新 user_version
 *
 * @module core/database/migrations
 */
import { generateId, type TableName } from '../utils/id.js';
import type { Database as DatabaseType } from './connection.js';

/** PRAGMA table_info 返回的列信息结构 */
interface TableColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/**
 * 迁移：为 messages 表添加 is_compact_summary 和 compact_metadata 列。
 * 仅在列不存在时执行 ALTER TABLE，保证幂等性。
 */
export function migrateCompactFields(db: DatabaseType): void {
  const columns = db.pragma('table_info(messages)') as TableColumn[];
  const columnNames = columns.map((col) => col.name);

  if (!columnNames.includes('is_compact_summary') || !columnNames.includes('compact_metadata')) {
    const txn = db.transaction(() => {
      if (!columnNames.includes('is_compact_summary')) {
        db.exec('ALTER TABLE messages ADD COLUMN is_compact_summary INTEGER DEFAULT 0');
      }
      if (!columnNames.includes('compact_metadata')) {
        db.exec('ALTER TABLE messages ADD COLUMN compact_metadata TEXT DEFAULT NULL');
      }
    });
    txn();
  }
}

/**
 * 迁移：为 memories 表添加 user_id 列。
 * 仅在列不存在时执行 ALTER TABLE，保证幂等性。
 */
export function migrateMemoriesUserId(db: DatabaseType): void {
  const columns = db.pragma('table_info(memories)') as TableColumn[];
  const columnNames = columns.map((col) => col.name);

  if (!columnNames.includes('user_id')) {
    const txn = db.transaction(() => {
      db.exec('ALTER TABLE memories ADD COLUMN user_id TEXT NOT NULL DEFAULT \'\'');
    });
    txn();
  }
}

/**
 * 迁移：为 memories 表添加 (user_id, key) UNIQUE 约束。
 *
 * @security 防止并发 upsert 竞态导致重复数据。
 *           迁移前清理已存在的重复记录（保留 created_at 最新的一条）。
 *           迁移幂等：索引已存在时跳过。
 *
 * @param db - 数据库实例
 */
export function migrateMemoriesUniqueConstraint(db: DatabaseType): void {
  // 检查索引是否已存在（幂等性）
  const existingIndex = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memories_user_key_unique'")
    .get() as { name: string } | undefined;

  if (existingIndex) {
    return;
  }

  const txn = db.transaction(() => {
    // 清理重复数据：同 (user_id, key) 保留 created_at 最新的一条
    // 使用 ROW_NUMBER 窗口函数（SQLite 3.25+ 支持）
    db.exec(`
      DELETE FROM memories
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY user_id, key
                   ORDER BY created_at DESC
                 ) AS rn
          FROM memories
        ) WHERE rn = 1
      )
    `);

    // 创建 UNIQUE 索引
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_key_unique ON memories(user_id, key)');
  });

  try {
    txn();
    console.log('[Migration] memories UNIQUE 约束迁移完成');
  } catch (error) {
    // 窗口函数不支持或清理失败时，仅创建索引（可能因重复数据失败）
    console.warn('[Migration] memories UNIQUE 约束迁移失败，跳过:', error);
  }
}

/**
 * 迁移：为 conversations 表添加 background 列。
 * 仅在列不存在时执行 ALTER TABLE，保证幂等性。
 */
export function migrateConversationBackground(db: DatabaseType): void {
  const columns = db.pragma('table_info(conversations)') as TableColumn[];
  const columnNames = columns.map((col) => col.name);

  if (!columnNames.includes('background')) {
    const txn = db.transaction(() => {
      db.exec('ALTER TABLE conversations ADD COLUMN background TEXT DEFAULT NULL');
    });
    txn();
  }
}

/**
 * 迁移：为 session_notes_state 表添加 tool_call_count 列。
 * 仅在列不存在时执行 ALTER TABLE，保证幂等性。
 */
export function migrateSessionNotesState(db: DatabaseType): void {
  const columns = db.pragma('table_info(session_notes_state)') as TableColumn[];
  const columnNames = columns.map((col) => col.name);

  if (!columnNames.includes('tool_call_count')) {
    const txn = db.transaction(() => {
      db.exec('ALTER TABLE session_notes_state ADD COLUMN tool_call_count INTEGER DEFAULT 0');
    });
    txn();
  }
}

// ---- V1 迁移：INTEGER id → TEXT id ----

/** 列定义结构，用于 V1 迁移时动态构建 CREATE TABLE 语句 */
interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
}

/** 表定义结构，包含表名、ID 前缀名和列定义列表 */
interface TableDef {
  name: string;
  tableName: TableName;
  columns: ColumnDef[];
}

/** V1 迁移涉及的表定义列表，每张表需要从 INTEGER id 迁移为 TEXT id */
const V1_TABLES: TableDef[] = [
  {
    name: 'users',
    tableName: 'users',
    columns: [
      { name: 'username', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'password_hash', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'created_at', type: 'TEXT', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
    ],
  },
  {
    name: 'conversations',
    tableName: 'conversations',
    columns: [
      { name: 'user_id', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'title', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'is_archived', type: 'INTEGER', nullable: true, defaultValue: '0' },
      { name: 'background', type: 'TEXT', nullable: true, defaultValue: 'NULL' },
      { name: 'created_at', type: 'TEXT', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TEXT', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
    ],
  },
  {
    name: 'messages',
    tableName: 'messages',
    columns: [
      { name: 'conversation_id', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'role', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'content', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'reasoning_content', type: 'TEXT', nullable: true, defaultValue: "''" },
      { name: 'is_compact_summary', type: 'INTEGER', nullable: true, defaultValue: '0' },
      { name: 'compact_metadata', type: 'TEXT', nullable: true, defaultValue: 'NULL' },
      { name: 'created_at', type: 'TEXT', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
    ],
  },
  {
    name: 'memories',
    tableName: 'memories',
    columns: [
      { name: 'key', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'content', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'source', type: 'TEXT', nullable: true, defaultValue: "''" },
      { name: 'type', type: 'TEXT', nullable: false, defaultValue: "'fact'" },
      { name: 'created_at', type: 'TEXT', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
    ],
  },
  {
    name: 'settings',
    tableName: 'settings',
    columns: [
      { name: 'user_id', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'key', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'value', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'is_encrypted', type: 'INTEGER', nullable: true, defaultValue: '0' },
      { name: 'created_at', type: 'TEXT', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TEXT', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
    ],
  },
  {
    name: 'session_notes_state',
    tableName: 'session_notes_state',
    columns: [
      { name: 'conversation_id', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'is_initialized', type: 'INTEGER', nullable: true, defaultValue: '0' },
      { name: 'notes_token_count', type: 'INTEGER', nullable: true, defaultValue: '0' },
      { name: 'tool_call_count', type: 'INTEGER', nullable: true, defaultValue: '0' },
      { name: 'last_updated_at', type: 'TEXT', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
    ],
  },
  {
    name: 'sub_agent_activities',
    tableName: 'sub_agent_activities',
    columns: [
      { name: 'user_id', type: 'TEXT', nullable: false, defaultValue: "'1'" },
      { name: 'type', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'timestamp', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'success', type: 'INTEGER', nullable: false, defaultValue: '1' },
      { name: 'metadata', type: 'TEXT', nullable: true, defaultValue: null },
      { name: 'summary', type: 'TEXT', nullable: true, defaultValue: null },
      { name: 'created_at', type: 'TEXT', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
    ],
  },
  {
    name: 'api_monitor_records',
    tableName: 'api_monitor_records',
    columns: [
      { name: 'user_id', type: 'TEXT', nullable: false, defaultValue: "'1'" },
      { name: 'conversation_id', type: 'TEXT', nullable: false, defaultValue: null },
      { name: 'request_json', type: 'TEXT', nullable: false, defaultValue: "''" },
      { name: 'response_raw_text', type: 'TEXT', nullable: false, defaultValue: "''" },
      { name: 'is_complete', type: 'INTEGER', nullable: false, defaultValue: '0' },
      { name: 'prompt_tokens', type: 'INTEGER', nullable: true, defaultValue: null },
      { name: 'completion_tokens', type: 'INTEGER', nullable: true, defaultValue: null },
      { name: 'total_tokens', type: 'INTEGER', nullable: true, defaultValue: null },
      { name: 'error_category', type: 'TEXT', nullable: true, defaultValue: null },
      { name: 'error_code', type: 'TEXT', nullable: true, defaultValue: null },
      { name: 'error_message', type: 'TEXT', nullable: true, defaultValue: null },
      { name: 'error_suggestion', type: 'TEXT', nullable: true, defaultValue: null },
      { name: 'internal_events', type: 'TEXT', nullable: true, defaultValue: null },
      { name: 'created_at', type: 'TEXT', nullable: true, defaultValue: 'CURRENT_TIMESTAMP' },
    ],
  },
];

/** 外键引用关系列表，用于 V1 迁移时将旧 INTEGER FK 更新为新 TEXT FK */
const FK_REFS: { childTable: string; childColumn: string; parentTable: string }[] = [
  { childTable: 'conversations', childColumn: 'user_id', parentTable: 'users' },
  { childTable: 'messages', childColumn: 'conversation_id', parentTable: 'conversations' },
  { childTable: 'settings', childColumn: 'user_id', parentTable: 'users' },
  {
    childTable: 'session_notes_state',
    childColumn: 'conversation_id',
    parentTable: 'conversations',
  },
  { childTable: 'sub_agent_activities', childColumn: 'user_id', parentTable: 'users' },
  { childTable: 'api_monitor_records', childColumn: 'user_id', parentTable: 'users' },
  {
    childTable: 'api_monitor_records',
    childColumn: 'conversation_id',
    parentTable: 'conversations',
  },
];

/**
 * V1 大版本迁移：将所有表的 INTEGER id 转换为 TEXT id。
 *
 * 执行流程：
 * 1. 清理上次失败残留的临时表，创建 _id_mapping 映射表
 * 2. 为每张表创建 _new 临时表，逐行复制数据并生成新的 TEXT 主键
 * 3. 通过 _id_mapping 将子表的外键从旧 INTEGER 更新为新 TEXT
 * 4. 删除旧表，将 _new 表重命名为正式表名
 * 5. 清理临时表，更新 user_version = 1
 *
 * 整个迁移在事务中执行，失败时自动回滚。
 */
export function migrateToV1(db: DatabaseType): void {
  console.log('[Migration] v0 → v1 (INTEGER id → TEXT id)...');

  const runMigration = db.transaction(() => {
    // 确保迁移可重入：清理上次失败残留的临时表
    for (const table of V1_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table.name}_new`);
    }
    db.exec('DROP TABLE IF EXISTS _id_mapping');

    db.exec(`
      CREATE TABLE IF NOT EXISTS _id_mapping (
        table_name TEXT NOT NULL,
        old_id INTEGER NOT NULL,
        new_id TEXT NOT NULL,
        PRIMARY KEY (table_name, old_id)
      )
    `);

    const insertMapping = db.prepare(
      'INSERT OR IGNORE INTO _id_mapping (table_name, old_id, new_id) VALUES (?, ?, ?)',
    );

    // Phase 1: 创建 _new 临时表，生成 TEXT 主键并复制数据
    for (const table of V1_TABLES) {
      const oldRows = db.prepare(`SELECT id FROM ${table.name}`).all() as { id: number }[];
      console.log(`[Migration] Migrating ${oldRows.length} rows in ${table.name}...`);

      const colDefs = [
        'id TEXT PRIMARY KEY',
        ...table.columns.map((c) => {
          let def = `${c.name} ${c.type}`;
          if (!c.nullable) def += ' NOT NULL';
          if (c.defaultValue !== null) def += ` DEFAULT ${c.defaultValue}`;
          return def;
        }),
      ];

      db.exec(`DROP TABLE IF EXISTS ${table.name}_new`);
      db.exec(`CREATE TABLE ${table.name}_new (${colDefs.join(', ')})`);

      const cols = table.columns.map((c) => c.name);
      const placeholders = ['?', ...cols.map(() => '?')].join(', ');

      for (const row of oldRows) {
        const newId = generateId(table.tableName);
        const oldRow = db
          .prepare(`SELECT ${cols.join(', ')} FROM ${table.name} WHERE id = ?`)
          .get(row.id) as Record<string, unknown> | undefined;

        if (!oldRow) continue;

        db.prepare(
          `INSERT INTO ${table.name}_new (id, ${cols.join(', ')}) VALUES (${placeholders})`,
        ).run(newId, ...cols.map((c) => oldRow[c]));

        insertMapping.run(table.name, row.id, newId);
      }
    }

    // Phase 2: 通过 _id_mapping 更新子表外键引用
    console.log('[Migration] Updating FK references...');
    for (const ref of FK_REFS) {
      const child = `${ref.childTable}_new`;
      db.prepare(
        `UPDATE ${child} SET ${ref.childColumn} = (
          SELECT m.new_id FROM _id_mapping m
          WHERE m.table_name = '${ref.parentTable}'
          AND m.old_id = CAST(${child}.${ref.childColumn} AS INTEGER)
        )`,
      ).run();
      console.log(`[Migration]   ${child}.${ref.childColumn} → ${ref.parentTable}`);
    }

    // Phase 3: 交换表名（逆序删除以避免外键约束冲突）
    console.log('[Migration] Swapping tables...');
    for (const table of [...V1_TABLES].reverse()) {
      db.exec(`DROP TABLE ${table.name}`);
      db.exec(`ALTER TABLE ${table.name}_new RENAME TO ${table.name}`);
    }

    // Phase 4: 清理临时表，标记迁移完成
    db.exec('DROP TABLE IF EXISTS _id_mapping');
    db.pragma('user_version = 1');
    console.log('[Migration] v0 → v1 complete');
  });

  runMigration();
}
