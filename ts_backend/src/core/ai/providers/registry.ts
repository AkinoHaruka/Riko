/**
 * Provider 注册表
 *
 * 管理所有内置 AI 提供商的定义。每个 Provider 只声明身份、端点和协议，
 * 不硬编码模型列表（模型迭代快，应动态获取或用户自由输入）。
 *
 * 模型路由策略：
 * 1. 用户设置中的 active_provider 优先
 * 2. 根据 model ID 前缀推断 Provider（如 "gpt-" → openai, "claude-" → anthropic）
 * 3. 兜底使用 deepseek（向后兼容）
 */
import type { ProviderDefinition } from './types.js';

// ─── 内置 Provider 定义（不含模型列表） ───

const BUILTIN_PROVIDER_DATA: Array<Omit<ProviderDefinition, 'models'> & { models?: never }> = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    aliases: ['deepseek'],
    apiMode: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    apiKeyKey: 'apikey_deepseek',
    envVarKey: 'DEEPSEEK_API_KEY',
    supportsThinking: true,
    supportsToolCalls: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    aliases: ['openai', 'gpt'],
    apiMode: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyKey: 'apikey_openai',
    envVarKey: 'OPENAI_API_KEY',
    supportsThinking: true,
    supportsToolCalls: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    aliases: ['anthropic', 'claude'],
    apiMode: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    apiKeyKey: 'apikey_anthropic',
    envVarKey: 'ANTHROPIC_API_KEY',
    supportsThinking: true,
    supportsToolCalls: true,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    aliases: ['gemini', 'google'],
    apiMode: 'google-generative-ai',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKeyKey: 'apikey_gemini',
    envVarKey: 'GEMINI_API_KEY',
    supportsThinking: true,
    supportsToolCalls: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    aliases: ['openrouter'],
    apiMode: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyKey: 'apikey_openrouter',
    envVarKey: 'OPENROUTER_API_KEY',
    supportsThinking: false,
    supportsToolCalls: true,
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    aliases: ['moonshot', 'kimi'],
    apiMode: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyKey: 'apikey_moonshot',
    envVarKey: 'MOONSHOT_API_KEY',
    supportsThinking: false,
    supportsToolCalls: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (本地)',
    aliases: ['ollama'],
    apiMode: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    apiKeyKey: 'apikey_ollama',
    envVarKey: 'OLLAMA_API_KEY',
    supportsThinking: false,
    supportsToolCalls: true,
  },
  {
    id: 'custom',
    name: '自定义 (OpenAI 兼容)',
    aliases: ['custom'],
    apiMode: 'openai-compatible',
    baseUrl: '',
    apiKeyKey: 'apikey_custom',
    envVarKey: 'CUSTOM_API_KEY',
    supportsThinking: false,
    supportsToolCalls: true,
  },
];

/** 构建 ProviderDefinition（models 为空数组，由动态获取填充） */
export const BUILTIN_PROVIDERS: ProviderDefinition[] = BUILTIN_PROVIDER_DATA.map((p) => ({
  ...p,
  models: [],
}));

// ─── 索引 ───

const byId = new Map<string, ProviderDefinition>();
const byAlias = new Map<string, ProviderDefinition>();

for (const provider of BUILTIN_PROVIDERS) {
  byId.set(provider.id, provider);
  for (const alias of provider.aliases) {
    byAlias.set(alias.toLowerCase(), provider);
  }
}

/** 根据 Provider ID 获取定义 */
export function getProviderById(id: string): ProviderDefinition | undefined {
  return byId.get(id);
}

/**
 * 根据 model ID 推断所属 Provider
 *
 * 推断策略（按优先级）：
 * 1. 前缀匹配：claude- → anthropic, gemini- → gemini, deepseek- → deepseek
 * 2. 前缀匹配：gpt- / o3 / o4 → openai, moonshot- → moonshot
 * 3. 斜杠分隔：anthropic/xxx → openrouter, openai/xxx → openrouter
 * 4. 别名匹配：模型 ID 第一段匹配 Provider 别名
 * 5. 返回 undefined
 */
export function findProviderByModelId(modelId: string): ProviderDefinition | undefined {
  // 1. 已知前缀直接匹配
  if (modelId.startsWith('claude-')) return byId.get('anthropic');
  if (modelId.startsWith('gemini-')) return byId.get('gemini');
  if (modelId.startsWith('deepseek-')) return byId.get('deepseek');
  if (modelId.startsWith('gpt-') || modelId.startsWith('o3') || modelId.startsWith('o4')) return byId.get('openai');
  if (modelId.startsWith('moonshot-')) return byId.get('moonshot');

  // 2. 斜杠分隔格式（如 anthropic/claude-sonnet-4）→ 通常是 OpenRouter
  if (modelId.includes('/')) return byId.get('openrouter');

  // 3. 取模型 ID 第一段匹配别名
  const prefix = modelId.split(/[-_/]/)[0]?.toLowerCase();
  if (prefix) {
    const byPrefix = byAlias.get(prefix);
    if (byPrefix) return byPrefix;
  }

  return undefined;
}

/** 获取所有内置 Provider 定义 */
export function getAllProviders(): ProviderDefinition[] {
  return [...BUILTIN_PROVIDERS];
}

/** 获取指定 Provider 的模型列表（空数组，模型应动态获取） */
export function getProviderModels(_providerId: string): import('./types.js').ProviderModel[] {
  return [];
}

/** 获取所有模型（空数组，模型应动态获取） */
export function getAllModels(): Array<import('./types.js').ProviderModel & { providerId: string }> {
  return [];
}

/**
 * 根据模型 ID 获取上下文窗口大小
 * 由于不再硬编码模型，始终返回 fallback 值
 */
export function getModelContextWindow(_modelId: string, fallback: number = 131072): number {
  return fallback;
}
