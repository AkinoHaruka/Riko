/**
 * 集中式配置入口
 *
 * 应用启动时最先加载此模块。职责：
 * 1. 通过 Zod schema 校验所有必需的环境变量，不通过则抛出异常阻止启动；
 * 2. 统一导出各子模块的配置对象，供业务代码按需引入。
 */
import { z } from 'zod';
import 'dotenv/config';

/** 环境变量的 Zod 校验 schema，定义每个变量的类型、校验规则和默认值 */
const envSchema = z.object({
  /** 服务监听端口，默认 3000 */
  PORT: z.coerce.number().default(3000),
  /** JWT 签名密钥，至少 16 字符 */
  JWT_SECRET: z.string().min(16, { error: 'JWT_SECRET 长度不能少于 16 个字符' }),
  /** DeepSeek API 密钥，可选 */
  DEEPSEEK_API_KEY: z.string().default(''),
  /** OpenAI API 密钥，可选 */
  OPENAI_API_KEY: z.string().default(''),
  /** Anthropic API 密钥，可选 */
  ANTHROPIC_API_KEY: z.string().default(''),
  /** Google Gemini API 密钥，可选 */
  GEMINI_API_KEY: z.string().default(''),
  /** OpenRouter API 密钥，可选 */
  OPENROUTER_API_KEY: z.string().default(''),
  /** Moonshot API 密钥，可选 */
  MOONSHOT_API_KEY: z.string().default(''),
  /** Ollama 基础地址，可选 */
  OLLAMA_BASE_URL: z.string().default(''),
  /** SQLite 数据库文件路径 */
  DB_PATH: z.string().default('./data/app.db'),
  /** AES 加密密钥，32 字节 */
  ENCRYPTION_KEY: z.string().default(''),
  /** CORS 允许的来源，逗号分隔 */
  ALLOWED_ORIGINS: z.string().default(''),
  /** 记忆文件根目录 */
  MEMORY_ROOT_DIR: z.string().default('./data/memories'),
  /** 系统提示词目录 */
  SYSTEM_PROMPTS_DIR: z.string().default('./data/prompts'),
  /** 日志级别 */
  LOG_LEVEL: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
});

/** 校验 process.env，不通过则抛出异常，由调用者决定是否终止进程 */
function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`[配置] 环境变量校验失败: ${z.treeifyError(result.error)}`);
  }
  return result.data;
}

/** 校验后的环境变量对象，类型安全 */
export const env = validateEnv();

export { databaseConfig } from './database.js';
export { aiConfig } from './ai.js';
export { authConfig } from './auth.js';
export { encryptionConfig, isEncryptionKeyValid } from './encryption.js';
export { autoDreamConfig, getAutoDreamConfig } from './auto_dream.js';
