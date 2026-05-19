import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeWc } from './wordCount.js';
import { sanitizeSearchPath } from '../pathSecurity.js';

export const wcToolHandler: ToolHandler = {
  name: 'wc_tool',

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
