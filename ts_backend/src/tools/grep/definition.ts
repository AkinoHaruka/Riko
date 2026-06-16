/**
 * Grep 工具的 OpenAI function schema 定义
 *
 * 声明 AI 可调用的 Grep 工具的参数结构，
 * 支持正则表达式搜索、glob 过滤、多种输出模式和上下文行显示。
 */
export function buildGrepToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'Grep',
      description:
        'A powerful search tool built on ripgrep. Search for regular expression patterns in file contents. Supports full regex syntax, glob filtering, output modes, and context lines.',
      parameters: {
        type: 'object' as const,
        properties: {
          pattern: {
            type: 'string' as const,
            description: 'The regular expression pattern to search for in file contents',
          },
          path: {
            type: 'string' as const,
            description: 'File or directory to search in. Defaults to current working directory.',
          },
          glob: {
            type: 'string' as const,
            description:
              'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") — maps to rg --glob',
          },
          output_mode: {
            type: 'string' as const,
            description:
              'Output mode: "content" shows matching lines, "files_with_matches" shows file paths, "count" shows match counts. Defaults to "files_with_matches".',
            enum: ['content', 'files_with_matches', 'count'],
          },
          '-A': {
            type: 'integer' as const,
            description:
              'Number of lines to show after each match (rg -A). Requires output_mode: "content".',
          },
          '-B': {
            type: 'integer' as const,
            description:
              'Number of lines to show before each match (rg -B). Requires output_mode: "content".',
          },
          '-C': {
            type: 'integer' as const,
            description:
              'Number of lines to show before and after each match (rg -C). Requires output_mode: "content".',
          },
          '-i': {
            type: 'boolean' as const,
            description: 'Case insensitive search (rg -i)',
          },
          head_limit: {
            type: 'integer' as const,
            description:
              'Limit output to first N lines/entries. Defaults to 250. Pass 0 for unlimited.',
          },
          offset: {
            type: 'integer' as const,
            description: 'Skip first N lines/entries before applying head_limit.',
          },
        },
        required: ['pattern'],
      },
    },
  };
}
