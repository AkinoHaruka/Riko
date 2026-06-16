/**
 * 数据库表结构定义与索引。
 *
 * 所有 CREATE TABLE 语句使用 IF NOT EXISTS 保证幂等性。
 * 主键统一使用 TEXT 类型（由 generateId 生成），外键启用 ON DELETE CASCADE。
 *
 * @module core/database/schema
 */

/** 用户表：存储登录凭证 */
export const CREATE_USERS = `
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`;

/** 设置表：用户级键值对配置，敏感值加密存储 */
export const CREATE_SETTINGS = `
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    is_encrypted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, key)
)
`;

/** 对话表：每个对话属于一个用户 */
export const CREATE_CONVERSATIONS = `
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    is_archived INTEGER DEFAULT 0,
    background TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)
`;

/** 消息表：对话中的聊天消息，支持推理内容和压缩摘要标记 */
export const CREATE_MESSAGES = `
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    reasoning_content TEXT DEFAULT '',
    is_compact_summary INTEGER DEFAULT 0,
    compact_metadata TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
)
`;

/** 记忆表：AI 长期记忆条目，支持向量搜索 */
export const CREATE_MEMORIES = `
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'fact',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`;

/** 会话笔记状态表：跟踪每个对话的会话记忆提取进度 */
export const CREATE_SESSION_NOTES_STATE = `
CREATE TABLE IF NOT EXISTS session_notes_state (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL UNIQUE,
  is_initialized INTEGER DEFAULT 0,
  notes_token_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
)
`;

/** 子代理活动表：记录子代理（如 dream、compact）的执行历史 */
export const CREATE_SUB_AGENT_ACTIVITIES = `
CREATE TABLE IF NOT EXISTS sub_agent_activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  metadata TEXT,
  summary TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
`;

/** API 监控记录表：记录每次 AI 请求的详细信息和 token 用量 */
export const CREATE_API_MONITOR_RECORDS = `
CREATE TABLE IF NOT EXISTS api_monitor_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  request_json TEXT NOT NULL DEFAULT '',
  response_raw_text TEXT NOT NULL DEFAULT '',
  is_complete INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  error_category TEXT,
  error_code TEXT,
  error_message TEXT,
  error_suggestion TEXT,
  internal_events TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
)
`;

/** 常用查询索引，加速按 conversation_id、user_id 等字段的检索 */
export const CREATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)',
];
