/**
 * Grep 工具的 ToolHandler 实现
 *
 * 将 AI 的工具调用参数转换为 GrepRequest，
 * 使用 sanitizeSearchPath 清理搜索路径后委托给 executeGrep 执行。
 */
import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeGrep } from './grep.js';
import { sanitizeSearchPath } from '../pathSecurity.js';

export const grepToolHandler: ToolHandler = {
  name: 'Grep',
  metadata: { readOnly: true, mutating: false, categories: ['filesystem'] },

  /** 执行文件内容搜索，搜索路径经过安全清理 */
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolCallResult> {
    const safePath = sanitizeSearchPath(args.path as string | undefined, context.memoryRoot);
    return executeGrep({
      pattern: (args.pattern as string) ?? '',
      path: safePath,
      output_mode: args.output_mode as string | undefined,
      case_insensitive: (args['-i'] as boolean) ?? undefined,
      glob: args.glob as string | undefined,
      head_limit: args.head_limit as number | undefined,
      offset: args.offset as number | undefined,
      context: (args['-C'] ?? args['context']) as number | undefined,
      before_context: args['-B'] as number | undefined,
      after_context: args['-A'] as number | undefined,
    }) as unknown as ToolCallResult;
  },
};
