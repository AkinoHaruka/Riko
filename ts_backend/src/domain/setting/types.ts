export interface Setting {
  id: string;
  user_id: string;
  key: string;
  value: string;
  is_encrypted: number;
  created_at: string;
  updated_at: string;
}

export interface SettingRequest {
  key: string;
  value: string;
}

export interface ApiKeyRequest {
  api_key: string;
}

export interface SaveSettingResult {
  message: string;
  key: string;
  is_encrypted: number;
}

export type ParamKey =
  | 'param_session_memory_min_messages'
  | 'param_session_memory_min_tokens_between_update'
  | 'param_session_memory_tool_calls_between_updates'
  | 'param_compact_trigger_tokens'
  | 'param_compact_recent_dialogue_tokens'
  | 'param_dream_min_hours'
  | 'param_dream_min_sessions';

export interface ParamConfig {
  key: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  group: 'session_memory' | 'compact' | 'dream';
}
