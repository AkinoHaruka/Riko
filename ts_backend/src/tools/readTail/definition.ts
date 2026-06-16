/**
 * Tail 工具的 OpenAI function schema 定义
 *
 * 声明 AI 可调用的 tail_tool 的参数结构，
 * 用于查看文件末尾部分内容，默认显示最后 10 行。
 */
export function buildTailToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'tail_tool',
      description:
        '查看记忆文件的结尾部分内容，默认显示最后10行，配合grep使用可快速定位最新变更。lines=0表示读取全部行',
      parameters: {
        type: 'object' as const,
        properties: {
          file_path: {
            type: 'string' as const,
            description: '记忆文件路径（MEMORY_ROOT_DIR内的相对路径）',
          },
          lines: { type: 'integer' as const, description: '读取的行数，0=全部', default: 10 },
        },
        required: ['file_path'] as string[],
      },
    },
  };
}
