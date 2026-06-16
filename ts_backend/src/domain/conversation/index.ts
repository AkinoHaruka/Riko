/**
 * 对话领域模块入口。
 * 统一导出对话相关的类型定义、数据访问层和服务层函数。
 */
export type {
  Conversation,
  CreateConversationRequest,
  UpdateConversationRequest,
} from './types.js';
export { findById, findByUserId, create, update, deleteWithMessages } from './repository.js';
export {
  createConversation,
  listConversations,
  updateConversation,
  deleteConversation,
} from './service.js';
