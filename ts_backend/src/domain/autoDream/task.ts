/**
 * 梦境任务状态管理。维护任务的阶段、状态、轮次和文件触碰记录，支持注册/追加/完成/失败/终止。
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../../core/logger/index.js';
import type { DreamPhase, DreamTurn, DreamTaskState } from './types.js';

const logger = createLogger('DreamTask');
const MAX_TURNS = 30;

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

export function addDreamTurn(
  task: DreamTaskState,
  text: string,
  toolUseCount: number,
  touchedPaths: string[],
): DreamTaskState {
  const existingSet = new Set(task.filesTouched);
  const newPaths = touchedPaths.filter((p) => !existingSet.has(p));

  if (text === '' && toolUseCount === 0 && newPaths.length === 0) {
    return task;
  }

  const newTurn: DreamTurn = { text, toolUseCount };
  const turns = task.turns.slice(-(MAX_TURNS - 1)).concat(newTurn);

  const phase: DreamPhase = newPaths.length > 0 ? 'updating' : task.phase;
  const filesTouched = [...task.filesTouched, ...newPaths];

  if (newPaths.length > 0) {
    logger.debug(`Dream 任务 %s 新增文件触碰: %s`, task.id, newPaths.join(', '));
  }

  return { ...task, turns, phase, filesTouched };
}

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
