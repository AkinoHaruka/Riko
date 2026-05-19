/**
 * 消息业务逻辑。含创建/查询/更新/删除，操作后广播事件。
 * skipBroadcast 参数用于流式场景：SSE 推流期间的消息内容更新由 ChatNotifier 自行同步，避免重复广播。
 */
import { eventManager } from '../../core/events/index.js';
import { HttpError } from '../../core/utils/index.js';
import * as repo from './repository.js';
import type {
  Message,
  CreateMessageRequest,
  UpdateMessageRequest,
  MessageListResult,
} from './types.js';

export function createMessage(userId: string, req: CreateMessageRequest): Message {
  const owned = repo.verifyConversationOwnership(req.conversation_id, userId);
  if (!owned) {
    throw new HttpError(404, '会话不存在或无权限');
  }

  const message = repo.create(req);
  repo.updateConversationTimestamp(req.conversation_id);

  eventManager.broadcast('message_created', message);
  eventManager.broadcast('conversation_updated', {
    id: req.conversation_id,
    updated_at: new Date().toISOString(),
  });

  return message;
}

export function listMessages(
  userId: string,
  conversationId: string,
  limit?: number,
  offset?: number,
): MessageListResult {
  const owned = repo.verifyConversationOwnership(conversationId, userId);
  if (!owned) {
    return [];
  }

  if (limit !== undefined || offset !== undefined) {
    const actualLimit = limit ?? 50;
    const actualOffset = offset ?? 0;
    const result = repo.listByConversationPaginated(
      conversationId,
      userId,
      actualLimit,
      actualOffset,
    );
    return {
      messages: result.messages,
      total: result.total,
      limit: actualLimit,
      offset: actualOffset,
    };
  }

  return repo.listByConversation(conversationId, userId);
}

export function updateMessage(
  userId: string,
  id: string,
  req: UpdateMessageRequest,
  skipBroadcast?: boolean,
): { message: string } {
  if (
    (req.content === undefined || req.content === null) &&
    (req.reasoning_content === undefined || req.reasoning_content === null)
  ) {
    throw new HttpError(400, '请提供需要更新的字段');
  }

  const found = repo.findMessageWithConversationId(id, userId);
  if (!found) {
    throw new HttpError(404, '消息不存在或无权限');
  }

  const fields: Partial<Pick<Message, 'content' | 'reasoning_content'>> = {};
  if (req.content !== undefined && req.content !== null) {
    fields.content = req.content;
  }
  if (req.reasoning_content !== undefined && req.reasoning_content !== null) {
    fields.reasoning_content = req.reasoning_content;
  }

  repo.update(id, fields);

  if (!skipBroadcast) {
    eventManager.broadcast('message_updated', {
      id,
      conversation_id: found.conversation_id,
    });
  }

  return { message: '更新成功' };
}

export function deleteMessage(userId: string, id: string): { message: string } {
  const found = repo.findMessageWithConversationId(id, userId);
  if (!found) {
    throw new HttpError(404, '消息不存在或无权限');
  }

  repo.deleteById(id);

  eventManager.broadcast('message_deleted', {
    id,
    conversation_id: found.conversation_id,
  });

  return { message: '删除成功' };
}

export function batchDeleteMessages(
  userId: string,
  conversationId: string,
): { message: string; deleted_count: number } {
  const owned = repo.verifyConversationOwnership(conversationId, userId);
  if (!owned) {
    throw new HttpError(404, '会话不存在或无权限');
  }

  const deletedCount = repo.deleteByConversationId(conversationId);

  eventManager.broadcast('message_deleted', { conversation_id: conversationId });

  return { message: '删除成功', deleted_count: deletedCount };
}
