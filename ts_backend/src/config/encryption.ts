/** 敏感字段加密配置：密钥长度必须为 32 字节 */
export const encryptionConfig = {
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  sensitiveKeys: ['apikey_deepseek', 'apikey_openai', 'apikey_anthropic'] as const,
} as const;

export function isEncryptionKeyValid(): boolean {
  return Buffer.byteLength(encryptionConfig.encryptionKey, 'utf-8') === 32;
}
