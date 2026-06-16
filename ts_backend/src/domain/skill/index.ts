/**
 * 技能系统统一导出
 *
 * @module domain/skill
 */

export type {
  SkillSource,
  SkillMeta,
  SkillDefinition,
  SkillListItem,
  SkillsListRequest,
  SkillViewRequest,
} from './types.js';

export { initSkillRegistry, listSkills, getSkill, getSkillNames } from './loader.js';
