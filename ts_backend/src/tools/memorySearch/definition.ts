export function buildMemorySearchToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'SearchMemory',
      description:
        'Search long-term memory (auto_dream/ directory). Use this to recall past context, user preferences, decisions, and experiences that may not be in the resident memory. Search by keyword or phrase.',
      parameters: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string' as const,
            description:
              'The search query — a keyword or phrase to search for in long-term memory files',
          },
          type: {
            type: 'string' as const,
            description:
              'Optional memory type filter: traits_roles, interaction_rules, key_experiences, or promises_goals',
            enum: ['traits_roles', 'interaction_rules', 'key_experiences', 'promises_goals'],
          },
        },
        required: ['query'],
      },
    },
  };
}
