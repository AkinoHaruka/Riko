/**
 * E2E 测试辅助工具
 *
 * 提供完整的 Fastify 应用实例构建/销毁、测试用户注册登录、
 * 数据库迁移和目录初始化等通用功能，供 e2e/ 目录下的各测试文件共享使用。
 * 与 integration/helpers.ts 的区别在于：E2E 版本注册了所有路由（含 WebSocket、
 * Chat、Tool）并执行完整的数据迁移流程。
 */
process.env.JWT_SECRET = 'test-secret-key-for-e2e';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/test_memories_e2e';
process.env.LOG_LEVEL = 'ERROR';

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { registerAllMiddleware } from '../../src/core/middleware/index.js';
import { setupAuth } from '../../src/core/middleware/auth.js';
import { registerCrudRoutes, registerToolRoutes, registerChatRoutes, registerEventsRoutes } from '../../src/api/index.js';
import { initDb, closeDb, getDb } from '../../src/core/database/index.js';
import { ensureMemoryDirExists, ensureAutoDreamDirExists } from '../../src/memoryStorage/paths.js';
import { migrateSystemPrompts, migrateAutoDreamFiles, migrateSessionNotesToSessionMemory, migrateAutoDreamNestedStructure } from '../../src/memoryStorage/migrator.js';
import { initializeTools } from '../../src/tools/index.js';
import { pluginManager } from '../../src/core/runtime/plugin-manager.js';
import { authPlugin } from '../../src/plugins/auth/plugin.js';
import { monitorPlugin } from '../../src/plugins/monitor/plugin.js';
import { compactPlugin } from '../../src/plugins/compact/plugin.js';
import { sessionMemoryPlugin } from '../../src/plugins/session-memory/plugin.js';
import { autoDreamPlugin } from '../../src/plugins/auto-dream/plugin.js';
import fs from 'fs';
import path from 'path';

/**
 * 构建用于 E2E 测试的完整 Fastify 应用实例
 * - 注册 WebSocket 插件和所有中间件
 * - 注册所有路由（CRUD、Tool、Chat、Events）
 * - 添加健康检查端点
 * - 初始化数据库并执行所有迁移
 * - 初始化工具系统和必要的目录结构
 */
export async function buildE2EApp() {
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024, trustProxy: true });
  await app.register(websocket);
  // 注入 token 验证器
  const { verifyToken } = await import('../../src/domain/auth/jwt.js');
  setupAuth(verifyToken);
  await registerAllMiddleware(app);
  // 重置并注册插件（auth、monitor 等）
  pluginManager.reset();
  pluginManager.register(authPlugin);
  pluginManager.register(monitorPlugin);
  pluginManager.register(compactPlugin);
  pluginManager.register(sessionMemoryPlugin);
  pluginManager.register(autoDreamPlugin);
  await pluginManager.startAll(app);
  await registerCrudRoutes(app);
  await registerToolRoutes(app);
  await registerChatRoutes(app);
  await registerEventsRoutes(app);
  app.get('/health', async () => ({ status: 'ok' }));

  await initDb();

  initializeTools();

  // 确保会话记忆所需的目录和模板文件存在
  const memoryRoot = path.resolve(process.env.MEMORY_ROOT_DIR || './data/test_memories_e2e');
  const systemPromptsDir = path.resolve('./data/system_prompts');
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.mkdirSync(systemPromptsDir, { recursive: true });
  const sessionMemoryDir = path.join(systemPromptsDir, 'session-memory');
  fs.mkdirSync(sessionMemoryDir, { recursive: true });
  const templatePath = path.join(sessionMemoryDir, 'template.md');
  const promptPath = path.join(sessionMemoryDir, 'prompt.md');
  if (!fs.existsSync(templatePath)) fs.writeFileSync(templatePath, '', 'utf-8');
  if (!fs.existsSync(promptPath)) fs.writeFileSync(promptPath, '', 'utf-8');

  // 执行所有数据迁移
  migrateSystemPrompts(getDb());
  ensureMemoryDirExists();
  migrateAutoDreamFiles();
  ensureAutoDreamDirExists();
  migrateAutoDreamNestedStructure();
  migrateSessionNotesToSessionMemory();

  await app.ready();
  return app;
}

/**
 * 销毁 E2E 测试应用实例，关闭数据库连接并释放 Fastify 资源
 */
export async function teardownE2EApp(app: FastifyInstance) {
  closeDb();
  await app.close();
}

/**
 * 注册测试用户并返回认证信息
 * 用户名默认使用时间戳保证唯一性，避免测试间冲突
 * @param app - Fastify 应用实例
 * @param username - 可选用户名，默认自动生成
 * @param password - 可选密码，默认 'testpassword123'
 * @returns 包含 token、userId 和 username 的对象
 */
export async function registerAndLogin(
  app: FastifyInstance,
  username?: string,
  password?: string,
) {
  const user = username ?? `e2e_user_${Date.now()}`;
  const pass = password ?? 'testpassword123';

  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username: user, password: pass },
  });

  const body = res.json() as { token: string; user: { id: string; username: string } };
  return { token: body.token, userId: body.user.id, username: body.user.username };
}
