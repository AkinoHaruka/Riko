import { getDb } from '../../core/database/index.js';
import { createLogger } from '../../core/logger/index.js';
import { generateId } from '../../core/utils/id.js';

const logger = createLogger('MonitorService');

/**
 * 监控与审计服务：记录 API 调用记录和子代理活动日志。
 * 供前端监控面板查询，用于调试和性能分析。
 *
 * 两大功能区域：
 * 1. API Monitor Records — 记录每次 AI API 调用的请求/响应/Token 用量/错误信息
 * 2. Sub-Agent Activities — 记录会话记忆提取、上下文压缩、梦境整固等子代理活动
 *
 * @security 所有查询均通过 user_id 过滤，确保数据隔离。
 */

// ─── API Monitor Records ────────────────────────────────────────

/** API 监控记录，对应 api_monitor_records 表 */
export interface ApiMonitorRecord {
  id: string;
  user_id: string;
  conversation_id: string;
  request_json: string;
  response_raw_text: string;
  is_complete: boolean;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  error_category: string | null;
  error_code: string | null;
  error_message: string | null;
  error_suggestion: string | null;
  internal_events: string | null;
  created_at: string;
}

interface MonitorRecordRow {
  id: string;
  user_id: string;
  conversation_id: string;
  request_json: string;
  response_raw_text: string;
  is_complete: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  error_category: string | null;
  error_code: string | null;
  error_message: string | null;
  error_suggestion: string | null;
  internal_events: string | null;
  created_at: string;
}

/** 数据库行到 ApiMonitorRecord 的转换，主要处理 is_complete 的 0/1 → boolean */
function rowToMonitorRecord(row: MonitorRecordRow): ApiMonitorRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    conversation_id: row.conversation_id,
    request_json: row.request_json,
    response_raw_text: row.response_raw_text,
    is_complete: row.is_complete === 1,
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    total_tokens: row.total_tokens,
    error_category: row.error_category,
    error_code: row.error_code,
    error_message: row.error_message,
    error_suggestion: row.error_suggestion,
    internal_events: row.internal_events,
    created_at: row.created_at,
  };
}

// ─── Sub-Agent Activities ──────────────────────────────────────

/** 子代理活动记录，对应 sub_agent_activities 表 */
export interface SubAgentActivity {
  id: string;
  user_id: string;
  type: 'session_memory' | 'compact' | 'dream';
  timestamp: string;
  success: boolean;
  metadata: Record<string, unknown>;
  summary: string;
}

interface ActivityRow {
  id: string;
  user_id: string;
  type: string;
  timestamp: string;
  success: number;
  metadata: string | null;
  summary: string | null;
  created_at: string;
}

/** 数据库行到 SubAgentActivity 的转换，处理 success 0/1 → boolean 和 metadata JSON 解析 */
function rowToActivity(row: ActivityRow): SubAgentActivity {
  // metadata 的 JSON.parse 可能因数据损坏而失败，添加 try-catch 保护
  let metadata: Record<string, unknown> = {};
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      logger.warn('metadata JSON 解析失败，row.id: %s', row.id);
    }
  }
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type as SubAgentActivity['type'],
    timestamp: row.timestamp,
    success: row.success === 1,
    metadata,
    summary: row.summary ?? '',
  };
}

/**
 * 监控服务类。提供 API 调用记录和子代理活动的 CRUD 操作。
 * @security 所有方法均要求 userId 参数，查询时自动过滤。
 */
export class MonitorService {
  // ─── Sub-Agent Activities ──────────────────────────────────

  /** 查询子代理活动列表，支持按类型过滤和分页 */
  getActivities(
    userId: string,
    options: {
      type?: string;
      limit?: number;
      offset?: number;
    },
  ): SubAgentActivity[] {
    const db = getDb();
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    let sql = 'SELECT * FROM sub_agent_activities WHERE user_id = ?';
    const params: unknown[] = [userId];

    if (options.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params) as unknown as ActivityRow[];
    return rows.map(rowToActivity);
  }

  /** 获取每种子代理类型的最新一条活动记录 */
  getLatestActivities(userId: string): Record<string, SubAgentActivity | null> {
    const db = getDb();
    const types: SubAgentActivity['type'][] = ['session_memory', 'compact', 'dream'];
    const result: Record<string, SubAgentActivity | null> = {};

    for (const type of types) {
      const row = db
        .prepare(
          'SELECT * FROM sub_agent_activities WHERE user_id = ? AND type = ? ORDER BY timestamp DESC LIMIT 1',
        )
        .get(userId, type) as ActivityRow | undefined;
      result[type] = row ? rowToActivity(row) : null;
    }

    return result;
  }

  // ─── API Monitor Records CRUD ──────────────────────────────────

  /** 分页查询指定会话的 API 监控记录 */
  getMonitorRecords(
    userId: string,
    options: {
      conversationId: string;
      limit?: number;
      offset?: number;
    },
  ): ApiMonitorRecord[] {
    const db = getDb();
    const limit = options.limit ?? 200;
    const offset = options.offset ?? 0;

    const rows = db
      .prepare(
        `SELECT * FROM api_monitor_records
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      )
      .all(userId, options.conversationId, limit, offset) as unknown as MonitorRecordRow[];
    return rows.map(rowToMonitorRecord);
  }

  /** 查询指定会话的 API 监控记录总数 */
  getMonitorRecordCount(userId: string, conversationId: string): number {
    const db = getDb();
    const row = db
      .prepare(
        'SELECT COUNT(*) as cnt FROM api_monitor_records WHERE user_id = ? AND conversation_id = ?',
      )
      .get(userId, conversationId) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  /** 插入一条 API 监控记录，返回记录 ID */
  insertMonitorRecord(
    userId: string,
    record: {
      conversationId: string;
      requestJson?: string;
      responseRawText?: string;
      isComplete?: boolean;
      promptTokens?: number | null;
      completionTokens?: number | null;
      totalTokens?: number | null;
      errorCategory?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      errorSuggestion?: string | null;
      internalEvents?: string | null;
    },
  ): string {
    const db = getDb();
    const id = generateId('api_monitor_records');
    db.prepare(
      `INSERT INTO api_monitor_records
       (id, user_id, conversation_id, request_json, response_raw_text, is_complete,
        prompt_tokens, completion_tokens, total_tokens,
        error_category, error_code, error_message, error_suggestion, internal_events)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      userId,
      record.conversationId,
      record.requestJson ?? '',
      record.responseRawText ?? '',
      record.isComplete ? 1 : 0,
      record.promptTokens ?? null,
      record.completionTokens ?? null,
      record.totalTokens ?? null,
      record.errorCategory ?? null,
      record.errorCode ?? null,
      record.errorMessage ?? null,
      record.errorSuggestion ?? null,
      record.internalEvents ?? null,
    );
    return id;
  }

  /**
   * 更新 API 监控记录。仅更新传入的非 undefined 字段。
   * @security WHERE 条件包含 user_id，确保只能更新自己的记录。
   * @returns 是否有记录被更新
   */
  updateMonitorRecord(
    userId: string,
    id: string,
    updates: {
      requestJson?: string;
      responseRawText?: string;
      isComplete?: boolean;
      promptTokens?: number | null;
      completionTokens?: number | null;
      totalTokens?: number | null;
      errorCategory?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      errorSuggestion?: string | null;
    },
  ): boolean {
    const db = getDb();
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.requestJson !== undefined) {
      sets.push('request_json = ?');
      params.push(updates.requestJson);
    }
    if (updates.responseRawText !== undefined) {
      sets.push('response_raw_text = ?');
      params.push(updates.responseRawText);
    }
    if (updates.isComplete !== undefined) {
      sets.push('is_complete = ?');
      params.push(updates.isComplete ? 1 : 0);
    }
    if (updates.promptTokens !== undefined) {
      sets.push('prompt_tokens = ?');
      params.push(updates.promptTokens);
    }
    if (updates.completionTokens !== undefined) {
      sets.push('completion_tokens = ?');
      params.push(updates.completionTokens);
    }
    if (updates.totalTokens !== undefined) {
      sets.push('total_tokens = ?');
      params.push(updates.totalTokens);
    }
    if (updates.errorCategory !== undefined) {
      sets.push('error_category = ?');
      params.push(updates.errorCategory);
    }
    if (updates.errorCode !== undefined) {
      sets.push('error_code = ?');
      params.push(updates.errorCode);
    }
    if (updates.errorMessage !== undefined) {
      sets.push('error_message = ?');
      params.push(updates.errorMessage);
    }
    if (updates.errorSuggestion !== undefined) {
      sets.push('error_suggestion = ?');
      params.push(updates.errorSuggestion);
    }

    if (sets.length === 0) return false;

    params.push(userId, id);
    const result = db
      .prepare(`UPDATE api_monitor_records SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`)
      .run(...params);
    return result.changes > 0;
  }

  /** 更新监控记录的 internal_events 字段（内部事件日志，供调试用） */
  updateMonitorRecordInternalEvents(userId: string, id: string, internalEvents: string): boolean {
    const db = getDb();
    const result = db
      .prepare('UPDATE api_monitor_records SET internal_events = ? WHERE user_id = ? AND id = ?')
      .run(internalEvents, userId, id);
    return result.changes > 0;
  }

  /** 删除指定会话的所有 API 监控记录 */
  deleteMonitorRecordsByConversation(userId: string, conversationId: string): number {
    const db = getDb();
    const result = db
      .prepare('DELETE FROM api_monitor_records WHERE user_id = ? AND conversation_id = ?')
      .run(userId, conversationId);
    return result.changes;
  }

  /**
   * 删除旧记录，仅保留最近 keepCount 条。使用子查询选取保留的记录 ID。
   * @security 子查询中也包含 user_id 条件，防止跨用户删除。
   */
  deleteOldMonitorRecords(userId: string, conversationId: string, keepCount: number): number {
    const db = getDb();
    const result = db
      .prepare(
        `DELETE FROM api_monitor_records
         WHERE user_id = ? AND conversation_id = ?
         AND id NOT IN (
           SELECT id FROM api_monitor_records
           WHERE user_id = ? AND conversation_id = ?
           ORDER BY created_at DESC
           LIMIT ?
         )`,
      )
      .run(userId, conversationId, userId, conversationId, keepCount);
    return result.changes;
  }

  /** 删除用户的所有 API 监控记录 */
  deleteAllMonitorRecords(userId: string): number {
    const db = getDb();
    const result = db.prepare('DELETE FROM api_monitor_records WHERE user_id = ?').run(userId);
    return result.changes;
  }
}

let monitorService: MonitorService | null = null;

/** 获取 MonitorService 单例 */
export function getMonitorService(): MonitorService {
  if (!monitorService) {
    monitorService = new MonitorService();
  }
  return monitorService;
}

/**
 * 记录子代理活动。写入失败时仅记录日志，不抛异常（监控不应影响主流程）。
 * @security user_id 从参数获取，确保活动记录归属正确用户。
 */
export function recordActivity(
  userId: string,
  activity: Omit<SubAgentActivity, 'id' | 'user_id'>,
): void {
  try {
    const db = getDb();
    const id = generateId('sub_agent_activities');
    db.prepare(
      'INSERT INTO sub_agent_activities (id, user_id, type, timestamp, success, metadata, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      userId,
      activity.type,
      activity.timestamp,
      activity.success ? 1 : 0,
      JSON.stringify(activity.metadata),
      activity.summary,
    );
  } catch (e) {
    logger.error('记录 sub-agent 活动失败: %s', e instanceof Error ? e.message : String(e));
  }
}

/** 删除用户的所有子代理活动记录 */
export function deleteAllActivities(userId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM sub_agent_activities WHERE user_id = ?').run(userId);
  return result.changes;
}
