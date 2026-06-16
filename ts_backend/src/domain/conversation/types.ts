/**
 * 对话领域类型定义。
 * 定义对话实体、创建请求和更新请求的数据结构。
 */

/** 对话实体，对应 conversations 表 */
export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  is_archived: number;
  background: string | null;
  created_at: string;
  updated_at: string;
}

/** 创建对话请求 */
export interface CreateConversationRequest {
  title: string;
}

/** 更新对话请求，所有字段可选 */
export interface UpdateConversationRequest {
  title?: string | null;
  is_archived?: number | null;
  background?: string | null;
}
