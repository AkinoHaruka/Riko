/**
 * SkillsList 工具的 OpenAI function schema 定义
 *
 * 列出所有可用技能的摘要信息（渐进式披露）。
 */
export function buildSkillsListToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'SkillsList',
      description:
        'List available skills with brief descriptions. Use this to discover what skills you have for emotional support, conversation, and interaction patterns. Each skill shows name, description, and when to use it.',
      parameters: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string' as const,
            description: 'Optional keyword to filter skills by name, description, or use case',
          },
        },
        required: [] as string[],
      },
    },
  };
}
