export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  reasoning_content: string;
  is_compact_summary: number;
  compact_metadata: string | null;
  created_at: string;
}

export interface CreateMessageRequest {
  conversation_id: string;
  role: string;
  content: string;
  reasoning_content?: string;
  is_compact_summary?: boolean;
  compact_metadata?: string | null;
}

export interface UpdateMessageRequest {
  content?: string | null;
  reasoning_content?: string | null;
}

export interface MessageListResponse {
  messages: Message[];
  total: number;
  limit: number;
  offset: number;
}

/** 消息列表返回类型：无分页参数时返回数组，有分页参数时返回带 total/limit/offset 的结构体 */
export type MessageListResult = Message[] | MessageListResponse;
