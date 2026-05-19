import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeHead } from './readHead.js';
import { validateSessionMemoryPath } from '../pathSecurity.js';

export const headToolHandler: ToolHandler = {
  name: 'head_tool',

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
    return executeHead({
      file_path: (args.file_path as string) ?? '',
      lines: args.lines as number | undefined,
    }) as unknown as ToolCallResult;
  },
};
