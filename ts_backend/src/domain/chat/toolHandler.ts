/**
 * 工具调用执行器。解析工具调用的 JSON 参数，通过 toolRegistry 分派到具体工具实现。
 */
import type { ToolCallAccumulator } from './types.js';
import type { ToolCallResult, ToolContext } from '../../tools/types.js';
import { toolRegistry } from '../../tools/registry.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('ToolHandler');

export type { ToolCallResult } from '../../tools/types.js';

function parseToolArguments(argsStr: string): Record<string, unknown> {
  try {
    return JSON.parse(argsStr);
  } catch {
    logger.warn('工具调用参数 JSON 解析失败: %s', argsStr.slice(0, 200));
    return {};
  }
}

export function executeToolCalls(
  toolCallsAccumulator: ToolCallAccumulator,
  conversationId: string,
  memoryRoot: string,
): Map<number, ToolCallResult> {
  const results = new Map<number, ToolCallResult>();
  const context: ToolContext = { conversationId, memoryRoot };
  const sortedIndices = Object.keys(toolCallsAccumulator)
    .map(Number)
    .sort((a, b) => a - b);

  for (const idx of sortedIndices) {
    const tcData = toolCallsAccumulator[idx];
    const funcName = tcData.function.name;
    const args = parseToolArguments(tcData.function.arguments);

    const handler = toolRegistry.get(funcName);
    if (!handler) {
      results.set(idx, { success: false, error: `未知工具: ${funcName}` });
      continue;
    }

    if (handler.validate) {
      const validation = handler.validate(args, context);
      if (!validation.valid) {
        results.set(idx, { success: false, error: validation.error });
        continue;
      }
    }

    try {
      const result = handler.execute(args, context);
      results.set(idx, result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.set(idx, { success: false, error: `工具执行异常: ${message}` });
    }
  }

  return results;
}

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
