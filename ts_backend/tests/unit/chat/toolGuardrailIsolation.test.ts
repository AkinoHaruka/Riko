/**
 * 工具护栏会话隔离单元测试
 *
 * 针对 toolHandler 中护栏控制器从"模块级全局单例"重构为"按会话独立实例池"的并发安全修复。
 *
 * 修复背景：原全局单例导致并发请求共享护栏计数——会话 A 的请求开始调用
 * resetToolGuardrails() 会清空会话 B 的重复失败/无进展计数，haltDecision 跨请求泄漏。
 *
 * 验证点：
 * 1. 两个会话的护栏计数互不影响
 * 2. resetToolGuardrails(conversationId) 只重置目标会话
 * 3. 一个会话触发 halt 不影响另一会话
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executeToolCalls, resetToolGuardrails } from '../../../src/domain/chat/toolHandler.js';
import type { ToolCallAccumulator } from '../../../src/domain/chat/types.js';
import { toolRegistry } from '../../../src/tools/registry.js';

/** 构造一个总是失败的工具调用累积器 */
function makeFailingAccumulator(toolName: string, args: string): ToolCallAccumulator {
  return {
    0: {
      id: 'call_0',
      type: 'function',
      function: { name: toolName, arguments: args },
    },
  };
}

describe('工具护栏会话隔离', () => {
  const TOOL = '__test_guardrail_fail__';

  beforeEach(() => {
    // 注册一个总是抛错的工具，驱动护栏的失败计数
    toolRegistry.register({
      name: TOOL,
      execute: async () => {
        throw new Error('模拟工具失败');
      },
    });
    // 清空实例池
    resetToolGuardrails();
  });

  it('会话 A 的失败计数不影响会话 B', async () => {
    const acc = makeFailingAccumulator(TOOL, '{"x":1}');

    // 会话 A 连续失败 2 次
    await executeToolCalls(acc, 'conv-a', '/tmp/mem', new Set([TOOL]));
    await executeToolCalls(acc, 'conv-a', '/tmp/mem', new Set([TOOL]));

    // 会话 B 第一次失败：应正常执行（结果 success=false 但未被护栏 block）
    const resB = await executeToolCalls(acc, 'conv-b', '/tmp/mem', new Set([TOOL]));
    const outB = resB.get(0);
    expect(outB).toBeDefined();
    expect(outB!.success).toBe(false);
    // 关键：B 的失败是普通工具异常，而非护栏阻止（护栏阻止的 error 含"阻止"或 guardrail 提示）
    expect(outB!.error).toContain('工具执行异常');
  });

  it('resetToolGuardrails(convA) 只重置会话 A，不影响会话 B', async () => {
    const acc = makeFailingAccumulator(TOOL, '{"x":2}');

    // 两个会话各失败 2 次
    await executeToolCalls(acc, 'conv-a', '/tmp/mem', new Set([TOOL]));
    await executeToolCalls(acc, 'conv-a', '/tmp/mem', new Set([TOOL]));
    await executeToolCalls(acc, 'conv-b', '/tmp/mem', new Set([TOOL]));
    await executeToolCalls(acc, 'conv-b', '/tmp/mem', new Set([TOOL]));

    // 仅重置会话 A
    resetToolGuardrails('conv-a');

    // 会话 B 继续失败：其计数未被 A 的重置影响，仍在累积
    const resB = await executeToolCalls(acc, 'conv-b', '/tmp/mem', new Set([TOOL]));
    expect(resB.get(0)).toBeDefined();

    // 会话 A 被重置后重新计数：第一次失败应是普通异常而非护栏阻止
    const resA = await executeToolCalls(acc, 'conv-a', '/tmp/mem', new Set([TOOL]));
    expect(resA.get(0)!.error).toContain('工具执行异常');
  });

  it('会话 A 触发 halt 后，会话 B 仍可正常调用', async () => {
    const acc = makeFailingAccumulator(TOOL, '{"x":3}');

    // 会话 A 反复失败直至护栏触发 halt/block（exactFailureBlockAfter 默认阈值）
    for (let i = 0; i < 6; i++) {
      await executeToolCalls(acc, 'conv-a', '/tmp/mem', new Set([TOOL]));
    }

    // 会话 B 全新会话：第一次调用不应被 A 的 halt 决策影响
    const resB = await executeToolCalls(
      makeFailingAccumulator(TOOL, '{"x":3}'),
      'conv-b',
      '/tmp/mem',
      new Set([TOOL]),
    );
    const outB = resB.get(0);
    expect(outB).toBeDefined();
    // B 的结果应是真实的工具异常，而非继承 A 的 halt
    expect(outB!.success).toBe(false);
  });
});
