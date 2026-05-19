/**
 * 设置业务逻辑：用户配置的读写、API Key 加密存储、功能开关和参数管理。
 * 敏感字段自动加密，已废弃的 system_prompt 返回降级提示。
 */
import { encrypt, decrypt, isSensitive } from '../../core/encryption/index.js';
import { createLogger } from '../../core/logger/index.js';
import { HttpError } from '../../core/utils/index.js';
import { invalidateClientCache } from '../../core/ai/client.js';
import { loadMainPrompt } from '../../prompts/index.js';
import * as repo from './repository.js';
import type { Setting, SettingRequest, ApiKeyRequest, SaveSettingResult } from './types.js';

const logger = createLogger('setting');

export function saveSetting(userId: string, req: SettingRequest): SaveSettingResult {
  const { key, value } = req;

  if (!key || typeof key !== 'string') {
    throw new HttpError(400, 'key 不能为空且必须为字符串');
  }
  if (value === null || value === undefined) {
    throw new HttpError(400, 'value 不能为空');
  }

  let storedValue = value;
  let isEncrypted = 0;

  if (isSensitive(key)) {
    try {
      storedValue = encrypt(value);
      isEncrypted = 1;
    } catch (e) {
      logger.error(`加密失败: ${e instanceof Error ? e.message : e}`);
      throw new HttpError(500, '敏感字段加密失败');
    }
  }

  repo.upsert(userId, key, storedValue, isEncrypted);
  return { message: '设置已保存', key, is_encrypted: isEncrypted };
}

export function batchSaveSettings(
  userId: string,
  items: { key: string; value: string }[],
): { message: string; count: number } {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'items 必须为非空数组');
  }

  for (const item of items) {
    if (!item.key || typeof item.key !== 'string') {
      throw new HttpError(400, `key 不能为空`);
    }
    if (item.value === null || item.value === undefined) {
      throw new HttpError(400, `key=${item.key} 的 value 不能为空`);
    }

    let storedValue = item.value;
    let isEncrypted = 0;
    if (isSensitive(item.key)) {
      storedValue = encrypt(item.value);
      isEncrypted = 1;
    }
    repo.upsert(userId, item.key, storedValue, isEncrypted);
  }

  return { message: '设置已保存', count: items.length };
}

export function getSetting(userId: string, key: string): Setting {
  const setting = repo.findByKey(userId, key);
  if (!setting) {
    throw new HttpError(404, '设置不存在');
  }

  if (setting.is_encrypted === 1) {
    try {
      setting.value = decrypt(setting.value);
    } catch (e) {
      logger.error(`解密失败: ${e instanceof Error ? e.message : e}`);
      throw new HttpError(500, '解密失败，请检查加密密钥配置');
    }
  }

  return setting;
}

export function getAllSettings(userId: string): { settings: Setting[] } {
  const settings = repo.findAllByUserId(userId);
  for (const item of settings) {
    if (item.is_encrypted === 1) {
      try {
        item.value = decrypt(item.value);
      } catch (e) {
        logger.error(`解密字段 ${item.key} 失败: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  return { settings };
}

export function getApiKey(userId: string): { api_key: string } {
  const setting = repo.findByKey(userId, 'apikey_deepseek');
  if (!setting) {
    return { api_key: '' };
  }

  let value = setting.value;
  if (setting.is_encrypted === 1) {
    try {
      value = decrypt(value);
    } catch (e) {
      logger.error(`解密 API Key 失败: ${e instanceof Error ? e.message : e}`);
      return { api_key: '' };
    }
  }

  return { api_key: value };
}

export function saveApiKey(userId: string, req: ApiKeyRequest): { message: string } {
  const value = (req.api_key ?? '').trim();
  const key = 'apikey_deepseek';

  if (!value) {
    repo.deleteByKey(userId, key);
    return { message: 'API Key 已清除' };
  }

  let storedValue: string;
  try {
    storedValue = encrypt(value);
  } catch (e) {
    logger.error(`加密 API Key 失败: ${e instanceof Error ? e.message : e}`);
    throw new HttpError(500, 'API Key 加密失败');
  }

  repo.upsert(userId, key, storedValue, 1);

  // 使缓存的 AI 客户端失效，确保后续请求立即使用新的 API Key
  invalidateClientCache(userId);

  return { message: 'API Key 已保存' };
}

export function deleteSetting(userId: string, key: string): { message: string } {
  const deleted = repo.deleteByKey(userId, key);
  if (!deleted) {
    throw new HttpError(404, '设置不存在');
  }
  return { message: '设置已删除' };
}

// ========== 子代理开关功能 ==========

export interface FeatureToggles {
  session_memory: boolean;
  auto_compact: boolean;
  auto_dream: boolean;
}

const FEATURE_KEYS = [
  'feature_session_memory',
  'feature_auto_compact',
  'feature_auto_dream',
] as const;

/** 解析布尔值：未设置时默认开启，显式 'false' 时关闭 */
function parseBoolValue(value: string | undefined): boolean {
  if (value === undefined || value === null) return true;
  return value !== 'false';
}

export function getFeatureToggles(userId: string): FeatureToggles {
  const result: FeatureToggles = {
    session_memory: true,
    auto_compact: true,
    auto_dream: true,
  };

  const settings = repo.findByKeys(userId, [...FEATURE_KEYS]);
  for (const key of FEATURE_KEYS) {
    const setting = settings.get(key);
    const enabled = parseBoolValue(setting?.value);
    if (key === 'feature_session_memory') result.session_memory = enabled;
    else if (key === 'feature_auto_compact') result.auto_compact = enabled;
    else if (key === 'feature_auto_dream') result.auto_dream = enabled;
  }

  return result;
}

/** 查询单个功能开关是否启用 */
export function isFeatureEnabled(userId: string, key: string): boolean {
  const setting = repo.findByKey(userId, key);
  return parseBoolValue(setting?.value);
}

// ========== 参数配置功能 ==========

export const PARAM_KEYS = {
  SESSION_MEMORY_MIN_MESSAGES: 'param_session_memory_min_messages',
  SESSION_MEMORY_MIN_TOKENS_BETWEEN_UPDATE: 'param_session_memory_min_tokens_between_update',
  SESSION_MEMORY_TOOL_CALLS_BETWEEN_UPDATES: 'param_session_memory_tool_calls_between_updates',
  COMPACT_TRIGGER_TOKENS: 'param_compact_trigger_tokens',
  COMPACT_RECENT_DIALOGUE_TOKENS: 'param_compact_recent_dialogue_tokens',
  DREAM_MIN_HOURS: 'param_dream_min_hours',
  DREAM_MIN_SESSIONS: 'param_dream_min_sessions',
} as const;

export const PARAM_DEFAULTS: Record<string, number> = {
  [PARAM_KEYS.SESSION_MEMORY_MIN_MESSAGES]: 6,
  [PARAM_KEYS.SESSION_MEMORY_MIN_TOKENS_BETWEEN_UPDATE]: 2000,
  [PARAM_KEYS.SESSION_MEMORY_TOOL_CALLS_BETWEEN_UPDATES]: 3,
  [PARAM_KEYS.COMPACT_TRIGGER_TOKENS]: 200000,
  [PARAM_KEYS.COMPACT_RECENT_DIALOGUE_TOKENS]: 20000,
  [PARAM_KEYS.DREAM_MIN_HOURS]: 24,
  [PARAM_KEYS.DREAM_MIN_SESSIONS]: 5,
};

export function getParamValue(userId: string, key: string, defaultValue: string): string {
  const setting = repo.findByKey(userId, key);
  if (setting && setting.value !== undefined && setting.value !== null) {
    return setting.value;
  }
  return defaultValue;
}

export function getParamNumber(userId: string, key: string, defaultValue: number): number {
  const value = getParamValue(userId, key, String(defaultValue));
  const parsed = Number(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function getParamNumberWithDefault(userId: string, key: string): number {
  const defaultValue = PARAM_DEFAULTS[key] ?? 0;
  return getParamNumber(userId, key, defaultValue);
}

export const PARAM_CONFIGS: import('./types.js').ParamConfig[] = [
  {
    key: PARAM_KEYS.SESSION_MEMORY_MIN_MESSAGES,
    label: '初始化最小消息数',
    defaultValue: 6,
    min: 1,
    max: 100,
    step: 1,
    group: 'session_memory',
  },
  {
    key: PARAM_KEYS.SESSION_MEMORY_MIN_TOKENS_BETWEEN_UPDATE,
    label: '更新最小 Token 间隔',
    defaultValue: 2000,
    min: 100,
    max: 50000,
    step: 100,
    group: 'session_memory',
  },
  {
    key: PARAM_KEYS.SESSION_MEMORY_TOOL_CALLS_BETWEEN_UPDATES,
    label: '工具调用间隔次数',
    defaultValue: 3,
    min: 1,
    max: 50,
    step: 1,
    group: 'session_memory',
  },
  {
    key: PARAM_KEYS.COMPACT_TRIGGER_TOKENS,
    label: '压缩触发 Token 数',
    defaultValue: 200000,
    min: 10000,
    max: 1000000,
    step: 10000,
    group: 'compact',
  },
  {
    key: PARAM_KEYS.COMPACT_RECENT_DIALOGUE_TOKENS,
    label: '压缩保留近期对话 Token 数',
    defaultValue: 20000,
    min: 1000,
    max: 100000,
    step: 1000,
    group: 'compact',
  },
  {
    key: PARAM_KEYS.DREAM_MIN_HOURS,
    label: '梦境最小间隔小时数',
    defaultValue: 24,
    min: 1,
    max: 168,
    step: 1,
    group: 'dream',
  },
  {
    key: PARAM_KEYS.DREAM_MIN_SESSIONS,
    label: '梦境最小会话数',
    defaultValue: 5,
    min: 1,
    max: 100,
    step: 1,
    group: 'dream',
  },
];

export function getAllParams(userId: string) {
  const allKeys = PARAM_CONFIGS.map((c) => c.key);
  const settings = repo.findByKeys(userId, allKeys);
  const params = PARAM_CONFIGS.map((config) => {
    const setting = settings.get(config.key);
    const defaultValue = PARAM_DEFAULTS[config.key] ?? 0;
    let value = defaultValue;
    if (setting && setting.value !== undefined && setting.value !== null) {
      const parsed = Number(setting.value);
      value = Number.isNaN(parsed) ? defaultValue : parsed;
    }
    return { ...config, value };
  });
  return { params };
}

export function batchUpdateParams(userId: string, params: { key: string; value: number }[]) {
  for (const param of params) {
    const config = PARAM_CONFIGS.find((c) => c.key === param.key);
    if (!config) {
      throw new HttpError(400, `未知参数: ${param.key}`);
    }
    if (typeof param.value !== 'number' || Number.isNaN(param.value)) {
      throw new HttpError(400, `参数 ${param.key} 的值必须为数字`);
    }
    let clampedValue = param.value;
    if (config.min !== undefined && clampedValue < config.min) {
      clampedValue = config.min;
    }
    if (config.max !== undefined && clampedValue > config.max) {
      clampedValue = config.max;
    }
    saveSetting(userId, { key: param.key, value: String(clampedValue) });
  }
  return { message: '参数已更新' };
}

const PAGE_BASIC_KEYS = [
  'selected_model',
  'temperature',
  'max_tokens',
  'thinking_type',
  'reasoning_effort',
  'json_mode',
  'dark_mode',
  'system_prompt',
];

export function getSettingsPageData(userId: string) {
  const allKeys = [
    ...PAGE_BASIC_KEYS,
    'apikey_deepseek',
    ...FEATURE_KEYS,
    ...PARAM_CONFIGS.map((c) => c.key),
  ];
  const settings = repo.findByKeys(userId, allKeys);

  const decryptValue = (
    setting: { value: string; is_encrypted: number } | undefined,
  ): string | null => {
    if (!setting) return null;
    if (setting.is_encrypted === 1) {
      try {
        return decrypt(setting.value);
      } catch {
        return '';
      }
    }
    return setting.value;
  };

  const basicSettings: Record<string, string | null> = {};
  for (const key of PAGE_BASIC_KEYS) {
    basicSettings[key] = decryptValue(settings.get(key));
  }
  // system_prompt 在 DB 为空时从文件加载（保证前端显示与 AI 实际使用一致）
  if (!basicSettings['system_prompt']) {
    const filePrompt = loadMainPrompt();
    if (filePrompt && filePrompt.trim()) {
      basicSettings['system_prompt'] = filePrompt;
    }
  }

  const apikeySetting = settings.get('apikey_deepseek');
  let apiKey = '';
  if (apikeySetting) {
    apiKey = decryptValue(apikeySetting) ?? '';
  }

  const features: FeatureToggles = { session_memory: true, auto_compact: true, auto_dream: true };
  for (const key of FEATURE_KEYS) {
    const setting = settings.get(key);
    const enabled = parseBoolValue(setting?.value);
    if (key === 'feature_session_memory') features.session_memory = enabled;
    else if (key === 'feature_auto_compact') features.auto_compact = enabled;
    else if (key === 'feature_auto_dream') features.auto_dream = enabled;
  }

  const params = PARAM_CONFIGS.map((config) => {
    const setting = settings.get(config.key);
    const defaultValue = PARAM_DEFAULTS[config.key] ?? 0;
    let value = defaultValue;
    if (setting && setting.value !== undefined && setting.value !== null) {
      const parsed = Number(setting.value);
      value = Number.isNaN(parsed) ? defaultValue : parsed;
    }
    return { ...config, value };
  });

  return { settings: basicSettings, api_key: apiKey, features, params };
}
