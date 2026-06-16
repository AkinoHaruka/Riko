/**
 * SkillsList 工具处理器单元测试
 *
 * 测试 skillsListToolHandler 的核心逻辑：
 * - 无 query 时返回全部技能摘要
 * - 有 query 时过滤匹配技能
 * - 空注册表时返回提示消息
 *
 * 使用 vi.mock 模拟 skill domain 模块。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟 skill domain 模块
const mockListSkills = vi.fn();

vi.mock('../../../src/domain/skill/index.js', () => ({
  listSkills: (...args: unknown[]) => mockListSkills(...args),
}));

describe('skillsListToolHandler', () => {
  let handler: import('../../../src/tools/types.js').ToolHandler;

  beforeEach(async () => {
    mockListSkills.mockReset();
    const mod = await import('../../../src/tools/skillsList/handler.js');
    handler = mod.skillsListToolHandler;
  });

  it('无 query 时返回全部技能摘要', () => {
    mockListSkills.mockReturnValue([
      { name: 'skill-a', description: '描述A', whenToUse: '场景A', source: 'user' },
      { name: 'skill-b', description: '描述B', whenToUse: '场景B', source: 'bundled' },
    ]);

    const result = handler.execute({}, { conversationId: 'test', memoryRoot: '/tmp' });

    expect(result.success).toBe(true);
    const r = result as Record<string, unknown>;
    expect(r.skills).toHaveLength(2);
    expect(r.message).toContain('2');
    // listSkills 被调用时传入 undefined（空 query）
    expect(mockListSkills).toHaveBeenCalledWith(undefined);
  });

  it('有 query 时过滤匹配技能', () => {
    mockListSkills.mockReturnValue([
      { name: 'coding', description: '编程辅助', whenToUse: '写代码时', source: 'bundled' },
    ]);

    const result = handler.execute(
      { query: '编程' },
      { conversationId: 'test', memoryRoot: '/tmp' },
    );

    expect(result.success).toBe(true);
    const r = result as Record<string, unknown>;
    expect(r.skills).toHaveLength(1);
    expect(mockListSkills).toHaveBeenCalledWith('编程');
  });

  it('空注册表时返回提示消息', () => {
    mockListSkills.mockReturnValue([]);

    const result = handler.execute({}, { conversationId: 'test', memoryRoot: '/tmp' });

    expect(result.success).toBe(true);
    const r = result as Record<string, unknown>;
    expect(r.skills).toEqual([]);
    expect(r.message).toContain('暂无可用技能');
  });
});
