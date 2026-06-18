/**
 * Anthropic Messages API Transport
 *
 * 适配 Anthropic Claude 系列模型，使用 @anthropic-ai/sdk。
 * 将归一化的消息/工具格式转换为 Anthropic Messages API 格式，
 * 并将流式响应归一化为统一的 NormalizedStreamChunk 序列。
 *
 * 核心特性：
 * - 流式/非流式聊天补全
 * - 工具调用（tool_use）
 * - 思考模式（extended thinking / thinking budget）
 * - 消息格式转换（OpenAI 格式 ↔ Anthropic 格式）
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  ProviderTransport,
  TransportChatParams,
  NormalizedStreamChunk,
  NormalizedChatResponse,
  NormalizedModel,
  NormalizedMessage,
  NormalizedToolCall,
  NormalizedUsage,
  NormalizedTool,
} from './types.js';
import { createLogger } from '../../logger/index.js';

const logger = createLogger('AnthropicTransport');

/** Anthropic Transport 实现 */
export class AnthropicTransport implements ProviderTransport {
  readonly apiMode = 'anthropic-messages' as const;
  private readonly client: Anthropic;

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new Anthropic({
      apiKey,
      // Anthropic SDK 默认 baseURL 为 https://api.anthropic.com，允许自定义覆盖
      ...(baseUrl && baseUrl !== 'https://api.anthropic.com' ? { baseURL: baseUrl } : {}),
    });
  }

  async *createStreamingChat(params: TransportChatParams): AsyncIterable<NormalizedStreamChunk> {
    const { system, messages } = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    const requestParams: Anthropic.MessageCreateParamsStreaming = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 16384,
      stream: true,
    };

    if (system) {
      requestParams.system = system;
    }

    if (tools && tools.length > 0) {
      requestParams.tools = tools;
    }

    // 思考模式：Anthropic 使用 thinking 参数
    if (params.thinking?.type === 'enabled') {
      requestParams.thinking = {
        type: 'enabled',
        budget_tokens: this.resolveThinkingBudget(params.reasoningEffort),
      };
    }

    // temperature 和 top_p
    if (params.temperature !== undefined) {
      requestParams.temperature = params.temperature;
    }
    if (params.topP !== undefined) {
      requestParams.top_p = params.topP;
    }
    if (params.stop && params.stop.length > 0) {
      requestParams.stop_sequences = params.stop;
    }

    const stream = this.client.messages.stream(requestParams);

    // 工具调用累积器
    const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const event of stream) {
      switch (event.type) {
        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            toolCallAccumulator.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              arguments: '',
            });
            // 立即发射工具调用头信息（id + name），让上层能正确累积工具调用
            yield {
              type: 'tool_call_delta',
              index: event.index,
              id: event.content_block.id,
              name: event.content_block.name,
            };
          }
          break;

        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            yield { type: 'content', content: event.delta.text };
          } else if (event.delta.type === 'thinking_delta') {
            yield { type: 'reasoning', content: event.delta.thinking };
          } else if (event.delta.type === 'input_json_delta') {
            const acc = toolCallAccumulator.get(event.index);
            if (acc) {
              acc.arguments += event.delta.partial_json;
              // 仅发射参数增量，id/name 已在 content_block_start 发射
              yield {
                type: 'tool_call_delta',
                index: event.index,
                argumentsDelta: event.delta.partial_json,
              };
            }
          }
          break;

        case 'message_delta':
          if (event.delta.stop_reason) {
            // 将 Anthropic 的 stop_reason 映射为 OpenAI 格式
            const finishReason = event.delta.stop_reason === 'tool_use' ? 'tool_calls' : event.delta.stop_reason;
            yield { type: 'finish', finishReason };
          }
          if (event.usage) {
            yield {
              type: 'usage',
              usage: {
                promptTokens: event.usage.input_tokens ?? 0,
                completionTokens: event.usage.output_tokens ?? 0,
                totalTokens: (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0),
              },
            };
          }
          break;

        case 'message_start':
          // message_start 包含 input_tokens 用量
          if (event.message.usage) {
            // 不在此处 yield usage，等 message_delta 中的完整用量
          }
          break;
      }
    }
  }

  async createNonStreamingChat(params: TransportChatParams): Promise<NormalizedChatResponse> {
    const { system, messages } = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    const requestParams: Anthropic.MessageCreateParams = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 16384,
    };

    if (system) {
      requestParams.system = system;
    }
    if (tools && tools.length > 0) {
      requestParams.tools = tools;
    }
    if (params.thinking?.type === 'enabled') {
      requestParams.thinking = {
        type: 'enabled',
        budget_tokens: this.resolveThinkingBudget(params.reasoningEffort),
      };
    }
    if (params.temperature !== undefined) {
      requestParams.temperature = params.temperature;
    }
    if (params.topP !== undefined) {
      requestParams.top_p = params.topP;
    }
    if (params.stop && params.stop.length > 0) {
      requestParams.stop_sequences = params.stop;
    }

    const response = await this.client.messages.create(requestParams);

    const result: NormalizedChatResponse = {
      content: null,
      finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : (response.stop_reason ?? undefined),
    };

    // 提取文本和工具调用
    let textContent = '';
    const toolCalls: NormalizedToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'thinking') {
        result.reasoningContent = (result.reasoningContent ?? '') + block.thinking;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
        });
      }
    }

    result.content = textContent || null;
    if (toolCalls.length > 0) {
      result.toolCalls = toolCalls;
    }

    // Token 用量
    if (response.usage) {
      result.usage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      };
    }

    return result;
  }

  async listModels(): Promise<NormalizedModel[]> {
    // Anthropic 没有 /models 端点，返回硬编码列表
    return [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', ownedBy: 'anthropic' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', ownedBy: 'anthropic' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', ownedBy: 'anthropic' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', ownedBy: 'anthropic' },
    ];
  }

  // ─── 私有方法 ───

  /**
   * 将归一化消息转换为 Anthropic Messages API 格式。
   *
   * Anthropic 要求 system 消息单独传入，不在 messages 数组中。
   *
   * Prompt Cache 注入（system_and_3 策略，最多 3 个断点，加上 tools 段共 4 个）：
   * 1. system 段：system 内容转换为 TextBlockParam 数组，最后一个 block 带 cache_control
   * 2. compact 段：识别 content 含 `<compact-context>` 的 user 消息，在其 content block 添加 cache_control
   * 3. recent 段：最后一条消息的最后一个 content block 添加 cache_control
   *
   * @param messages - 归一化消息列表
   * @returns { system, messages } system 为 TextBlockParam 数组或 undefined
   */
  private convertMessages(messages: NormalizedMessage[]): {
    system: Array<Anthropic.TextBlockParam> | undefined;
    messages: Anthropic.MessageParam[];
  } {
    let systemText: string | undefined;
    const anthropicMessages: Anthropic.MessageParam[] = [];

    // 第一遍：收集 system 文本，转换非 system 消息
    for (const msg of messages) {
      if (msg.role === 'system') {
        // Anthropic 的 system 消息单独处理
        systemText = (systemText ?? '') + (systemText ? '\n\n' : '') + msg.content;
        continue;
      }

      if (msg.role === 'assistant') {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: JSON.parse(tc.arguments || '{}'),
            });
          }
        }
        anthropicMessages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        // Anthropic 中 tool 消息是 user 角色下的 tool_result
        anthropicMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolCallId ?? '',
            content: msg.content,
          }],
        });
      } else {
        // user 消息
        anthropicMessages.push({
          role: 'user',
          content: msg.content,
        });
      }
    }

    // 第二遍：注入 cache_control 断点
    // 1. system 段：转换为 TextBlockParam 数组，最后一个 block 带 cache_control
    let system: Array<Anthropic.TextBlockParam> | undefined;
    if (systemText) {
      system = [{
        type: 'text',
        text: systemText,
        cache_control: { type: 'ephemeral' },
      }];
    }

    // 2. compact 段：识别含 <compact-context> 的 user 消息，注入 cache_control
    for (const msg of anthropicMessages) {
      if (msg.role !== 'user') continue;
      // content 为 string 时，检查是否含 <compact-context>
      if (typeof msg.content === 'string' && msg.content.includes('<compact-context>')) {
        // 转换为 ContentBlockParam 数组，添加 cache_control
        msg.content = [{
          type: 'text',
          text: msg.content,
          cache_control: { type: 'ephemeral' },
        }];
        break; // 仅第一个 compact 摘要注入断点
      }
    }

    // 3. recent 段：最后一条消息的最后一个 content block 添加 cache_control
    //    仅当消息数 >= 2 时注入（避免单条消息时 recent 与 system/tools 断点重叠无意义）
    if (anthropicMessages.length >= 2) {
      const lastMsg = anthropicMessages[anthropicMessages.length - 1];
      if (typeof lastMsg.content === 'string') {
        // string 转换为 ContentBlockParam 数组，添加 cache_control
        lastMsg.content = [{
          type: 'text',
          text: lastMsg.content,
          cache_control: { type: 'ephemeral' },
        }];
      } else if (Array.isArray(lastMsg.content) && lastMsg.content.length > 0) {
        // 数组：在最后一个 block 添加 cache_control
        const lastBlock = lastMsg.content[lastMsg.content.length - 1] as Anthropic.ContentBlockParam & {
          cache_control?: Anthropic.CacheControlEphemeral | null;
        };
        lastBlock.cache_control = { type: 'ephemeral' };
      }
    }

    return { system, messages: anthropicMessages };
  }

  /**
   * 将归一化工具定义转换为 Anthropic 格式。
   *
   * Prompt Cache 注入：在最后一个工具上添加 cache_control 断点（tools 段），
   * 使工具定义部分被缓存，避免每次请求重复传输工具 schema。
   *
   * @param tools - 归一化工具定义列表
   * @returns Anthropic 格式工具列表，最后一个工具带 cache_control 断点
   */
  private convertTools(tools: NormalizedTool[]): Anthropic.Tool[] {
    return tools.map((tool, index) => {
      const converted: Anthropic.Tool = {
        name: tool.function.name,
        description: tool.function.description,
        input_schema: (tool.function.parameters ?? {
          type: 'object',
          properties: {},
        }) as Anthropic.Tool.InputSchema,
      };
      // 仅在最后一个工具注入 cache_control 断点（system_and_3 策略的 tools 段）
      if (index === tools.length - 1) {
        converted.cache_control = { type: 'ephemeral' };
      }
      return converted;
    });
  }

  /** 根据 reasoning_effort 推导 thinking budget */
  private resolveThinkingBudget(effort?: string): number {
    switch (effort) {
      case 'low': return 4096;
      case 'medium': return 8192;
      case 'high': return 16384;
      case 'max': return 32768;
      default: return 8192;
    }
  }
}
