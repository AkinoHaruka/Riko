/**
 * Wc (wordCount) 工具的 ToolHandler 实现
 *
 * 将 AI 的工具调用参数转换为 WcRequest，
 * 使用 sanitizeSearchPath 清理目录路径后委托给 executeWc 执行统计。
 */
import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeWc } from './wordCount.js';
import { sanitizeSearchPath } from '../pathSecurity.js';

export const wcToolHandler: ToolHandler = {
  name: 'wc_tool',

  /** 执行字数统计，目录路径经过安全清理 */
  execute(args: Record<string, unknown>, context: ToolContext): ToolCallResult {
    const safePath = sanitizeSearchPath(args.path as string | undefined, context.memoryRoot);
    return executeWc(
      {
        file_path: args.file_path as string | undefined,
        path: safePath,
        glob: args.glob as string | undefined,
      },
      context.memoryRoot,
    ) as unknown as ToolCallResult;
  },
};
