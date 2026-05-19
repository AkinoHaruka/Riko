import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeWrite } from './writeFile.js';
import { validateSessionMemoryPath } from '../pathSecurity.js';

export const writeToolHandler: ToolHandler = {
  name: 'Write',

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
    return executeWrite({
      file_path: (args.file_path as string) ?? '',
      content: (args.content as string) ?? '',
      memoryRoot: context.memoryRoot,
    }) as unknown as ToolCallResult;
  },
};
