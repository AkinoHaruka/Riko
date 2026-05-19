/** AES-256-CBC 加解密，用于保护用户设置中的敏感字段 */
export { encrypt, decrypt, isSensitive, SENSITIVE_KEYS } from './aes.js';
