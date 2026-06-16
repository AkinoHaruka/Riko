/**
 * 工具调用护栏集成测试
 *
 * 测试 ToolCallGuardrailController 在 toolHandler 中的集成行为：
 * - beforeCall 返回 block 时阻止工具执行
 * - afterCall 记录失败，halt 时终止后续调用
 * - resetToolGuardrails 重置状态
 *
 * 直接测试 guardrailController 的行为逻辑，
 * 不依赖完整的 toolHandler 流程和大量 mock。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolCallGuardrailController, buildGuardrailSyntheticResult } from '../../../src/core/security/index.js';
import type { GuardrailDecision } from '../../../src/core/security/index.js';

describe('ToolCallGuardrailController 集成', () => {
  let controller: ToolCallGuardrailController;

  beforeEach(() => {
    // 启用硬停止，使 block/halt 决策生效
    controller = new ToolCallGuardrailController({
      warningsEnabled: true,
      hardStopEnabled: true,
    });
  });

  describe('beforeCall 返回 block 时阻止工具执行', () => {
    it('精确重复失败达到阈值后 beforeCall 返回 block', () => {
      const toolName = 'read_tool';
      const args = { file_path: '/test.txt' };

      // 模拟多次失败：默认 exactFailureBlockAfter = 5
      for (let i = 0; i < 5; i++) {
        controller.afterCall(toolName, args, 'error: file not found', true);
      }

      // 第 6 次调用前应被阻止
      const decision = controller.beforeCall(toolName, args);
      expect(decision.action).toBe('block');
      expect(decision.code).toBe('repeated_exact_failure_block');
    });

    it('block 决策生成合成结果包含错误信息', () => {
      const toolName = 'read_tool';
      const args = { file_path: '/test.txt' };

      for (let i = 0; i < 5; i++) {
        controller.afterCall(toolName, args, 'error', true);
      }

      const decision = controller.beforeCall(toolName, args);
      expect(decision.action).toBe('block');

      const syntheticResult = buildGuardrailSyntheticResult(decision);
      const parsed = JSON.parse(syntheticResult);
      expect(parsed.error).toContain('read_tool');
      expect(parsed.guardrail.action).toBe('block');
    });
  });

  describe('afterCall 记录失败，halt 时终止后续调用', () => {
    it('同工具失败达到阈值后 afterCall 返回 halt', () => {
      const toolName = 'edit_tool';

      // 默认 sameToolFailureHaltAfter = 8
      for (let i = 0; i < 8; i++) {
        const decision = controller.afterCall(toolName, { attempt: i }, 'error', true);
        if (i < 7) {
          // 前 7 次不应 halt
          expect(decision.action).not.toBe('halt');
        }
      }

      // 第 8 次失败后应返回 halt
      const lastDecision = controller.afterCall(toolName, { attempt: 7 }, 'error', true);
      expect(lastDecision.action).toBe('halt');
      expect(lastDecision.code).toBe('same_tool_failure_halt');
    });

    it('halt 后所有后续 beforeCall 直接返回终止决策', () => {
      const toolName = 'edit_tool';

      // 触发 halt
      for (let i = 0; i < 8; i++) {
        controller.afterCall(toolName, { attempt: i }, 'error', true);
      }

      // 任何工具的 beforeCall 都应返回 halt
      const decision = controller.beforeCall('other_tool', {});
      expect(decision.action).toBe('halt');
    });

    it('halt 后所有后续 afterCall 直接返回终止决策', () => {
      const toolName = 'edit_tool';

      // 触发 halt
      for (let i = 0; i < 8; i++) {
        controller.afterCall(toolName, { attempt: i }, 'error', true);
      }

      // 任何工具的 afterCall 都应返回 halt
      const decision = controller.afterCall('other_tool', {}, 'result', false);
      expect(decision.action).toBe('halt');
    });
  });

  describe('resetToolGuardrails 重置状态', () => {
    it('reset 后所有计数器清零', () => {
      const toolName = 'read_tool';
      const args = { file_path: '/test.txt' };

      // 积累一些失败记录
      for (let i = 0; i < 3; i++) {
        controller.afterCall(toolName, args, 'error', true);
      }

      // 重置
      controller.reset();

      // 重置后 beforeCall 应返回 allow
      const decision = controller.beforeCall(toolName, args);
      expect(decision.action).toBe('allow');
    });

    it('reset 后可重新积累失败计数', () => {
      const toolName = 'read_tool';
      const args = { file_path: '/test.txt' };

      // 积累失败并触发 block
      for (let i = 0; i < 5; i++) {
        controller.afterCall(toolName, args, 'error', true);
      }
      expect(controller.beforeCall(toolName, args).action).toBe('block');

      // 重置后重新积累
      controller.reset();
      for (let i = 0; i < 4; i++) {
        controller.afterCall(toolName, args, 'error', true);
      }
      // 还未达到阈值，应返回 allow
      expect(controller.beforeCall(toolName, args).action).toBe('allow');
    });
  });

  describe('正常调用不受护栏影响', () => {
    it('成功调用返回 allow', () => {
      const decision = controller.afterCall('read_tool', {}, 'success result', false);
      expect(decision.action).toBe('allow');
    });

    it('首次失败不会触发阻止', () => {
      const decision = controller.afterCall('edit_tool', {}, 'error', true);
      expect(decision.action).toBe('allow');
    });

    it('hardStopEnabled=false 时不触发 block', () => {
      const softController = new ToolCallGuardrailController({
        warningsEnabled: true,
        hardStopEnabled: false,
      });

      // 积累大量失败
      for (let i = 0; i < 10; i++) {
        softController.afterCall('read_tool', {}, 'error', true);
      }

      // 不会 block，因为 hardStopEnabled=false
      const decision = softController.beforeCall('read_tool', {});
      expect(decision.action).toBe('allow');
    });
  });
});
