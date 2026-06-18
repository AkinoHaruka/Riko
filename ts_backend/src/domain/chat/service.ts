/**
 * 聊天服务：流式/非流式对话补全、模型列表查询。
 * 流式模式支持工具调用循环，非流式模式用于子代理场景。
 * 所有请求都经过系统提示词组装和常驻记忆注入。
 *
 * 多 Provider 支持：根据 model ID 自动路由到对应的 Transport，
 * 上层代码无需关心底层 API 差异。
 */
import { loadMainPrompt, loadToolRules, loadPersistentMemory } from '../../prompts/index.js';
import { buildApiParams, buildSystemPrompt } from './types.js';
import { buildMemorySearchToolDefinition, buildEditToolDefinition, buildWriteToolDefinition, buildCatToolDefinition, buildGrepToolDefinition, buildLsToolDefinition, buildFindToolDefinition, buildStatToolDefinition, buildWcToolDefinition, buildHeadToolDefinition, buildTailToolDefinition, buildSkillsListToolDefinition, buildSkillViewToolDefinition, buildMcpToolDefinitions } from '../../tools/index.js';
import type { ChatCompletionRequest, ChatMessage } from './types.js';
import { streamResponse } from './stream.js';
import { nonStreamingToolCallLoop } from './toolCallLoop.js';
import { resetToolGuardrails } from './toolHandler.js';
import { getOrCreateClient, getTransportForModel, resolveProvider } from '../../core/ai/client.js';
import { mapApiError } from '../../core/ai/errors.js';
import { getAllModels } from '../../core/ai/providers/index.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('ChatService');

/** 模型列表缓存 */
let modelsCache: Array<{ id: string; name: string; owned_by: string }> | null = null;
let modelsCacheTime = 0;
/** 模型列表缓存 TTL：5 分钟 */
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 从消息列表中提取压缩上下文。
 * 将所有标记为 is_compact_summary 的消息内容拼接为压缩上下文字符串。
 * @param messages - 消息列表
 * @returns 压缩上下文，无压缩消息时返回 undefined
 */
function extractCompactContext(messages: ChatMessage[]): string | undefined {
  const compactMessages = messages.filter((m) => m.is_compact_summary);
  if (compactMessages.length === 0) return undefined;
  return compactMessages.map((m) => m.content).join('\n');
}

/**
 * 流式聊天补全。组装系统提示词和工具定义后委托给 streamResponse。
 * @param request - 聊天补全请求
 * @param userId - 用户 ID
 * @returns SSE 事件字符串的异步生成器
 */
export async function* chatCompletionStream(
  request: ChatCompletionRequest,
  userId: string,
): AsyncGenerator<string> {
  // 每次请求重置护栏状态，避免上一轮 halt 决策污染本次对话
  resetToolGuardrails();
  const mainPrompt = loadMainPrompt(userId);
  const toolRules = loadToolRules();
  const persistentMemory = loadPersistentMemory();
  const systemPrompt = buildSystemPrompt(mainPrompt, toolRules, persistentMemory);
  const compactContext = extractCompactContext(request.messages);

  const params = buildApiParams(request, {
    systemPrompt,
    compactContext,
  });
  // 注入所有可用工具定义，AI 可按需调用
  const allToolDefinitions = [
    buildEditToolDefinition(),
    buildWriteToolDefinition(),
    buildCatToolDefinition(),
    buildGrepToolDefinition(),
    buildLsToolDefinition(),
    buildFindToolDefinition(),
    buildStatToolDefinition(),
    buildWcToolDefinition(),
    buildHeadToolDefinition(),
    buildTailToolDefinition(),
    buildMemorySearchToolDefinition(),
    buildSkillsListToolDefinition(),
    buildSkillViewToolDefinition(),
    ...buildMcpToolDefinitions(),
  ];
  if (!params.tools) {
    params.tools = allToolDefinitions;
  } else {
    params.tools = [...(params.tools as unknown[]), ...allToolDefinitions];
  }
  yield* streamResponse(params, userId, request.conversation_id, request.model);
}

/**
 * 非流式聊天补全，用于子代理场景。
 * 支持多轮工具调用循环：委托给 nonStreamingToolCallLoop。
 * @param request - 聊天补全请求
 * @param userId - 用户 ID
 * @returns 完整的聊天补全响应
 */
export async function chatCompletionNonStream(
  request: ChatCompletionRequest,
  userId: string,
): Promise<Record<string, unknown>> {
  // 每次请求重置护栏状态，避免上一轮 halt 决策污染本次对话
  resetToolGuardrails();
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
    // 根据模型 ID 路由到对应的 Provider
    const provider = resolveProvider(request.model);
    if (provider.apiMode === 'openai-compatible') {
      // OpenAI 兼容 Provider：使用原有的 toolCallLoop
      const client = await getOrCreateClient(userId);
      return await nonStreamingToolCallLoop(client, params, conversationId);
    }

    // 非 OpenAI 兼容 Provider：使用 Transport 的非流式接口
    const transport = await getTransportForModel(request.model, userId);
    const response = await transport.createNonStreamingChat({
      model: request.model,
      messages: (params.messages as Array<Record<string, unknown>>).map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: (m.content as string) ?? '',
      })),
      tools: (params.tools as Array<Record<string, unknown>> | undefined)?.map((t) => {
        const fn = (t.function ?? {}) as Record<string, unknown>;
        return {
          type: 'function' as const,
          function: {
            name: (fn.name as string) ?? '',
            description: fn.description as string | undefined,
            parameters: fn.parameters as Record<string, unknown> | undefined,
          },
        };
      }),
      temperature: request.temperature,
      maxTokens: request.max_tokens,
      topP: request.top_p,
      stream: false,
      thinking: request.thinking,
      reasoningEffort: request.reasoning_effort,
    });

    return response as unknown as Record<string, unknown>;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'status' in error) {
      const mapped = mapApiError(error);
      logger.error('AI API 错误 [%d]: %s', mapped.statusCode, mapped.message);
      return { error: mapped.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error('非流式请求异常: %s', message);
    return { error: 'AI 请求失败，请稍后重试' };
  }
}

/**
 * 查询可用模型列表。带 5 分钟内存缓存。
 * 聚合所有已配置 Provider 的模型列表。
 * @param userId - 用户 ID
 * @returns 模型列表
 */
export async function listModels(
  _userId: string,
): Promise<Array<{ id: string; name: string; owned_by: string }>> {
  const now = Date.now();
  if (modelsCache && now - modelsCacheTime < MODELS_CACHE_TTL_MS) {
    return modelsCache;
  }

  // 从注册表获取所有已知模型
  const allModels = getAllModels();
  const models = allModels.map((m) => ({
    id: m.id,
    name: m.name,
    owned_by: m.providerId,
  }));

  modelsCache = models;
  modelsCacheTime = now;
  return models;
}
