/**
 * 工具调用循环集成测试
 *
 * 验证 nonStreamingToolCallLoop 和 streamingToolCallLoop 的多轮工具调用逻辑：
 * 1. 无工具调用时单轮即结束
 * 2. 单轮工具调用后返回最终文本
 * 3. 达到最大轮次时停止，不会无限循环
 * 4. 无 conversationId 时跳过工具执行
 * 5. 多轮工具调用链
 * 6. 流式循环的基本行为（单轮、工具调用、最大轮次）
 *
 * 通过 mock OpenAI 客户端控制每轮返回内容，
 * 并在全局 toolRegistry 中注册 mock 工具以验证工具被实际调用。
 */
process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.MEMORY_ROOT_DIR = './data/memories';
process.env.LOG_LEVEL = 'ERROR';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type OpenAI from 'openai';
import {
  nonStreamingToolCallLoop,
  streamingToolCallLoop,
} from '../../../src/domain/chat/toolCallLoop.js';
import { toolRegistry } from '../../../src/tools/registry.js';
import { resetToolGuardrails } from '../../../src/domain/chat/toolHandler.js';
import type { ToolHandler, ToolCallResult } from '../../../src/core/types/tools.js';

const TEST_TOOL_NAME = 'test_echo_tool';

// ─── mock 工具工厂 ───

/**
 * 创建 mock 工具处理器。
 * 使用 vi.fn 跟踪调用次数和参数，返回固定的成功结果。
 */
function createMockTool() {
  const execute = vi.fn(
    async (
      args: Record<string, unknown>,
      context: { conversationId: string },
    ): Promise<ToolCallResult> => {
      return { success: true, echo: args, conversationId: context.conversationId };
    },
  );
  const handler: ToolHandler = {
    name: TEST_TOOL_NAME,
    metadata: { readOnly: true, mutating: false },
    execute: execute as unknown as ToolHandler['execute'],
  };
  return { handler, execute };
}

// ─── 非流式响应构造工具 ───

/** 构造纯文本响应（无工具调用） */
function textResponse(content: string): Record<string, unknown> {
  return {
    id: `resp-${Math.random().toString(36).slice(2)}`,
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

/** 构造工具调用响应 */
function toolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: `resp-${Math.random().toString(36).slice(2)}`,
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call_${Math.random().toString(36).slice(2)}`,
              type: 'function',
              function: { name: toolName, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

/**
 * 创建 mock OpenAI 客户端（非流式）。
 * 按顺序返回预设的响应列表，超出索引时重复最后一个。
 */
function createMockClient(responses: Array<Record<string, unknown>>): {
  client: OpenAI;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn();
  let index = 0;
  create.mockImplementation(() => {
    const resp = responses[index] ?? responses[responses.length - 1];
    index++;
    return Promise.resolve(resp);
  });
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return { client, create };
}

// ─── 流式响应构造工具 ───

/** 构造流式 chunk：包含 delta 和可选的 finish_reason */
function streamChunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): Record<string, unknown> {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/** 构造仅包含 usage 的流式 chunk（通常为最后一个 chunk） */
function usageChunk(usage: Record<string, number>): Record<string, unknown> {
  return { id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [], usage };
}

/**
 * 创建 mock 流式 OpenAI 客户端。
 * 每次调用 create 返回一个异步可迭代流，按预设 chunk 列表依次 yield。
 */
function createMockStreamClient(streams: Array<Array<Record<string, unknown>>>): {
  client: OpenAI;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn();
  let index = 0;
  create.mockImplementation(() => {
    const chunks = streams[index] ?? streams[streams.length - 1];
    index++;
    const stream = (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();
    return Promise.resolve(stream);
  });
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return { client, create };
}

/** 收集 async generator 的所有 yield 值 */
async function collectEvents(gen: AsyncGenerator<string>): Promise<string[]> {
  const events: string[] = [];
  for await (const evt of gen) {
    events.push(evt);
  }
  return events;
}

/** 从 SSE 字符串中解析出事件对象 */
function parseSseEvent(sse: string): {
  type: string;
  content?: string;
  data?: unknown;
} {
  const match = sse.match(/^data: (.+)\n\n$/s);
  if (!match) return { type: 'unknown' };
  return JSON.parse(match[1]);
}

// ─── 非流式循环测试 ───

describe('nonStreamingToolCallLoop', () => {
  let mockTool: ReturnType<typeof createMockTool>;

  beforeEach(() => {
    // 每个测试前重置护栏状态，避免上个测试的失败计数污染
    resetToolGuardrails();
    mockTool = createMockTool();
    toolRegistry.register(mockTool.handler);
  });

  afterEach(() => {
    toolRegistry.unregister(TEST_TOOL_NAME);
  });

  it('无工具调用时单轮即结束', async () => {
    const { client, create } = createMockClient([textResponse('你好，我是助手')]);

    const params = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    };

    const result = await nonStreamingToolCallLoop(client, params, 'conv-1', 5);

    // AI 只被调用 1 次（第一轮无工具调用 → break）
    expect(create).toHaveBeenCalledTimes(1);
    // 工具未被调用
    expect(mockTool.execute).not.toHaveBeenCalled();
    // 返回的响应内容正确
    const choice = (result as { choices: Array<{ message: { content: string } }> }).choices[0];
    expect(choice.message.content).toBe('你好，我是助手');
  });

  it('单轮工具调用后第二轮返回最终文本', async () => {
    const { client, create } = createMockClient([
      toolCallResponse(TEST_TOOL_NAME, { query: 'test' }),
      textResponse('根据工具结果，答案是 42'),
    ]);

    const params = {
      model: 'test-model',
      messages: [{ role: 'user', content: '帮我查询' }],
    };

    const result = await nonStreamingToolCallLoop(client, params, 'conv-2', 5);

    // AI 被调用 2 次（第一轮工具调用 → 第二轮最终回答）
    expect(create).toHaveBeenCalledTimes(2);
    // 工具被调用 1 次
    expect(mockTool.execute).toHaveBeenCalledTimes(1);
    // 工具收到了正确的参数
    expect(mockTool.execute.mock.calls[0][0]).toEqual({ query: 'test' });
    // 返回第二轮的响应
    const choice = (result as { choices: Array<{ message: { content: string } }> }).choices[0];
    expect(choice.message.content).toBe('根据工具结果，答案是 42');

    // 验证第二轮请求的消息列表包含 assistant 工具调用消息和 tool 结果消息
    const secondCallParams = create.mock.calls[1][0] as { messages: Array<Record<string, unknown>> };
    const messages = secondCallParams.messages;
    // 原始 user 消息 + assistant 工具调用消息 + tool 结果消息 = 3
    expect(messages).toHaveLength(3);
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].tool_calls).toBeDefined();
    expect(messages[2].role).toBe('tool');
    expect(messages[2].tool_call_id).toBeDefined();
  });

  it('达到最大轮次时停止，不会无限循环', async () => {
    // 每轮都返回工具调用，模拟 AI 不断要求调用工具
    const { client, create } = createMockClient([
      toolCallResponse(TEST_TOOL_NAME, { round: 1 }),
      toolCallResponse(TEST_TOOL_NAME, { round: 2 }),
      // 第三个响应不应被使用
      toolCallResponse(TEST_TOOL_NAME, { round: 3 }),
    ]);

    const params = {
      model: 'test-model',
      messages: [{ role: 'user', content: '无限调用工具' }],
    };

    const result = await nonStreamingToolCallLoop(client, params, 'conv-3', 2);

    // AI 只被调用 2 次（maxTurns=2）
    expect(create).toHaveBeenCalledTimes(2);
    // 工具被调用 2 次（每轮各一次）
    expect(mockTool.execute).toHaveBeenCalledTimes(2);
    // 工具参数正确
    expect(mockTool.execute.mock.calls[0][0]).toEqual({ round: 1 });
    expect(mockTool.execute.mock.calls[1][0]).toEqual({ round: 2 });
    // 返回最后一轮的响应（仍为工具调用响应，因为 maxTurns 到达）
    const choice = (result as {
      choices: Array<{ message: { tool_calls: unknown[] } }>;
    }).choices[0];
    expect(choice.message.tool_calls).toBeDefined();
    expect(choice.message.tool_calls).toHaveLength(1);
  });

  it('无 conversationId 时跳过工具执行', async () => {
    const { client, create } = createMockClient([
      toolCallResponse(TEST_TOOL_NAME, { query: 'test' }),
    ]);

    const params = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    };

    // 不传 conversationId
    const result = await nonStreamingToolCallLoop(client, params, undefined, 5);

    // AI 只被调用 1 次（有工具调用但无 conversationId → break）
    expect(create).toHaveBeenCalledTimes(1);
    // 工具未被调用（无 conversationId，跳过执行）
    expect(mockTool.execute).not.toHaveBeenCalled();
    // 返回工具调用响应本身
    const choice = (result as {
      choices: Array<{ message: { tool_calls: unknown[] } }>;
    }).choices[0];
    expect(choice.message.tool_calls).toBeDefined();
  });

  it('多轮工具调用：2 轮工具后第 3 轮返回最终文本', async () => {
    const { client, create } = createMockClient([
      toolCallResponse(TEST_TOOL_NAME, { step: 1 }),
      toolCallResponse(TEST_TOOL_NAME, { step: 2 }),
      textResponse('两轮工具调用完成'),
    ]);

    const params = {
      model: 'test-model',
      messages: [{ role: 'user', content: '多步操作' }],
    };

    const result = await nonStreamingToolCallLoop(client, params, 'conv-4', 5);

    // AI 被调用 3 次
    expect(create).toHaveBeenCalledTimes(3);
    // 工具被调用 2 次
    expect(mockTool.execute).toHaveBeenCalledTimes(2);
    // 工具参数按顺序正确
    expect(mockTool.execute.mock.calls[0][0]).toEqual({ step: 1 });
    expect(mockTool.execute.mock.calls[1][0]).toEqual({ step: 2 });
    // 返回第三轮的文本
    const choice = (result as { choices: Array<{ message: { content: string } }> }).choices[0];
    expect(choice.message.content).toBe('两轮工具调用完成');
  });
});

// ─── 流式循环测试 ───

describe('streamingToolCallLoop', () => {
  let mockTool: ReturnType<typeof createMockTool>;

  beforeEach(() => {
    resetToolGuardrails();
    mockTool = createMockTool();
    toolRegistry.register(mockTool.handler);
  });

  afterEach(() => {
    toolRegistry.unregister(TEST_TOOL_NAME);
  });

  it('无工具调用时单轮即结束', async () => {
    const { client, create } = createMockStreamClient([
      [
        streamChunk({ content: '你好' }),
        streamChunk({ content: '世界' }),
        streamChunk({}, 'stop'),
        usageChunk({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
      ],
    ]);

    const params = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    };

    const stats = { toolCallCount: 0 };
    const events = await collectEvents(
      streamingToolCallLoop(client, params, 'conv-s1', 5, undefined, undefined, stats),
    );

    // AI 只被调用 1 次
    expect(create).toHaveBeenCalledTimes(1);
    // 工具未被调用
    expect(mockTool.execute).not.toHaveBeenCalled();
    expect(stats.toolCallCount).toBe(0);

    // SSE 事件验证
    const parsed = events.map(parseSseEvent);
    const contentEvents = parsed.filter((e) => e.type === 'content');
    const finishEvents = parsed.filter((e) => e.type === 'finish');
    expect(contentEvents).toHaveLength(2);
    expect(contentEvents[0].content).toBe('你好');
    expect(contentEvents[1].content).toBe('世界');
    expect(finishEvents).toHaveLength(1);
    expect((finishEvents[0].data as { finish_reason: string }).finish_reason).toBe('stop');
  });

  it('单轮工具调用后第二轮返回最终文本', async () => {
    const { client, create } = createMockStreamClient([
      // 第一轮：工具调用
      [
        streamChunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_s1',
              function: { name: TEST_TOOL_NAME, arguments: '{"q":"hi"}' },
            },
          ],
        }),
        streamChunk({}, 'tool_calls'),
      ],
      // 第二轮：最终文本
      [
        streamChunk({ content: '工具结果是' }),
        streamChunk({ content: '：成功' }),
        streamChunk({}, 'stop'),
      ],
    ]);

    const params = {
      model: 'test-model',
      messages: [{ role: 'user', content: '调用工具' }],
    };

    const stats = { toolCallCount: 0 };
    const events = await collectEvents(
      streamingToolCallLoop(client, params, 'conv-s2', 5, undefined, undefined, stats),
    );

    // AI 被调用 2 次
    expect(create).toHaveBeenCalledTimes(2);
    // 工具被调用 1 次
    expect(mockTool.execute).toHaveBeenCalledTimes(1);
    expect(stats.toolCallCount).toBe(1);
    // 工具参数正确
    expect(mockTool.execute.mock.calls[0][0]).toEqual({ q: 'hi' });

    // SSE 事件验证
    const parsed = events.map(parseSseEvent);
    const contentEvents = parsed.filter((e) => e.type === 'content');
    const toolCallEvents = parsed.filter((e) => e.type === 'tool_call');
    const finishEvents = parsed.filter((e) => e.type === 'finish');

    // 第一轮发送 tool_call 提示事件（不发 finish）
    expect(toolCallEvents).toHaveLength(1);
    // 第二轮发送 2 个 content 事件
    expect(contentEvents).toHaveLength(2);
    expect(contentEvents[0].content).toBe('工具结果是');
    expect(contentEvents[1].content).toBe('：成功');
    // 第二轮发送 finish 事件
    expect(finishEvents).toHaveLength(1);
  });

  it('达到最大轮次时停止', async () => {
    const { client, create } = createMockStreamClient([
      // 第一轮（非最后一轮）：工具调用
      [
        streamChunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_m1',
              function: { name: TEST_TOOL_NAME, arguments: '{}' },
            },
          ],
        }),
        streamChunk({}, 'tool_calls'),
      ],
      // 第二轮（最后一轮）：仍为工具调用，但因 isLastTurn=true 会发送 finish
      [
        streamChunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_m2',
              function: { name: TEST_TOOL_NAME, arguments: '{}' },
            },
          ],
        }),
        streamChunk({}, 'tool_calls'),
      ],
    ]);

    const params = {
      model: 'test-model',
      messages: [{ role: 'user', content: '无限调用' }],
    };

    const stats = { toolCallCount: 0 };
    const events = await collectEvents(
      streamingToolCallLoop(client, params, 'conv-s3', 2, undefined, undefined, stats),
    );

    // AI 只被调用 2 次（maxTurns=2）
    expect(create).toHaveBeenCalledTimes(2);
    // 工具被调用 2 次
    expect(mockTool.execute).toHaveBeenCalledTimes(2);
    expect(stats.toolCallCount).toBe(2);

    // 最后一轮应发送 finish 事件（isLastTurn=true 时即使有工具调用也发 finish）
    const parsed = events.map(parseSseEvent);
    const finishEvents = parsed.filter((e) => e.type === 'finish');
    const toolCallEvents = parsed.filter((e) => e.type === 'tool_call');
    // 第一轮发 tool_call 提示，第二轮发 finish
    expect(toolCallEvents).toHaveLength(1);
    expect(finishEvents).toHaveLength(1);
  });

  it('无 conversationId 时跳过工具执行并补发 finish', async () => {
    const { client, create } = createMockStreamClient([
      [
        streamChunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_n1',
              function: { name: TEST_TOOL_NAME, arguments: '{}' },
            },
          ],
        }),
        streamChunk({}, 'tool_calls'),
      ],
    ]);

    const params = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    };

    const stats = { toolCallCount: 0 };
    const events = await collectEvents(
      streamingToolCallLoop(client, params, undefined, 5, undefined, undefined, stats),
    );

    // AI 只被调用 1 次
    expect(create).toHaveBeenCalledTimes(1);
    // 工具未被调用
    expect(mockTool.execute).not.toHaveBeenCalled();
    expect(stats.toolCallCount).toBe(0);

    // 应补发 finish 事件（stop）
    const parsed = events.map(parseSseEvent);
    const finishEvents = parsed.filter((e) => e.type === 'finish');
    expect(finishEvents).toHaveLength(1);
    expect((finishEvents[0].data as { finish_reason: string }).finish_reason).toBe('stop');
  });
});
