/**
 * 消息类型定义。Message 对应数据库 messages 表，支持普通消息和压缩摘要消息。
 * is_compact_summary 标记该消息是否为上下文压缩生成的摘要。
 * compact_metadata 存储 JSON 格式的压缩元数据（如来源、触发类型）。
 */

/** 数据库 messages 表的行映射 */
export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  /** 推理内容（DeepSeek 推理模型的思维链输出） */
  reasoning_content: string;
  /** 是否为压缩摘要消息：0=普通消息，1=压缩摘要 */
  is_compact_summary: number;
  /** 压缩元数据 JSON，包含 source、trigger_type 等信息 */
  compact_metadata: string | null;
  created_at: string;
}

/** 创建消息请求 */
export interface CreateMessageRequest {
  conversation_id: string;
  role: string;
  content: string;
  reasoning_content?: string;
  is_compact_summary?: boolean;
  compact_metadata?: string | null;
}

/** 更新消息请求，仅允许更新内容和推理内容 */
export interface UpdateMessageRequest {
  content?: string | null;
  reasoning_content?: string | null;
}

/** 分页消息列表响应 */
export interface MessageListResponse {
  messages: Message[];
  total: number;
  limit: number;
  offset: number;
}

/** 消息列表返回类型：无分页参数时返回数组，有分页参数时返回带 total/limit/offset 的结构体 */
export type MessageListResult = Message[] | MessageListResponse;
