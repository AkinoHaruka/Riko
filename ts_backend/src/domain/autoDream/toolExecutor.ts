/**
 * 梦境工具定义生成器。
 * 为 SubAgent 提供 Edit/Write/Read/Grep/Glob 五个工具的 OpenAI 函数定义，
 * 实际执行时的权限控制由 permissionChecker.ts 中的自定义执行器负责。
 */
import OpenAI from 'openai';
import { firstThreatMessage as _firstThreatMessage } from '../../core/security/index.js';

/**
 * 构建梦境子代理可用的工具列表。
 * 仅包含文件操作类工具，不包含搜索/执行等高风险工具。
 * @returns OpenAI ChatCompletionTool 数组
 */
export function buildDreamTools(): OpenAI.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'Edit',
        description:
          'Performs exact string replacements in files. Use this tool to edit existing files. The edit will FAIL if old_string is not unique — either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance of old_string.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'The absolute path to the file to modify' },
            old_string: { type: 'string', description: 'The text to replace' },
            new_string: {
              type: 'string',
              description: 'The text to replace it with (must be different from old_string)',
            },
            replace_all: {
              type: 'boolean',
              description: 'Replace all occurrences of old_string (default false)',
              default: false,
            },
          },
          required: ['file_path', 'old_string', 'new_string'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'Write',
        description:
          'Writes a file to the local filesystem. Use to create new files or complete rewrites of existing files. This tool will overwrite the existing file if there is one at the provided path.',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description:
                'The absolute path to the file to write (must be absolute, not relative)',
            },
            content: { type: 'string', description: 'The content to write to the file' },
          },
          required: ['file_path', 'content'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'Read',
        description:
          'Reads a file from the local filesystem. You can access any file directly by using this tool. Supports reading text files, images, PDF files, and Jupyter notebooks.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'The absolute path to the file to read' },
            offset: {
              type: 'integer',
              description:
                'The line number to start reading from. Only provide if the file is too large to read at once.',
            },
            limit: {
              type: 'integer',
              description:
                'The number of lines to read. Only provide if the file is too large to read at once.',
            },
          },
          required: ['file_path'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'Grep',
        description:
          'A powerful search tool built on ripgrep. Search for regular expression patterns in file contents.',
        parameters: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'The regular expression pattern to search for in file contents',
            },
            path: {
              type: 'string',
              description: 'File or directory to search in. Defaults to current working directory.',
            },
            output_mode: {
              type: 'string',
              enum: ['content', 'files_with_matches', 'count'],
              description: 'Output mode. Defaults to "files_with_matches".',
            },
            glob: { type: 'string', description: 'Glob pattern to filter files (e.g. "*.md")' },
            '-i': { type: 'boolean', description: 'Case insensitive search (rg -i)' },
          },
          required: ['pattern'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'Glob',
        description:
          'Fast file pattern matching tool. Supports glob patterns like "**/*.md" or "*.ts". Returns matching file paths sorted by modification time.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'The glob pattern to match files against' },
            path: { type: 'string', description: 'The directory to search in. Omit for default.' },
          },
          required: ['pattern'],
          additionalProperties: false,
        },
      },
    },
  ];
}
