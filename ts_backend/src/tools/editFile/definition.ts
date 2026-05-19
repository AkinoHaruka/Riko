export function buildEditToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'Edit',
      description:
        'Performs exact string replacements in files. Use this tool to edit existing files. The edit will FAIL if old_string is not unique — either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance of old_string.',
      parameters: {
        type: 'object' as const,
        properties: {
          file_path: {
            type: 'string' as const,
            description: 'The absolute path to the file to modify',
          },
          old_string: {
            type: 'string' as const,
            description: 'The text to replace',
          },
          new_string: {
            type: 'string' as const,
            description: 'The text to replace it with (must be different from old_string)',
          },
          replace_all: {
            type: 'boolean' as const,
            description: 'Replace all occurrences of old_string (default false)',
            default: false,
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  };
}
