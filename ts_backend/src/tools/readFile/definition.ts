export function buildCatToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'Read',
      description:
        'Reads a file from the local filesystem. You can access any file directly by using this tool. Supports reading text files, images (PNG, JPG, GIF, WebP), PDF files, and Jupyter notebooks (.ipynb).',
      parameters: {
        type: 'object' as const,
        properties: {
          file_path: {
            type: 'string' as const,
            description: 'The absolute path to the file to read',
          },
          offset: {
            type: 'integer' as const,
            description:
              'The line number to start reading from. Only provide if the file is too large to read at once.',
          },
          limit: {
            type: 'integer' as const,
            description:
              'The number of lines to read. Only provide if the file is too large to read at once.',
          },
        },
        required: ['file_path'],
      },
    },
  };
}
