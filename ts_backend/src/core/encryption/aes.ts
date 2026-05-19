/**
 * AES-256-GCM 加密/解密实现（AES-256-CBC 向后兼容）。
 *
 * 设计决策：
 * - 加密使用 AES-256-GCM，12 字节随机 IV，产出 16 字节 auth tag。
 * - 存储格式：IV（12 字节）+ authTag（16 字节）+ 密文，整体 base64 编码。
 * - 解密时优先尝试 GCM 新格式，失败后回退 CBC（16 字节 IV + 密文），
 *   再失败回退全零 IV 的 CBC 旧格式，保证三格式全部向前兼容。
 * - encrypt / decrypt 在密钥未配置时会提前报错，避免运行时产生不可逆的坏数据。
 */
import crypto from 'crypto';
import { encryptionConfig, isEncryptionKeyValid } from '../../config/index.js';

const GCM_ALGORITHM = 'aes-256-gcm';
const CBC_ALGORITHM = 'aes-256-cbc';
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const CBC_IV_LENGTH = 16;

const SENSITIVE_SET = new Set<string>(encryptionConfig.sensitiveKeys);

export const SENSITIVE_KEYS = encryptionConfig.sensitiveKeys;

export function isSensitive(key: string): boolean {
  return SENSITIVE_SET.has(key);
}

/** 使用 AES-256-GCM + 随机 IV 对明文加密，返回 base64（IV[12] + authTag[16] + 密文） */
export function encrypt(text: string): string {
  if (!isEncryptionKeyValid()) {
    throw new Error('加密密钥未正确配置');
  }

  const keyBytes = Buffer.from(encryptionConfig.encryptionKey, 'utf-8');
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, keyBytes, iv);

  const encrypted = Buffer.concat([cipher.update(text, 'utf-8'), cipher.final()]);

  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * 对加密的 base64 字符串解密，兼容三种格式：
 * 1. GCM 新格式：IV(12) + authTag(16) + 密文
 * 2. CBC 随机 IV 格式：IV(16) + 密文
 * 3. CBC 全零 IV 旧格式：纯密文（无 IV 前缀）
 */
export function decrypt(encryptedBase64: string): string {
  if (!isEncryptionKeyValid()) {
    throw new Error('加密密钥未正确配置');
  }

  const keyBytes = Buffer.from(encryptionConfig.encryptionKey, 'utf-8');
  const raw = Buffer.from(encryptedBase64, 'base64');

  // 1) 尝试 GCM 新格式：12 字节 IV + 16 字节 authTag + 密文
  if (raw.length >= GCM_IV_LENGTH + GCM_TAG_LENGTH) {
    try {
      const iv = raw.subarray(0, GCM_IV_LENGTH);
      const authTag = raw.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + GCM_TAG_LENGTH);
      const ciphertext = raw.subarray(GCM_IV_LENGTH + GCM_TAG_LENGTH);
      const decipher = crypto.createDecipheriv(GCM_ALGORITHM, keyBytes, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf-8');
    } catch {
      // GCM 解密失败，继续尝试 CBC 格式
    }
  }

  // 2) 尝试 CBC 随机 IV 格式：16 字节 IV + 密文
  if (raw.length > CBC_IV_LENGTH) {
    try {
      const iv = raw.subarray(0, CBC_IV_LENGTH);
      const ciphertext = raw.subarray(CBC_IV_LENGTH);
      const decipher = crypto.createDecipheriv(CBC_ALGORITHM, keyBytes, iv);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf-8');
    } catch {
      // CBC 随机 IV 解密失败，回退全零 IV 旧格式
    }
  }

  // 3) CBC 全零 IV 旧格式：纯密文（无 IV 前缀）
  const iv = Buffer.alloc(CBC_IV_LENGTH, 0);
  const decipher = crypto.createDecipheriv(CBC_ALGORITHM, keyBytes, iv);
  const decrypted = Buffer.concat([decipher.update(raw), decipher.final()]);
  return decrypted.toString('utf-8');
}
