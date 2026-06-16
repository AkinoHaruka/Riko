/**
 * 加密模块入口。
 * 导出 AES-256-GCM 加解密函数及敏感字段判断工具，供 settings 等模块使用。
 *
 * @module core/encryption
 */
export { encrypt, decrypt, isSensitive, SENSITIVE_KEYS } from './aes.js';
