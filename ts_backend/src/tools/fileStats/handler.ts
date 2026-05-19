import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeStat } from './fileStats.js';
import { validateSessionMemoryPath } from '../pathSecurity.js';

export const statToolHandler: ToolHandler = {
  name: 'stat_tool',

  validate(args: Record<string, unknown>, context: ToolContext) {
    const filePath = (args.file_path as string) ?? '';
    const pathCheck = validateSessionMemoryPath(
      filePath,
      context.conversationId,
      context.memoryRoot,
    );
    return pathCheck.valid ? { valid: true } : { valid: false, error: pathCheck.error };
  },

  execute(args: Record<string, unknown>, _context: ToolContext): ToolCallResult {
    return executeStat({
      file_path: (args.file_path as string) ?? '',
    }) as unknown as ToolCallResult;
  },
};
