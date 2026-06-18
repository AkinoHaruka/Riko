/**
 * Edit 工具的 ToolHandler 实现
 *
 * 将 AI 的工具调用参数转换为 EditRequest，执行前置路径安全校验，
 * 并委托给 executeEdit 执行实际的文件编辑操作。
 */
import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeEdit } from './editFile.js';
import { validateSessionMemoryPath } from '../pathSecurity.js';

export const editToolHandler: ToolHandler = {
  name: 'Edit',
  metadata: { readOnly: false, mutating: true, categories: ['filesystem'] },

  /**
   * 前置校验：验证文件路径是否在 memoryRoot 范围内。
   * @security 路径安全验证在工具执行前拦截非法路径
   */
  validate(args: Record<string, unknown>, context: ToolContext) {
    const filePath = (args.file_path as string) ?? '';
    const pathCheck = validateSessionMemoryPath(
      filePath,
      context.memoryRoot,
    );
    return pathCheck.valid ? { valid: true } : { valid: false, error: pathCheck.error };
  },

  /** 执行文件编辑操作 */
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
