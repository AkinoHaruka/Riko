/**
 * Glob (listFiles) 工具的 ToolHandler 实现
 *
 * 当提供 pattern 参数时，委托给 executeFind 执行 glob 文件查找；
 * 当不提供 pattern 时，委托给 executeLs 列出目录中的记忆文件。
 * 搜索路径经过 sanitizeSearchPath 安全清理。
 */
import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeLs } from './listFiles.js';
import { executeFind } from '../findFiles/findFiles.js';
import { sanitizeSearchPath } from '../pathSecurity.js';

export const lsToolHandler: ToolHandler = {
  name: 'Glob',

  /** 有 pattern 时走 find 逻辑，否则走 ls 逻辑 */
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolCallResult> {
    const pattern = args.pattern as string | undefined;
    if (pattern) {
      return executeFind(
        {
          pattern,
          path: args.path as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        },
        context.memoryRoot,
      ) as unknown as ToolCallResult;
    }
    const safePath = sanitizeSearchPath(args.path as string | undefined, context.memoryRoot);
    return executeLs({
      path: safePath,
    }) as unknown as ToolCallResult;
  },
};
