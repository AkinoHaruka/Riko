/**
 * 压力等级系统。
 *
 * 根据当前 token 使用量与阈值的比例，将上下文压力分为 4 级：
 * - Green：正常对话
 * - Yellow：日志记录，无干预
 * - Orange：注入 memory flush nudge，建议 AI 固化关键信息
 * - Red：触发 overflow 处理（强制压缩 + 拒绝非必要工具调用）
 *
 * 同时提供动态压缩阈值计算，根据模型上下文窗口大小自动适配。
 *
 * @module domain/compact/pressureLevel
 */

/** 压力等级 */
export enum PressureLevel {
  Green = 'green',
  Yellow = 'yellow',
  Orange = 'orange',
  Red = 'red',
}

/** 压力阈值配置 */
export interface PressureThresholds {
  /** 软阈值（Yellow 起点） */
  soft: number;
  /** 硬阈值（Orange 起点） */
  hard: number;
  /** 紧急阈值（Red 起点） */
  emergency: number;
  /** 是否启用压缩（小窗口模型禁用） */
  enabled: boolean;
}

/** 小窗口模型禁用压缩的阈值 */
const MIN_CONTEXT_WINDOW_FOR_COMPACT = 25_000;

/**
 * 根据模型上下文窗口大小返回默认压力阈值。
 *
 * | 上下文窗口 | 软阈值 | 硬阈值 | 紧急阈值 |
 * |---|---|---|---|
 * | < 25K | 禁用 | 禁用 | 禁用 |
 * | 25K~200K | 20% | 40% | 60% |
 * | 200K~500K | 10% | 20% | 30% |
 * | > 500K | 5% | 10% | 15% |
 *
 * @param contextWindow - 模型上下文窗口大小（token 数）
 * @returns 压力阈值配置
 */
export function defaultThresholdsFor(contextWindow: number): PressureThresholds {
  // 小窗口模型禁用压缩
  if (contextWindow < MIN_CONTEXT_WINDOW_FOR_COMPACT) {
    return { soft: 0, hard: 0, emergency: 0, enabled: false };
  }

  let softPct: number;
  let hardPct: number;
  let emergencyPct: number;

  if (contextWindow < 200_000) {
    // 25K~200K：20%/40%/60%
    softPct = 0.2;
    hardPct = 0.4;
    emergencyPct = 0.6;
  } else if (contextWindow < 500_000) {
    // 200K~500K：10%/20%/30%
    softPct = 0.1;
    hardPct = 0.2;
    emergencyPct = 0.3;
  } else {
    // > 500K：5%/10%/15%
    softPct = 0.05;
    hardPct = 0.1;
    emergencyPct = 0.15;
  }

  return {
    soft: Math.floor(contextWindow * softPct),
    hard: Math.floor(contextWindow * hardPct),
    emergency: Math.floor(contextWindow * emergencyPct),
    enabled: true,
  };
}

/**
 * 解析阈值配置值。
 * 支持四种格式：
 * - 百分比："20%" → contextWindow * 0.2
 * - K 后缀："50K" → 50 * 1024
 * - M 后缀："1M" → 1 * 1024 * 1024
 * - 纯数字："50000" → 50000
 *
 * @param value - 阈值配置字符串
 * @param contextWindow - 模型上下文窗口大小（百分比模式时使用）
 * @returns 解析后的 token 数，解析失败返回 0
 */
export function parseThresholdValue(value: string, contextWindow: number): number {
  if (!value) return 0;
  const trimmed = value.trim().toLowerCase();

  // 百分比模式
  if (trimmed.endsWith('%')) {
    const pct = Number(trimmed.slice(0, -1));
    if (!Number.isNaN(pct)) {
      return Math.floor(contextWindow * pct / 100);
    }
    return 0;
  }

  // K 后缀
  if (trimmed.endsWith('k')) {
    const num = Number(trimmed.slice(0, -1));
    if (!Number.isNaN(num)) {
      return Math.floor(num * 1024);
    }
    return 0;
  }

  // M 后缀
  if (trimmed.endsWith('m')) {
    const num = Number(trimmed.slice(0, -1));
    if (!Number.isNaN(num)) {
      return Math.floor(num * 1024 * 1024);
    }
    return 0;
  }

  // 纯数字
  const num = Number(trimmed);
  return Number.isNaN(num) ? 0 : Math.floor(num);
}

/**
 * 根据当前 token 使用量和阈值计算压力等级。
 *
 * @param currentTokens - 当前未压缩 token 数
 * @param thresholds - 压力阈值配置
 * @returns 压力等级
 */
export function calculatePressureLevel(
  currentTokens: number,
  thresholds: PressureThresholds,
): PressureLevel {
  if (!thresholds.enabled) return PressureLevel.Green;

  if (currentTokens >= thresholds.emergency) {
    return PressureLevel.Red;
  }
  if (currentTokens >= thresholds.hard) {
    return PressureLevel.Orange;
  }
  if (currentTokens >= thresholds.soft) {
    return PressureLevel.Yellow;
  }
  return PressureLevel.Green;
}

/**
 * Orange 压力时注入的 memory flush nudge。
 * 建议 AI 主动调用 memorySearch 固化关键信息，避免压缩时丢失。
 */
export const MEMORY_FLUSH_NUDGE = `
## 上下文压力提示
当前对话上下文已接近压缩阈值。建议你主动调用 SearchMemory 工具，
将关键信息（决策、承诺、待办事项）固化到长期记忆中，避免压缩时丢失。
`.trim();

/**
 * Red 压力时注入的 overflow 警告。
 * 警告 AI 上下文已溢出，非必要工具调用将被拒绝。
 */
export const OVERFLOW_WARNING = `
## 上下文溢出警告
当前对话上下文已超过紧急阈值。系统将强制触发压缩。
在压缩完成前，仅允许调用 SearchMemory 和 compact 相关工具，其他工具调用将被拒绝。
`.trim();
