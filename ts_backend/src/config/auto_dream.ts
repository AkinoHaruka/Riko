/**
 * 自动梦境合并配置：后台任务定期总结会话、提取记忆并压缩上下文。
 * 可借助环境变量覆盖默认值。
 */
import { createLogger } from '../core/logger/index.js';
import { isAutoMemoryEnabled } from '../memoryStorage/paths.js';

const logger = createLogger('AutoDreamConfig');

export interface AutoDreamConfig {
  minHours: number;
  minSessions: number;
  enabled: boolean;
  scanIntervalMs: number;
  holderStaleMs: number;
  model: string;
  temperature: number;
}

export const autoDreamConfig = {
  memoryRootDir: process.env.MEMORY_ROOT_DIR || './data/memories',
  systemPromptsDir: process.env.SYSTEM_PROMPTS_DIR || './data/prompts',
  logTranscriptDir: process.env.DREAM_TRANSCRIPT_DIR || '',
} as const;

export function getDefaultAutoDreamConfig(): AutoDreamConfig {
  return {
    minHours: 24,
    minSessions: 5,
    enabled: true,
    scanIntervalMs: 10 * 60 * 1000,
    holderStaleMs: 60 * 60 * 1000,
    model: 'deepseek-v4-pro',
    temperature: 0.3,
  };
}

/** 将环境变量字符串解析为 boolean，无法解析时返回 null */
function parseEnvBool(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return null;
}

/** 读取环境变量覆盖默认梦境配置，并对所有字段做有效性和边界检查 */
export function getAutoDreamConfig(): AutoDreamConfig {
  const config = getDefaultAutoDreamConfig();

  const minHoursStr = (process.env.DREAM_MIN_HOURS || '').trim();
  if (minHoursStr) {
    const parsed = Number(minHoursStr);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.minHours = parsed;
    } else {
      logger.warn('DREAM_MIN_HOURS 值无效: %s，使用默认值 24', minHoursStr);
    }
  }

  const minSessionsStr = (process.env.DREAM_MIN_SESSIONS || '').trim();
  if (minSessionsStr) {
    const parsed = Number(minSessionsStr);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.minSessions = parsed;
    } else {
      logger.warn('DREAM_MIN_SESSIONS 值无效: %s，使用默认值 5', minSessionsStr);
    }
  }

  const enabledStr = (process.env.DREAM_ENABLED || '').trim();
  if (enabledStr) {
    const parsed = parseEnvBool(enabledStr);
    if (parsed !== null) {
      config.enabled = parsed;
    } else {
      logger.warn('DREAM_ENABLED 值无效: %s，使用默认值 true', enabledStr);
    }
  }

  const modelStr = (process.env.DREAM_MODEL || '').trim();
  if (modelStr) {
    config.model = modelStr;
  }

  const temperatureStr = (process.env.DREAM_TEMPERATURE || '').trim();
  if (temperatureStr) {
    const parsed = Number(temperatureStr);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 2) {
      config.temperature = parsed;
    } else {
      logger.warn('DREAM_TEMPERATURE 值无效: %s，使用默认值 0.3', temperatureStr);
    }
  }

  return validateAutoDreamConfig(config);
}

/** 同时检查自动记忆和自动梦境是否启用 */
export function isAutoDreamEnabled(): boolean {
  return isAutoMemoryEnabled() && getAutoDreamConfig().enabled;
}

/** 校验配置对象的每项字段，无效时回退为默认值 */
export function validateAutoDreamConfig(config: AutoDreamConfig): AutoDreamConfig {
  const defaults = getDefaultAutoDreamConfig();

  if (
    typeof config.minHours !== 'number' ||
    !Number.isFinite(config.minHours) ||
    config.minHours <= 0
  ) {
    logger.warn('minHours 无效: %s，回退到默认值 %d', config.minHours, defaults.minHours);
    config.minHours = defaults.minHours;
  }

  if (
    typeof config.minSessions !== 'number' ||
    !Number.isFinite(config.minSessions) ||
    config.minSessions <= 0
  ) {
    logger.warn('minSessions 无效: %s，回退到默认值 %d', config.minSessions, defaults.minSessions);
    config.minSessions = defaults.minSessions;
  }

  if (typeof config.enabled !== 'boolean') {
    logger.warn('enabled 无效: %s，回退到默认值 %s', config.enabled, defaults.enabled);
    config.enabled = defaults.enabled;
  }

  if (
    typeof config.scanIntervalMs !== 'number' ||
    !Number.isFinite(config.scanIntervalMs) ||
    config.scanIntervalMs <= 0
  ) {
    logger.warn('scanIntervalMs 无效: %s，回退到默认值', config.scanIntervalMs);
    config.scanIntervalMs = defaults.scanIntervalMs;
  }

  if (
    typeof config.holderStaleMs !== 'number' ||
    !Number.isFinite(config.holderStaleMs) ||
    config.holderStaleMs <= 0
  ) {
    logger.warn('holderStaleMs 无效: %s，回退到默认值', config.holderStaleMs);
    config.holderStaleMs = defaults.holderStaleMs;
  }

  if (typeof config.model !== 'string' || config.model.trim() === '') {
    logger.warn('model 无效: %s，回退到默认值', config.model);
    config.model = defaults.model;
  }

  if (
    typeof config.temperature !== 'number' ||
    !Number.isFinite(config.temperature) ||
    config.temperature < 0 ||
    config.temperature > 2
  ) {
    logger.warn('temperature 无效: %s，回退到默认值 %d', config.temperature, defaults.temperature);
    config.temperature = defaults.temperature;
  }

  return config;
}
