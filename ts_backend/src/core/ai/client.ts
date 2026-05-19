/**
 * DeepSeek OpenAI 客户端管理。
 * 按 userId 缓存客户端实例（TTL 5 分钟），API Key 优先从用户设置读取（已加密的自动解密），
 * 兜底使用 .env 中的 DEEPSEEK_API_KEY。
 */
import OpenAI from 'openai';
import { aiConfig } from '../../config/index.js';
import { getDb } from '../database/index.js';
import { decrypt } from '../encryption/index.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('AIClient');

/** 客户端缓存条目 */
interface CachedClient {
  client: OpenAI;
  expireAt: number;
}

/** 基于 userId 的客户端缓存，TTL 5 分钟 */
const clientCache = new Map<string, CachedClient>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getUserApiKey(userId: string): Promise<string | null> {
  const db = getDb();
  const row = db
    .prepare('SELECT value, is_encrypted FROM settings WHERE user_id = ? AND key = ?')
    .get(userId, 'apikey_deepseek') as { value: string; is_encrypted: number } | undefined;

  if (!row) {
    logger.debug(`用户 ${userId} 未找到 apikey_deepseek，使用 .env 默认值`);
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

  logger.debug(`用户 ${userId} 的 API Key 已加载`);
  return value || null;
}

export function createClient(apiKey: string): OpenAI {
  if (!apiKey) {
    throw new Error('API Key 不能为空，请在设置中配置有效的 API Key');
  }

  return new OpenAI({
    baseURL: aiConfig.baseUrl,
    apiKey,
    timeout: 600_000,
    maxRetries: 2,
  });
}

/** 使指定用户的客户端缓存失效，下次调用 getOrCreateClient 将创建新实例 */
export function invalidateClientCache(userId: string): void {
  clientCache.delete(userId);
  logger.debug(`用户 ${userId} 的客户端缓存已失效`);
}

export async function getOrCreateClient(userId: string): Promise<OpenAI> {
  // 检查缓存是否命中且未过期
  const cached = clientCache.get(userId);
  if (cached && cached.expireAt > Date.now()) {
    return cached.client;
  }

  const apiKey = await getUserApiKey(userId);
  const key = apiKey || aiConfig.deepseekApiKey;
  const client = createClient(key);

  // 写入缓存
  clientCache.set(userId, { client, expireAt: Date.now() + CACHE_TTL_MS });
  logger.debug(`用户 ${userId} 的客户端已创建并缓存`);

  return client;
}
