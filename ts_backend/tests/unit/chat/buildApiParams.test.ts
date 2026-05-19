import { describe, it, expect } from 'vitest';
import { buildApiParams } from '../../../src/domain/chat/types.js';
import type { ChatCompletionRequest } from '../../../src/domain/chat/types.js';

function makeBaseRequest(overrides?: Partial<ChatCompletionRequest>): ChatCompletionRequest {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    model: 'deepseek-chat',
    stream: true,
    ...overrides,
  };
}

describe('buildApiParams', () => {
  it('仅传入必填字段时，返回包含 model、messages、stream 的参数', () => {
    const request = makeBaseRequest();
    const params = buildApiParams(request);

    expect(params.model).toBe('deepseek-chat');
    expect(params.stream).toBe(true);
    expect(params.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('max_tokens');
    expect(params).not.toHaveProperty('top_p');
    expect(params).not.toHaveProperty('reasoning_effort');
    expect(params).not.toHaveProperty('response_format');
    expect(params).not.toHaveProperty('stop');
  });

  it('传入可选字段时，参数中应包含这些字段', () => {
    const request = makeBaseRequest({
      temperature: 0.7,
      max_tokens: 1024,
      top_p: 0.9,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      stop: ['\n'],
    });
    const params = buildApiParams(request);

    expect(params.temperature).toBe(0.7);
    expect(params.max_tokens).toBe(1024);
    expect(params.top_p).toBe(0.9);
    expect(params.reasoning_effort).toBe('low');
    expect(params.response_format).toEqual({ type: 'json_object' });
    expect(params.stop).toEqual(['\n']);
  });

  it('undefined 的可选字段应被排除', () => {
    const request = makeBaseRequest({
      temperature: 0.5,
      max_tokens: undefined,
      top_p: undefined,
    });
    const params = buildApiParams(request);

    expect(params.temperature).toBe(0.5);
    expect(params).not.toHaveProperty('max_tokens');
    expect(params).not.toHaveProperty('top_p');
  });

  it('systemPrompt 注入时，在 messages 开头创建新的 system 消息', () => {
    const request = makeBaseRequest({
      messages: [
        { role: 'user', content: 'hello' },
      ],
    });
    const params = buildApiParams(request, { systemPrompt: '你是一个助手' });

    const messages = params.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: 'system', content: '你是一个助手' });
    expect(messages[1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('compactContext 注入时，在 messages 开头创建带标签的 user 消息', () => {
    const request = makeBaseRequest({
      messages: [
        { role: 'user', content: 'hello' },
      ],
    });
    const params = buildApiParams(request, { compactContext: '压缩上下文内容' });

    const messages = params.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('<compact-context>');
    expect(messages[0].content).toContain('压缩上下文内容');
    expect(messages[1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('compactContext 含前后空白时内容被 trim', () => {
    const request = makeBaseRequest({
      messages: [
        { role: 'user', content: 'hello' },
      ],
    });
    const params = buildApiParams(request, { compactContext: '  \n  压缩内容  \n  ' });

    const messages = params.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('压缩内容');
    expect(messages[1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('thinking 参数直接放入请求参数顶层', () => {
    const request = makeBaseRequest({
      thinking: { type: 'enabled' },
    });
    const params = buildApiParams(request);

    expect(params.thinking).toEqual({ type: 'enabled' });
    expect(params).not.toHaveProperty('extra_body');
  });

  it('systemPrompt 和 compactContext 同时存在时，systemPrompt 作为 system 消息，compactContext 作为 user 消息', () => {
    const request = makeBaseRequest({
      messages: [{ role: 'user', content: 'hi' }],
    });
    const params = buildApiParams(request, { systemPrompt: '系统提示', compactContext: '压缩上下文' });

    const messages = params.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe('系统提示');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('<compact-context>');
    expect(messages[2]).toEqual({ role: 'user', content: 'hi' });
  });

  it('不传 sessionMemoryTools 时，参数中不包含 tools 字段', () => {
    const request = makeBaseRequest();
    const params = buildApiParams(request);

    expect(params).not.toHaveProperty('tools');
  });

  it('不传 thinking 时，参数中不包含 thinking 和 extra_body 字段', () => {
    const request = makeBaseRequest();
    const params = buildApiParams(request);

    expect(params).not.toHaveProperty('thinking');
    expect(params).not.toHaveProperty('extra_body');
  });

  it('空字符串 compactContext 不创建额外消息', () => {
    const request = makeBaseRequest({
      messages: [{ role: 'user', content: 'hello' }],
    });
    const params = buildApiParams(request, { compactContext: '' });

    const messages = params.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  it('仅空白字符的 compactContext 不创建额外消息', () => {
    const request = makeBaseRequest({
      messages: [{ role: 'user', content: 'hello' }],
    });
    const params = buildApiParams(request, { compactContext: '   \n  ' });

    const messages = params.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  it('thinking 和 reasoning_effort 同时存在时均出现在参数顶层', () => {
    const request = makeBaseRequest({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    });
    const params = buildApiParams(request);

    expect(params.thinking).toEqual({ type: 'enabled' });
    expect(params.reasoning_effort).toBe('high');
  });

  it('thinking disabled 时 thinking 参数在顶层且类型为 disabled', () => {
    const request = makeBaseRequest({
      thinking: { type: 'disabled' },
    });
    const params = buildApiParams(request);

    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params).not.toHaveProperty('extra_body');
  });

  it('thinking enabled 时 temperature 和 top_p 被排除', () => {
    const request = makeBaseRequest({
      thinking: { type: 'enabled' },
      temperature: 0.7,
      top_p: 0.9,
    });
    const params = buildApiParams(request);

    expect(params.thinking).toEqual({ type: 'enabled' });
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('top_p');
  });

  it('thinking disabled 时 temperature 和 top_p 正常传递', () => {
    const request = makeBaseRequest({
      thinking: { type: 'disabled' },
      temperature: 0.7,
      top_p: 0.9,
    });
    const params = buildApiParams(request);

    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.temperature).toBe(0.7);
    expect(params.top_p).toBe(0.9);
  });

  it('systemPrompt 包含 session memory extension 时，system 消息包含完整内容', () => {
    const mainPrompt = '我是璃，十四岁，一只猫娘。';
    const toolRules = '# 工具调用规则\n使用工具时请遵循以下规则。';
    const persistentMemory = '# 常驻记忆\n用户偏好简短回复。';
    const sessionExtension = '\n---\n\n## 会话记忆系统\n你拥有一个会话笔记系统。';
    const fullSystemPrompt = mainPrompt + '\n\n' + toolRules + '\n\n' + persistentMemory + '\n\n' + sessionExtension.trim();

    const request = makeBaseRequest({
      messages: [{ role: 'user', content: '你好' }],
    });
    const params = buildApiParams(request, { systemPrompt: fullSystemPrompt });

    const messages = params.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('我是璃');
    expect(messages[0].content).toContain('工具调用规则');
    expect(messages[0].content).toContain('常驻记忆');
    expect(messages[0].content).toContain('会话记忆系统');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toBe('你好');
  });

  it('systemPrompt 为空字符串时不创建 system 消息', () => {
    const request = makeBaseRequest({
      messages: [{ role: 'user', content: 'hello' }],
    });
    const params = buildApiParams(request, { systemPrompt: '' });

    const messages = params.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  it('systemPrompt 仅空白字符时不创建 system 消息', () => {
    const request = makeBaseRequest({
      messages: [{ role: 'user', content: 'hello' }],
    });
    const params = buildApiParams(request, { systemPrompt: '   \n  ' });

    const messages = params.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });
});
