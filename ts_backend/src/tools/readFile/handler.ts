import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeCat } from './readFile.js';
import { validateSessionMemoryPath } from '../pathSecurity.js';

export const catToolHandler: ToolHandler = {
  name: 'Read',

  validate(args: Record<string, unknown>, context: ToolContext) {
    const filePath = (args.file_path as string) ?? '';
    const pathCheck = validateSessionMemoryPath(
      filePath,
      context.conversationId,
      context.memoryRoot,
    );
    return pathCheck.valid ? { valid: true } : { valid: false, error: pathCheck.error };
  },

  execute(args: Record<string, unknown>, context: ToolContext): ToolCallResult {
    return executeCat({
      file_path: (args.file_path as string) ?? '',
      offset: args.offset as number | undefined,
      limit: args.limit as number | undefined,
      memoryRoot: context.memoryRoot,
    }) as unknown as ToolCallResult;
  },
};
