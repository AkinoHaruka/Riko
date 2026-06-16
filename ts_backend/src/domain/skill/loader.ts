/**
 * 技能发现与加载
 *
 * 扫描技能目录，解析 SKILL.md 的 frontmatter 和正文，
 * 生成 SkillDefinition 对象供工具调用使用。
 *
 * 技能目录结构：
 *   data/skills/<dirName>/SKILL.md
 *
 * SKILL.md 格式：
 *   ---
 *   name: 技能名称
 *   description: 一行描述
 *   when_to_use: 使用场景
 *   ---
 *   技能 prompt 正文（注入 AI 上下文）
 *
 * @module domain/skill/loader
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from '../../core/logger/index.js';
import { eventManager } from '../../core/events/index.js';
import type { SkillDefinition, SkillMeta, SkillSource } from './types.js';

const logger = createLogger('SkillLoader');

/** SKILL.md 文件名 */
const SKILL_FILE = 'SKILL.md';

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 *
 * 简易解析器，不支持嵌套对象和数组。
 * 仅提取 name / description / when_to_use / version 四个字段。
 *
 * @param content - SKILL.md 文件完整内容
 * @returns 元数据对象和正文（不含 frontmatter）
 */
function parseSkillFrontmatter(content: string): { meta: Partial<SkillMeta>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content };
  }

  const [, frontmatter, body] = match;
  const meta: Partial<SkillMeta> = {};

  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    // when_to_use → whenToUse
    if (key === 'name') meta.name = value;
    else if (key === 'description') meta.description = value;
    else if (key === 'when_to_use') meta.whenToUse = value;
    else if (key === 'version') meta.version = value;
  }

  return { meta, body: body.trim() };
}

/**
 * 从单个目录加载技能。
 *
 * @param dirPath - 技能目录绝对路径
 * @param source - 技能来源
 * @returns SkillDefinition，加载失败时返回 null
 */
function loadSkillFromDir(dirPath: string, source: SkillSource): SkillDefinition | null {
  const skillFilePath = path.join(dirPath, SKILL_FILE);
  if (!fs.existsSync(skillFilePath)) return null;

  try {
    const content = fs.readFileSync(skillFilePath, 'utf-8');
    const { meta, body } = parseSkillFrontmatter(content);
    const dirName = path.basename(dirPath);

    const skill: SkillDefinition = {
      name: meta.name || dirName,
      description: meta.description || '',
      whenToUse: meta.whenToUse || '',
      version: meta.version,
      dirName,
      source,
      prompt: body,
      dirPath,
    };

    eventManager.emit('skill:loaded', { name: skill.name, source, dirName });

    return skill;
  } catch (e) {
    logger.warn('加载技能失败: %s — %s', dirPath, e instanceof Error ? e.message : String(e));
    eventManager.emit('skill:error', { dirPath, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * 扫描目录下所有技能。
 *
 * 遍历 dir 下的子目录，每个包含 SKILL.md 的子目录视为一个技能。
 *
 * @param dir - 技能根目录（如 data/skills/）
 * @param source - 技能来源
 * @returns 技能定义列表
 */
export function scanSkillDir(dir: string, source: SkillSource): SkillDefinition[] {
  if (!fs.existsSync(dir)) return [];

  const skills: SkillDefinition[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = loadSkillFromDir(path.join(dir, entry.name), source);
      if (skill) skills.push(skill);
    }
  } catch (e) {
    logger.warn('扫描技能目录失败: %s — %s', dir, e instanceof Error ? e.message : String(e));
  }

  return skills;
}

/** 技能注册表：name → SkillDefinition */
const skillRegistry = new Map<string, SkillDefinition>();

/** 技能注册表是否已初始化 */
let initialized = false;

/**
 * 初始化技能注册表。
 *
 * 扫描内置技能目录和用户技能目录，加载所有技能。
 * 幂等操作，重复调用安全。
 *
 * @param skillsDir - 用户技能目录路径
 */
export function initSkillRegistry(skillsDir: string): void {
  if (initialized) return;

  // 加载用户自定义技能
  const userSkills = scanSkillDir(skillsDir, 'user');
  for (const skill of userSkills) {
    skillRegistry.set(skill.name, skill);
  }

  // 加载内置技能（bundled 目录在 data/skills/bundled/ 下）
  const bundledDir = path.join(skillsDir, 'bundled');
  const bundledSkills = scanSkillDir(bundledDir, 'bundled');
  for (const skill of bundledSkills) {
    skillRegistry.set(skill.name, skill);
  }

  initialized = true;
  logger.info('技能注册表已初始化: %d 个技能', skillRegistry.size);
}

/**
 * 获取所有技能的摘要列表（渐进式披露：只返回元数据）。
 *
 * @param query - 可选的关键词过滤
 * @returns 技能摘要列表
 */
export function listSkills(query?: string): Array<{ name: string; description: string; whenToUse: string; source: SkillSource }> {
  const results: Array<{ name: string; description: string; whenToUse: string; source: SkillSource }> = [];

  for (const skill of skillRegistry.values()) {
    if (query) {
      const q = query.toLowerCase();
      const haystack = `${skill.name} ${skill.description} ${skill.whenToUse}`.toLowerCase();
      if (!haystack.includes(q)) continue;
    }
    results.push({
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      source: skill.source,
    });
  }

  return results;
}

/**
 * 获取技能的完整定义（按需加载）。
 *
 * @param name - 技能名称
 * @returns 技能定义，不存在时返回 null
 */
export function getSkill(name: string): SkillDefinition | null {
  return skillRegistry.get(name) ?? null;
}

/**
 * 获取所有已注册技能的名称。
 */
export function getSkillNames(): string[] {
  return [...skillRegistry.keys()];
}
