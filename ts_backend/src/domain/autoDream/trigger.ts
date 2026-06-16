/**
 * 梦境触发条件检查。
 * 基于距上次整固的小时数和新增会话数判断是否应触发整固，
 * 两个阈值均从用户可配置参数读取。
 */
import { getParamNumberWithDefault, PARAM_KEYS } from '../setting/index.js';

/**
 * 判断是否满足自动梦境触发条件。
 * @param hoursSinceLastConsolidation - 距上次整固的小时数
 * @param newSessionCount - 新增会话数
 * @param userId - 用户 ID，用于读取该用户的触发阈值配置
 * @returns 是否应触发整固
 */
export function shouldTriggerAutoDream(
  hoursSinceLastConsolidation: number,
  newSessionCount: number,
  userId: string,
): boolean {
  const minHours = getParamNumberWithDefault(userId, PARAM_KEYS.DREAM_MIN_HOURS);
  const minSessions = getParamNumberWithDefault(userId, PARAM_KEYS.DREAM_MIN_SESSIONS);
  return hoursSinceLastConsolidation >= minHours && newSessionCount >= minSessions;
}

/**
 * 获取指定用户的梦境触发参数。
 * @param userId - 用户 ID
 * @returns 最小间隔小时数和最小会话数阈值
 */
export function getDreamTriggerParams(userId: string): {
  minHours: number;
  minSessions: number;
} {
  return {
    minHours: getParamNumberWithDefault(userId, PARAM_KEYS.DREAM_MIN_HOURS),
    minSessions: getParamNumberWithDefault(userId, PARAM_KEYS.DREAM_MIN_SESSIONS),
  };
}
