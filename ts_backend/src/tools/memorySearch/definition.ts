/**
 * SearchMemory 工具的 OpenAI function schema 定义
 *
 * 声明 AI 可调用的 SearchMemory 工具的参数结构，
 * 用于在长期记忆（auto_dream/ 目录）中按关键词搜索。
 */
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
              'Optional memory type filter: traits_roles, interaction_rules, key_experiences, promises_goals, or emotions',
            enum: ['traits_roles', 'interaction_rules', 'key_experiences', 'promises_goals', 'emotions'],
          },
        },
        required: ['query'],
      },
    },
  };
}
