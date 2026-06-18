/**
 * Google Generative AI Transport
 *
 * 适配 Google Gemini 系列模型，使用 @google/generative-ai SDK。
 * 将归一化的消息/工具格式转换为 Gemini API 格式，
 * 并将流式响应归一化为统一的 NormalizedStreamChunk 序列。
 */
import { GoogleGenerativeAI, SchemaType, type Content, type Part, type FunctionDeclaration, type FunctionDeclarationSchema, type Tool as GeminiTool } from '@google/generative-ai';
import type {
  ProviderTransport,
  TransportChatParams,
  NormalizedStreamChunk,
  NormalizedChatResponse,
  NormalizedModel,
  NormalizedMessage,
  NormalizedTool,
} from './types.js';

/** Gemini Transport 实现 */
export class GeminiTransport implements ProviderTransport {
  readonly apiMode = 'google-generative-ai' as const;
  private readonly genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async *createStreamingChat(params: TransportChatParams): AsyncIterable<NormalizedStreamChunk> {
    const tools = params.tools && params.tools.length > 0 ? this.convertTools(params.tools) : undefined;
    const model = this.genAI.getGenerativeModel({
      model: params.model,
      ...(tools ? { tools } : {}),
    });

    const generationConfig: Record<string, unknown> = {};
    if (params.temperature !== undefined) {
      generationConfig.temperature = params.temperature;
    }
    if (params.topP !== undefined) {
      generationConfig.topP = params.topP;
    }
    if (params.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = params.maxTokens;
    }
    if (params.stop && params.stop.length > 0) {
      generationConfig.stopSequences = params.stop;
    }
    if (params.responseFormat?.type === 'json_object') {
      generationConfig.responseMimeType = 'application/json';
    }

    // 将消息转换为 Gemini 格式
    const { systemInstruction, history } = this.convertMessages(params.messages);

    // 使用 Gemini 的 chat 模式进行多轮对话
    const chat = model.startChat({
      history,
      generationConfig,
      ...(systemInstruction ? { systemInstruction } : {}),
    });

    // 取最后一条用户消息作为输入
    const lastUserMsg = params.messages.filter((m) => m.role === 'user').pop();
    if (!lastUserMsg) {
      throw new Error('Gemini 需要至少一条用户消息');
    }

    const result = await chat.sendMessageStream(lastUserMsg.content);

    for await (const chunk of result.stream) {
      // 文本内容
      const text = chunk.text();
      if (text) {
        yield { type: 'content', content: text };
      }

      // 工具调用
      const functionCallParts = chunk.functionCalls();
      if (functionCallParts && functionCallParts.length > 0) {
        for (let i = 0; i < functionCallParts.length; i++) {
          const fc = functionCallParts[i];
          yield {
            type: 'tool_call_delta',
            index: i,
            id: `call_${i}`,
            name: fc.name,
            argumentsDelta: JSON.stringify(fc.args),
          };
        }
      }

      // 用量
      if (chunk.usageMetadata) {
        const usage = chunk.usageMetadata;
        yield {
          type: 'usage',
          usage: {
            promptTokens: usage.promptTokenCount ?? 0,
            completionTokens: usage.candidatesTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0,
          },
        };
      }
    }

    // 发送 finish 事件
    yield { type: 'finish', finishReason: 'stop' };
  }

  async createNonStreamingChat(params: TransportChatParams): Promise<NormalizedChatResponse> {
    const tools = params.tools && params.tools.length > 0 ? this.convertTools(params.tools) : undefined;
    const model = this.genAI.getGenerativeModel({
      model: params.model,
      ...(tools ? { tools } : {}),
    });

    const generationConfig: Record<string, unknown> = {};
    if (params.temperature !== undefined) generationConfig.temperature = params.temperature;
    if (params.topP !== undefined) generationConfig.topP = params.topP;
    if (params.maxTokens !== undefined) generationConfig.maxOutputTokens = params.maxTokens;
    if (params.stop && params.stop.length > 0) generationConfig.stopSequences = params.stop;
    if (params.responseFormat?.type === 'json_object') generationConfig.responseMimeType = 'application/json';

    const { systemInstruction, history } = this.convertMessages(params.messages);

    const chat = model.startChat({
      history,
      generationConfig,
      ...(systemInstruction ? { systemInstruction } : {}),
    });

    const lastUserMsg = params.messages.filter((m) => m.role === 'user').pop();
    if (!lastUserMsg) {
      throw new Error('Gemini 需要至少一条用户消息');
    }

    const result = await chat.sendMessage(lastUserMsg.content);
    const response = result.response;

    const responseResult: NormalizedChatResponse = {
      content: response.text() || null,
      finishReason: 'stop',
    };

    // 工具调用
    const functionCalls = response.functionCalls();
    if (functionCalls && functionCalls.length > 0) {
      responseResult.toolCalls = functionCalls.map((fc, i) => ({
        id: `call_${i}`,
        name: fc.name,
        arguments: JSON.stringify(fc.args),
      }));
    }

    // 用量
    if (response.usageMetadata) {
      responseResult.usage = {
        promptTokens: response.usageMetadata.promptTokenCount ?? 0,
        completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: response.usageMetadata.totalTokenCount ?? 0,
      };
    }

    return responseResult;
  }

  async listModels(): Promise<NormalizedModel[]> {
    return [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', ownedBy: 'google' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', ownedBy: 'google' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', ownedBy: 'google' },
    ];
  }

  // ─── 私有方法 ───

  /**
   * 将归一化消息转换为 Gemini 格式
   * Gemini 的 system instruction 单独传入，history 不包含最后一条用户消息
   */
  private convertMessages(messages: NormalizedMessage[]): {
    systemInstruction: string | undefined;
    history: Content[];
  } {
    let systemInstruction: string | undefined;
    const history: Content[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = (systemInstruction ?? '') + (systemInstruction ? '\n\n' : '') + msg.content;
        continue;
      }

      if (msg.role === 'assistant') {
        const parts: Part[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: JSON.parse(tc.arguments || '{}'),
              },
            });
          }
        }
        history.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        history.push({
          role: 'function',
          parts: [{
            functionResponse: {
              name: msg.toolCallId ?? 'unknown',
              response: { result: msg.content },
            },
          }],
        });
      } else if (msg.role === 'user') {
        history.push({ role: 'user', parts: [{ text: msg.content }] });
      }
    }

    // 移除最后一条用户消息（Gemini chat 模式下单独发送）
    let lastUserIdx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx >= 0) {
      history.splice(lastUserIdx, 1);
    }

    return { systemInstruction, history };
  }

  /** 将归一化工具定义转换为 Gemini 格式 */
  private convertTools(tools: NormalizedTool[]): GeminiTool[] {
    const declarations: FunctionDeclaration[] = tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: this.convertSchemaToGemini(tool.function.parameters),
    }));
    return [{ functionDeclarations: declarations }];
  }

  /** 将 JSON Schema 转换为 Gemini 兼容格式 */
  private convertSchemaToGemini(schema?: Record<string, unknown>): FunctionDeclarationSchema | undefined {
    if (!schema) return undefined;
    return {
      type: SchemaType.OBJECT,
      properties: (schema.properties as FunctionDeclarationSchema['properties']) ?? {},
      ...(schema.required ? { required: schema.required as string[] } : {}),
    };
  }

  /** 根据 reasoning_effort 推导 thinking budget */
  private resolveThinkingBudget(effort?: string): number {
    switch (effort) {
      case 'low': return 2048;
      case 'medium': return 8192;
      case 'high': return 24576;
      case 'max': return 65536;
      default: return 8192;
    }
  }
}
