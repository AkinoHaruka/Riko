/**
 * Monitor 领域单元测试
 *
 * 覆盖 MonitorService 类（API 监控记录 CRUD + 子代理活动查询）
 * 和模块级函数 recordActivity / deleteAllActivities。
 *
 * 重点验证：
 * 1. 用户隔离：所有查询和更新均通过 user_id 过滤，跨用户操作不可见
 * 2. 类型转换：is_complete / success 的 0/1 → boolean
 * 3. 默认值：可选字段未提供时正确写入默认值
 * 4. 更新语义：仅更新传入的非 undefined 字段
 * 5. 删除语义：deleteOldMonitorRecords 子查询包含 user_id 防止跨用户删除
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getDb } from '../../../src/core/database/index.js';
import { generateId } from '../../../src/core/utils/id.js';
import {
  getMonitorService,
  recordActivity,
  deleteAllActivities,
  type ApiMonitorRecord,
  type SubAgentActivity,
} from '../../../src/domain/monitor/service.js';

/** 创建测试用户，返回用户 ID */
function createTestUser(username: string): string {
  const db = getDb();
  const id = generateId('users');
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(id, username, 'testhash');
  return id;
}

/** 创建测试会话，返回会话 ID（外键约束要求先创建对应 conversation） */
function createTestConversation(userId: string, title: string): string {
  const db = getDb();
  const id = generateId('conversations');
  db.prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)')
    .run(id, userId, title);
  return id;
}

describe('Monitor 领域 - MonitorService', () => {
  let userId: string;
  let otherUserId: string;
  let convId: string;
  let otherConvId: string;
  let service: ReturnType<typeof getMonitorService>;

  beforeEach(async () => {
    closeDb();
    await initDb();
    userId = createTestUser('user_a');
    otherUserId = createTestUser('user_b');
    // 为两个用户分别创建一个会话，用于 monitor 记录的外键约束
    convId = createTestConversation(userId, 'Conversation A');
    otherConvId = createTestConversation(otherUserId, 'Conversation B');
    service = getMonitorService();
  });

  afterEach(() => {
    closeDb();
  });

  // ─── API Monitor Records ──────────────────────────────────

  describe('insertMonitorRecord / getMonitorRecords', () => {
    it('插入记录并按 user_id 隔离查询', () => {
      const id = service.insertMonitorRecord(userId, {
        conversationId: convId,
        requestJson: '{"model":"deepseek-v4-flash"}',
        responseRawText: 'hello',
        isComplete: true,
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      });

      // 另一用户插入一条
      service.insertMonitorRecord(otherUserId, {
        conversationId: otherConvId,
        requestJson: '{}',
      });

      const records = service.getMonitorRecords(userId, { conversationId: convId });
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(id);
      expect(records[0].user_id).toBe(userId);
      expect(records[0].is_complete).toBe(true);
      expect(records[0].prompt_tokens).toBe(10);
      expect(records[0].total_tokens).toBe(30);
    });

    it('可选字段未提供时使用默认值', () => {
      const id = service.insertMonitorRecord(userId, { conversationId: convId });

      const records = service.getMonitorRecords(userId, { conversationId: convId });
      expect(records).toHaveLength(1);
      const r = records[0];
      expect(r.id).toBe(id);
      expect(r.request_json).toBe('');
      expect(r.response_raw_text).toBe('');
      expect(r.is_complete).toBe(false);
      expect(r.prompt_tokens).toBeNull();
      expect(r.error_code).toBeNull();
      expect(r.internal_events).toBeNull();
    });

    it('跨用户查询返回空列表（隔离校验）', () => {
      service.insertMonitorRecord(userId, { conversationId: convId });
      // otherUserId 查询 convId 的记录，应返回空（user_id 隔离）
      const otherRecords = service.getMonitorRecords(otherUserId, { conversationId: convId });
      expect(otherRecords).toHaveLength(0);
    });

    it('支持 limit 和 offset 分页', () => {
      for (let i = 0; i < 5; i++) {
        service.insertMonitorRecord(userId, { conversationId: convId });
      }
      const page1 = service.getMonitorRecords(userId, { conversationId: convId, limit: 2, offset: 0 });
      const page2 = service.getMonitorRecords(userId, { conversationId: convId, limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      // 分页不重叠
      const ids1 = new Set(page1.map((r) => r.id));
      const ids2 = new Set(page2.map((r) => r.id));
      for (const id of ids2) expect(ids1.has(id)).toBe(false);
    });
  });

  describe('getMonitorRecordCount', () => {
    it('按 user_id 隔离计数', () => {
      service.insertMonitorRecord(userId, { conversationId: convId });
      service.insertMonitorRecord(userId, { conversationId: convId });
      service.insertMonitorRecord(otherUserId, { conversationId: otherConvId });

      expect(service.getMonitorRecordCount(userId, convId)).toBe(2);
      expect(service.getMonitorRecordCount(otherUserId, otherConvId)).toBe(1);
    });

    it('不存在的会话返回 0', () => {
      expect(service.getMonitorRecordCount(userId, 'nonexistent_conv')).toBe(0);
    });
  });

  describe('updateMonitorRecord', () => {
    it('仅更新传入的字段（部分更新语义）', () => {
      const id = service.insertMonitorRecord(userId, {
        conversationId: convId,
        requestJson: 'old_req',
        promptTokens: 10,
      });

      const updated = service.updateMonitorRecord(userId, id, {
        responseRawText: 'new_resp',
        isComplete: true,
        completionTokens: 50,
      });

      expect(updated).toBe(true);
      const records = service.getMonitorRecords(userId, { conversationId: convId });
      const r = records.find((x) => x.id === id);
      expect(r?.response_raw_text).toBe('new_resp');
      expect(r?.is_complete).toBe(true);
      expect(r?.completion_tokens).toBe(50);
      // 未更新的字段保持原值
      expect(r?.request_json).toBe('old_req');
      expect(r?.prompt_tokens).toBe(10);
    });

    it('不传入任何更新字段时返回 false', () => {
      const id = service.insertMonitorRecord(userId, { conversationId: convId });
      const result = service.updateMonitorRecord(userId, id, {});
      expect(result).toBe(false);
    });

    it('跨用户更新不生效（WHERE user_id 隔离）', () => {
      const id = service.insertMonitorRecord(userId, { conversationId: convId });
      const result = service.updateMonitorRecord(otherUserId, id, { responseRawText: 'hacked' });
      expect(result).toBe(false);

      const records = service.getMonitorRecords(userId, { conversationId: convId });
      expect(records[0].response_raw_text).toBe('');
    });

    it('可将 error 字段从 null 显式更新为字符串', () => {
      const id = service.insertMonitorRecord(userId, { conversationId: convId });
      service.updateMonitorRecord(userId, id, {
        errorCategory: 'api_error',
        errorCode: 'RATE_LIMIT',
        errorMessage: '请求过于频繁',
      });
      const r = service.getMonitorRecords(userId, { conversationId: convId }).find((x) => x.id === id);
      expect(r?.error_category).toBe('api_error');
      expect(r?.error_code).toBe('RATE_LIMIT');
      expect(r?.error_message).toBe('请求过于频繁');
    });
  });

  describe('updateMonitorRecordInternalEvents', () => {
    it('单独更新 internal_events 字段', () => {
      const id = service.insertMonitorRecord(userId, { conversationId: convId });
      const ok = service.updateMonitorRecordInternalEvents(userId, id, '{"event":"compact"}');
      expect(ok).toBe(true);
      const r = service.getMonitorRecords(userId, { conversationId: convId }).find((x) => x.id === id);
      expect(r?.internal_events).toBe('{"event":"compact"}');
    });

    it('跨用户更新 internal_events 不生效', () => {
      const id = service.insertMonitorRecord(userId, { conversationId: convId });
      const ok = service.updateMonitorRecordInternalEvents(otherUserId, id, 'hacked');
      expect(ok).toBe(false);
    });
  });

  describe('deleteMonitorRecordsByConversation', () => {
    it('删除指定会话的所有记录（按 user_id 隔离）', () => {
      service.insertMonitorRecord(userId, { conversationId: convId });
      service.insertMonitorRecord(userId, { conversationId: convId });
      service.insertMonitorRecord(userId, { conversationId: createTestConversation(userId, 'other') });
      // 其他用户在自己的会话上插入记录
      service.insertMonitorRecord(otherUserId, { conversationId: otherConvId });

      const deleted = service.deleteMonitorRecordsByConversation(userId, convId);
      expect(deleted).toBe(2);
      // 其他会话保留
      expect(service.getMonitorRecords(userId, { conversationId: convId })).toHaveLength(0);
      // 其他用户记录保留
      expect(service.getMonitorRecordCount(otherUserId, otherConvId)).toBe(1);
    });
  });

  describe('deleteOldMonitorRecords', () => {
    it('仅保留最近 N 条，删除其余（按 user_id 隔离）', () => {
      // 插入 5 条同会话记录
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(service.insertMonitorRecord(userId, { conversationId: convId }));
      }
      // 其他用户在自己的会话插入记录（不应被删除）
      service.insertMonitorRecord(otherUserId, { conversationId: otherConvId });

      const deleted = service.deleteOldMonitorRecords(userId, convId, 2);
      expect(deleted).toBe(3); // 5 - 2 = 3

      const remaining = service.getMonitorRecords(userId, { conversationId: convId });
      expect(remaining).toHaveLength(2);
      // 其他用户记录保留
      expect(service.getMonitorRecordCount(otherUserId, otherConvId)).toBe(1);
    });
  });

  describe('deleteAllMonitorRecords', () => {
    it('删除用户所有监控记录（不影响其他用户）', () => {
      service.insertMonitorRecord(userId, { conversationId: convId });
      service.insertMonitorRecord(userId, { conversationId: createTestConversation(userId, 'c2') });
      service.insertMonitorRecord(otherUserId, { conversationId: otherConvId });

      const deleted = service.deleteAllMonitorRecords(userId);
      expect(deleted).toBe(2);
      expect(service.getMonitorRecordCount(otherUserId, otherConvId)).toBe(1);
    });
  });

  // ─── Sub-Agent Activities ──────────────────────────────────

  describe('recordActivity / getActivities', () => {
    it('记录子代理活动并按 user_id 查询', () => {
      recordActivity(userId, {
        type: 'session_memory',
        timestamp: new Date().toISOString(),
        success: true,
        metadata: { model: 'deepseek-v4-flash', turns: 3 },
        summary: '提取了 5 条笔记',
      });

      const activities = service.getActivities(userId, {});
      expect(activities).toHaveLength(1);
      expect(activities[0].user_id).toBe(userId);
      expect(activities[0].success).toBe(true);
      expect(activities[0].metadata.model).toBe('deepseek-v4-flash');
      expect(activities[0].summary).toBe('提取了 5 条笔记');
    });

    it('metadata 损坏时降级为空对象（不抛异常）', () => {
      const db = getDb();
      const id = generateId('sub_agent_activities');
      db.prepare(
        'INSERT INTO sub_agent_activities (id, user_id, type, timestamp, success, metadata, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, userId, 'compact', new Date().toISOString(), 1, '{invalid json', '损坏的元数据');

      const activities = service.getActivities(userId, {});
      expect(activities).toHaveLength(1);
      expect(activities[0].metadata).toEqual({});
      expect(activities[0].summary).toBe('损坏的元数据');
    });

    it('跨用户查询返回空（隔离校验）', () => {
      recordActivity(userId, {
        type: 'dream',
        timestamp: new Date().toISOString(),
        success: true,
        metadata: {},
        summary: '梦境整固',
      });
      const otherActivities = service.getActivities(otherUserId, {});
      expect(otherActivities).toHaveLength(0);
    });

    it('按 type 过滤活动记录', () => {
      recordActivity(userId, {
        type: 'session_memory',
        timestamp: new Date().toISOString(),
        success: true,
        metadata: {},
        summary: 'a1',
      });
      recordActivity(userId, {
        type: 'compact',
        timestamp: new Date().toISOString(),
        success: false,
        metadata: {},
        summary: 'a2',
      });

      const filtered = service.getActivities(userId, { type: 'compact' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe('compact');
    });
  });

  describe('getLatestActivities', () => {
    it('返回每种子代理类型的最新一条记录', () => {
      const ts1 = '2026-01-01T00:00:00.000Z';
      const ts2 = '2026-02-01T00:00:00.000Z';
      const ts3 = '2026-03-01T00:00:00.000Z';

      recordActivity(userId, { type: 'session_memory', timestamp: ts1, success: true, metadata: {}, summary: 's1' });
      recordActivity(userId, { type: 'session_memory', timestamp: ts2, success: true, metadata: {}, summary: 's2' });
      recordActivity(userId, { type: 'compact', timestamp: ts3, success: true, metadata: {}, summary: 'c1' });
      // dream 类型未插入

      const latest = service.getLatestActivities(userId);
      expect(latest.session_memory?.summary).toBe('s2');
      expect(latest.compact?.summary).toBe('c1');
      expect(latest.dream).toBeNull();
    });

    it('跨用户查询 latest 返回 null（隔离校验）', () => {
      recordActivity(userId, {
        type: 'dream',
        timestamp: new Date().toISOString(),
        success: true,
        metadata: {},
        summary: 'dream1',
      });
      const latest = service.getLatestActivities(otherUserId);
      expect(latest.session_memory).toBeNull();
      expect(latest.compact).toBeNull();
      expect(latest.dream).toBeNull();
    });
  });

  describe('deleteAllActivities', () => {
    it('删除用户所有活动记录（不影响其他用户）', () => {
      recordActivity(userId, {
        type: 'session_memory',
        timestamp: new Date().toISOString(),
        success: true,
        metadata: {},
        summary: 'a1',
      });
      recordActivity(otherUserId, {
        type: 'dream',
        timestamp: new Date().toISOString(),
        success: true,
        metadata: {},
        summary: 'other',
      });

      const deleted = deleteAllActivities(userId);
      expect(deleted).toBe(1);
      // 其他用户活动保留
      expect(service.getActivities(otherUserId, {})).toHaveLength(1);
    });
  });

  // ─── 类型完整性校验 ───────────────────────────────────────

  describe('类型转换', () => {
    it('ApiMonitorRecord 字段完整性', () => {
      const id = service.insertMonitorRecord(userId, {
        conversationId: convId,
        requestJson: 'req',
        responseRawText: 'resp',
        isComplete: false,
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        errorCategory: 'timeout',
        errorCode: 'TIMEOUT',
        errorMessage: '请求超时',
        errorSuggestion: '请重试',
        internalEvents: '{"event":"waiting"}',
      });

      const records: ApiMonitorRecord[] = service.getMonitorRecords(userId, { conversationId: convId });
      const r = records.find((x) => x.id === id)!;
      expect(r.is_complete).toBe(false);
      expect(r.prompt_tokens).toBe(100);
      expect(r.error_message).toBe('请求超时');
      expect(r.error_suggestion).toBe('请重试');
      expect(r.internal_events).toBe('{"event":"waiting"}');
    });

    it('SubAgentActivity 字段完整性', () => {
      recordActivity(userId, {
        type: 'compact',
        timestamp: '2026-01-01T00:00:00.000Z',
        success: false,
        metadata: { error: 'compact 失败', tokens: 5000 },
        summary: '压缩失败',
      });

      const activities: SubAgentActivity[] = service.getActivities(userId, {});
      const a = activities[0];
      expect(a.type).toBe('compact');
      expect(a.success).toBe(false);
      expect(a.metadata.error).toBe('compact 失败');
      expect(a.metadata.tokens).toBe(5000);
    });
  });
});
