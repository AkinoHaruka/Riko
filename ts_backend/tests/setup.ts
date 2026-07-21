/**
 * vitest 全局 setup 文件
 *
 * 在所有测试运行前设置必要的环境变量，
 * 避免导入 src 模块时因 config/index.ts 中的 validateEnv() 校验失败而退出进程。
 * 各测试文件可覆盖这些默认值（如 JWT_SECRET、DB_PATH）。
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
process.env.DB_PATH = process.env.DB_PATH || ':memory:';
process.env.MEMORY_ROOT_DIR = process.env.MEMORY_ROOT_DIR || './data/memories';
process.env.SYSTEM_PROMPTS_DIR = process.env.SYSTEM_PROMPTS_DIR || './data/system_prompts';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'WARN';

// @see Node.js MaxListenersExceededWarning
// E2E/集成测试中每个 buildE2EApp() 会调用 initDb() 创建新的 better-sqlite3 实例，
// better-sqlite3 内部会在 process 上注册 exit listener 用于进程退出时关闭数据库。
// 多个测试用例累积超过 Node.js 默认上限 10 时会触发内存泄漏警告。
// 这些 listener 在 closeDb() 后实际是 no-op（数据库已关闭），不影响生产环境。
// 此处仅在测试环境中提高上限，避免误导性的警告输出。
process.setMaxListeners(20);
