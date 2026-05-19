import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeTail } from './readTail.js';
import { validateSessionMemoryPath } from '../pathSecurity.js';

export const tailToolHandler: ToolHandler = {
  name: 'tail_tool',

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
    return executeTail({
      file_path: (args.file_path as string) ?? '',
      lines: args.lines as number | undefined,
    }) as unknown as ToolCallResult;
  },
};
