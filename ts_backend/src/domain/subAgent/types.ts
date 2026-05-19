/**
 * 子代理架构类型定义。子代理是独立的多轮 AI 对话循环，用于执行会话记忆提取、上下文压缩和梦境整固。
 * SubAgentConfig 支持自定义模型、工具集、轮次限制和自定义工具执行器（用于权限控制等场景）。
 */
export interface SubAgentToolCall {
  turn: number;
  name: string;
  arguments: string;
  resultPreview: string;
}

export interface SubAgentTurnDetail {
  turn: number;
  modelResponse?: string;
  reasoningContent?: string;
  toolCalls: SubAgentToolCall[];
}

export interface SubAgentTrace {
  requestJson: string;
  turns: SubAgentTurnDetail[];
  totalTurns: number;
  toolCallCount: number;
  elapsedMs: number;
}

export type SubAgentType = 'session_memory' | 'compact' | 'dream';

export interface SubAgentPromptParts {
  mainPrompt: string;
  toolRules: string;
  persistentMemory: string;
  compactContext: string;
  rawConversation: string;
  subAgentPrompt: string;
}

export interface SubAgentResult {
  type: SubAgentType;
  success: boolean;
  output: string;
  error?: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  trace?: SubAgentTrace;
}

export interface SubAgentConfig {
  type: SubAgentType;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: Record<string, unknown>[];
  maxTurns?: number;
  /** 自定义工具执行器，优先于 toolRegistry。签名: (name, args) => resultString */
  customToolExecutor?: (name: string, args: Record<string, unknown>) => string;
}
