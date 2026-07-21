/**
 * Provider 注册表单元测试
 *
 * 覆盖 findProviderByModelId 的四级路由策略：
 * 1. 已知前缀匹配（claude- / gemini- / deepseek- / gpt- / o3 / o4 / moonshot-）
 * 2. 斜杠格式匹配 OpenRouter（任何含 "/" 的模型 ID）
 * 3. 别名匹配（模型 ID 第一段匹配 Provider 别名，大小写不敏感）
 * 4. 无法识别返回 undefined（由 client.ts 兜底为 deepseek）
 *
 * 同时测试 getProviderById 辅助函数。
 * 注：getProviderByAlias 未导出（byAlias 为内部 Map），故不单独测试。
 */
import { describe, it, expect } from 'vitest';
import {
  findProviderByModelId,
  getProviderById,
  getAllProviders,
} from '../../../src/core/ai/providers/registry.js';

// ── getProviderById ─────────────────────────────────────────────────

describe('getProviderById', () => {
  it('应返回已注册的 Provider 定义（含完整字段）', () => {
    const deepseek = getProviderById('deepseek');
    expect(deepseek).toBeDefined();
    expect(deepseek?.id).toBe('deepseek');
    expect(deepseek?.name).toBe('DeepSeek');
    expect(deepseek?.apiMode).toBe('openai-compatible');
    expect(deepseek?.baseUrl).toBe('https://api.deepseek.com');
    expect(deepseek?.apiKeyKey).toBe('apikey_deepseek');
    expect(deepseek?.envVarKey).toBe('DEEPSEEK_API_KEY');
    expect(deepseek?.supportsThinking).toBe(true);
    expect(deepseek?.supportsToolCalls).toBe(true);
  });

  it('anthropic 应使用 anthropic-messages 协议', () => {
    expect(getProviderById('anthropic')?.apiMode).toBe('anthropic-messages');
  });

  it('gemini 应使用 google-generative-ai 协议', () => {
    expect(getProviderById('gemini')?.apiMode).toBe('google-generative-ai');
  });

  it('openrouter 应声明不支持 thinking', () => {
    expect(getProviderById('openrouter')?.supportsThinking).toBe(false);
  });

  it('对未知 ID 返回 undefined', () => {
    expect(getProviderById('nonexistent')).toBeUndefined();
    expect(getProviderById('')).toBeUndefined();
  });

  it('ID 匹配区分大小写（byId 未做大小写归一化）', () => {
    expect(getProviderById('Deepseek')).toBeUndefined();
    expect(getProviderById('OPENAI')).toBeUndefined();
  });
});

// ── findProviderByModelId: 第一级 - 已知前缀匹配 ───────────────────

describe('findProviderByModelId - 第一级：已知前缀匹配', () => {
  it('claude- 前缀 → anthropic', () => {
    expect(findProviderByModelId('claude-3-opus')?.id).toBe('anthropic');
    expect(findProviderByModelId('claude-sonnet-4')?.id).toBe('anthropic');
    expect(findProviderByModelId('claude-3-5-haiku')?.id).toBe('anthropic');
  });

  it('gemini- 前缀 → gemini', () => {
    expect(findProviderByModelId('gemini-2.0-flash')?.id).toBe('gemini');
    expect(findProviderByModelId('gemini-1.5-pro')?.id).toBe('gemini');
  });

  it('deepseek- 前缀 → deepseek', () => {
    expect(findProviderByModelId('deepseek-chat')?.id).toBe('deepseek');
    expect(findProviderByModelId('deepseek-v4-flash')?.id).toBe('deepseek');
    expect(findProviderByModelId('deepseek-reasoner')?.id).toBe('deepseek');
  });

  it('gpt- 前缀 → openai', () => {
    expect(findProviderByModelId('gpt-4')?.id).toBe('openai');
    expect(findProviderByModelId('gpt-4o')?.id).toBe('openai');
    expect(findProviderByModelId('gpt-3.5-turbo')?.id).toBe('openai');
    expect(findProviderByModelId('gpt-4-turbo-preview')?.id).toBe('openai');
  });

  it('o3 前缀 → openai', () => {
    expect(findProviderByModelId('o3-mini')?.id).toBe('openai');
    expect(findProviderByModelId('o3')?.id).toBe('openai');
  });

  it('o4 前缀 → openai', () => {
    expect(findProviderByModelId('o4-mini')?.id).toBe('openai');
    expect(findProviderByModelId('o4')?.id).toBe('openai');
  });

  it('moonshot- 前缀 → moonshot', () => {
    expect(findProviderByModelId('moonshot-v1-8k')?.id).toBe('moonshot');
    expect(findProviderByModelId('moonshot-v1-32k')?.id).toBe('moonshot');
  });
});

// ── findProviderByModelId: 第二级 - 斜杠格式匹配 OpenRouter ────────

describe('findProviderByModelId - 第二级：斜杠格式匹配 OpenRouter', () => {
  it('anthropic/xxx → openrouter', () => {
    expect(findProviderByModelId('anthropic/claude-sonnet-4')?.id).toBe('openrouter');
  });

  it('openai/xxx → openrouter', () => {
    expect(findProviderByModelId('openai/gpt-4')?.id).toBe('openrouter');
    expect(findProviderByModelId('openai/gpt-4o')?.id).toBe('openrouter');
  });

  it('google/gemini-xxx → openrouter', () => {
    expect(findProviderByModelId('google/gemini-2.0-flash')?.id).toBe('openrouter');
  });

  it('任意未知 provider/xxx → openrouter', () => {
    expect(findProviderByModelId('mistral/mistral-large')?.id).toBe('openrouter');
    expect(findProviderByModelId('meta-llama/llama-3')?.id).toBe('openrouter');
  });

  it('含斜杠的模型 ID 不会走前缀匹配（前缀匹配只识别 xxx- 格式）', () => {
    // "anthropic/claude-sonnet-4" 不以 "claude-" 开头，因此走斜杠规则 → openrouter
    // 若错误地走了前缀匹配，会返回 anthropic 而非 openrouter
    const result = findProviderByModelId('anthropic/claude-sonnet-4');
    expect(result?.id).toBe('openrouter');
  });
});

// ── findProviderByModelId: 第三级 - 别名匹配 ────────────────────────

describe('findProviderByModelId - 第三级：别名匹配', () => {
  it('第一段为 google → gemini（别名）', () => {
    expect(findProviderByModelId('google-gemini-pro')?.id).toBe('gemini');
  });

  it('第一段为 kimi → moonshot（别名）', () => {
    expect(findProviderByModelId('kimi-k2')?.id).toBe('moonshot');
  });

  it('第一段为 ollama → ollama（别名）', () => {
    expect(findProviderByModelId('ollama-llama3')?.id).toBe('ollama');
  });

  it('第一段为 custom → custom（别名）', () => {
    expect(findProviderByModelId('custom-my-model')?.id).toBe('custom');
  });

  it('claude_opus（下划线分隔，非 claude- 前缀）→ anthropic（别名）', () => {
    // "claude_opus" 不以 "claude-" 开头，走别名匹配，第一段 "claude" 命中 anthropic 别名
    expect(findProviderByModelId('claude_opus')?.id).toBe('anthropic');
  });

  it('gpt_custom（下划线分隔，非 gpt- 前缀）→ openai（别名）', () => {
    // "gpt_custom" 不以 "gpt-" 开头，走别名匹配，第一段 "gpt" 命中 openai 别名
    expect(findProviderByModelId('gpt_custom')?.id).toBe('openai');
  });

  it('deepseek（无连字符）通过别名匹配命中', () => {
    // "deepseek" 不以 "deepseek-" 开头，但第一段 "deepseek" 命中别名
    expect(findProviderByModelId('deepseek')?.id).toBe('deepseek');
  });

  it('别名匹配大小写不敏感（byAlias 构建时做了 toLowerCase）', () => {
    expect(findProviderByModelId('Ollama-llama3')?.id).toBe('ollama');
    expect(findProviderByModelId('KIMI-k2')?.id).toBe('moonshot');
    expect(findProviderByModelId('Google-gemini')?.id).toBe('gemini');
  });
});

// ── findProviderByModelId: 第四级 - 无法识别返回 undefined ──────────

describe('findProviderByModelId - 第四级：无法识别', () => {
  it('完全未知的模型 ID 返回 undefined', () => {
    expect(findProviderByModelId('unknown-model')).toBeUndefined();
    expect(findProviderByModelId('xyz')).toBeUndefined();
    expect(findProviderByModelId('random-thing')).toBeUndefined();
  });

  it('空字符串返回 undefined', () => {
    expect(findProviderByModelId('')).toBeUndefined();
  });

  it('第一段不在别名表中的模型返回 undefined（由 client.ts 兜底为 deepseek）', () => {
    // registry 仅负责推断，兜底逻辑在 client.ts 中处理
    const result = findProviderByModelId('totally-unknown-model');
    expect(result).toBeUndefined();
  });
});

// ── findProviderByModelId: 路由优先级 ───────────────────────────────

describe('findProviderByModelId - 路由优先级', () => {
  it('前缀匹配优先于斜杠匹配', () => {
    // 无斜杠：claude- 前缀直接命中 anthropic
    expect(findProviderByModelId('claude-sonnet-4')?.id).toBe('anthropic');
    // 有斜杠：anthropic/claude-... 走斜杠规则 → openrouter
    expect(findProviderByModelId('anthropic/claude-sonnet-4')?.id).toBe('openrouter');
  });

  it('斜杠匹配优先于别名匹配', () => {
    // 有斜杠：ollama/llama3 → openrouter
    expect(findProviderByModelId('ollama/llama3')?.id).toBe('openrouter');
    // 无斜杠：ollama-llama3 → 别名匹配 → ollama
    expect(findProviderByModelId('ollama-llama3')?.id).toBe('ollama');
  });

  it('gpt- 前缀优先于 openai 别名（同一 Provider，结果一致但路径不同）', () => {
    // 两者都应解析为 openai，验证不同输入路径均能正确命中
    expect(findProviderByModelId('gpt-4')?.id).toBe('openai');
    expect(findProviderByModelId('openai-custom')?.id).toBe('openai');
  });
});

// ── getAllProviders: 注册表完整性校验 ───────────────────────────────

describe('getAllProviders - 注册表完整性', () => {
  it('应包含所有预期的内置 Provider', () => {
    const all = getAllProviders();
    const ids = all.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'deepseek',
        'openai',
        'anthropic',
        'gemini',
        'openrouter',
        'moonshot',
        'ollama',
        'custom',
      ]),
    );
  });

  it('返回的数组为副本，修改不影响内部注册表', () => {
    const all = getAllProviders();
    const originalLen = all.length;
    all.push({
      id: 'injected',
      name: 'injected',
      aliases: [],
      apiMode: 'openai-compatible',
      baseUrl: '',
      apiKeyKey: '',
      envVarKey: '',
      supportsThinking: false,
      supportsToolCalls: false,
      models: [],
    });
    expect(getAllProviders().length).toBe(originalLen);
    expect(getProviderById('injected')).toBeUndefined();
  });
});
