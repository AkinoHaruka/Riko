/**
 * 子代理执行器：多轮对话循环，支持工具调用、自动重试、执行轨迹收集。
 * 提供给 session_memory、compact、dream 三个子代理使用。
 *
 * 核心流程：
 * 1. 构建 OpenAI 请求参数（模型、消息、工具定义）
 * 2. 循环调用 AI API，每轮处理响应和工具调用
 * 3. 工具调用通过 toolRegistry 或 customToolExecutor 执行
 * 4. 连续未调用工具时追加提示重试，超过阈值后终止
 * 5. 收集执行轨迹（请求 JSON、每轮详情、耗时等）
 */
import type OpenAI from 'openai';
import { getOrCreateClient } from '../../core/ai/client.js';
import { createLogger } from '../../core/logger/index.js';
import { toolRegistry } from '../../tools/registry.js';
import type { ToolContext } from '../../core/types/tools.js';
import { buildSubAgentMessages } from './promptBuilder.js';
import { getParamValue } from '../setting/index.js';
import type {
  SubAgentConfig,
  SubAgentPromptParts,
  SubAgentResult,
  SubAgentTrace,
  SubAgentTurnDetail,
  SubAgentToolCall,
} from './types.js';

const logger = createLogger('SubAgentExecutor');
const DEFAULT_MAX_TURNS = 10;
/** 默认模型标识，getParamValue 未找到用户设置时使用 */
const FALLBACK_MODEL = 'deepseek-v4-pro';
const DEFAULT_TEMPERATURE = 0.3;

/**
 * 获取用户选择的模型，优先从设置读取，兜底使用 FALLBACK_MODEL。
 * @param userId - 用户 ID
 * @returns 模型标识字符串
 */
function resolveModel(userId: string): string {
  return getParamValue(userId, 'selected_model', FALLBACK_MODEL);
}

/**
 * 执行子代理的多轮对话循环。
 * @param config 子代理配置（模型、工具、轮次限制等）
 * @param promptParts 提示词各部分
 * @param userId 用户 ID，用于获取 API 客户端
 * @param toolContext 工具执行上下文（会话 ID、记忆根目录等）
 * @returns 子代理执行结果（成功/失败、输出文本、执行轨迹）
 */
export class SubAgentExecutor {
  async execute(
    config: SubAgentConfig,
    promptParts: SubAgentPromptParts,
    userId: string,
    toolContext?: ToolContext,
  ): Promise<SubAgentResult> {
    const startTime = Date.now();
    const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
    const model = config.model ?? resolveModel(userId);
    const temperature = config.temperature ?? DEFAULT_TEMPERATURE;

    // 收集执行轨迹
    const turns: SubAgentTurnDetail[] = [];
    let requestJson = '';
    // 声明在 try 外部，确保 catch 块可访问已累计的值
    let totalTurns = 0;
    let toolCallCount = 0;

    try {
      logger.info(
        `[SubAgent:${config.type}] 开始执行, userId=${userId}, model=${model}, maxTurns=${maxTurns}`,
      );

      let client: OpenAI;
      try {
        client = await getOrCreateClient(userId);
        logger.info(`[SubAgent:${config.type}] OpenAI客户端获取成功, baseURL=${client.baseURL}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[SubAgent:${config.type}] 获取客户端失败: ${msg}`);
        throw new Error(`获取 AI 客户端失败: ${msg}`);
      }

      const messages = buildSubAgentMessages(promptParts) as OpenAI.ChatCompletionMessageParam[];

      // 保存请求 JSON 供前端监控展示（完整内容，不截断）
      const requestObj: Record<string, unknown> = {
        type: config.type,
        model,
        temperature,
        maxTurns,
        messages: messages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
        tools: config.tools?.map((t) =>
          typeof t === 'object' && t && 'function' in t
            ? (t as Record<string, unknown>).function
            : t,
        ),
      };
      // 移除可能包含的敏感头信息，防止 API Key 泄露
      if (requestObj.headers && typeof requestObj.headers === 'object') {
        delete (requestObj.headers as Record<string, unknown>).Authorization;
      }
      requestJson = JSON.stringify(requestObj, null, 2);

      logger.info(`[SubAgent:${config.type}] 消息构建完成, 消息数=${messages.length}`);

      const apiParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages,
        temperature,
        stream: false,
      };

      if (config.maxTokens) {
        apiParams.max_tokens = config.maxTokens;
      }

      if (config.tools && config.tools.length > 0) {
        apiParams.tools = config.tools as unknown as OpenAI.ChatCompletionTool[];
        logger.info(`[SubAgent:${config.type}] 工具数量: ${config.tools.length}`);
      }

      let accumulatedText = '';
      const hadTools = !!(config.tools && config.tools.length > 0);
      // 连续未调用工具计数器，超过阈值后终止循环避免浪费轮次
      let consecutiveNoToolCalls = 0;
      const MAX_CONSECUTIVE_NO_TOOL_CALLS = 2;

      for (let turn = 0; turn < maxTurns; turn++) {
        totalTurns = turn + 1;
        const turnTools: SubAgentToolCall[] = [];
        let turnResponseText = '';

        logger.info(
          `[SubAgent:${config.type}] 第 ${totalTurns} 轮调用开始, messages数=${apiParams.messages.length}`,
        );

        let response;
        try {
          response = await client.chat.completions.create(apiParams);
        } catch (apiError) {
          const errMsg = apiError instanceof Error ? apiError.message : String(apiError);
          const errStatus = (apiError as { status?: number })?.status;
          logger.error(
            `[SubAgent:${config.type}] 第 ${totalTurns} 轮API调用失败: status=${errStatus}, message=${errMsg}`,
          );
          throw new Error(`AI API 调用失败 (status=${errStatus}): ${errMsg}`);
        }

        const choice = response.choices[0];
        if (!choice) {
          logger.error(`[SubAgent:${config.type}] 第 ${totalTurns} 轮返回空choices`);
          throw new Error('AI API 返回空响应');
        }

        const message = choice.message;
        turnResponseText = message.content ?? '';

        if (message.content) {
          accumulatedText += message.content;
        }

        if (!message.tool_calls || message.tool_calls.length === 0) {
          consecutiveNoToolCalls++;
          if (hadTools && toolCallCount === 0 && consecutiveNoToolCalls <= MAX_CONSECUTIVE_NO_TOOL_CALLS && turn < maxTurns - 1) {
            logger.warn(`[SubAgent:${config.type}] 第 ${totalTurns} 轮LLM未调用工具，追加提示重试 (${consecutiveNoToolCalls}/${MAX_CONSECUTIVE_NO_TOOL_CALLS})`);
            const rc = (message as unknown as Record<string, unknown>).reasoning_content as
              | string
              | undefined;
            const noToolMsg: Record<string, unknown> = {
              role: 'assistant',
              content: message.content || '',
            };
            if (rc) noToolMsg.reasoning_content = rc;
            messages.push(noToolMsg as unknown as OpenAI.ChatCompletionAssistantMessageParam);
            messages.push({
              role: 'user',
              content:
                '你必须使用提供的工具（edit_tool 或 write_tool）来更新文件。不要仅用文字描述，必须调用工具。请立即调用工具。',
            } as OpenAI.ChatCompletionUserMessageParam);
            apiParams.messages = messages;

            turns.push({
              turn: totalTurns,
              modelResponse: turnResponseText.slice(0, 500),
              reasoningContent: rc?.slice(0, 500),
              toolCalls: [],
            });
            continue;
          }
          if (consecutiveNoToolCalls > MAX_CONSECUTIVE_NO_TOOL_CALLS) {
            logger.warn(`[SubAgent:${config.type}] 连续 ${consecutiveNoToolCalls} 轮未调用工具，终止循环`);
          }
          turns.push({
            turn: totalTurns,
            modelResponse: turnResponseText.slice(0, 500),
            toolCalls: [],
          });
          logger.info(`[SubAgent:${config.type}] 第 ${totalTurns} 轮无工具调用，结束`);
          break;
        }

        const functionToolCalls = message.tool_calls.filter(
          (tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function',
        );

        if (functionToolCalls.length === 0) {
          turns.push({
            turn: totalTurns,
            toolCalls: [],
            modelResponse: turnResponseText.slice(0, 500),
          });
          break;
        }

        toolCallCount += functionToolCalls.length;
        consecutiveNoToolCalls = 0; // 有工具调用时重置连续未调用计数器
        logger.info(
          `[SubAgent:${config.type}] 第 ${totalTurns} 轮工具调用数: ${functionToolCalls.length}, 工具: ${functionToolCalls.map((tc) => tc.function.name).join(', ')}`,
        );

        const rc = (message as unknown as Record<string, unknown>).reasoning_content as
          | string
          | undefined;
        const assistantMsg: Record<string, unknown> = {
          role: 'assistant',
          content: message.content || '',
          tool_calls: functionToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        };
        if (rc) assistantMsg.reasoning_content = rc;
        messages.push(assistantMsg as unknown as OpenAI.ChatCompletionAssistantMessageParam);

        for (const tc of functionToolCalls) {
          logger.info(
            `[SubAgent:${config.type}] 执行工具: ${tc.function.name}, args长度=${tc.function.arguments.length}`,
          );
          const resultContent = this.executeToolCall(tc, toolContext, config.customToolExecutor);
          const resultPreview =
            resultContent.length > 300 ? resultContent.slice(0, 300) + '...' : resultContent;
          logger.info(
            `[SubAgent:${config.type}] 工具 ${tc.function.name} 执行完成, 结果长度=${resultContent.length}`,
          );

          turnTools.push({
            turn: totalTurns,
            name: tc.function.name,
            arguments: tc.function.arguments,
            resultPreview,
          });

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: resultContent,
          });
        }

        turns.push({
          turn: totalTurns,
          modelResponse: turnResponseText.slice(0, 500),
          reasoningContent: rc?.slice(0, 500),
          toolCalls: turnTools,
        });

        apiParams.messages = messages;

        if (choice.finish_reason === 'stop') {
          logger.info(`[SubAgent:${config.type}] 第 ${totalTurns} 轮 finish_reason=stop，结束`);
          break;
        }
      }

      const elapsedMs = Date.now() - startTime;

      if (hadTools && toolCallCount === 0) {
        logger.warn(`[SubAgent:${config.type}] 执行完成但未调用任何工具`);
        accumulatedText = accumulatedText.trim()
          ? `${accumulatedText.trim()}\n\n[警告：模型未调用任何工具，笔记文件未被更新]`
          : '[警告：模型未调用任何工具，任务未完成]';
      } else if (!accumulatedText.trim() && totalTurns > 0) {
        accumulatedText = `[子代理 ${config.type} 已完成 ${totalTurns} 轮工具调用]`;
      }

      const trace: SubAgentTrace = {
        requestJson,
        turns,
        totalTurns,
        toolCallCount,
        elapsedMs,
      };

      logger.info(
        `[SubAgent:${config.type}] 执行完成, totalTurns=${totalTurns}, toolCallCount=${toolCallCount}, elapsedMs=${elapsedMs}, output长度=${accumulatedText.length}`,
      );

      return {
        type: config.type,
        // 没有工具时，模型文本响应即为成功；有工具时，必须至少调用一次工具才算成功
        success: !hadTools || toolCallCount > 0,
        output: accumulatedText,
        error: toolCallCount === 0 && hadTools ? '模型未调用任何工具，笔记文件未被更新' : undefined,
        trace,
        metadata: {
          model,
          totalTurns,
          toolCallCount,
          elapsedMs,
          maxTokens: config.maxTokens ?? null,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (e) {
      const elapsedMs = Date.now() - startTime;
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.error(`[SubAgent:${config.type}] 执行失败: ${errorMessage}`);

      const trace: SubAgentTrace = {
        requestJson,
        turns,
        totalTurns: turns.length,
        toolCallCount,
        elapsedMs,
      };

      return {
        type: config.type,
        success: false,
        output: '',
        error: errorMessage,
        trace,
        metadata: { model, totalTurns: turns.length, toolCallCount, elapsedMs },
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 执行单个工具调用。优先使用 customToolExecutor，否则从 toolRegistry 查找。
   * 执行前先调用 validate 校验参数合法性，执行失败时返回错误 JSON 而非抛异常。
   */
  private executeToolCall(
    toolCall: Extract<OpenAI.ChatCompletionMessageToolCall, { type: 'function' }>,
    toolContext?: ToolContext,
    customExecutor?: (name: string, args: Record<string, unknown>) => string,
  ): string {
    const funcName = toolCall.function.name;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      args = { _parseError: `工具参数 JSON 解析失败，原始参数: ${toolCall.function.arguments.slice(0, 200)}` };
    }

    // 自定义执行器优先（子代理可提供自己的工具实现）
    if (customExecutor) {
      try {
        return customExecutor(funcName, args);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return JSON.stringify({ success: false, error: `工具执行异常: ${message}` });
      }
    }

    if (!toolContext) {
      return JSON.stringify({ success: false, error: 'toolContext 未提供' });
    }
    const handler = toolRegistry.get(funcName);
    if (!handler) {
      return JSON.stringify({ success: false, error: `未知工具: ${funcName}` });
    }
    if (handler.validate) {
      const validation = handler.validate(args, toolContext);
      if (!validation.valid) {
        return JSON.stringify({ success: false, error: validation.error });
      }
    }
    try {
      const result = handler.execute(args, toolContext);
      return JSON.stringify(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return JSON.stringify({ success: false, error: `工具执行异常: ${message}` });
    }
  }
}
