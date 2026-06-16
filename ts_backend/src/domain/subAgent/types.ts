/**
 * 子代理架构类型定义。子代理是独立的多轮 AI 对话循环，用于执行会话记忆提取、上下文压缩和梦境整固。
 * SubAgentConfig 支持自定义模型、工具集、轮次限制和自定义工具执行器（用于权限控制等场景） */

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

/** 子代理配置 */
export interface SubAgentConfig {
  type: SubAgentType;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: Record<string, unknown>[];
  maxTurns?: number;
  /** 自定义工具执行器，优先于 toolRegistry。用于权限控制等场景 */
  customToolExecutor?: (name: string, args: Record<string, unknown>) => string;
}
