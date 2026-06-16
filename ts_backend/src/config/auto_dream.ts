/**
 * 自动梦境合并配置
 *
 * 管理后台梦境任务的参数：触发条件（最小间隔、最少会话数）、扫描频率、
 * 持锁超时、使用的模型及温度。所有字段均可通过环境变量覆盖，
 * 并在读取后进行边界校验，无效值回退为默认值。
 *
 * @module config/auto_dream
 * @note 此模块是纯叶子节点，不依赖 core/ 或 memoryStorage/，
 *       仅读取 process.env 和返回纯数据结构。
 */

/** 自动梦境任务的完整配置结构 */
export interface AutoDreamConfig {
  /** 距上次合并的最小小时数，避免频繁触发 */
  minHours: number;
  /** 触发合并所需的最少会话数 */
  minSessions: number;
  /** 是否启用自动梦境 */
  enabled: boolean;
  /** 后台扫描间隔（毫秒） */
  scanIntervalMs: number;
  /** 合并锁的过期时间（毫秒），超时后允许其他实例接管 */
  holderStaleMs: number;
  /** 梦境合并使用的 AI 模型名称 */
  model: string;
  /** 梦境合并的采样温度，低温度保证输出稳定性 */
  temperature: number;
}

/** 梦境相关目录路径配置，可通过环境变量覆盖 */
export const autoDreamConfig = {
  /** 记忆文件根目录 */
  memoryRootDir: process.env.MEMORY_ROOT_DIR || './data/memories',
  /** 系统提示词目录 */
  systemPromptsDir: process.env.SYSTEM_PROMPTS_DIR || './data/prompts',
  /** 梦境转录日志目录，为空时不记录转录 */
  logTranscriptDir: process.env.DREAM_TRANSCRIPT_DIR || '',
} as const;

/** 返回所有字段的默认值 */
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
      console.warn(`[AutoDreamConfig] DREAM_MIN_HOURS 值无效: ${minHoursStr}，使用默认值 24`);
    }
  }

  const minSessionsStr = (process.env.DREAM_MIN_SESSIONS || '').trim();
  if (minSessionsStr) {
    const parsed = Number(minSessionsStr);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.minSessions = parsed;
    } else {
      console.warn(`[AutoDreamConfig] DREAM_MIN_SESSIONS 值无效: ${minSessionsStr}，使用默认值 5`);
    }
  }

  const enabledStr = (process.env.DREAM_ENABLED || '').trim();
  if (enabledStr) {
    const parsed = parseEnvBool(enabledStr);
    if (parsed !== null) {
      config.enabled = parsed;
    } else {
      console.warn(`[AutoDreamConfig] DREAM_ENABLED 值无效: ${enabledStr}，使用默认值 true`);
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
      console.warn(`[AutoDreamConfig] DREAM_TEMPERATURE 值无效: ${temperatureStr}，使用默认值 0.3`);
    }
  }

  return validateAutoDreamConfig(config);
}

/** 校验配置对象的每项字段，无效时回退为默认值。不修改传入对象，返回新对象 */
export function validateAutoDreamConfig(config: AutoDreamConfig): AutoDreamConfig {
  const result = { ...config };
  const defaults = getDefaultAutoDreamConfig();

  if (
    typeof result.minHours !== 'number' ||
    !Number.isFinite(result.minHours) ||
    result.minHours <= 0
  ) {
    console.warn(`[AutoDreamConfig] minHours 无效: ${result.minHours}，回退到默认值 ${defaults.minHours}`);
    result.minHours = defaults.minHours;
  }

  if (
    typeof result.minSessions !== 'number' ||
    !Number.isFinite(result.minSessions) ||
    result.minSessions <= 0
  ) {
    console.warn(`[AutoDreamConfig] minSessions 无效: ${result.minSessions}，回退到默认值 ${defaults.minSessions}`);
    result.minSessions = defaults.minSessions;
  }

  if (typeof result.enabled !== 'boolean') {
    console.warn(`[AutoDreamConfig] enabled 无效: ${result.enabled}，回退到默认值 ${defaults.enabled}`);
    result.enabled = defaults.enabled;
  }

  if (
    typeof result.scanIntervalMs !== 'number' ||
    !Number.isFinite(result.scanIntervalMs) ||
    result.scanIntervalMs <= 0
  ) {
    console.warn(`[AutoDreamConfig] scanIntervalMs 无效: ${result.scanIntervalMs}，回退到默认值`);
    result.scanIntervalMs = defaults.scanIntervalMs;
  }

  if (
    typeof result.holderStaleMs !== 'number' ||
    !Number.isFinite(result.holderStaleMs) ||
    result.holderStaleMs <= 0
  ) {
    console.warn(`[AutoDreamConfig] holderStaleMs 无效: ${result.holderStaleMs}，回退到默认值`);
    result.holderStaleMs = defaults.holderStaleMs;
  }

  if (typeof result.model !== 'string' || result.model.trim() === '') {
    console.warn(`[AutoDreamConfig] model 无效: ${result.model}，回退到默认值`);
    result.model = defaults.model;
  }

  if (
    typeof result.temperature !== 'number' ||
    !Number.isFinite(result.temperature) ||
    result.temperature < 0 ||
    result.temperature > 2
  ) {
    console.warn(`[AutoDreamConfig] temperature 无效: ${result.temperature}，回退到默认值 ${defaults.temperature}`);
    result.temperature = defaults.temperature;
  }

  return result;
}
