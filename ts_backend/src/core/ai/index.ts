/**
 * AI 客户端模块入口
 *
 * 导出多 Provider 客户端管理、Transport 工厂和 API 错误映射工具，
 * 供 domain/chat 等上层模块使用。
 *
 * @module core/ai
 */
export {
  getOrCreateTransport,
  getTransportForModel,
  resolveProvider,
  resolveApiKey,
  createTransport,
  invalidateClientCache,
  // 向后兼容
  getOrCreateClient,
  createClient,
} from './client.js';
export { mapApiError } from './errors.js';
export type { MappedApiError } from './errors.js';
// Provider 注册表和类型
export {
  getProviderById,
  findProviderByModelId,
  getAllProviders,
  getProviderModels,
  getAllModels,
  getModelContextWindow,
} from './providers/index.js';
export type {
  ApiMode,
  ProviderDefinition,
  ProviderModel,
  ProviderTransport,
  NormalizedMessage,
  NormalizedToolCall,
  NormalizedTool,
  TransportChatParams,
  NormalizedStreamChunk,
  NormalizedUsage,
  NormalizedChatResponse,
  NormalizedModel,
} from './providers/index.js';
