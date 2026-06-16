/**
 * AES 加密模块单元测试
 * 测试 AES-256-GCM 加密/解密、随机 IV、中文支持、空字符串处理及旧格式 CBC 回退兼容
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { encrypt, decrypt } from '../../src/core/encryption/aes.js';

// 保存原始环境变量，测试结束后恢复
const originalKey = process.env.ENCRYPTION_KEY;
const TEST_KEY = '0123456789abcdef0123456789abcdef';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
});

afterAll(() => {
  if (originalKey !== undefined) {
    process.env.ENCRYPTION_KEY = originalKey;
  } else {
    delete process.env.ENCRYPTION_KEY;
  }
});

describe('AES-256-GCM 加密模块 (CBC 回退兼容)', () => {
  it('加密后应能正确解密', () => {
    const plaintext = 'Hello, World!';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  // 随机 IV 确保相同明文产生不同密文，防止密文模式分析
  it('每次加密应产生不同的密文（随机 IV）', () => {
    const plaintext = 'same text';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('应正确处理中文文本', () => {
    const plaintext = '你好，世界！这是一个测试。';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('应正确处理空字符串', () => {
    const plaintext = '';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('应正确处理长文本', () => {
    const plaintext = 'a'.repeat(10000);
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  // 兼容旧版全零 IV 的 CBC 加密格式，确保数据迁移后仍可解密
  it('应兼容全零 IV 的旧格式', () => {
    // 手动构造全零 IV 的旧格式密文，验证 decrypt 的回退逻辑
    const keyBytes = Buffer.from(TEST_KEY, 'utf-8');
    const plaintext = 'legacy data';
    const iv = Buffer.alloc(16, 0);
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBytes, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const encryptedBase64 = encrypted.toString('base64');

    // 旧格式密文长度小于 32 字节，decrypt 应自动回退到全零 IV 解密
    const raw = Buffer.from(encryptedBase64, 'base64');
    expect(raw.length).toBeLessThan(32);

    const decrypted = decrypt(encryptedBase64);
    expect(decrypted).toBe(plaintext);
  });
});
