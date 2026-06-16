/**
 * Chat API 参数构建单元测试
 * 测试 buildApiParams 函数：必填字段传递、可选字段过滤、systemPrompt/compactContext 注入、
 * thinking 参数处理及 session memory extension 等
 */
import { describe, it, expect } from 'vitest';
import { buildApiParams, MAX_TOKENS_DEFAULT, MAX_TOKENS_CAP } from '../../../src/domain/chat/types.js';
import type { ChatCompletionRequest } from '../../../src/domain/chat/types.js';

/** 构造基础请求对象，可覆盖部分字段 */
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
    expect(params.max_tokens).toBe(MAX_TOKENS_DEFAULT);
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

  it('undefined 的可选字段应被排除（max_tokens 除外，使用默认值）', () => {
    const request = makeBaseRequest({
      temperature: 0.5,
      max_tokens: undefined,
      top_p: undefined,
    });
    const params = buildApiParams(request);

    expect(params.temperature).toBe(0.5);
    expect(params.max_tokens).toBe(MAX_TOKENS_DEFAULT);
    expect(params).not.toHaveProperty('top_p');
  });

  it('max_tokens 超过上限时被裁剪为 MAX_TOKENS_CAP', () => {
    const request = makeBaseRequest({ max_tokens: 384000 });
    const params = buildApiParams(request);
    expect(params.max_tokens).toBe(MAX_TOKENS_CAP);
  });

  it('max_tokens 在上限内时保持原值', () => {
    const request = makeBaseRequest({ max_tokens: 65536 });
    const params = buildApiParams(request);
    expect(params.max_tokens).toBe(65536);
  });

  // systemPrompt 作为 system 消息插入到 messages 开头
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

  // compactContext 用 <compact-context> 标签包裹后作为 user 消息注入
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

  // systemPrompt 和 compactContext 同时存在时的消息顺序
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

  // thinking enabled 时 DeepSeek API 不允许传 temperature 和 top_p
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

  // 验证包含会话记忆扩展的完整系统提示词注入
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
