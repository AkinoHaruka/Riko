/**
 * 设置类型定义。Setting 对应数据库 settings 表，支持明文和加密存储。
 * ParamKey/ParamConfig 用于子代理参数的元数据描述（标签、范围、步长等）。
 */

/** 数据库 settings 表的行映射 */
export interface Setting {
  id: string;
  user_id: string;
  key: string;
  /** 值：明文或 AES 加密后的密文（由 is_encrypted 区分） */
  value: string;
  /** 是否加密存储：0=明文，1=AES 加密 */
  is_encrypted: number;
  created_at: string;
  updated_at: string;
}

/** 设置保存请求 */
export interface SettingRequest {
  key: string;
  value: string;
}

/** API Key 保存请求（支持指定 Provider） */
export interface ApiKeyRequest {
  api_key: string;
  /** Provider ID，默认 "deepseek"（向后兼容） */
  provider_id?: string;
}

/** 设置保存结果 */
export interface SaveSettingResult {
  message: string;
  key: string;
  is_encrypted: number;
}

/**
 * 参数键名联合类型。每个键对应一个可调参数，用于控制子代理行为。
 * 命名规则：param_{模块}_{具体参数名}
 */
export type ParamKey =
  | 'param_session_memory_min_messages'
  | 'param_session_memory_min_tokens_between_update'
  | 'param_session_memory_tool_calls_between_updates'
  | 'param_compact_trigger_tokens'
  | 'param_compact_recent_dialogue_tokens'
  | 'param_dream_min_hours'
  | 'param_dream_min_sessions';

/** 参数配置元数据，用于前端渲染滑块控件和后端校验 */
export interface ParamConfig {
  key: string;
  /** 显示标签 */
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  /** 参数分组：session_memory / compact / dream */
  group: 'session_memory' | 'compact' | 'dream';
}
