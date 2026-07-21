/**
 * 工具调用执行器。
 * 解析工具调用的 JSON 参数，通过 toolRegistry 分派到具体工具实现，
 * 并将执行结果构建为 OpenAI 格式的 tool 消息供续流使用。
 * 集成工具调用护栏，检测重复失败和无进展循环。
 */
import type { ToolCallAccumulator } from './types.js';
import type { ToolCallResult, ToolContext } from '../../core/types/tools.js';
import { toolRegistry } from '../../tools/registry.js';
import { ToolCallGuardrailController, buildGuardrailSyntheticResult } from '../../core/security/index.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('ToolHandler');

/**
 * 护栏控制器实例池：按 conversationId 维系独立实例。
 *
 * 设计说明（修复并发污染）：
 * 原实现使用模块级全局单例，导致并发请求共享同一份护栏计数器——
 * 用户 A 的请求开始时调用 resetToolGuardrails() 会清空用户 B 正在进行的
 * 重复失败/无进展计数，且 haltDecision 会跨请求泄漏。这不仅破坏隔离性，
 * 还可能让护栏误判（把别人的失败算到自己头上）。
 *
 * 现改为每会话独立实例：各会话的护栏状态互不影响，符合
 * ToolCallGuardrailController "每轮对话一个实例" 的设计意图。
 * 实例带最后访问时间，定期清理空闲会话防止内存泄漏。
 */
interface GuardrailEntry {
  controller: ToolCallGuardrailController;
  lastAccess: number;
}

const guardrailPool = new Map<string, GuardrailEntry>();
/** 空闲会话实例最大存活时间：30 分钟 */
const GUARDRAIL_IDLE_TTL_MS = 30 * 60 * 1000;
/** 实例池容量上限，防止会话数暴涨导致内存膨胀 */
const GUARDRAIL_POOL_MAX = 500;

/** 获取（或创建）指定会话的护栏控制器，并刷新其访问时间 */
function getGuardrail(conversationId: string): ToolCallGuardrailController {
  let entry = guardrailPool.get(conversationId);
  if (!entry) {
    // 容量上限：淘汰最久未访问的实例（Map 迭代按插入序，头部最旧）
    if (guardrailPool.size >= GUARDRAIL_POOL_MAX) {
      const oldestKey = guardrailPool.keys().next().value;
      if (oldestKey !== undefined) guardrailPool.delete(oldestKey);
    }
    entry = {
      controller: new ToolCallGuardrailController({ warningsEnabled: true, hardStopEnabled: true }),
      lastAccess: Date.now(),
    };
    guardrailPool.set(conversationId, entry);
  }
  entry.lastAccess = Date.now();
  return entry.controller;
}

/**
 * 重置护栏状态（新对话轮次开始时调用）。
 *
 * @param conversationId - 传入时仅重置该会话的护栏（推荐，并发安全）；
 *                         不传时退化为清空整个实例池（向后兼容旧调用）。
 */
export function resetToolGuardrails(conversationId?: string): void {
  if (conversationId !== undefined) {
    const entry = guardrailPool.get(conversationId);
    entry?.controller.reset();
  } else {
    guardrailPool.clear();
  }
}

/** 定期清理空闲护栏实例，防止内存泄漏。unref 避免阻止进程退出。 */
const guardrailCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of guardrailPool) {
    if (now - entry.lastAccess > GUARDRAIL_IDLE_TTL_MS) {
      guardrailPool.delete(key);
    }
  }
}, GUARDRAIL_IDLE_TTL_MS);
guardrailCleanupTimer.unref?.();

export type { ToolCallResult } from '../../core/types/tools.js';

/**
 * 解析工具调用的 JSON 参数字符串。
 * 解析失败时返回包含 _parseError 的对象，让 AI 知道参数格式有误，而非以空参数静默执行。
 * @param argsStr - 工具参数 JSON 字符串
 * @returns 解析后的参数对象
 */
function parseToolArguments(argsStr: string): Record<string, unknown> {
  try {
    return JSON.parse(argsStr);
  } catch {
    logger.warn('工具调用参数 JSON 解析失败: %s', argsStr.slice(0, 200));
    return { _parseError: `工具参数 JSON 解析失败，原始参数: ${argsStr.slice(0, 200)}` };
  }
}

/**
 * 执行累积器中的所有工具调用。
 * 按索引顺序依次执行，每个工具调用经过校验和异常捕获。
 * 仅允许执行 allowedTools 白名单中的工具，防止 LLM 调用未声明的工具。
 * @param toolCallsAccumulator - 工具调用累积器
 * @param conversationId - 当前会话 ID
 * @param memoryRoot - 记忆文件根目录
 * @param allowedTools - 允许执行的工具名称集合，未提供时允许所有已注册工具
 * @param userId - 当前用户 ID（可选），用于工具内数据隔离
 * @returns 以索引为键的工具调用结果映射
 */
export async function executeToolCalls(
  toolCallsAccumulator: ToolCallAccumulator,
  conversationId: string,
  memoryRoot: string,
  allowedTools?: Set<string>,
  userId?: string,
): Promise<Map<number, ToolCallResult>> {
  const results = new Map<number, ToolCallResult>();
  const context: ToolContext = { conversationId, memoryRoot, userId };
  // 按会话获取独立的护栏控制器，避免并发请求间的状态污染
  const guardrailController = getGuardrail(conversationId);
  const sortedIndices = Object.keys(toolCallsAccumulator)
    .map(Number)
    .sort((a, b) => a - b);

  for (const idx of sortedIndices) {
    const tcData = toolCallsAccumulator[idx];
    const funcName = tcData.function.name;

    // 白名单检查：仅允许执行当前请求中声明的工具
    if (allowedTools && !allowedTools.has(funcName)) {
      results.set(idx, { success: false, error: `未授权的工具: ${funcName}` });
      continue;
    }

    const handler = toolRegistry.get(funcName);
    if (!handler) {
      results.set(idx, { success: false, error: `未知工具: ${funcName}` });
      continue;
    }

    const args = parseToolArguments(tcData.function.arguments);

    // 工具调用前护栏检查
    const beforeDecision = guardrailController.beforeCall(funcName, args);
    if (beforeDecision.action === 'block' || beforeDecision.action === 'halt') {
      logger.warn('工具护栏阻止调用: %s (%s)', funcName, beforeDecision.code);
      results.set(idx, {
        success: false,
        error: buildGuardrailSyntheticResult(beforeDecision),
      });
      continue;
    }
    if (beforeDecision.action === 'warn') {
      logger.info('工具护栏警告: %s - %s', funcName, beforeDecision.message);
    }

    if (handler.validate) {
      const validation = handler.validate(args, context);
      if (!validation.valid) {
        results.set(idx, { success: false, error: validation.error });
        continue;
      }
    }

    try {
      const result = await handler.execute(args, context);
      results.set(idx, result);

      // 工具调用后护栏记录（成功）
      const afterDecision = guardrailController.afterCall(funcName, args, JSON.stringify(result), false);
      if (afterDecision.action === 'warn') {
        logger.info('工具护栏警告: %s - %s', funcName, afterDecision.message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.set(idx, { success: false, error: `工具执行异常: ${message}` });

      // 工具调用后护栏记录（失败）
      const afterDecision = guardrailController.afterCall(funcName, args, message, true);
      if (afterDecision.action === 'warn') {
        logger.info('工具护栏警告: %s - %s', funcName, afterDecision.message);
      } else if (afterDecision.action === 'halt') {
        logger.warn('工具护栏终止: %s (%s)', funcName, afterDecision.code);
      }
    }
  }

  return results;
}

/**
 * 构建工具调用结果消息列表，供续流请求使用。
 * @param toolCallsAccumulator - 工具调用累积器
 * @param toolResults - 工具调用执行结果映射
 * @returns OpenAI 格式的 tool 角色消息数组
 */
export function buildToolResultMessages(
  toolCallsAccumulator: ToolCallAccumulator,
  toolResults: Map<number, ToolCallResult>,
): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  const sortedIndices = Object.keys(toolCallsAccumulator)
    .map(Number)
    .sort((a, b) => a - b);

  for (const idx of sortedIndices) {
    const tcData = toolCallsAccumulator[idx];
    const result = toolResults.get(idx);
    const resultContent = result
      ? JSON.stringify(result)
      : '{"success": false, "error": "工具执行结果缺失"}';

    messages.push({
      role: 'tool',
      tool_call_id: tcData.id,
      content: resultContent,
    });
  }

  return messages;
}
