/**
 * SkillView 工具处理器单元测试
 *
 * 测试 skillViewToolHandler 的核心逻辑：
 * - 正常返回技能完整内容
 * - 缺少 name 参数返回错误
 * - 技能不存在返回错误
 *
 * 使用 vi.mock 模拟 skill domain 模块。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟 skill domain 模块
const mockGetSkill = vi.fn();

vi.mock('../../../src/domain/skill/index.js', () => ({
  getSkill: (...args: unknown[]) => mockGetSkill(...args),
}));

describe('skillViewToolHandler', () => {
  let handler: import('../../../src/tools/types.js').ToolHandler;

  beforeEach(async () => {
    mockGetSkill.mockReset();
    const mod = await import('../../../src/tools/skillView/handler.js');
    handler = mod.skillViewToolHandler;
  });

  it('正常返回技能完整内容', async () => {
    mockGetSkill.mockReturnValue({
      name: 'greeting',
      description: '问候技能',
      whenToUse: '用户打招呼时',
      source: 'user',
      prompt: '你是友好的助手，请热情地回应用户。',
      dirName: 'greeting',
      dirPath: '/skills/greeting',
    });

    const result = await handler.execute(
      { name: 'greeting' },
      { conversationId: 'test', memoryRoot: '/tmp' },
    );

    expect(result.success).toBe(true);
    const r = result as Record<string, unknown>;
    expect((r.skill as Record<string, unknown>).name).toBe('greeting');
    expect((r.skill as Record<string, unknown>).prompt).toBe('你是友好的助手，请热情地回应用户。');
    expect(r.message).toContain('greeting');
  });

  it('缺少 name 参数返回错误', async () => {
    const result = await handler.execute({}, { conversationId: 'test', memoryRoot: '/tmp' });

    expect(result.success).toBe(false);
    const r = result as Record<string, unknown>;
    expect(r.error).toContain('缺少技能名称参数');
  });

  it('技能不存在返回错误', async () => {
    mockGetSkill.mockReturnValue(null);

    const result = await handler.execute(
      { name: 'nonexistent' },
      { conversationId: 'test', memoryRoot: '/tmp' },
    );

    expect(result.success).toBe(false);
    const r = result as Record<string, unknown>;
    expect(r.error).toContain('nonexistent');
  });
});
