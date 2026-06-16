/**
 * SkillView 工具的 OpenAI function schema 定义
 *
 * 按需加载技能的完整 prompt 内容（渐进式披露的第二级）。
 */
export function buildSkillViewToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'SkillView',
      description:
        'View the full prompt content of a specific skill. Use this after SkillsList to load the complete instructions when you decide to apply a skill. Only call this for skills you intend to use.',
      parameters: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string' as const,
            description: 'The skill name (from SkillsList results)',
          },
        },
        required: ['name'] as string[],
      },
    },
  };
}
