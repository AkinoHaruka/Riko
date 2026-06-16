/**
 * 敏感字段加密配置
 *
 * 管理 AES 加密密钥和需要加密的设置项键名列表。
 * 加密密钥必须为 32 字节（AES-256），未配置时 API Key 等敏感数据将以明文存储。
 *
 * 多 Provider 支持：所有 Provider 的 API Key 都需要加密存储。
 */
export const encryptionConfig = {
  /** AES-256 加密密钥，必须为 32 字节 UTF-8 字符串；未配置时敏感数据明文存储 */
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  /** 需要加密存储的设置项键名列表，写入数据库时自动加密这些字段 */
  sensitiveKeys: [
    'apikey_deepseek',
    'apikey_openai',
    'apikey_anthropic',
    'apikey_gemini',
    'apikey_openrouter',
    'apikey_moonshot',
    'apikey_ollama',
  ] as const,
} as const;

/** 检查加密密钥是否有效（长度恰好 32 字节） */
export function isEncryptionKeyValid(): boolean {
  return Buffer.byteLength(encryptionConfig.encryptionKey, 'utf-8') === 32;
}
