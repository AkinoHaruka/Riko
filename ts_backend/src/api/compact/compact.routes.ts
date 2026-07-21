/**
 * 上下文压缩路由模块
 *
 * 职责：提供手动触发上下文压缩和查询压缩状态（令牌使用情况）的端点。
 * 当对话消息过多导致 token 接近模型上限时，通过压缩将历史消息摘要化，
 * 保留近期对话，释放 token 空间。
 *
 * 端点概览：
 *   POST /compact          — 手动触发会话上下文压缩
 *   GET  /compact/status   — 查询会话的令牌使用量和警告状态
 */
import type { FastifyInstance } from 'fastify';
import { getCurrentUser } from '../../core/middleware/index.js';
import { getDb } from '../../core/database/connection.js';
import { generateId } from '../../core/utils/id.js';
import { eventManager } from '../../core/events/manager.js';
import {
  compactConversation,
  runPostCompactCleanup,
  messagesToCompactMessages,
  restoreRecentMessages,
} from '../../domain/compact/service.js';
import {
  estimateMessagesTokens,
  calculateTokenWarningState,
} from '../../domain/compact/tokenEstimator.js';
import { listByConversation } from '../../domain/message/repository.js';
import { compactSchema, errorResponse } from '../../core/validation/schemas.js';

export async function compactRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /compact
   * 手动触发会话上下文压缩。
   *
   * 请求体：
   *   - conversation_id: string — 目标会话 ID（必填）
   *   - model: string — 用于压缩的模型，默认 deepseek-v4-pro（可选）
   *   - custom_instructions: string — 自定义压缩指令（可选）
   *
   * 响应：{ success: boolean, pre_compact_tokens: number, post_compact_tokens: number, will_retrigger: boolean }
   *
   * @security 验证会话所有权：通过 user_id 比对确保用户只能压缩自己的会话
   */
  app.post('/compact', async (request, reply) => {
    const parsed = compactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data;
    const user = getCurrentUser(request);

    // @security 会话所有权校验：防止用户压缩他人会话
    const db = getDb();
    const row = db
      .prepare('SELECT user_id FROM conversations WHERE id = ?')
      .get(body.conversation_id) as { user_id: string } | undefined;

    if (!row) {
      return reply.status(404).send({ error: '会话不存在' });
    }
    if (row.user_id !== user.userId) {
      return reply.status(403).send({ error: '无权访问此会话' });
    }

    try {
      const dbMessages = listByConversation(body.conversation_id, user.userId);
      const messages = messagesToCompactMessages(dbMessages);

      const model = body.model ?? 'deepseek-v4-pro';

      const result = await compactConversation(
        messages,
        body.conversation_id,
        user.userId,
        model,
        false,
        body.custom_instructions,
      );

      // 在事务中执行压缩相关的数据库写操作，保证原子性
      const transaction = db.transaction(() => {
        // Step 1: 将所有现有消息标记为已压缩
        db.prepare('UPDATE messages SET is_compact_summary = 1 WHERE conversation_id = ?').run(
          body.conversation_id,
        );

        // Step 2: 将近期消息恢复为未压缩状态
        // 使用内容计数器匹配，因为同一内容可能出现多次，需精确还原数量
        const allMessages = db
          .prepare(
            'SELECT id, role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC',
          )
          .all(body.conversation_id) as Array<{ id: string; role: string; content: string }>;

        const restoredIds = restoreRecentMessages(result.recentMessages, allMessages);
        for (const id of restoredIds) {
          db.prepare('UPDATE messages SET is_compact_summary = 0 WHERE id = ?').run(id);
        }

        // Step 3: 插入压缩边界标记和摘要消息
        const boundaryId = generateId('messages');
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, reasoning_content, is_compact_summary, compact_metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(
          boundaryId,
          body.conversation_id,
          result.boundaryMarker.role,
          result.boundaryMarker.content,
          '',
          0,
          result.boundaryMarker.compact_metadata ?? null,
        );
        for (const msg of result.summaryMessages) {
          const summaryId = generateId('messages');
          db.prepare(
            'INSERT INTO messages (id, conversation_id, role, content, reasoning_content, is_compact_summary, compact_metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ).run(
            summaryId,
            body.conversation_id,
            msg.role,
            msg.content,
            msg.reasoning_content ?? '',
            1,
            null,
          );
        }
      });

      transaction();

      await runPostCompactCleanup(body.conversation_id);

      eventManager.broadcast('messages_compacted', { conversation_id: body.conversation_id });

      // 提取子代理追踪信息，用于生成压缩活动摘要
      const resultExtra = result as unknown as Record<string, unknown>;
      const compactTrace = resultExtra['subAgentTrace'];
      let modelOutput = '';
      if (compactTrace && typeof compactTrace === 'object') {
        const trace = compactTrace as Record<string, unknown>;
        const turns = (trace['turns'] as Array<Record<string, unknown>>) ?? [];
        modelOutput = turns
          .map((t) => (t['modelResponse'] as string) ?? '')
          .filter(Boolean)
          .join('\n\n');
      }
      eventManager.broadcast('compact_activity', {
        conversation_id: body.conversation_id,
        timestamp: new Date().toISOString(),
        trigger_type: 'manual',
        pre_compact_tokens: result.preCompactTokenCount,
        post_compact_tokens: result.truePostCompactTokenCount,
        recent_dialogue_tokens: estimateMessagesTokens(result.recentMessages),
        strategy: compactTrace ? 'sub_agent' : 'unknown',
        summary:
          modelOutput ||
          `Manual compact: ${result.preCompactTokenCount} → ${result.truePostCompactTokenCount} tokens`,
        success: true,
        trace: compactTrace ?? null,
      });

      return {
        success: true,
        pre_compact_tokens: result.preCompactTokenCount,
        post_compact_tokens: result.truePostCompactTokenCount,
        will_retrigger: result.willRetriggerNextTurn,
      };
    } catch (e) {
      return reply.status(500).send({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /**
   * GET /compact/status
   * 查询指定会话的令牌使用情况和警告状态，供前端展示压缩提示。
   *
   * 查询参数：
   *   - conversation_id: string — 目标会话 ID（必填）
   *   - model: string — 模型名称，默认 deepseek-v4-pro（可选）
   *
   * 响应：{ token_usage: number, warning_state: string, message_count: number }
   *
   * @security 验证会话所有权，防止越权查询
   */
  app.get('/compact/status', async (request, reply) => {
    const query = request.query as { conversation_id?: string; model?: string };
    const user = getCurrentUser(request);

    if (!query.conversation_id) {
      return reply.status(400).send({ error: 'conversation_id 不能为空' });
    }

    const conversationId = query.conversation_id;

    try {
      // @security 会话所有权校验
      const db = getDb();
      const row = db
        .prepare('SELECT user_id FROM conversations WHERE id = ?')
        .get(conversationId) as { user_id: string } | undefined;

      if (!row) {
        return reply.status(404).send({ error: '会话不存在' });
      }
      if (row.user_id !== user.userId) {
        return reply.status(403).send({ error: '无权访问此会话' });
      }

      const dbMessages = listByConversation(conversationId, user.userId);
      const messages = messagesToCompactMessages(dbMessages);

      const model = query.model ?? 'deepseek-v4-pro';
      const tokenUsage = estimateMessagesTokens(messages);
      const warningState = calculateTokenWarningState(tokenUsage, model);

      return {
        token_usage: tokenUsage,
        warning_state: warningState,
        message_count: messages.length,
      };
    } catch (e) {
      return reply.status(500).send({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
