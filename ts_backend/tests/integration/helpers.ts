/**
 * 集成测试辅助工具
 *
 * 提供 Fastify 应用实例的构建/销毁、测试用户注册等通用功能，
 * 供 integration/ 目录下的各测试文件共享使用。
 */
import Fastify from 'fastify';
import { authMiddleware, setupAuth } from '../../src/core/middleware/auth.js';
import { registerCrudRoutes } from '../../src/api/index.js';
import { initDb, closeDb } from '../../src/core/database/index.js';
import { pluginManager } from '../../src/core/runtime/plugin-manager.js';
import { authPlugin } from '../../src/plugins/auth/plugin.js';
import { monitorPlugin } from '../../src/plugins/monitor/plugin.js';
import { compactPlugin } from '../../src/plugins/compact/plugin.js';
import { sessionMemoryPlugin } from '../../src/plugins/session-memory/plugin.js';
import { autoDreamPlugin } from '../../src/plugins/auto-dream/plugin.js';

/**
 * 构建用于集成测试的 Fastify 应用实例
 * - 注册认证中间件和 CRUD 路由
 * - 初始化内存数据库
 */
export async function buildApp() {
  const app = Fastify();
  // 注入 token 验证器
  const { verifyToken } = await import('../../src/domain/auth/jwt.js');
  setupAuth(verifyToken);
  app.addHook('onRequest', authMiddleware);
  // 注册插件
  pluginManager.reset();
  pluginManager.register(authPlugin);
  pluginManager.register(monitorPlugin);
  pluginManager.register(compactPlugin);
  pluginManager.register(sessionMemoryPlugin);
  pluginManager.register(autoDreamPlugin);
  await pluginManager.startAll(app);
  await registerCrudRoutes(app);
  await initDb();
  return app;
}

/**
 * 销毁测试应用实例，关闭数据库连接并释放 Fastify 资源
 */
export async function teardownApp(app: Fastify.FastifyInstance) {
  closeDb();
  await app.close();
}

/**
 * 注册测试用户并返回认证信息
 * @param app - Fastify 应用实例
 * @param username - 用户名，默认 'testuser'
 * @param password - 密码，默认 'password123'
 * @returns 包含 token 和 user 信息的对象
 */
export async function registerUser(
  app: Fastify.FastifyInstance,
  username = 'testuser',
  password = 'password123',
) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password },
  });
  return response.json() as { token: string; user: { id: string; username: string } };
}
