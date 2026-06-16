/**
 * 技能加载器真实文件系统测试
 *
 * 使用 os.tmpdir() 创建临时目录，写入真实 SKILL.md 文件，
 * 验证 initSkillRegistry 正确解析。
 *
 * 测试要点：
 * 1. 正确解析有效 SKILL.md
 * 2. frontmatter 缺失字段时使用默认值
 * 3. 空目录不报错
 * 4. 多个技能目录全部被发现
 * 5. SKILL.md 缺少 frontmatter 时的处理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 每个测试前重置模块缓存，确保 initialized 变量重新初始化
beforeEach(() => {
  vi.resetModules();
});

/** 临时目录根路径 */
let tmpRoot: string;

/** 每个测试创建独立的临时目录 */
beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'riko-skill-test-'));
});

/** 测试结束后清理临时目录 */
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * 在临时目录下创建技能子目录和 SKILL.md
 * @param dirName - 技能目录名
 * @param content - SKILL.md 文件内容
 */
function createSkillDir(dirName: string, content: string): void {
  const skillDir = path.join(tmpRoot, dirName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
}

describe('initSkillRegistry 真实文件系统', () => {
  it('正确解析有效 SKILL.md', async () => {
    createSkillDir('greeting', [
      '---',
      'name: greeting',
      'description: 问候技能',
      'when_to_use: 用户打招呼时使用',
      '---',
      '你是友好的助手，用温暖的语气回应用户。',
    ].join('\n'));

    const { initSkillRegistry, getSkill, listSkills } = await import('../../../src/domain/skill/loader.js');
    initSkillRegistry(tmpRoot);

    const skill = getSkill('greeting');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('greeting');
    expect(skill!.description).toBe('问候技能');
    expect(skill!.whenToUse).toBe('用户打招呼时使用');
    expect(skill!.prompt).toBe('你是友好的助手，用温暖的语气回应用户。');
    expect(skill!.source).toBe('user');
    expect(skill!.dirName).toBe('greeting');

    // listSkills 也应返回
    const list = listSkills();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('greeting');
  });

  it('frontmatter 缺失字段时使用默认值', async () => {
    // 只提供 name，缺少 description 和 when_to_use
    createSkillDir('minimal', [
      '---',
      'name: minimal',
      '---',
      '最小化技能 prompt',
    ].join('\n'));

    const { initSkillRegistry, getSkill } = await import('../../../src/domain/skill/loader.js');
    initSkillRegistry(tmpRoot);

    const skill = getSkill('minimal');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('minimal');
    // 缺失字段使用默认空字符串
    expect(skill!.description).toBe('');
    expect(skill!.whenToUse).toBe('');
    expect(skill!.prompt).toBe('最小化技能 prompt');
  });

  it('空目录不报错', async () => {
    // tmpRoot 已创建但没有任何子目录
    const { initSkillRegistry, listSkills } = await import('../../../src/domain/skill/loader.js');
    initSkillRegistry(tmpRoot);

    const list = listSkills();
    expect(list).toEqual([]);
  });

  it('多个技能目录全部被发现', async () => {
    createSkillDir('skill-a', [
      '---',
      'name: skill-a',
      'description: 技能A',
      '---',
      'Prompt A',
    ].join('\n'));

    createSkillDir('skill-b', [
      '---',
      'name: skill-b',
      'description: 技能B',
      '---',
      'Prompt B',
    ].join('\n'));

    createSkillDir('skill-c', [
      '---',
      'name: skill-c',
      'description: 技能C',
      '---',
      'Prompt C',
    ].join('\n'));

    const { initSkillRegistry, listSkills, getSkill } = await import('../../../src/domain/skill/loader.js');
    initSkillRegistry(tmpRoot);

    const list = listSkills();
    expect(list).toHaveLength(3);

    const names = list.map((s) => s.name).sort();
    expect(names).toEqual(['skill-a', 'skill-b', 'skill-c']);

    // 验证每个技能的 prompt 都正确加载
    expect(getSkill('skill-a')!.prompt).toBe('Prompt A');
    expect(getSkill('skill-b')!.prompt).toBe('Prompt B');
    expect(getSkill('skill-c')!.prompt).toBe('Prompt C');
  });

  it('SKILL.md 缺少 frontmatter 时使用目录名作为 name', async () => {
    // 没有 frontmatter 分隔符的 SKILL.md
    createSkillDir('no-frontmatter', '这是没有 frontmatter 的技能内容');

    const { initSkillRegistry, getSkill } = await import('../../../src/domain/skill/loader.js');
    initSkillRegistry(tmpRoot);

    const skill = getSkill('no-frontmatter');
    expect(skill).not.toBeNull();
    // 缺少 frontmatter 时 name 默认为目录名
    expect(skill!.name).toBe('no-frontmatter');
    expect(skill!.description).toBe('');
    expect(skill!.whenToUse).toBe('');
    // body 就是整个文件内容（因为没有 frontmatter 分隔）
    expect(skill!.prompt).toBe('这是没有 frontmatter 的技能内容');
  });

  it('无 SKILL.md 的子目录被跳过', async () => {
    // 创建子目录但不放 SKILL.md
    const emptyDir = path.join(tmpRoot, 'empty-subdir');
    fs.mkdirSync(emptyDir, { recursive: true });

    // 创建一个有 SKILL.md 的技能
    createSkillDir('valid-skill', [
      '---',
      'name: valid-skill',
      'description: 有效技能',
      '---',
      'Prompt',
    ].join('\n'));

    const { initSkillRegistry, listSkills } = await import('../../../src/domain/skill/loader.js');
    initSkillRegistry(tmpRoot);

    const list = listSkills();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('valid-skill');
  });
});
