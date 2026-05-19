// 上下文压缩 API：手动触发压缩、查询压缩状态和令牌使用情况
import type { FastifyInstance } from 'fastify';
import { getCurrentUser } from '../../core/middleware/index.js';
import { getDb } from '../../core/database/index.js';
import { generateId } from '../../core/utils/id.js';
import { eventManager } from '../../core/events/manager.js';
import {
  compactConversation,
  runPostCompactCleanup,
  messagesToCompactMessages,
} from '../../domain/compact/service.js';
import {
  estimateMessagesTokens,
  calculateTokenWarningState,
} from '../../domain/compact/tokenEstimator.js';
import { listByConversation } from '../../domain/message/repository.js';
import { compactSchema, errorResponse } from '../../core/validation/schemas.js';

export async function compactRoutes(app: FastifyInstance): Promise<void> {
  app.post('/compact', async (request, reply) => {
    const parsed = compactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data;
    const user = getCurrentUser(request);

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

      // Step 1: Mark all existing messages as compacted
      db.prepare('UPDATE messages SET is_compact_summary = 1 WHERE conversation_id = ?').run(
        body.conversation_id,
      );

      // Step 2: Keep recent messages marked as not compacted
      const recentContentCounts = new Map<string, number>();
      for (const m of result.recentMessages) {
        const key = `${m.role}|${m.content}`;
        recentContentCounts.set(key, (recentContentCounts.get(key) ?? 0) + 1);
      }
      const allMessages = db
        .prepare(
          'SELECT id, role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC',
        )
        .all(body.conversation_id) as Array<{ id: string; role: string; content: string }>;

      for (const msg of allMessages) {
        if (recentContentCounts.size === 0) break;
        const key = `${msg.role}|${msg.content}`;
        const count = recentContentCounts.get(key);
        if (count !== undefined) {
          db.prepare('UPDATE messages SET is_compact_summary = 0 WHERE id = ?').run(msg.id);
          if (count > 1) {
            recentContentCounts.set(key, count - 1);
          } else {
            recentContentCounts.delete(key);
          }
        }
      }

      // Step 3: Insert compaction boundary and summary
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

      await runPostCompactCleanup(body.conversation_id);

      eventManager.broadcast('messages_compacted', { conversation_id: body.conversation_id });

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
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.get('/compact/status', async (request, reply) => {
    const query = request.query as { conversation_id?: string; model?: string };
    const user = getCurrentUser(request);

    if (!query.conversation_id) {
      return reply.status(400).send({ error: 'conversation_id 不能为空' });
    }

    const conversationId = query.conversation_id;

    try {
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
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
