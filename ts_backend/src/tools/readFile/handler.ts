/**
 * Read 工具的 ToolHandler 实现
 *
 * 将 AI 的工具调用参数转换为 CatRequest，执行前置路径安全校验，
 * 并委托给 executeCat 执行文件读取操作。
 */
import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeCat } from './readFile.js';
import { validateSessionMemoryPath } from '../pathSecurity.js';

export const catToolHandler: ToolHandler = {
  name: 'Read',
  metadata: { readOnly: true, mutating: false, categories: ['filesystem'] },

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

  /** 执行文件读取操作 */
  execute(args: Record<string, unknown>, context: ToolContext): ToolCallResult {
    return executeCat({
      file_path: (args.file_path as string) ?? '',
      offset: args.offset as number | undefined,
      limit: args.limit as number | undefined,
      memoryRoot: context.memoryRoot,
    }) as unknown as ToolCallResult;
  },
};
