/**
 * Provider 模块入口
 *
 * 导出 Provider 注册表、Transport 实现和核心类型，
 * 供 core/ai/client.ts 等上层模块使用。
 */
export type {
  ApiMode,
  ProviderDefinition,
  ProviderModel,
  NormalizedMessage,
  NormalizedToolCall,
  NormalizedTool,
  TransportChatParams,
  NormalizedStreamChunk,
  NormalizedUsage,
  NormalizedChatResponse,
  NormalizedModel,
  ProviderTransport,
  ProviderRuntime,
} from './types.js';

export {
  getProviderById,
  findProviderByModelId,
  getAllProviders,
  getProviderModels,
  getAllModels,
  getModelContextWindow,
  BUILTIN_PROVIDERS,
} from './registry.js';

export { OpenAICompatibleTransport } from './openai_compatible.js';
export { AnthropicTransport } from './anthropic.js';
export { GeminiTransport } from './gemini.js';
