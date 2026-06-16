/**
 * AES-256-GCM 加密/解密实现（AES-256-CBC 向后兼容）。
 *
 * 设计决策：
 * - 加密使用 AES-256-GCM，12 字节随机 IV，产出 16 字节 auth tag。
 * - 存储格式：IV（12 字节）+ authTag（16 字节）+ 密文，整体 base64 编码。
 * - 解密时优先尝试 GCM 新格式，失败后回退 CBC（16 字节 IV + 密文），
 *   再失败回退全零 IV 的 CBC 旧格式，保证三格式全部向前兼容。
 * - encrypt / decrypt 在密钥未配置时会提前报错，避免运行时产生不可逆的坏数据。
 *
 * @security 所有加密操作使用 AES-256-GCM（认证加密），确保密文的机密性与完整性。
 *           CBC 旧格式仅用于向后兼容，新数据一律使用 GCM。
 *           密钥来自环境变量 ENCRYPTION_KEY，必须为 32 字节 UTF-8 字符串。
 *
 * @module core/encryption/aes
 */
import crypto from 'crypto';
import { encryptionConfig, isEncryptionKeyValid } from '../../config/index.js';

const GCM_ALGORITHM = 'aes-256-gcm';
const CBC_ALGORITHM = 'aes-256-cbc';
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const CBC_IV_LENGTH = 16;

/** @security 敏感配置键名集合，用于判断某个设置项是否需要加密存储 */
const SENSITIVE_SET = new Set<string>(encryptionConfig.sensitiveKeys);

/** @security 敏感配置键名列表，供上层模块查询哪些键需要加密 */
export const SENSITIVE_KEYS = encryptionConfig.sensitiveKeys;

/**
 * 判断给定键名是否为敏感配置项。
 * @param key - 设置键名
 * @returns 是否需要加密存储
 */
export function isSensitive(key: string): boolean {
  return SENSITIVE_SET.has(key);
}

/**
 * @security 使用 AES-256-GCM + 随机 IV 对明文加密。
 * 每次加密生成新的随机 IV，确保相同明文产出不同密文。
 *
 * @param text - 待加密的明文
 * @returns base64 编码的密文（格式：IV[12] + authTag[16] + 密文）
 * @throws 密钥未配置时抛出错误
 */
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
 * @security 对加密的 base64 字符串解密，兼容三种格式：
 * 1. GCM 新格式：IV(12) + authTag(16) + 密文 — 优先尝试，GCM 提供完整性校验
 * 2. CBC 随机 IV 格式：IV(16) + 密文 — CBC 无认证，需额外验证 UTF-8 有效性
 * 3. CBC 全零 IV 旧格式：纯密文（无 IV 前缀）— 最早期的格式，同样需 UTF-8 验证
 *
 * @param encryptedBase64 - base64 编码的密文
 * @returns 解密后的明文
 * @throws 密钥未配置或解密失败时抛出错误
 */
export function decrypt(encryptedBase64: string): string {
  if (!isEncryptionKeyValid()) {
    throw new Error('加密密钥未正确配置');
  }

  const keyBytes = Buffer.from(encryptionConfig.encryptionKey, 'utf-8');
  const raw = Buffer.from(encryptedBase64, 'base64');

  // 1) 尝试 GCM 新格式：12 字节 IV + 16 字节 authTag + 密文（优先，有完整性保护）
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

  // 2) 尝试 CBC 随机 IV 格式：16 字节 IV + 密文（无认证，需验证 UTF-8）
  if (raw.length > CBC_IV_LENGTH) {
    try {
      const iv = raw.subarray(0, CBC_IV_LENGTH);
      const ciphertext = raw.subarray(CBC_IV_LENGTH);
      const decipher = crypto.createDecipheriv(CBC_ALGORITHM, keyBytes, iv);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      // CBC 无完整性校验，解密"成功"可能产出乱码，需验证 UTF-8 有效性
      // 通过 round-trip 编码验证：如果重新编码后与原始 buffer 不一致，说明解密结果无效
      const text = decrypted.toString('utf-8');
      if (!Buffer.from(text, 'utf-8').equals(decrypted)) {
        throw new Error('CBC 解密结果不是有效的 UTF-8');
      }
      return text;
    } catch {
      // CBC 随机 IV 解密失败，回退全零 IV 旧格式
    }
  }

  // 3) CBC 全零 IV 旧格式：纯密文（无 IV 前缀），最早期格式
  const iv = Buffer.alloc(CBC_IV_LENGTH, 0);
  const decipher = crypto.createDecipheriv(CBC_ALGORITHM, keyBytes, iv);
  const decrypted = Buffer.concat([decipher.update(raw), decipher.final()]);
  // CBC 无完整性校验，解密"成功"可能产出乱码，需验证 UTF-8 有效性
  const text = decrypted.toString('utf-8');
  if (!Buffer.from(text, 'utf-8').equals(decrypted)) {
    throw new Error('解密失败：密文可能已损坏或密钥不匹配');
  }
  return text;
}
