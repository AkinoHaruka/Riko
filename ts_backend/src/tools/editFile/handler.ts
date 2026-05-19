import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeEdit } from './editFile.js';
import { validateSessionMemoryPath } from '../pathSecurity.js';

export const editToolHandler: ToolHandler = {
  name: 'Edit',

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
    return executeEdit({
      file_path: (args.file_path as string) ?? '',
      old_string: (args.old_string as string) ?? '',
      new_string: (args.new_string as string) ?? '',
      replace_all: (args.replace_all as boolean) ?? false,
      memoryRoot: context.memoryRoot,
    }) as unknown as ToolCallResult;
  },
};
