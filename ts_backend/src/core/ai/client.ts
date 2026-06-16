/**
 * 多 Provider AI 客户端管理
 *
 * 根据模型 ID 自动路由到对应的 AI 提供商，管理客户端实例的生命周期。
 * 支持三种 API 协议：OpenAI 兼容、Anthropic Messages、Google Generative AI。
 *
 * 核心特性：
 * - 按 userId:provider 缓存 Transport 实例（TTL 5 分钟，最大 100 条）
 * - API Key 优先级：用户设置（加密存储）→ 环境变量 → 空
 * - 模型自动路由：根据 model ID 匹配 Provider
 * - 向后兼容：未指定 Provider 时默认使用 DeepSeek
 *
 * @module core/ai/client
 */
import type {
  ProviderDefinition,
  ProviderTransport,
  ApiMode,
} from './providers/index.js';
import {
  findProviderByModelId,
  getProviderById,
  OpenAICompatibleTransport,
  AnthropicTransport,
  GeminiTransport,
} from './providers/index.js';
import { getDb } from '../database/index.js';
import { decrypt } from '../encryption/index.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('AIClient');

// ─── 缓存管理 ───

/** Transport 缓存条目 */
interface CachedTransport {
  transport: ProviderTransport;
  expireAt: number;
}

/** 基于 userId:providerId 的 Transport 缓存，TTL 5 分钟，最大 100 条 */
const transportCache = new Map<string, CachedTransport>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 100;

/** 定时清理过期缓存条目 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of transportCache) {
    if (entry.expireAt <= now) {
      transportCache.delete(key);
    }
  }
}, CACHE_TTL_MS);

// ─── API Key 读取 ───

/**
 * 获取用户在设置中配置的指定 Provider 的 API Key。
 *
 * @security 从数据库读取的 API Key 可能是加密存储的，此函数负责自动解密。
 *           解密失败时返回 null，不会抛出异常。
 * @param userId - 用户 ID
 * @param provider - Provider 定义
 * @returns 解密后的 API Key，未配置时返回 null
 */
export async function getUserApiKey(userId: string, provider: ProviderDefinition): Promise<string | null> {
  const db = getDb();
  const row = db
    .prepare('SELECT value, is_encrypted FROM settings WHERE user_id = ? AND key = ?')
    .get(userId, provider.apiKeyKey) as { value: string; is_encrypted: number } | undefined;

  if (!row) {
    logger.debug(`用户 ${userId} 未找到 ${provider.apiKeyKey}，尝试环境变量`);
    return null;
  }

  let value = row.value;
  if (row.is_encrypted === 1) {
    try {
      value = decrypt(value);
    } catch (e) {
      logger.error(`解密 API Key 失败: ${e}`);
      return null;
    }
  }

  return value || null;
}

/**
 * 获取指定 Provider 的 API Key，按优先级查找：
 * 1. 用户设置（数据库，加密存储）
 * 2. 环境变量
 * 3. 返回空字符串
 */
export async function resolveApiKey(userId: string, provider: ProviderDefinition): Promise<string> {
  const userKey = await getUserApiKey(userId, provider);
  if (userKey) return userKey;

  // 兜底：从环境变量读取
  const envKey = process.env[provider.envVarKey] || '';
  return envKey;
}

// ─── Transport 创建 ───

/**
 * 根据 Provider 定义和 API Key 创建对应的 Transport 实例
 */
export function createTransport(provider: ProviderDefinition, apiKey: string): ProviderTransport {
  switch (provider.apiMode) {
    case 'openai-compatible':
      return new OpenAICompatibleTransport(
        provider.baseUrl,
        apiKey,
        provider.id === 'deepseek',
      );
    case 'anthropic-messages':
      return new AnthropicTransport(apiKey, provider.baseUrl);
    case 'google-generative-ai':
      return new GeminiTransport(apiKey);
    default:
      throw new Error(`不支持的 API 协议: ${provider.apiMode}`);
  }
}

// ─── 核心接口 ───

/**
 * 根据模型 ID 查找对应的 Provider 定义
 *
 * 查找策略：
 * 1. 精确匹配模型 ID
 * 2. 模型 ID 前缀匹配
 * 3. 兜底使用 DeepSeek
 */
export function resolveProvider(modelId: string): ProviderDefinition {
  return findProviderByModelId(modelId) ?? getProviderById('deepseek')!;
}

/**
 * 使指定用户的 Transport 缓存失效。
 * 当用户更新 API Key 后调用，确保下次请求使用新的 Key 创建 Transport。
 *
 * @param userId - 需要失效缓存的用户 ID
 * @param providerId - 可选，指定 Provider ID；不传则清除该用户所有缓存
 */
export function invalidateClientCache(userId: string, providerId?: string): void {
  if (providerId) {
    transportCache.delete(`${userId}:${providerId}`);
    logger.debug(`用户 ${userId} 的 ${providerId} Transport 缓存已失效`);
  } else {
    // 清除该用户的所有缓存
    for (const key of transportCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        transportCache.delete(key);
      }
    }
    logger.debug(`用户 ${userId} 的所有 Transport 缓存已失效`);
  }
}

/**
 * 获取或创建指定用户和 Provider 的 Transport 实例。
 * 优先从缓存中获取未过期的实例；缓存未命中时创建新实例。
 *
 * @param userId - 用户 ID
 * @param provider - Provider 定义
 * @returns 可用的 Transport 实例
 * @throws API Key 为空时抛出错误
 */
export async function getOrCreateTransport(
  userId: string,
  provider: ProviderDefinition,
): Promise<ProviderTransport> {
  const cacheKey = `${userId}:${provider.id}`;

  // 检查缓存是否命中且未过期
  const cached = transportCache.get(cacheKey);
  if (cached && cached.expireAt > Date.now()) {
    return cached.transport;
  }

  const apiKey = await resolveApiKey(userId, provider);
  if (!apiKey) {
    throw new Error(
      `${provider.name} API Key 未配置，请在设置中配置或设置环境变量 ${provider.envVarKey}`,
    );
  }

  const transport = createTransport(provider, apiKey);

  // 写入缓存，超限时淘汰最早过期的条目
  if (transportCache.size >= MAX_CACHE_SIZE) {
    let oldestKey: string | null = null;
    let oldestExpire = Infinity;
    for (const [k, v] of transportCache) {
      if (v.expireAt < oldestExpire) {
        oldestExpire = v.expireAt;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) {
      transportCache.delete(oldestKey);
    }
  }
  transportCache.set(cacheKey, { transport, expireAt: Date.now() + CACHE_TTL_MS });
  logger.debug(`用户 ${userId} 的 ${provider.name} Transport 已创建并缓存`);

  return transport;
}

/**
 * 便捷方法：根据模型 ID 获取 Transport
 *
 * 自动解析模型所属 Provider，然后获取或创建对应的 Transport。
 *
 * @param modelId - 模型标识
 * @param userId - 用户 ID
 * @returns Transport 实例
 */
export async function getTransportForModel(
  modelId: string,
  userId: string,
): Promise<ProviderTransport> {
  const provider = resolveProvider(modelId);
  return getOrCreateTransport(userId, provider);
}

// ─── 向后兼容接口 ───

/**
 * @deprecated 使用 getOrCreateTransport 代替
 * 获取指定用户的 OpenAI 兼容客户端（DeepSeek 或其他 OpenAI 兼容 Provider）
 */
export async function getOrCreateClient(userId: string): Promise<import('openai').default> {
  const provider = getProviderById('deepseek')!;
  const transport = await getOrCreateTransport(userId, provider);
  if (transport instanceof OpenAICompatibleTransport) {
    return transport.openaiClient;
  }
  throw new Error('DeepSeek Transport 不是 OpenAI 兼容类型');
}

/**
 * @deprecated 使用 createTransport 代替
 * 创建 OpenAI SDK 客户端实例
 */
export function createClient(apiKey: string): import('openai').default {
  const provider = getProviderById('deepseek')!;
  const transport = createTransport(provider, apiKey);
  if (transport instanceof OpenAICompatibleTransport) {
    return transport.openaiClient;
  }
  throw new Error('DeepSeek Transport 不是 OpenAI 兼容类型');
}
