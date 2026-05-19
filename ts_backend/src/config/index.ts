/**
 * 集中式配置入口：校验环境变量，然后导出所有模块级配置。
 * 应用启动时最先加载此模块。
 */
import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(1, { error: 'JWT_SECRET 不能为空' }),
  DEEPSEEK_API_KEY: z.string().default(''),
  DB_PATH: z.string().default('./data/app.db'),
  ENCRYPTION_KEY: z.string().default(''),
  ALLOWED_ORIGINS: z.string().default(''),
  MEMORY_ROOT_DIR: z.string().default('./data/memories'),
  SYSTEM_PROMPTS_DIR: z.string().default('./data/prompts'),
  LOG_LEVEL: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
});

/** 校验 process.env，不通过则终止进程 */
function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('[配置] 环境变量校验失败:', z.treeifyError(result.error));
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();

export { databaseConfig } from './database.js';
export { aiConfig } from './ai.js';
export { authConfig } from './auth.js';
export { encryptionConfig, isEncryptionKeyValid } from './encryption.js';
export { autoDreamConfig, getAutoDreamConfig, isAutoDreamEnabled } from './auto_dream.js';
