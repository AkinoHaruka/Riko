/**
 * 消息模块入口。导出消息相关的类型、业务函数和数据访问函数。
 * 消息隶属于会话（conversation），所有操作均需通过 user_id 校验所有权。
 */
export type {
  Message,
  CreateMessageRequest,
  UpdateMessageRequest,
  MessageListResponse,
  MessageListResult,
} from './types.js';
export {
  createMessage,
  listMessages,
  updateMessage,
  deleteMessage,
  batchDeleteMessages,
} from './service.js';
export {
  verifyConversationOwnership,
  create,
  updateConversationTimestamp,
  listByConversation,
  listByConversationPaginated,
  findById,
  update,
  deleteById,
  deleteByConversationId,
} from './repository.js';
