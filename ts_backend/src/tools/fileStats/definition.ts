/**
 * Stat 工具的 OpenAI function schema 定义
 *
 * 声明 AI 可调用的 stat_tool 的参数结构，
 * 用于查询文件或目录的元数据信息。
 */
export function buildStatToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'stat_tool',
      description:
        '查看文件或目录的元数据信息，包括大小、修改时间、权限等。可用于检查文件是否超过大小限制',
      parameters: {
        type: 'object' as const,
        properties: {
          file_path: { type: 'string', description: '文件或目录的相对路径（空或.表示根目录）' },
        },
        required: ['file_path'],
      },
    },
  };
}
