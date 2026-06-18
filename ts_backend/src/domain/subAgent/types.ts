/**
 * 子代理架构类型定义。子代理是独立的多轮 AI 对话循环，用于执行会话记忆提取、上下文压缩和梦境整固。
 * SubAgentConfig 支持自定义模型、工具集、轮次限制和自定义工具执行器（用于权限控制等场景）
 */

/** 单次工具调用记录 */
export interface SubAgentToolCall {
  turn: number;
  name: string;
  arguments: string;
  resultPreview: string;
}

/** 单轮对话详情 */
export interface SubAgentTurnDetail {
  turn: number;
  modelResponse?: string;
  reasoningContent?: string;
  toolCalls: SubAgentToolCall[];
}

/** 完整执行轨迹，供前端监控面板展示 */
export interface SubAgentTrace {
  requestJson: string;
  turns: SubAgentTurnDetail[];
  totalTurns: number;
  toolCallCount: number;
  elapsedMs: number;
}

/** 子代理类型：session_memory=会话记忆提取，compact=上下文压缩，dream=梦境整固 */
export type SubAgentType = 'session_memory' | 'compact' | 'dream';

/**
 * 子代理角色枚举。
 * - leaf：叶子代理，不可再 spawn 子代理（默认）
 * - orchestrator：编排代理，可 spawn 子代理（受 maxSpawnDepth 限制）
 */
export enum SubAgentRole {
  Leaf = 'leaf',
  Orchestrator = 'orchestrator',
}

/**
 * 子代理独立迭代预算。
 * 与父代理的 maxTurns 正交：maxTurns 限制单次子代理的对话轮次（横向），
 * iterationBudget 限制整个子代理执行的总资源消耗（纵向）。
 */
export interface IterationBudget {
  /** 最大对话轮次 */
  maxTurns: number;
  /** 最大工具调用次数 */
  maxToolCalls: number;
  /** 最大 token 消耗 */
  maxTokens: number;
}

/**
 * 子代理上下文继承配置。
 * 用于 fork 子代理时继承父会话的前缀消息和工具定义。
 */
export interface ForkContext {
  /** 父会话 ID */
  parentConversationId: string;
  /** 是否继承父会话的前缀消息（system + compact 摘要） */
  inheritPrefix: boolean;
  /** 是否继承父会话的工具定义 */
  inheritTools: boolean;
}

/** 子代理提示词各部分，由 promptBuilder 组装后传入执行器 */
export interface SubAgentPromptParts {
  mainPrompt: string;
  toolRules: string;
  persistentMemory: string;
  compactContext: string;
  rawConversation: string;
  subAgentPrompt: string;
}

/** 子代理执行结果 */
export interface SubAgentResult {
  type: SubAgentType;
  success: boolean;
  output: string;
  error?: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  trace?: SubAgentTrace;
}

/**
 * 子代理配置。
 *
 * 增强字段（2026-06）：
 * - role：角色枚举，默认 leaf
 * - toolAllowlist：工具白名单，未设置则继承父代理
 * - maxSpawnDepth：最大 spawn 深度，默认 2
 * - returnFormat：返回格式合同（text/json/structured）
 * - iterationBudget：独立迭代预算
 * - forkContext：继承父会话前缀
 * - parentSpanId：父 span ID（用于追踪）
 */
export interface SubAgentConfig {
  type: SubAgentType;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: Record<string, unknown>[];
  maxTurns?: number;
  /** 自定义工具执行器，优先于 toolRegistry。用于权限控制等场景 */
  customToolExecutor?: (name: string, args: Record<string, unknown>) => string;

  // ─── 增强字段（2026-06） ───

  /** 子代理角色，默认 leaf。orchestrator 可 spawn 子代理 */
  role?: SubAgentRole;
  /** 工具白名单，未设置则继承父代理。与 Tool Policy Session 层取交集 */
  toolAllowlist?: string[];
  /** 最大 spawn 深度，默认 2。防止子代理无限嵌套 */
  maxSpawnDepth?: number;
  /** 返回格式合同，约束子代理输出的结构 */
  returnFormat?: 'text' | 'json' | 'structured';
  /** 独立迭代预算，限制子代理的总资源消耗 */
  iterationBudget?: IterationBudget;
  /** 上下文继承配置，用于 fork 子代理 */
  forkContext?: ForkContext;
  /** 父 span ID，用于分布式追踪 */
  parentSpanId?: string;
}

/**
 * 角色工具白名单映射。
 * leaf 角色：仅允许只读工具（通过 Tool Policy 过滤）
 * orchestrator 角色：允许所有工具（但受 maxSpawnDepth 限制）
 *
 * 注意：此映射为默认值，可被 SubAgentConfig.toolAllowlist 覆盖。
 */
export const ROLE_DEFAULT_TOOL_ALLOWLIST: Record<SubAgentRole, string[] | null> = {
  // leaf 角色：无默认白名单，由 Tool Policy Session 层过滤只读工具
  [SubAgentRole.Leaf]: null,
  // orchestrator 角色：允许所有工具
  [SubAgentRole.Orchestrator]: null,
};

/** 默认最大 spawn 深度 */
export const DEFAULT_MAX_SPAWN_DEPTH = 2;
