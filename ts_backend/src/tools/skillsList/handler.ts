/**
 * SkillsList 工具处理器
 *
 * 调用技能注册表获取摘要列表，返回给 AI。
 */
import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { listSkills } from '../../domain/skill/index.js';

export const skillsListToolHandler: ToolHandler = {
  name: 'SkillsList',
  metadata: { readOnly: true, mutating: false, categories: ['skill'] },

  execute(args: Record<string, unknown>, _context: ToolContext): ToolCallResult {
    const query = args.query as string | undefined;
    const skills = listSkills(query || undefined);

    if (skills.length === 0) {
      return {
        success: true,
        skills: [],
        message: query ? `没有匹配 "${query}" 的技能` : '暂无可用技能',
      } as unknown as ToolCallResult;
    }

    return {
      success: true,
      skills,
      message: `共 ${skills.length} 个技能可用`,
    } as unknown as ToolCallResult;
  },
};
