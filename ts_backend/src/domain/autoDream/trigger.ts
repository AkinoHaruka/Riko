/**
 * 梦境触发条件检查：基于距上次整固的小时数和新增会话数，均从用户可配置参数读取。
 */
import { getParamNumberWithDefault, PARAM_KEYS } from '../setting/index.js';

export function shouldTriggerAutoDream(
  hoursSinceLastConsolidation: number,
  newSessionCount: number,
  userId: string,
): boolean {
  const minHours = getParamNumberWithDefault(userId, PARAM_KEYS.DREAM_MIN_HOURS);
  const minSessions = getParamNumberWithDefault(userId, PARAM_KEYS.DREAM_MIN_SESSIONS);
  return hoursSinceLastConsolidation >= minHours && newSessionCount >= minSessions;
}

export function getDreamTriggerParams(userId: string): {
  minHours: number;
  minSessions: number;
} {
  return {
    minHours: getParamNumberWithDefault(userId, PARAM_KEYS.DREAM_MIN_HOURS),
    minSessions: getParamNumberWithDefault(userId, PARAM_KEYS.DREAM_MIN_SESSIONS),
  };
}
