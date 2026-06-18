/**
 * SkillView 工具处理器
 *
 * 按名称查找技能，返回完整 prompt 内容供 AI 使用。
 */
import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { getSkill } from '../../domain/skill/index.js';

export const skillViewToolHandler: ToolHandler = {
  name: 'SkillView',
  metadata: { readOnly: true, mutating: false, categories: ['skill'] },

  execute(args: Record<string, unknown>, _context: ToolContext): ToolCallResult {
    const name = args.name as string;
    if (!name) {
      return { success: false, error: '缺少技能名称参数' };
    }

    const skill = getSkill(name);
    if (!skill) {
      return { success: false, error: `未找到技能: ${name}` };
    }

    return {
      success: true,
      skill: {
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse,
        source: skill.source,
        prompt: skill.prompt,
      },
      message: `已加载技能「${skill.name}」的完整内容`,
    } as unknown as ToolCallResult;
  },
};
