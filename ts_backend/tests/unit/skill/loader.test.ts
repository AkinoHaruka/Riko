/**
 * 技能加载器单元测试
 *
 * 测试 scanSkillDir、initSkillRegistry、listSkills、getSkill 的核心逻辑。
 * 使用 vi.mock('fs') 模拟文件系统，vi.resetModules() 隔离模块级状态。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Dirent } from 'node:fs';

// ── fs mock ──────────────────────────────────────────────────────

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

/** 辅助：创建 mock Dirent（规避 Node.js fs.Dirent 泛型类型差异） */
function mockDirent(name: string): Dirent {
  return {
    name,
    isDirectory: () => true,
    isFile: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: '',
    path: '',
  } as Dirent;
}

// ── scanSkillDir 测试 ────────────────────────────────────────────

describe('scanSkillDir', () => {
  let fs: typeof import('fs');

  beforeEach(async () => {
    fs = (await import('fs')).default;
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it('目录不存在时返回空数组', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    // 动态导入以获取最新 mock 状态
    const { scanSkillDir } = await import('../../../src/domain/skill/loader.js');
    const result = scanSkillDir('/nonexistent', 'user');

    expect(result).toEqual([]);
    expect(fs.existsSync).toHaveBeenCalledWith('/nonexistent');
  });

  it('正常加载技能', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([mockDirent('greeting')]);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '---\nname: greeting\ndescription: 问候技能\nwhen_to_use: 用户打招呼时\n---\n你是友好的助手',
    );

    const { scanSkillDir } = await import('../../../src/domain/skill/loader.js');
    const result = scanSkillDir('/skills', 'user');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('greeting');
    expect(result[0].description).toBe('问候技能');
    expect(result[0].whenToUse).toBe('用户打招呼时');
    expect(result[0].prompt).toBe('你是友好的助手');
    expect(result[0].source).toBe('user');
  });

  it('无 SKILL.md 的子目录被跳过', async () => {
    // 第一个 existsSync 检查目录存在，第二个检查 SKILL.md 不存在
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(true) // 目录存在
      .mockReturnValueOnce(false); // SKILL.md 不存在
    vi.mocked(fs.readdirSync).mockReturnValue([mockDirent('empty-dir')]);

    const { scanSkillDir } = await import('../../../src/domain/skill/loader.js');
    const result = scanSkillDir('/skills', 'user');

    expect(result).toEqual([]);
  });
});

// ── initSkillRegistry / listSkills / getSkill 测试 ────────────────
// 这些函数依赖模块级 skillRegistry 和 initialized 变量，
// 每个测试用例需要 vi.resetModules() 重置模块状态

describe('initSkillRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('幂等性：重复调用不会重复加载', async () => {
    let callCount = 0;
    vi.doMock('fs', () => ({
      default: {
        existsSync: vi.fn().mockImplementation(() => {
          callCount++;
          return true;
        }),
        readdirSync: vi.fn().mockReturnValue([mockDirent('skill-a')]),
        readFileSync: vi.fn().mockReturnValue(
          '---\nname: skill-a\ndescription: test\n---\nprompt body',
        ),
        mkdirSync: vi.fn(),
      },
    }));

    const { initSkillRegistry, listSkills } = await import('../../../src/domain/skill/loader.js');

    initSkillRegistry('/skills');
    const countAfterFirst = listSkills().length;

    initSkillRegistry('/skills');
    const countAfterSecond = listSkills().length;

    // 第二次调用不应增加技能数量
    expect(countAfterFirst).toBe(countAfterSecond);
    expect(countAfterFirst).toBeGreaterThan(0);
  });
});

describe('listSkills', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('无过滤时返回全部技能', async () => {
    vi.doMock('fs', () => ({
      default: {
        existsSync: vi.fn().mockReturnValue(true),
        readdirSync: vi.fn()
          .mockReturnValueOnce([mockDirent('skill-a')])
          .mockReturnValueOnce([]),
        readFileSync: vi.fn().mockReturnValue(
          '---\nname: skill-a\ndescription: 描述A\n---\nprompt',
        ),
        mkdirSync: vi.fn(),
      },
    }));

    const { initSkillRegistry, listSkills } = await import('../../../src/domain/skill/loader.js');
    initSkillRegistry('/skills');

    const result = listSkills();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('skill-a');
  });

  it('关键词过滤匹配技能', async () => {
    vi.doMock('fs', () => ({
      default: {
        existsSync: vi.fn().mockReturnValue(true),
        readdirSync: vi.fn()
          .mockReturnValueOnce([mockDirent('greeting'), mockDirent('coding')])
          .mockReturnValueOnce([]),
        readFileSync: vi.fn()
          .mockReturnValueOnce('---\nname: greeting\ndescription: 问候\n---\nprompt')
          .mockReturnValueOnce('---\nname: coding\ndescription: 编程辅助\n---\nprompt'),
        mkdirSync: vi.fn(),
      },
    }));

    const { initSkillRegistry, listSkills } = await import('../../../src/domain/skill/loader.js');
    initSkillRegistry('/skills');

    const result = listSkills('编程');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('coding');
  });

  it('空注册表返回空数组', async () => {
    vi.doMock('fs', () => ({
      default: {
        existsSync: vi.fn().mockReturnValue(false),
        readdirSync: vi.fn().mockReturnValue([]),
        readFileSync: vi.fn(),
        mkdirSync: vi.fn(),
      },
    }));

    const { initSkillRegistry, listSkills } = await import('../../../src/domain/skill/loader.js');
    initSkillRegistry('/skills');

    const result = listSkills();
    expect(result).toEqual([]);
  });
});

describe('getSkill', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('存在时返回技能定义', async () => {
    vi.doMock('fs', () => ({
      default: {
        existsSync: vi.fn().mockReturnValue(true),
        readdirSync: vi.fn()
          .mockReturnValueOnce([mockDirent('my-skill')])
          .mockReturnValueOnce([]),
        readFileSync: vi.fn().mockReturnValue(
          '---\nname: my-skill\ndescription: test\n---\nprompt body',
        ),
        mkdirSync: vi.fn(),
      },
    }));

    const { initSkillRegistry, getSkill } = await import('../../../src/domain/skill/loader.js');
    initSkillRegistry('/skills');

    const skill = getSkill('my-skill');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('my-skill');
    expect(skill!.prompt).toBe('prompt body');
  });

  it('不存在时返回 null', async () => {
    vi.doMock('fs', () => ({
      default: {
        existsSync: vi.fn().mockReturnValue(false),
        readdirSync: vi.fn().mockReturnValue([]),
        readFileSync: vi.fn(),
        mkdirSync: vi.fn(),
      },
    }));

    const { initSkillRegistry, getSkill } = await import('../../../src/domain/skill/loader.js');
    initSkillRegistry('/skills');

    const skill = getSkill('nonexistent');
    expect(skill).toBeNull();
  });
});
