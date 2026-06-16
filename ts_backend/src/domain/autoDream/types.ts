/**
 * 梦境（后台知识整固）类型定义。
 * DreamTaskState 跟踪整固任务的完整生命周期，
 * 整固过程由 SubAgent 驱动，将多个会话的知识归纳整理到分类目录中。
 */

/** 梦境任务阶段：starting=初始审查阶段，updating=已开始写入文件 */
export type DreamPhase = 'starting' | 'updating';

/** 梦境任务状态：running=执行中，completed=成功，failed=失败，killed=被终止 */
export type DreamStatus = 'running' | 'completed' | 'failed' | 'killed';

/** 单轮交互记录，包含文本输出和工具调用次数 */
export interface DreamTurn {
  text: string;
  toolUseCount: number;
}

/** 梦境任务完整状态，贯穿任务从创建到结束的全生命周期 */
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

/** 梦境执行上下文，控制是否强制触发及排除当前会话 */
export interface DreamContext {
  /** 是否跳过触发条件检查，强制执行 */
  force: boolean;
  /** 当前活跃会话 ID，整固时排除该会话避免干扰 */
  currentSessionId: string;
}

export type { AutoDreamConfig } from '../../config/auto_dream.js';
