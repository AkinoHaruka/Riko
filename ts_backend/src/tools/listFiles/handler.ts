import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeLs } from './listFiles.js';
import { executeFind } from '../findFiles/findFiles.js';
import { sanitizeSearchPath } from '../pathSecurity.js';

export const lsToolHandler: ToolHandler = {
  name: 'Glob',

  execute(args: Record<string, unknown>, context: ToolContext): ToolCallResult {
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
