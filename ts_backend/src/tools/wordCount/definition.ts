/**
 * Wc (wordCount) 工具的 OpenAI function schema 定义
 *
 * 声明 AI 可调用的 wc_tool 的参数结构，
 * 支持单文件统计和目录批量统计，超过 10MB 的文件不进行统计。
 */
export function buildWcToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'wc_tool',
      description:
        '统计文件的行数、字数和字节数。支持单文件统计和目录批量统计，超过10MB的文件不进行统计',
      parameters: {
        type: 'object' as const,
        properties: {
          file_path: {
            type: 'string' as const,
            description: '单文件路径（相对路径）',
            default: '',
          },
          path: {
            type: 'string' as const,
            description: '目录路径用于批量统计（相对路径，空=根目录）',
            default: '',
          },
          glob: { type: 'string' as const, description: '文件过滤模式，如*.md', default: '' },
        },
      },
    },
  };
}
