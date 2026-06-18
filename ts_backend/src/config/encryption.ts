/**
 * 敏感字段加密配置
 *
 * 管理 AES 加密密钥和需要加密的设置项键名列表。
 * 加密密钥必须为 32 字节（AES-256）。
 *
 * @security 密钥解析策略：
 *   1. 用户显式设置 ENCRYPTION_KEY 但长度不为 32 字节 → 抛错阻止启动
 *   2. 未设置 ENCRYPTION_KEY → 自动生成 32 字节随机密钥并持久化到 .env
 *   3. 密钥始终有效，敏感数据始终加密存储，杜绝明文降级
 *
 * 多 Provider 支持：所有 Provider 的 API Key 都需要加密存储。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/** 需要加密存储的设置项键名列表 */
const SENSITIVE_KEYS = [
  'apikey_deepseek',
  'apikey_openai',
  'apikey_anthropic',
  'apikey_gemini',
  'apikey_openrouter',
  'apikey_moonshot',
  'apikey_ollama',
] as const;

/**
 * 解析加密密钥。
 *
 * @security 密钥解析逻辑：
 *   - 用户显式设置但长度不对 → 抛错（拒绝启动）
 *   - 未设置 → 自动生成 32 字节随机密钥并写入 .env
 *   - 已设置且长度正确 → 直接使用
 *
 * @returns 有效的 32 字节加密密钥
 * @throws 用户设置的密钥长度不为 32 字节时抛错
 */
function resolveEncryptionKey(): string {
  const envKey = process.env.ENCRYPTION_KEY;

  // 用户显式设置了密钥但长度不对 → 拒绝启动
  if (envKey !== undefined && envKey !== '') {
    if (Buffer.byteLength(envKey, 'utf-8') !== 32) {
      throw new Error(
        `ENCRYPTION_KEY 长度必须为 32 字节（当前 ${Buffer.byteLength(envKey, 'utf-8')} 字节），` +
          '请生成 32 字节随机密钥或移除该环境变量以启用自动生成',
      );
    }
    return envKey;
  }

  // 未设置 → 自动生成 32 字节随机密钥（16 字节随机数的十六进制表示 = 32 字符）
  const generatedKey = crypto.randomBytes(16).toString('hex');
  persistEncryptionKey(generatedKey);
  console.warn('[安全] 已自动生成 ENCRYPTION_KEY 并写入 .env 文件，请妥善备份！');
  return generatedKey;
}

/**
 * 将自动生成的加密密钥持久化到 .env 文件。
 * 如果 .env 不存在则创建，已存在则追加。
 *
 * @param key - 32 字节加密密钥
 */
function persistEncryptionKey(key: string): void {
  try {
    // 定位 .env 文件：优先项目根目录（ts_backend/）
    let envPath: string;
    const cwd = process.cwd();
    const possiblePaths = [
      path.join(cwd, '.env'),
      path.join(cwd, 'ts_backend', '.env'),
    ];

    envPath = possiblePaths[0];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        envPath = p;
        break;
      }
    }

    const line = `\n# 自动生成的加密密钥（${new Date().toISOString()}）\nENCRYPTION_KEY=${key}\n`;

    if (fs.existsSync(envPath)) {
      // 追加到现有 .env
      const content = fs.readFileSync(envPath, 'utf-8');
      // 避免重复写入
      if (!content.includes('ENCRYPTION_KEY=')) {
        fs.appendFileSync(envPath, line, 'utf-8');
      }
    } else {
      // 创建新 .env 文件
      fs.writeFileSync(envPath, line.trimStart(), 'utf-8');
    }

    // 同步到 process.env，确保后续代码能读取
    process.env.ENCRYPTION_KEY = key;
  } catch (error) {
    console.error('[安全] 持久化 ENCRYPTION_KEY 失败:', error);
    // 持久化失败时仍使用生成的密钥（仅当前进程有效，重启后会重新生成）
  }
}

/** 解析并缓存加密密钥（模块加载时执行一次） */
const resolvedKey = resolveEncryptionKey();

export const encryptionConfig = {
  /** AES-256 加密密钥，32 字节 UTF-8 字符串（始终有效） */
  encryptionKey: resolvedKey,
  /** 需要加密存储的设置项键名列表，写入数据库时自动加密这些字段 */
  sensitiveKeys: SENSITIVE_KEYS,
} as const;

/**
 * 检查加密密钥是否有效（长度恰好 32 字节）。
 * @security 自动生成机制启用后，此函数始终返回 true。
 *           保留是为了向后兼容（main.ts 启动检查、测试等场景）。
 */
export function isEncryptionKeyValid(): boolean {
  return Buffer.byteLength(encryptionConfig.encryptionKey, 'utf-8') === 32;
}
