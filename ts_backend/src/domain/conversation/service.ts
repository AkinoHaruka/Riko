/**
 * 对话 CRUD 业务逻辑。
 * 操作成功后广播事件通知 WebSocket 客户端。
 * 包含输入验证和审计日志记录。
 */
import { eventManager } from '../../core/events/index.js';
import { createLogger } from '../../core/logger/index.js';
import { HttpError } from '../../core/utils/index.js';
import * as repo from './repository.js';
import type { Conversation, UpdateConversationRequest } from './types.js';

const logger = createLogger('conversation');

/**
 * 创建新对话。
 * @param userId - 用户 ID
 * @param title - 对话标题
 * @returns 创建后的对话对象
 * @throws {HttpError} 400 标题为空
 */
export function createConversation(userId: string, title: string): Conversation {
  if (title == null || typeof title !== 'string') {
    throw new HttpError(400, '会话标题不能为空');
  }
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new HttpError(400, '会话标题不能为空');
  }

  logger.info('[审计] 用户ID:%s 执行了 创建会话 操作，标题: %s', userId, trimmedTitle);

  const conversation = repo.create(userId, trimmedTitle);
  eventManager.broadcast('conversation_created', conversation);

  return conversation;
}

/**
 * 获取用户的所有对话列表。
 * @param userId - 用户 ID
 * @returns 对话列表
 */
export function listConversations(userId: string): Conversation[] {
  return repo.findByUserId(userId);
}

/**
 * 更新对话的指定字段。
 * @param id - 对话 ID
 * @param userId - 用户 ID
 * @param req - 更新请求
 * @returns 更新后的对话对象
 * @throws {HttpError} 400 无有效更新字段 / 404 对话不存在或无权访问
 */
export function updateConversation(
  id: string,
  userId: string,
  req: UpdateConversationRequest,
): Conversation {
  if (
    (req.title === undefined || req.title === null) &&
    (req.is_archived === undefined || req.is_archived === null) &&
    req.background === undefined
  ) {
    throw new HttpError(400, '请提供需要更新的字段（title、is_archived 或 background）');
  }

  if (
    req.is_archived !== undefined &&
    req.is_archived !== null &&
    req.is_archived !== 0 &&
    req.is_archived !== 1
  ) {
    throw new HttpError(400, 'is_archived 必须为 0 或 1');
  }

  if (
    req.title !== undefined &&
    req.title !== null &&
    (typeof req.title !== 'string' || !req.title.trim())
  ) {
    throw new HttpError(400, 'title 不能为空字符串');
  }

  const fields: Partial<Pick<Conversation, 'title' | 'is_archived' | 'background'>> = {};
  if (req.title !== undefined && req.title !== null) {
    fields.title = req.title.trim();
  }
  if (req.is_archived !== undefined && req.is_archived !== null) {
    fields.is_archived = req.is_archived;
  }
  if (req.background !== undefined) {
    fields.background = req.background;
  }

  const updated = repo.update(id, userId, fields);
  if (!updated) {
    throw new HttpError(404, '会话不存在或无权访问');
  }

  eventManager.broadcast('conversation_updated', updated);

  return updated;
}

/**
 * 删除对话及其所有关联数据。
 * @security 通过 userId 确保只能删除自己的对话。
 * @param id - 对话 ID
 * @param userId - 用户 ID
 * @returns 删除结果消息
 * @throws {HttpError} 404 对话不存在或无权访问
 */
export function deleteConversation(id: string, userId: string): { message: string } {
  const deleted = repo.deleteWithMessages(id, userId);
  if (!deleted) {
    throw new HttpError(404, '会话不存在或无权访问');
  }

  eventManager.broadcast('conversation_deleted', { id });

  logger.info('[审计] 用户ID:%s 执行了 删除会话 操作，会话ID: %s', userId, id);

  return { message: '删除成功' };
}
