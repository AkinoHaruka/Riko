/**
 * SubAgent 领域单元测试
 *
 * 覆盖 progressChecker.ts 的纯函数和 types.ts 中的常量。
 *
 * 测试目标：
 * 1. parseSubAgentOutcome — 三种返回格式（text/json/structured）的解析
 * 2. validateSubAgentProgress — structured 格式必需章节校验
 * 3. extractSection — 从 structured 输出中提取章节内容
 * 4. hasAllSections — 检查所有章节（含可选）是否齐全
 * 5. SubAgentRole / ROLE_DEFAULT_TOOL_ALLOWLIST 常量
 *
 * SubAgentExecutor.execute 由于依赖 OpenAI 客户端和数据库中的 prompt 模板，
 * 由 e2e 测试（chat-stream、session-memory 等）间接覆盖，此处不重复实现。
 */
import { describe, it, expect } from 'vitest';
import {
  RETURN_FORMAT_INSTRUCTION,
  parseSubAgentOutcome,
  validateSubAgentProgress,
  extractSection,
  hasAllSections,
} from '../../../src/domain/subAgent/progressChecker.js';
import {
  SubAgentRole,
  ROLE_DEFAULT_TOOL_ALLOWLIST,
  DEFAULT_MAX_SPAWN_DEPTH,
  type SubAgentTrace,
} from '../../../src/domain/subAgent/types.js';

// 构造一个最小可用的 SubAgentTrace，validateSubAgentProgress 当前未使用此参数
const STUB_TRACE = {
  requestJson: '{}',
  turns: [],
  totalTurns: 0,
  toolCallCount: 0,
  elapsedMs: 0,
} as unknown as SubAgentTrace;

describe('SubAgent 领域 - progressChecker', () => {
  // ─── RETURN_FORMAT_INSTRUCTION 常量 ───────────────────────

  describe('RETURN_FORMAT_INSTRUCTION', () => {
    it('包含三种格式的说明', () => {
      expect(RETURN_FORMAT_INSTRUCTION).toContain('### text 格式');
      expect(RETURN_FORMAT_INSTRUCTION).toContain('### json 格式');
      expect(RETURN_FORMAT_INSTRUCTION).toContain('### structured 格式');
    });

    it('structured 格式列出所有 8 个章节', () => {
      const sections = [
        '## 已解决事项',
        '## 待解决事项',
        '## 活跃任务',
        '## 关键决策',
        '## 资源',
        '## 用户偏好',
        '## 承诺',
        '## 开放问题',
      ];
      for (const section of sections) {
        expect(RETURN_FORMAT_INSTRUCTION).toContain(section);
      }
    });
  });

  // ─── parseSubAgentOutcome ─────────────────────────────────

  describe('parseSubAgentOutcome', () => {
    it('text 格式：直接返回 trim 后的文本', () => {
      const result = parseSubAgentOutcome('  hello world  ', 'text');
      expect(result.success).toBe(true);
      expect(result.result).toBe('hello world');
      expect(result.error).toBeUndefined();
    });

    it('text 格式为默认格式（不传 format 参数）', () => {
      const result = parseSubAgentOutcome('plain text');
      expect(result.success).toBe(true);
      expect(result.result).toBe('plain text');
    });

    it('json 格式：合法 JSON 对象且含 success 字段', () => {
      const json = JSON.stringify({
        success: true,
        result: '执行成功',
        details: { tokens: 100 },
        error: null,
      });
      const result = parseSubAgentOutcome(json, 'json');
      expect(result.success).toBe(true);
      expect(result.result).toBe('执行成功');
    });

    it('json 格式：success=false 时透传错误', () => {
      const json = JSON.stringify({
        success: false,
        result: null,
        error: '参数校验失败',
      });
      const result = parseSubAgentOutcome(json, 'json');
      expect(result.success).toBe(false);
      expect(result.error).toBe('参数校验失败');
    });

    it('json 格式：缺少 success 字段返回错误', () => {
      const json = JSON.stringify({ result: 'xxx' });
      const result = parseSubAgentOutcome(json, 'json');
      expect(result.success).toBe(false);
      expect(result.error).toContain('success');
    });

    it('json 格式：非对象 JSON（null）返回错误', () => {
      const result = parseSubAgentOutcome('null', 'json');
      expect(result.success).toBe(false);
      expect(result.error).toContain('不是对象');
    });

    it('json 格式：数组（无 success 字段）返回缺少字段错误', () => {
      const result = parseSubAgentOutcome('[1, 2, 3]', 'json');
      expect(result.success).toBe(false);
      // 数组通过 typeof object 校验，但缺少 success 字段
      expect(result.error).toContain('success');
    });

    it('json 格式：JSON 解析失败返回错误', () => {
      const result = parseSubAgentOutcome('{invalid json', 'json');
      expect(result.success).toBe(false);
      expect(result.error).toContain('JSON 解析失败');
    });

    it('structured 格式：包含所有必需章节时通过', () => {
      const output = [
        '## 已解决事项',
        '- 完成工具调用',
        '## 待解决事项',
        '- 无',
        '## 活跃任务',
        '- 无',
        '## 关键决策',
        '- 使用 edit_tool',
        '## 资源',
        '- /memory/test.md',
      ].join('\n');
      const result = parseSubAgentOutcome(output, 'structured');
      expect(result.success).toBe(true);
    });

    it('structured 格式：缺少必需章节时返回错误', () => {
      const output = '## 已解决事项\n- a\n## 待解决事项\n- b';
      const result = parseSubAgentOutcome(output, 'structured');
      expect(result.success).toBe(false);
      expect(result.error).toContain('缺少章节');
    });

    it('未知格式返回错误', () => {
      const result = parseSubAgentOutcome('xxx', 'xml' as 'text');
      expect(result.success).toBe(false);
      expect(result.error).toContain('未知的返回格式');
    });
  });

  // ─── validateSubAgentProgress ────────────────────────────

  describe('validateSubAgentProgress', () => {
    it('包含所有 5 个必需章节时通过', () => {
      const output = [
        '## 已解决事项', '- a',
        '## 待解决事项', '- b',
        '## 活跃任务', '- c',
        '## 关键决策', '- d',
        '## 资源', '- e',
      ].join('\n');
      const result = validateSubAgentProgress(STUB_TRACE, output);
      expect(result.valid).toBe(true);
      expect(result.missingSections).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it('缺少单个章节时报告缺失项', () => {
      const output = [
        '## 已解决事项', '- a',
        '## 待解决事项', '- b',
        '## 活跃任务', '- c',
        '## 关键决策', '- d',
        // 缺少 "## 资源"
      ].join('\n');
      const result = validateSubAgentProgress(STUB_TRACE, output);
      expect(result.valid).toBe(false);
      expect(result.missingSections).toEqual(['## 资源']);
      expect(result.error).toContain('## 资源');
    });

    it('缺少多个章节时全部报告', () => {
      const result = validateSubAgentProgress(STUB_TRACE, '');
      expect(result.valid).toBe(false);
      expect(result.missingSections).toHaveLength(5);
    });

    it('章节匹配是子串匹配（不要求完全等于一行）', () => {
      // 章节标题嵌入到文本中也算匹配（当前实现是 includes）
      const output = '前缀 ## 已解决事项 后缀\n## 待解决事项\n## 活跃任务\n## 关键决策\n## 资源';
      const result = validateSubAgentProgress(STUB_TRACE, output);
      expect(result.valid).toBe(true);
    });
  });

  // ─── extractSection ──────────────────────────────────────

  describe('extractSection', () => {
    const SAMPLE = [
      '## 已解决事项',
      '- 完成工具调用',
      '- 写入文件',
      '',
      '## 待解决事项',
      '- 路径校验问题',
      '',
      '## 活跃任务',
      '无',
    ].join('\n');

    it('提取指定章节的内容（不含标题）', () => {
      const content = extractSection(SAMPLE, '## 已解决事项');
      expect(content).toContain('- 完成工具调用');
      expect(content).toContain('- 写入文件');
      // 不应包含下一个章节标题
      expect(content).not.toContain('## 待解决事项');
    });

    it('章节不存在时返回空字符串', () => {
      const content = extractSection(SAMPLE, '## 不存在的章节');
      expect(content).toBe('');
    });

    it('章节标题含正则元字符时正确转义', () => {
      // 标题中包含 $ 等元字符时不应破坏正则
      const content = extractSection('## test$section\nbody', '## test$section');
      expect(content).toBe('body');
    });

    it('最后一个章节的内容提取到文本末尾', () => {
      const content = extractSection(SAMPLE, '## 活跃任务');
      expect(content).toBe('无');
    });
  });

  // ─── hasAllSections ──────────────────────────────────────

  describe('hasAllSections', () => {
    it('包含全部 8 个章节时返回 true', () => {
      const output = [
        '## 已解决事项',
        '## 待解决事项',
        '## 活跃任务',
        '## 关键决策',
        '## 资源',
        '## 用户偏好',
        '## 承诺',
        '## 开放问题',
      ].join('\n');
      expect(hasAllSections(output)).toBe(true);
    });

    it('缺少任一章节（含可选）时返回 false', () => {
      // 缺少 ## 承诺
      const output = [
        '## 已解决事项',
        '## 待解决事项',
        '## 活跃任务',
        '## 关键决策',
        '## 资源',
        '## 用户偏好',
        '## 开放问题',
      ].join('\n');
      expect(hasAllSections(output)).toBe(false);
    });

    it('空字符串返回 false', () => {
      expect(hasAllSections('')).toBe(false);
    });
  });
});

// ─── types.ts 常量与枚举 ──────────────────────────────────

describe('SubAgent 领域 - types 常量', () => {
  describe('SubAgentRole', () => {
    it('Leaf 角色值为 "leaf"', () => {
      expect(SubAgentRole.Leaf).toBe('leaf');
    });

    it('Orchestrator 角色值为 "orchestrator"', () => {
      expect(SubAgentRole.Orchestrator).toBe('orchestrator');
    });
  });

  describe('ROLE_DEFAULT_TOOL_ALLOWLIST', () => {
    it('leaf 角色默认白名单为 null（由 Tool Policy Session 层过滤）', () => {
      expect(ROLE_DEFAULT_TOOL_ALLOWLIST[SubAgentRole.Leaf]).toBeNull();
    });

    it('orchestrator 角色默认白名单为 null（允许所有工具）', () => {
      expect(ROLE_DEFAULT_TOOL_ALLOWLIST[SubAgentRole.Orchestrator]).toBeNull();
    });
  });

  describe('DEFAULT_MAX_SPAWN_DEPTH', () => {
    it('默认 spawn 深度为 2', () => {
      expect(DEFAULT_MAX_SPAWN_DEPTH).toBe(2);
    });
  });
});
