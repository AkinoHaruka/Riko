/** 所有数据库表的 CREATE TABLE 语句及索引定义 */
export const CREATE_USERS = `
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`;

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

export const CREATE_MEMORIES = `
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'fact',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`;

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

export const CREATE_SUB_AGENT_ACTIVITIES = `
CREATE TABLE IF NOT EXISTS sub_agent_activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '1',
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  metadata TEXT,
  summary TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
`;

export const CREATE_API_MONITOR_RECORDS = `
CREATE TABLE IF NOT EXISTS api_monitor_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '1',
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

export const CREATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)',
];
