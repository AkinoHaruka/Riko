import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeFind } from './findFiles.js';

export const findToolHandler: ToolHandler = {
  name: 'find_tool',

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
