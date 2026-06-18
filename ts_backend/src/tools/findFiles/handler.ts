/**
 * Find 工具的 ToolHandler 实现
 *
 * 将 AI 的工具调用参数转换为 FindRequest，
 * 并委托给 executeFind 执行文件查找操作。
 * Find 工具不需要前置路径校验，因为 executeFind 内部会验证路径。
 */
import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeFind } from './findFiles.js';

export const findToolHandler: ToolHandler = {
  name: 'find_tool',
  metadata: { readOnly: true, mutating: false, categories: ['filesystem'] },

  /** 执行文件查找操作 */
  execute(args: Record<string, unknown>, context: ToolContext): ToolCallResult {
    return executeFind(
      {
        pattern: (args.pattern as string) ?? '',
        path: args.path as string | undefined,
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
      },
      context.memoryRoot,
    ) as unknown as ToolCallResult;
  },
};
