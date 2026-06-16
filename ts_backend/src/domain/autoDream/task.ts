/**
 * 梦境任务状态管理。
 * 维护任务的阶段、状态、轮次和文件触碰记录，
 * 支持注册/追加/完成/失败/终止等状态转换。
 * 所有函数均为纯函数，返回新的状态对象，不修改输入。
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../../core/logger/index.js';
import type { DreamPhase, DreamTurn, DreamTaskState } from './types.js';

const logger = createLogger('DreamTask');

/** 轮次历史保留上限，超出后丢弃最早的轮次 */
const MAX_TURNS = 30;

/**
 * 注册新的梦境任务，创建初始状态。
 * @param sessionsReviewing - 待审查的会话数量
 * @param priorMtime - 获取锁时记录的原始 mtime，用于失败时回滚
 * @returns 初始状态的 DreamTaskState
 */
export function registerDreamTask(sessionsReviewing: number, priorMtime: number): DreamTaskState {
  const task: DreamTaskState = {
    id: randomUUID(),
    type: 'dream',
    phase: 'starting',
    status: 'running',
    sessionsReviewing,
    filesTouched: [],
    turns: [],
    priorMtime,
    startTime: new Date().toISOString(),
    endTime: null,
    notified: false,
  };
  logger.info(`注册 Dream 任务: id=%s sessions=%d`, task.id, sessionsReviewing);
  return task;
}

/**
 * 追加一轮交互记录到任务状态。
 * 空轮次（无文本、无工具调用、无新文件触碰）将被忽略。
 * @param task - 当前任务状态
 * @param text - 本轮输出文本
 * @param toolUseCount - 本轮工具调用次数
 * @param touchedPaths - 本轮触碰的文件路径列表
 * @returns 更新后的任务状态
 */
export function addDreamTurn(
  task: DreamTaskState,
  text: string,
  toolUseCount: number,
  touchedPaths: string[],
): DreamTaskState {
  const existingSet = new Set(task.filesTouched);
  const newPaths = touchedPaths.filter((p) => !existingSet.has(p));

  // 空轮次不产生状态变更
  if (text === '' && toolUseCount === 0 && newPaths.length === 0) {
    return task;
  }

  const newTurn: DreamTurn = { text, toolUseCount };
  // 保留最近 MAX_TURNS-1 轮历史，加上当前轮
  const turns = task.turns.slice(-(MAX_TURNS - 1)).concat(newTurn);

  // 有新文件触碰时阶段升级为 updating
  const phase: DreamPhase = newPaths.length > 0 ? 'updating' : task.phase;
  const filesTouched = [...task.filesTouched, ...newPaths];

  if (newPaths.length > 0) {
    logger.debug(`Dream 任务 %s 新增文件触碰: %s`, task.id, newPaths.join(', '));
  }

  return { ...task, turns, phase, filesTouched };
}

/**
 * 标记任务为已完成。
 * @param task - 当前任务状态
 * @returns 状态为 completed 的新任务对象
 */
export function completeDreamTask(task: DreamTaskState): DreamTaskState {
  const updated: DreamTaskState = {
    ...task,
    status: 'completed',
    endTime: new Date().toISOString(),
    notified: true,
  };
  logger.info(`Dream 任务完成: id=%s files=%d`, task.id, updated.filesTouched.length);
  return updated;
}

/**
 * 标记任务为失败。
 * @param task - 当前任务状态
 * @returns 状态为 failed 的新任务对象
 */
export function failDreamTask(task: DreamTaskState): DreamTaskState {
  const updated: DreamTaskState = {
    ...task,
    status: 'failed',
    endTime: new Date().toISOString(),
    notified: false,
  };
  logger.info(`Dream 任务失败: id=%s`, task.id);
  return updated;
}

/**
 * 终止正在运行的任务。
 * @param task - 当前任务状态
 * @returns 状态为 killed 的新任务对象
 */
export function killDreamTask(task: DreamTaskState): DreamTaskState {
  const updated: DreamTaskState = {
    ...task,
    status: 'killed',
    endTime: new Date().toISOString(),
    notified: true,
  };
  logger.info(`Dream 任务被终止: id=%s`, task.id);
  return updated;
}

/**
 * 生成任务摘要，用于 API 响应和事件广播。
 * @param task - 任务状态
 * @returns 序列化后的任务摘要对象
 */
export function getTaskSummary(task: DreamTaskState) {
  return {
    id: task.id,
    phase: task.phase,
    status: task.status,
    sessions_reviewing: task.sessionsReviewing,
    files_touched_count: task.filesTouched.length,
    files_touched: task.filesTouched,
    turns_count: task.turns.length,
    start_time: task.startTime,
    end_time: task.endTime,
    notified: task.notified,
  };
}
