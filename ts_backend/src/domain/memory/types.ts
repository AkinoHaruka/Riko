/**
 * 记忆领域类型定义。
 * 定义记忆实体和创建请求的数据结构。
 */

/** 记忆实体，对应 memories 表 */
export interface Memory {
  id: string;
  user_id: string;
  key: string;
  content: string;
  source: string;
  type: string;
  created_at: string;
}

/** 创建记忆请求 */
export interface MemoryCreateRequest {
  key: string;
  content: string;
  source?: string;
  type?: string;
  user_id?: string;
}
