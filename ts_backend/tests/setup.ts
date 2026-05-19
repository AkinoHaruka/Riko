/**
 * vitest 全局 setup 文件
 * 在所有测试运行前设置必要的环境变量，
 * 避免导入 src 模块时因 config/index.ts 中的 validateEnv() 校验失败而退出进程。
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
process.env.DB_PATH = process.env.DB_PATH || ':memory:';
process.env.MEMORY_ROOT_DIR = process.env.MEMORY_ROOT_DIR || './data/memories';
process.env.SYSTEM_PROMPTS_DIR = process.env.SYSTEM_PROMPTS_DIR || './data/system_prompts';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'WARN';
