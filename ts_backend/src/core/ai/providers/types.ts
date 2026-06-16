/**
 * 多 Provider 类型定义
 *
 * 定义 Provider 注册表、Transport 传输层和归一化流式响应的核心类型。
 * 所有 AI 提供商（OpenAI 兼容、Anthropic、Gemini）通过统一接口接入，
 * 上层业务代码无需关心底层 API 差异。
 *
 * 设计原则：
 * - 声明式 Provider 定义：身份、端点、认证、模型目录集中声明
 * - Transport 抽象：不同 API 协议通过 Transport 适配，输出归一化流式块
 * - 模型自动路由：根据 model ID 自动匹配 Provider，无需用户手动选择
 */

// ─── Provider 定义 ───

/** API 传输协议类型 */
export type ApiMode = 'openai-compatible' | 'anthropic-messages' | 'google-generative-ai';

/** Provider 定义，描述一个 AI 提供商的所有行为特征 */
export interface ProviderDefinition {
  /** Provider 唯一标识，如 "deepseek"、"openai"、"anthropic"、"gemini" */
  id: string;
  /** 显示名称 */
  name: string;
  /** 别名列表，用于模型 ID 前缀匹配 */
  aliases: string[];
  /** API 传输协议 */
  apiMode: ApiMode;
  /** 默认 API 基础地址 */
  baseUrl: string;
  /** 数据库中存储 API Key 的 key 前缀，如 "apikey_deepseek" */
  apiKeyKey: string;
  /** 环境变量名，如 "DEEPSEEK_API_KEY" */
  envVarKey: string;
  /** 是否支持思考/推理模式 */
  supportsThinking: boolean;
  /** 是否支持工具调用 */
  supportsToolCalls: boolean;
  /** 已知模型列表（含上下文窗口大小） */
  models: ProviderModel[];
}

/** Provider 模型定义 */
export interface ProviderModel {
  /** 模型 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** 上下文窗口大小（token 数） */
  contextWindow: number;
  /** 最大输出 token 数 */
  maxOutputTokens?: number;
  /** 是否支持视觉输入 */
  supportsVision?: boolean;
  /** 是否支持思考/推理 */
  supportsThinking?: boolean;
}

// ─── Transport 归一化类型 ───

/** 归一化的聊天消息 */
export interface NormalizedMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 消息中的工具调用 */
  toolCalls?: NormalizedToolCall[];
  /** tool 消息对应的工具调用 ID */
  toolCallId?: string;
}

/** 归一化的工具调用 */
export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** 归一化的工具定义 */
export interface NormalizedTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** Transport 聊天请求参数 */
export interface TransportChatParams {
  model: string;
  messages: NormalizedMessage[];
  tools?: NormalizedTool[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream: boolean;
  thinking?: { type: 'enabled' | 'disabled' };
  reasoningEffort?: string;
  responseFormat?: Record<string, unknown>;
  stop?: string[];
}

/** 归一化流式块类型 */
export type NormalizedStreamChunk =
  | { type: 'content'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: 'usage'; usage: NormalizedUsage }
  | { type: 'finish'; finishReason: string };

/** 归一化 Token 用量 */
export interface NormalizedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** DeepSeek 特有：缓存命中 token 数 */
  promptCacheHitTokens?: number;
  /** DeepSeek 特有：缓存未命中 token 数 */
  promptCacheMissTokens?: number;
}

/** 归一化的非流式响应 */
export interface NormalizedChatResponse {
  content: string | null;
  reasoningContent?: string;
  toolCalls?: NormalizedToolCall[];
  usage?: NormalizedUsage;
  finishReason?: string;
}

/** 归一化的模型信息 */
export interface NormalizedModel {
  id: string;
  name: string;
  ownedBy: string;
}

/** Transport 传输层接口，所有 Provider 适配器必须实现 */
export interface ProviderTransport {
  /** 对应的 API 协议类型 */
  readonly apiMode: ApiMode;

  /** 创建流式聊天补全，返回归一化的流式块序列 */
  createStreamingChat(params: TransportChatParams): AsyncIterable<NormalizedStreamChunk>;

  /** 创建非流式聊天补全，返回归一化的响应 */
  createNonStreamingChat(params: TransportChatParams): Promise<NormalizedChatResponse>;

  /** 获取可用模型列表 */
  listModels(): Promise<NormalizedModel[]>;
}

// ─── Provider 运行时状态 ───

/** Provider 运行时信息（含 API Key 和 Transport 实例） */
export interface ProviderRuntime {
  /** Provider 定义 */
  definition: ProviderDefinition;
  /** 已解密的 API Key */
  apiKey: string;
  /** Transport 实例（懒创建） */
  transport?: ProviderTransport;
}
