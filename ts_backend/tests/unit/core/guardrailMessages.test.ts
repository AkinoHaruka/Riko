/**
 * 工具护栏错误消息验证
 *
 * 验证 buildGuardrailSyntheticResult 生成的错误消息：
 * - block 级别：消息是否足够让 AI 理解并调整策略
 * - halt 级别：消息是否清晰表达终止原因
 * - warn 级别：消息是否包含有用的上下文信息
 */
import { describe, it, expect } from 'vitest';
import {
  ToolCallGuardrailController,
  buildGuardrailSyntheticResult,
} from '../../../src/core/security/toolGuardrails.js';
import type { GuardrailDecision } from '../../../src/core/security/toolGuardrails.js';

describe('buildGuardrailSyntheticResult — 错误消息验证', () => {
  // ── 1. block 级别 ────────────────────────────────────────────
  describe('block 级别', () => {
    it('错误消息应包含工具名称，让 AI 知道哪个工具被阻止', () => {
      const decision: GuardrailDecision = {
        action: 'block',
        code: 'repeated_exact_failure_block',
        message: '阻止 read_tool：相同工具调用已失败 5 次，参数完全相同。请改变策略或说明阻碍原因。',
        toolName: 'read_tool',
        count: 5,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('read_tool');
      expect(parsed.guardrail.toolName).toBe('read_tool');
    });

    it('错误消息应包含失败次数，让 AI 了解严重程度', () => {
      const decision: GuardrailDecision = {
        action: 'block',
        code: 'repeated_exact_failure_block',
        message: '阻止 read_tool：相同工具调用已失败 5 次，参数完全相同。请改变策略或说明阻碍原因。',
        toolName: 'read_tool',
        count: 5,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.guardrail.count).toBe(5);
      expect(parsed.error).toContain('5 次');
    });

    it('错误消息应包含策略建议，引导 AI 调整行为', () => {
      const decision: GuardrailDecision = {
        action: 'block',
        code: 'repeated_exact_failure_block',
        message: '阻止 read_tool：相同工具调用已失败 5 次，参数完全相同。请改变策略或说明阻碍原因。',
        toolName: 'read_tool',
        count: 5,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      // 消息应包含策略调整建议
      expect(parsed.error).toContain('改变策略');
    });

    it('幂等工具无进展 block 消息应包含替代方案建议', () => {
      const decision: GuardrailDecision = {
        action: 'block',
        code: 'idempotent_no_progress_block',
        message: '阻止 grep_tool：此只读调用已返回相同结果 5 次。请使用已有结果或尝试不同查询。',
        toolName: 'grep_tool',
        count: 5,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('使用已有结果');
      expect(parsed.error).toContain('不同查询');
    });

    it('合成结果应包含 guardrail 元数据供 AI 解析', () => {
      const decision: GuardrailDecision = {
        action: 'block',
        code: 'repeated_exact_failure_block',
        message: '阻止 read_tool：相同工具调用已失败 5 次',
        toolName: 'read_tool',
        count: 5,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.guardrail).toBeDefined();
      expect(parsed.guardrail.action).toBe('block');
      expect(parsed.guardrail.code).toBe('repeated_exact_failure_block');
      expect(parsed.guardrail.toolName).toBe('read_tool');
      expect(parsed.guardrail.count).toBe(5);
    });
  });

  // ── 2. halt 级别 ────────────────────────────────────────────
  describe('halt 级别', () => {
    it('halt 消息应清晰表达终止原因', () => {
      const decision: GuardrailDecision = {
        action: 'halt',
        code: 'same_tool_failure_halt',
        message: '终止 edit_tool：本轮已失败 8 次。请停止重试相同失败路径，选择不同方法。',
        toolName: 'edit_tool',
        count: 8,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('终止');
      expect(parsed.error).toContain('8 次');
    });

    it('halt 消息应明确要求停止重试', () => {
      const decision: GuardrailDecision = {
        action: 'halt',
        code: 'same_tool_failure_halt',
        message: '终止 edit_tool：本轮已失败 8 次。请停止重试相同失败路径，选择不同方法。',
        toolName: 'edit_tool',
        count: 8,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('停止重试');
      expect(parsed.error).toContain('不同方法');
    });

    it('halt 合成结果的 guardrail.action 应为 halt', () => {
      const decision: GuardrailDecision = {
        action: 'halt',
        code: 'same_tool_failure_halt',
        message: '终止 edit_tool：本轮已失败 8 次。',
        toolName: 'edit_tool',
        count: 8,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.guardrail.action).toBe('halt');
    });
  });

  // ── 3. warn 级别 ────────────────────────────────────────────
  describe('warn 级别', () => {
    it('warn 消息应包含工具名称', () => {
      const decision: GuardrailDecision = {
        action: 'warn',
        code: 'repeated_exact_failure_warning',
        message: 'read_tool 已使用相同参数失败 2 次。这看起来像循环，请检查错误并改变策略。',
        toolName: 'read_tool',
        count: 2,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('read_tool');
    });

    it('warn 消息应包含重复次数上下文', () => {
      const decision: GuardrailDecision = {
        action: 'warn',
        code: 'repeated_exact_failure_warning',
        message: 'read_tool 已使用相同参数失败 2 次。这看起来像循环，请检查错误并改变策略。',
        toolName: 'read_tool',
        count: 2,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('2 次');
      expect(parsed.guardrail.count).toBe(2);
    });

    it('精确重复失败 warn 消息应建议检查错误', () => {
      const decision: GuardrailDecision = {
        action: 'warn',
        code: 'repeated_exact_failure_warning',
        message: 'read_tool 已使用相同参数失败 2 次。这看起来像循环，请检查错误并改变策略。',
        toolName: 'read_tool',
        count: 2,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('检查错误');
      expect(parsed.error).toContain('改变策略');
    });

    it('同工具失败 warn 消息应建议诊断错误', () => {
      const decision: GuardrailDecision = {
        action: 'warn',
        code: 'same_tool_failure_warning',
        message: 'edit_tool 本轮已失败 3 次。请先诊断错误再重试，或尝试不同工具。',
        toolName: 'edit_tool',
        count: 3,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('诊断错误');
      expect(parsed.error).toContain('不同工具');
    });

    it('幂等无进展 warn 消息应建议使用已有结果', () => {
      const decision: GuardrailDecision = {
        action: 'warn',
        code: 'idempotent_no_progress_warning',
        message: 'read_tool 已返回相同结果 2 次。请使用已有结果或改变查询方式。',
        toolName: 'read_tool',
        count: 2,
      };
      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('使用已有结果');
      expect(parsed.error).toContain('改变查询方式');
    });
  });

  // ── 4. 端到端集成验证 ────────────────────────────────────────
  describe('端到端：从控制器到合成结果', () => {
    it('block 决策的合成结果应可被 AI 解析为 JSON', () => {
      const ctrl = new ToolCallGuardrailController({
        warningsEnabled: true,
        hardStopEnabled: true,
        exactFailureBlockAfter: 3,
      });

      // 模拟 3 次精确重复失败
      ctrl.afterCall('read_tool', { file_path: '/test.md' }, 'error: not found', true);
      ctrl.afterCall('read_tool', { file_path: '/test.md' }, 'error: not found', true);
      ctrl.afterCall('read_tool', { file_path: '/test.md' }, 'error: not found', true);

      const before = ctrl.beforeCall('read_tool', { file_path: '/test.md' });
      expect(before.action).toBe('block');

      const result = buildGuardrailSyntheticResult(before);
      const parsed = JSON.parse(result);

      // AI 应能从 error 字段理解发生了什么
      expect(typeof parsed.error).toBe('string');
      expect(parsed.error.length).toBeGreaterThan(0);
      // AI 应能从 guardrail 字段获取结构化信息
      expect(parsed.guardrail.action).toBe('block');
      expect(parsed.guardrail.code).toBe('repeated_exact_failure_block');
    });

    it('halt 决策的合成结果应清晰表达终止', () => {
      const ctrl = new ToolCallGuardrailController({
        warningsEnabled: true,
        hardStopEnabled: true,
        sameToolFailureHaltAfter: 3,
      });

      // 模拟同工具不同参数反复失败
      ctrl.afterCall('edit_tool', { file_path: '/a.md' }, 'error', true);
      ctrl.afterCall('edit_tool', { file_path: '/b.md' }, 'error', true);
      const decision = ctrl.afterCall('edit_tool', { file_path: '/c.md' }, 'error', true);

      expect(decision.action).toBe('halt');

      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.guardrail.action).toBe('halt');
      expect(parsed.error).toContain('终止');
    });

    it('warn 决策的合成结果应包含有用上下文但不阻止执行', () => {
      const ctrl = new ToolCallGuardrailController({
        warningsEnabled: true,
        hardStopEnabled: false,
      });

      ctrl.afterCall('read_tool', { file_path: '/test.md' }, 'error: not found', true);
      const decision = ctrl.afterCall('read_tool', { file_path: '/test.md' }, 'error: not found', true);

      expect(decision.action).toBe('warn');

      const result = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(result);

      expect(parsed.guardrail.action).toBe('warn');
      expect(parsed.error).toContain('read_tool');
      expect(parsed.error).toContain('循环');
    });
  });
});
