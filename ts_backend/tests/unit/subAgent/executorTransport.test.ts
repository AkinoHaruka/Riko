/**
 * SubAgentExecutor Transport 化单元测试
 *
 * 针对执行器从"硬编码 OpenAI 客户端"重构为"按模型路由到 Provider Transport"的验证。
 * 使用 vi.mock 注入假的 Anthropic Transport，验证：
 * 1. 非 OpenAI 兼容模型（claude-*）能走 Transport 的归一化非流式接口
 * 2. 多轮工具调用循环在 Transport 路径下正确执行
 * 3. reasoningContent 被正确收集到轨迹
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ProviderTransport,
  NormalizedChatResponse,
  NormalizedStreamChunk,
  TransportChatParams,
} from '../../../src/core/ai/providers/types.js';

// ─── 可控的假 Transport ───

/** 按调用顺序返回预置响应的假 Transport */
class FakeTransport implements ProviderTransport {
  readonly apiMode = 'anthropic-messages' as const;
  public calls: TransportChatParams[] = [];
  private responses: NormalizedChatResponse[];

  constructor(responses: NormalizedChatResponse[]) {
    this.responses = [...responses];
  }

  async createNonStreamingChat(params: TransportChatParams): Promise<NormalizedChatResponse> {
    this.calls.push(params);
    const next = this.responses.shift();
    if (!next) throw new Error('FakeTransport: 无更多预置响应');
    return next;
  }

  async *createStreamingChat(): AsyncIterable<NormalizedStreamChunk> {
    throw new Error('本测试不使用流式');
  }

  async listModels() {
    return [];
  }
}

let fakeTransport: FakeTransport;

// mock getTransportForModel，返回我们的假 Transport
vi.mock('../../../src/core/ai/client.js', () => ({
  getTransportForModel: vi.fn(async () => fakeTransport),
}));

// mock setting 的 getParamValue，避免读数据库
vi.mock('../../../src/domain/setting/index.js', () => ({
  getParamValue: vi.fn((_userId: string, _key: string, fallback: string) => fallback),
}));

import { SubAgentExecutor } from '../../../src/domain/subAgent/executor.js';
import type { SubAgentPromptParts } from '../../../src/domain/subAgent/types.js';

const PROMPT_PARTS: SubAgentPromptParts = {
  mainPrompt: 'main',
  toolRules: 'rules',
  persistentMemory: '',
  compactContext: '',
  rawConversation: 'conv',
  subAgentPrompt: 'task',
};

const TOOL_DEF = {
  type: 'function',
  function: { name: 'write_tool', description: 'write', parameters: { type: 'object' } },
};

describe('SubAgentExecutor Transport 化', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('非 OpenAI 模型通过 Transport 执行，单轮无工具调用直接返回', async () => {
    fakeTransport = new FakeTransport([
      { content: '完成，无需工具', finishReason: 'end_turn' },
    ]);

    const executor = new SubAgentExecutor();
    const result = await executor.execute(
      { type: 'session_memory', model: 'claude-sonnet-4' },
      PROMPT_PARTS,
      'user-1',
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('完成，无需工具');
    expect(fakeTransport.calls).toHaveLength(1);
    expect(fakeTransport.calls[0].model).toBe('claude-sonnet-4');
    expect(result.metadata?.model).toBe('claude-sonnet-4');
  });

  it('多轮工具调用循环：第一轮调工具，第二轮返回文本', async () => {
    fakeTransport = new FakeTransport([
      // 第一轮：返回工具调用
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'write_tool', arguments: '{"path":"a.md"}' }],
        finishReason: 'tool_calls',
      },
      // 第二轮：返回最终文本
      { content: '已写入笔记', finishReason: 'end_turn' },
    ]);

    const executor = new SubAgentExecutor();
    const result = await executor.execute(
      {
        type: 'session_memory',
        model: 'claude-sonnet-4',
        tools: [TOOL_DEF],
        // 用 customToolExecutor 避免依赖真实文件系统
        customToolExecutor: () => JSON.stringify({ success: true }),
      },
      PROMPT_PARTS,
      'user-1',
    );

    expect(result.success).toBe(true);
    expect(result.trace?.toolCallCount).toBe(1);
    expect(result.trace?.totalTurns).toBe(2);
    // 第二轮请求应携带 assistant 的 toolCalls 和 tool 结果消息
    const secondCall = fakeTransport.calls[1];
    const assistantMsg = secondCall.messages.find((m) => m.role === 'assistant');
    const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
    expect(assistantMsg?.toolCalls?.[0]?.name).toBe('write_tool');
    expect(toolMsg?.toolCallId).toBe('tc1');
  });

  it('reasoningContent 被收集到轨迹', async () => {
    fakeTransport = new FakeTransport([
      { content: '思考后回答', reasoningContent: '这是思维链过程', finishReason: 'end_turn' },
    ]);

    const executor = new SubAgentExecutor();
    const result = await executor.execute(
      { type: 'compact', model: 'claude-sonnet-4' },
      PROMPT_PARTS,
      'user-1',
    );

    expect(result.trace?.turns[0]?.reasoningContent).toBe('这是思维链过程');
  });

  it('Transport 抛错时返回失败结果而非抛出', async () => {
    fakeTransport = new FakeTransport([]); // 无预置响应，调用即抛错

    const executor = new SubAgentExecutor();
    const result = await executor.execute(
      { type: 'dream', model: 'gemini-2.5-pro' },
      PROMPT_PARTS,
      'user-1',
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
