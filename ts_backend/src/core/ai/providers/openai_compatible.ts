/**
 * OpenAI 兼容 Transport
 *
 * 适配所有兼容 OpenAI Chat Completions API 的提供商：
 * DeepSeek、OpenAI、OpenRouter、Moonshot、Ollama 等。
 * 复用 OpenAI SDK，只需切换 baseURL 和 apiKey。
 *
 * 核心特性：
 * - 流式/非流式聊天补全
 * - 工具调用（function calling）
 * - DeepSeek 扩展字段（reasoning_content、prompt_cache_hit_tokens）
 * - 思考模式参数适配（thinking 模式下跳过 temperature/top_p）
 */
import OpenAI from 'openai';
import type {
  ProviderTransport,
  TransportChatParams,
  NormalizedStreamChunk,
  NormalizedChatResponse,
  NormalizedModel,
  NormalizedMessage,
  NormalizedUsage,
  NormalizedTool,
} from './types.js';
import { createLogger } from '../../logger/index.js';

const logger = createLogger('OpenAICompatibleTransport');

/** OpenAI 兼容 Transport 实现 */
export class OpenAICompatibleTransport implements ProviderTransport {
  readonly apiMode = 'openai-compatible' as const;
  private readonly client: OpenAI;
  /** 是否为 DeepSeek（需要特殊处理 thinking 参数） */
  private readonly isDeepSeek: boolean;

  constructor(baseUrl: string, apiKey: string, isDeepSeek: boolean = false) {
    this.client = new OpenAI({
      baseURL: baseUrl,
      apiKey,
      timeout: 600_000,
      maxRetries: 2,
    });
    this.isDeepSeek = isDeepSeek;
  }

  /** 获取底层 OpenAI 客户端（供 toolCallLoop 使用） */
  get openaiClient(): OpenAI {
    return this.client;
  }

  async *createStreamingChat(params: TransportChatParams): AsyncIterable<NormalizedStreamChunk> {
    const requestParams = this.buildRequestParams(params);

    const stream = await this.client.chat.completions.create({
      ...requestParams,
      stream: true,
    } as OpenAI.ChatCompletionCreateParamsStreaming);

    for await (const chunk of stream) {
      if (chunk.choices && chunk.choices.length > 0) {
        const choice = chunk.choices[0];
        const delta = choice.delta as Record<string, unknown>;

        // 文本内容
        if (delta.content) {
          yield { type: 'content', content: delta.content as string };
        }

        // 推理内容（DeepSeek 扩展）
        if (delta.reasoning_content) {
          yield { type: 'reasoning', content: delta.reasoning_content as string };
        }

        // 工具调用增量
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls as Array<{
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>) {
            yield {
              type: 'tool_call_delta',
              index: tc.index,
              id: tc.id,
              name: tc.function?.name,
              argumentsDelta: tc.function?.arguments,
            };
          }
        }

        // 结束原因
        if (choice.finish_reason) {
          yield { type: 'finish', finishReason: choice.finish_reason };
        }
      }

      // Token 用量
      if (chunk.usage) {
        const usage = chunk.usage as unknown as Record<string, unknown>;
        const normalizedUsage: NormalizedUsage = {
          promptTokens: (usage.prompt_tokens as number) ?? 0,
          completionTokens: (usage.completion_tokens as number) ?? 0,
          totalTokens: (usage.total_tokens as number) ?? 0,
        };
        if (usage.prompt_cache_hit_tokens !== undefined) {
          normalizedUsage.promptCacheHitTokens = usage.prompt_cache_hit_tokens as number;
        }
        if (usage.prompt_cache_miss_tokens !== undefined) {
          normalizedUsage.promptCacheMissTokens = usage.prompt_cache_miss_tokens as number;
        }
        yield { type: 'usage', usage: normalizedUsage };
      }
    }
  }

  async createNonStreamingChat(params: TransportChatParams): Promise<NormalizedChatResponse> {
    const requestParams = this.buildRequestParams(params);

    const response = await this.client.chat.completions.create({
      ...requestParams,
      stream: false,
    } as OpenAI.ChatCompletionCreateParamsNonStreaming);

    const choice = response.choices?.[0];
    const message = choice?.message as unknown as Record<string, unknown> | undefined;

    const result: NormalizedChatResponse = {
      content: (message?.content as string) ?? null,
      finishReason: choice?.finish_reason ?? undefined,
    };

    // 推理内容（DeepSeek 扩展）
    if (message?.reasoning_content) {
      result.reasoningContent = message.reasoning_content as string;
    }

    // 工具调用
    if (message?.tool_calls) {
      result.toolCalls = (message.tool_calls as Array<{
        id: string;
        function: { name: string; arguments: string };
      }>).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));
    }

    // Token 用量
    if (response.usage) {
      const usage = response.usage as unknown as Record<string, unknown>;
      result.usage = {
        promptTokens: (usage.prompt_tokens as number) ?? 0,
        completionTokens: (usage.completion_tokens as number) ?? 0,
        totalTokens: (usage.total_tokens as number) ?? 0,
      };
    }

    return result;
  }

  async listModels(): Promise<NormalizedModel[]> {
    try {
      const response = await this.client.models.list();
      return response.data.map((model) => ({
        id: model.id,
        name: model.id,
        ownedBy: model.owned_by ?? 'unknown',
      }));
    } catch (e) {
      logger.warn('获取模型列表失败: %s', e);
      return [];
    }
  }

  /**
   * 构建 OpenAI SDK 请求参数
   * DeepSeek 在 thinking 模式下不支持 temperature 和 top_p，需跳过
   */
  private buildRequestParams(params: TransportChatParams): Record<string, unknown> {
    const messages = params.messages.map(convertToOpenAIMessage);
    const result: Record<string, unknown> = {
      model: params.model,
      messages,
    };

    if (params.tools && params.tools.length > 0) {
      result.tools = params.tools.map(convertToOpenAITool);
    }

    const isThinkingEnabled = params.thinking?.type === 'enabled';

    // temperature：DeepSeek thinking 模式下不支持
    if (params.temperature !== undefined && !(this.isDeepSeek && isThinkingEnabled)) {
      result.temperature = params.temperature;
    }

    if (params.maxTokens !== undefined) {
      result.max_tokens = params.maxTokens;
    }

    // top_p：DeepSeek thinking 模式下不支持
    if (params.topP !== undefined && !(this.isDeepSeek && isThinkingEnabled)) {
      result.top_p = params.topP;
    }

    if (params.reasoningEffort !== undefined) {
      result.reasoning_effort = params.reasoningEffort;
    }

    if (params.responseFormat !== undefined) {
      result.response_format = params.responseFormat;
    }

    if (params.stop !== undefined) {
      result.stop = params.stop;
    }

    // thinking 参数（DeepSeek 特有）
    if (params.thinking !== undefined) {
      result.thinking = params.thinking;
    }

    return result;
  }
}

// ─── 消息格式转换 ───

/** 将归一化消息转换为 OpenAI 格式 */
function convertToOpenAIMessage(msg: NormalizedMessage): Record<string, unknown> {
  switch (msg.role) {
    case 'system':
    case 'user':
      return { role: msg.role, content: msg.content };
    case 'assistant': {
      const result: Record<string, unknown> = { role: 'assistant', content: msg.content || null };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        result.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      return result;
    }
    case 'tool':
      return {
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId,
      };
    default:
      return { role: msg.role, content: msg.content };
  }
}

/** 将归一化工具定义转换为 OpenAI 格式 */
function convertToOpenAITool(tool: NormalizedTool): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  };
}
