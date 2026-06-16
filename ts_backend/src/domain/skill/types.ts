/**
 * 技能系统类型定义
 *
 * 技能是可发现的 prompt 模板，AI 通过 skills_list 浏览摘要，
 * 通过 skill_view 按需加载完整内容（渐进式披露，节省 token）。
 *
 * 技能来源：
 * - bundled：内置技能，随应用分发
 * - user：用户自定义技能，存放在 data/skills/ 目录
 *
 * @module domain/skill/types
 */

/** 技能来源标识 */
export type SkillSource = 'bundled' | 'user';

/** 技能 frontmatter 元数据 */
export interface SkillMeta {
  /** 技能名称（覆盖目录名） */
  name: string;
  /** 一行描述，用于技能列表展示 */
  description: string;
  /** 详细使用场景，告诉模型何时自动调用此技能 */
  whenToUse: string;
  /** 技能版本 */
  version?: string;
}

/** 完整的技能定义（含 prompt 正文） */
export interface SkillDefinition extends SkillMeta {
  /** 技能目录名（即 data/skills/<dirName>/） */
  dirName: string;
  /** 技能来源 */
  source: SkillSource;
  /** SKILL.md 的完整正文（不含 frontmatter），即注入到 AI 上下文的 prompt */
  prompt: string;
  /** 技能目录的绝对路径 */
  dirPath: string;
}

/** skills_list 工具返回的摘要条目 */
export interface SkillListItem {
  name: string;
  description: string;
  whenToUse: string;
  source: SkillSource;
}

/** skills_list 工具的请求参数 */
export interface SkillsListRequest {
  /** 按关键词过滤（匹配 name/description/whenToUse） */
  query?: string;
}

/** skill_view 工具的请求参数 */
export interface SkillViewRequest {
  /** 技能名称 */
  name: string;
}
