export function buildLsToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'Glob',
      description:
        'Fast file pattern matching tool. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.',
      parameters: {
        type: 'object' as const,
        properties: {
          pattern: {
            type: 'string' as const,
            description: 'The glob pattern to match files against',
          },
          path: {
            type: 'string' as const,
            description:
              'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" — simply omit it for the default behavior.',
          },
        },
        required: ['pattern'],
      },
    },
  };
}
