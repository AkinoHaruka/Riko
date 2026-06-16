/**
 * Write 工具的 OpenAI function schema 定义
 *
 * 声明 AI 可调用的 Write 工具的参数结构，
 * 用于创建新文件或完全覆盖已有文件。
 * 覆盖已有文件前必须先使用 Read 工具读取内容。
 */
export function buildWriteToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'Write',
      description:
        "Writes a file to the local filesystem. Use to create new files or complete rewrites of existing files. This tool will overwrite the existing file if there is one at the provided path. If this is an existing file, you MUST use the Read tool first to read the file's contents.",
      parameters: {
        type: 'object' as const,
        properties: {
          file_path: {
            type: 'string' as const,
            description: 'The absolute path to the file to write (must be absolute, not relative)',
          },
          content: {
            type: 'string' as const,
            description: 'The content to write to the file',
          },
        },
        required: ['file_path', 'content'],
      },
    },
  };
}
