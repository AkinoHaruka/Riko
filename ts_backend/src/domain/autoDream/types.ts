/**
 * 梦境（后台知识整固）类型定义。DreamTaskState 跟踪整固任务的完整生命周期。
 * 整固过程由 SubAgent 驱动，将多个会话的知识归纳整理到分类目录中。
 */
export type DreamPhase = 'starting' | 'updating';

export type DreamStatus = 'running' | 'completed' | 'failed' | 'killed';

export interface DreamTurn {
  text: string;
  toolUseCount: number;
}

export interface DreamTaskState {
  id: string;
  type: 'dream';
  phase: DreamPhase;
  status: DreamStatus;
  sessionsReviewing: number;
  filesTouched: string[];
  turns: DreamTurn[];
  priorMtime: number;
  startTime: string;
  endTime: string | null;
  notified: boolean;
}

export interface DreamContext {
  force: boolean;
  currentSessionId: string;
}

export type { AutoDreamConfig } from '../../config/auto_dream.js';
