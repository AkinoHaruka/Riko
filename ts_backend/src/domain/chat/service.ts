/**
 * 聊天服务：流式/非流式对话补全、模型列表查询。
 * 流式模式支持工具调用循环，非流式模式用于子代理场景。
 */
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions/completions.js';
import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions/completions.js';
import { loadMainPrompt, loadToolRules, loadPersistentMemory } from '../../prompts/index.js';
import { buildApiParams, buildSystemPrompt } from './types.js';
import { buildMemorySearchToolDefinition } from '../../tools/memorySearch/definition.js';
import type { ChatCompletionRequest, ToolCallAccumulator, ChatMessage } from './types.js';
import { streamResponse } from './stream.js';
import { executeToolCalls, buildToolResultMessages } from './toolHandler.js';
import { getOrCreateClient } from '../../core/ai/client.js';
import { mapApiError } from '../../core/ai/errors.js';
import { env } from '../../config/index.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('ChatService');

let modelsCache: Array<{ id: string; name: string; owned_by: string }> | null = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

function extractCompactContext(messages: ChatMessage[]): string | undefined {
  const compactMessages = messages.filter((m) => m.is_compact_summary);
  if (compactMessages.length === 0) return undefined;
  return compactMessages.map((m) => m.content).join('\n');
}

export async function* chatCompletionStream(
  request: ChatCompletionRequest,
  userId: string,
): AsyncGenerator<string> {
  const mainPrompt = loadMainPrompt(userId);
  const toolRules = loadToolRules();
  const persistentMemory = loadPersistentMemory();
  const systemPrompt = buildSystemPrompt(mainPrompt, toolRules, persistentMemory);
  const compactContext = extractCompactContext(request.messages);

  const params = buildApiParams(request, {
    systemPrompt,
    compactContext,
  });
  // 注入长期记忆检索工具，AI 可按需搜索 auto_dream/ 中的历史记忆
  if (!params.tools) {
    params.tools = [buildMemorySearchToolDefinition()];
  }
  yield* streamResponse(params, userId, request.conversation_id);
}

function toNonStreamingParams(
  params: Record<string, unknown>,
): ChatCompletionCreateParamsNonStreaming {
  return {
    ...params,
    stream: false,
  } as ChatCompletionCreateParamsNonStreaming;
}

function buildNonStreamingContinueParams(
  originalParams: Record<string, unknown>,
  messages: Record<string, unknown>[],
): ChatCompletionCreateParamsNonStreaming {
  const { tools: _tools, messages: _oldMessages, ...restParams } = originalParams;
  return {
    ...restParams,
    messages: messages as unknown as ChatCompletionCreateParamsNonStreaming['messages'],
    stream: false,
  } as ChatCompletionCreateParamsNonStreaming;
}

export async function chatCompletionNonStream(
  request: ChatCompletionRequest,
  userId: string,
): Promise<Record<string, unknown>> {
  const mainPrompt = loadMainPrompt(userId);
  const toolRules = loadToolRules();
  const persistentMemory = loadPersistentMemory();
  const systemPrompt = buildSystemPrompt(mainPrompt, toolRules, persistentMemory);
  const compactContext = extractCompactContext(request.messages);
  const conversationId = request.conversation_id;
  const params = buildApiParams(request, {
    systemPrompt,
    compactContext,
  });

  try {
    const client = await getOrCreateClient(userId);

    const requestParams = toNonStreamingParams(params);
    const response = await client.chat.completions.create(requestParams);

    if (response.choices?.[0]?.message?.tool_calls) {
      const toolCalls = response.choices[0].message.tool_calls;
      const toolCallsAccumulator: ToolCallAccumulator = {};
      toolCalls.forEach((tc, idx) => {
        if (tc.type === 'function') {
          const fn = (tc as ChatCompletionMessageFunctionToolCall).function;
          toolCallsAccumulator[idx] = {
            id: tc.id,
            type: 'function',
            function: {
              name: fn.name,
              arguments: fn.arguments,
            },
          };
        }
      });

      const memoryRoot = env.MEMORY_ROOT_DIR;
      const toolResults = executeToolCalls(toolCallsAccumulator, conversationId!, memoryRoot);
      const toolResultMessages = buildToolResultMessages(toolCallsAccumulator, toolResults);

      const messages = params.messages as Record<string, unknown>[];
      const assistantMsg = response.choices[0].message as unknown as Record<string, unknown>;
      messages.push(assistantMsg);
      messages.push(...toolResultMessages);

      const continueParams = buildNonStreamingContinueParams(params, messages);
      const secondResponse = await client.chat.completions.create(continueParams);
      return secondResponse as unknown as Record<string, unknown>;
    }

    return response as unknown as Record<string, unknown>;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'status' in error) {
      const mapped = mapApiError(error);
      logger.error('DeepSeek API 错误 [%d]: %s', mapped.statusCode, mapped.message);
      return { error: mapped.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error('DeepSeek 非流式请求异常: %s', message);
    return { error: `DeepSeek 请求失败: ${message}` };
  }
}

export async function listModels(
  userId: string,
): Promise<Array<{ id: string; name: string; owned_by: string }>> {
  const now = Date.now();
  if (modelsCache && now - modelsCacheTime < MODELS_CACHE_TTL_MS) {
    return modelsCache;
  }

  // API 不可用时的兜底模型列表，确保前端至少能显示默认选项
  const FALLBACK_MODELS: Array<{ id: string; name: string; owned_by: string }> = [
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', owned_by: 'deepseek' },
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', owned_by: 'deepseek' },
  ];

  try {
    const client = await getOrCreateClient(userId);
    const response = await client.models.list();
    const models = response.data.map((model) => ({
      id: model.id,
      name: model.id,
      owned_by: model.owned_by ?? 'deepseek',
    }));

    modelsCache = models;
    modelsCacheTime = now;
    return models;
  } catch (e) {
    logger.warn('获取模型列表失败，使用兜底列表: %s', e);
    return FALLBACK_MODELS;
  }
}
