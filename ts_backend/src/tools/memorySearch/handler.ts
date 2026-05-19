import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeSearchMemory } from './searchMemory.js';

export const memorySearchToolHandler: ToolHandler = {
  name: 'SearchMemory',

  execute(args: Record<string, unknown>, _context: ToolContext): ToolCallResult {
    const result = executeSearchMemory({
      query: (args.query as string) ?? '',
      type: args.type as string | undefined,
    });

    return {
      success: result.success,
      result: result.matches ?? [],
      message: result.message,
    } as unknown as ToolCallResult;
  },
};
