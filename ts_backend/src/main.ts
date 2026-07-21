/**
 * 应用入口模块
 *
 * 初始化 Fastify 服务器并编排启动流程：
 * 1. 创建 Fastify 实例，注册 WebSocket、中间件和路由；
 * 2. 监听端口，启动 HTTP 服务；
 * 3. 后台执行非关键初始化（数据库、迁移、API Key 同步、梦境任务）；
 * 4. 注册优雅关闭钩子，确保资源正确释放。
 */
import Fastify, { type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { env, authConfig, autoDreamConfig } from './config/index.js';
import { initDb, closeDb, getDb, waitForDb } from './core/database/index.js';
import { registerAllMiddleware } from './core/middleware/index.js';
import { setupAuth } from './core/middleware/auth.js';
import { setupVirtualPathMapping } from './core/validation/path.js';
import { createLogger } from './core/logger/index.js';
import {
  registerCrudRoutes,
  registerToolRoutes,
  registerChatRoutes,
  registerEventsRoutes,
} from './api/index.js';
import { migratePromptDir, PROMPT_DIR, migrateMainPromptToDb } from './prompts/index.js';
import { initAutoDream } from './domain/autoDream/service.js';
import { ensureAutoDreamDirExists, ensureMemoryDirExists } from './memoryStorage/paths.js';
import {
  migrateSystemPrompts,
  migrateAutoDreamFiles,
  migrateSessionNotesToSessionMemory,
  migrateAutoDreamNestedStructure,
} from './memoryStorage/migrator.js';
import { initializeTools } from './tools/index.js';
import { initializeFts, syncDbMemoriesToFts, isFtsInitialized } from './domain/memory/ftsSearch.js';
import { initSkillRegistry } from './domain/skill/index.js';
import { connectMcpServers, disconnectAllMcpServers, getMcpConnections } from './domain/mcp/index.js';
import { loadMcpConfig } from './domain/mcp/config.js';
import { setMcpConfigPath } from './api/mcp/routes.js';
import { pluginManager } from './core/runtime/plugin-manager.js';
import { authPlugin } from './plugins/auth/plugin.js';
import { monitorPlugin } from './plugins/monitor/plugin.js';
import { compactPlugin } from './plugins/compact/plugin.js';
import { sessionMemoryPlugin } from './plugins/session-memory/plugin.js';
import { autoDreamPlugin } from './plugins/auto-dream/plugin.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const logger = createLogger('Main');

/**
 * 将环境变量中的 DeepSeek API Key 同步到数据库。
 *
 * 首次部署时用户可能只在 .env 中配置了 Key，此函数确保 Key 也写入 settings 表，
 * 使前端设置页面能读取和修改。若数据库中已存在则跳过，避免覆盖用户修改。
 */
async function syncEnvApiKey(): Promise<void> {
  const envKey = env.DEEPSEEK_API_KEY?.trim();
  // 占位符或空值不同步
  if (!envKey || envKey === 'your-deepseek-api-key') return;

  try {
    const db = getDb();
    const { generateId } = await import('./core/utils/id.js');

    // 获取默认用户（auth 中间件的 getOrCreateDefaultUser 相同逻辑）
    let userId: string;
    const existingUser = db.prepare('SELECT id FROM users LIMIT 1').get() as
      | { id: string }
      | undefined;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      // 无用户时创建默认用户，随机密码确保无法被用来登录
      userId = generateId('users');
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
      db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(
        userId,
        'default',
        hash,
      );
    }

    const existing = db
      .prepare('SELECT id FROM settings WHERE user_id = ? AND key = ?')
      .get(userId, 'apikey_deepseek') as { id: string } | undefined;

    if (existing) {
      logger.debug('[启动] API Key 已存在于数据库，跳过同步');
      return;
    }

    // @security 密钥始终有效（encryption.ts 自动生成机制保证），直接加密存储
    const { encrypt: encryptValue } = await import('./core/encryption/index.js');
    const storedValue = encryptValue(envKey);
    const isEncrypted = 1;

    const settingId = generateId('settings');
    db.prepare(
      'INSERT INTO settings (id, user_id, key, value, is_encrypted) VALUES (?, ?, ?, ?, ?)',
    ).run(settingId, userId, 'apikey_deepseek', storedValue, isEncrypted);

    logger.info('[启动] 已从 .env 同步 API Key 到数据库');
  } catch (err) {
    logger.error(err, '[启动] 同步 API Key 失败');
  }
}

/**
 * @security 迁移历史明文敏感数据为加密存储。
 *
 * 扫描 settings 表中 is_encrypted=0 且 key 在 sensitiveKeys 列表中的记录，
 * 重新加密 value 并更新 is_encrypted=1。
 *
 * 触发场景：旧版本明文存储的 API Key，升级到新版本后自动迁移为加密存储。
 */
async function migratePlaintextSettings(): Promise<void> {
  try {
    const db = getDb();
    const { encryptionConfig } = await import('./config/index.js');
    const { encrypt: encryptValue } = await import('./core/encryption/index.js');

    // 查询所有明文存储的敏感设置
    const placeholders = encryptionConfig.sensitiveKeys.map(() => '?').join(',');
    const plaintextRows = db
      .prepare(
        `SELECT id, key, value FROM settings WHERE is_encrypted = 0 AND key IN (${placeholders})`,
      )
      .all(...encryptionConfig.sensitiveKeys) as { id: string; key: string; value: string }[];

    if (plaintextRows.length === 0) {
      return;
    }

    logger.info('[安全] 发现 %d 条明文敏感数据，开始迁移为加密存储', plaintextRows.length);

    const updateStmt = db.prepare(
      'UPDATE settings SET value = ?, is_encrypted = 1 WHERE id = ?',
    );

    const migrateTxn = db.transaction(() => {
      for (const row of plaintextRows) {
        try {
          const encryptedValue = encryptValue(row.value);
          updateStmt.run(encryptedValue, row.id);
        } catch (err) {
          logger.error('[安全] 迁移明文设置失败 (id=%s, key=%s): %s', row.id, row.key, err);
        }
      }
    });

    migrateTxn();
    logger.info('[安全] 明文敏感数据迁移完成，共迁移 %d 条', plaintextRows.length);
  } catch (err) {
    logger.error(err, '[安全] 明文敏感数据迁移失败');
  }
}

/**
 * 应用启动主流程。
 *
 * 采用"先启动、后初始化"策略：HTTP 服务先就绪以快速响应健康检查，
 * 数据库、迁移、梦境等非关键初始化在 setImmediate 中异步执行。
 */
async function bootstrap(): Promise<void> {
  const app = Fastify({
    logger: false,
    // 2 MB 默认请求体上限；import 路由有单独的 bodyLimit
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: 'loopback',
  });

  // 注册 octet-stream 解析器，支持二进制文件上传
  app.addContentTypeParser(
    'application/octet-stream',
    (
      _req: FastifyRequest,
      payload: NodeJS.ReadableStream,
      done: (err: Error | null, body?: Buffer) => void,
    ) => {
      const chunks: Buffer[] = [];
      // called 标志防止 done 被多次调用（end 和 error 可能同时触发）
      let called = false;
      const finish = (err: Error | null, body?: Buffer) => {
        if (called) return;
        called = true;
        done(err, body);
      };
      payload.on('data', (chunk: Buffer) => chunks.push(chunk));
      payload.on('end', () => finish(null, Buffer.concat(chunks)));
      payload.on('error', (err: Error) => finish(err));
    },
  );

  // 全局错误处理器：脱敏 URL 中的敏感参数，区分限流错误和普通错误
  app.setErrorHandler((error, request, reply) => {
    // 脱敏：移除 URL 中 token/api_key 等敏感参数的实际值
    const safeUrl = request.url.replace(
      /([?&])(token|api_key|access_token)=([^&]*)/gi,
      '$1$2=[REDACTED]',
    );

    const errObj = error as Record<string, unknown>;
    const errMessage = typeof errObj.message === 'string' ? errObj.message : '服务器内部错误';
    const errStatusCode = typeof errObj.statusCode === 'number' ? errObj.statusCode : 500;

    if (errObj.code === 'FST_ERR_RATE_LIMIT') {
      return reply.status(429).send({
        error: '请求速率已达上限，请稍后重试',
        statusCode: 429,
      });
    }

    logger.error(error, `未捕获的错误: ${request.method} ${safeUrl}`);
    reply.status(errStatusCode).send({
      error: errMessage,
      statusCode: errStatusCode,
    });
  });

  await app.register(websocket);
  // 注入 token 验证器，解耦中间件对 domain/auth 的直接依赖
  const { verifyToken } = await import('./domain/auth/jwt.js');
  setupAuth(verifyToken);
  await registerAllMiddleware(app);

  // 注册插件（auth、monitor 等），由插件自行注册路由
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

  // 健康检查端点，供负载均衡器和监控使用
  app.get('/health', async () => {
    // 检查数据库连接状态
    let databaseStatus: 'ok' | 'error' = 'error';
    try {
      getDb();
      databaseStatus = 'ok';
    } catch {
      databaseStatus = 'error';
    }

    // 检查 FTS 索引状态
    let ftsStatus: 'ok' | 'error' | 'not_initialized' = 'not_initialized';
    if (isFtsInitialized()) {
      try {
        getDb();
        ftsStatus = 'ok';
      } catch {
        ftsStatus = 'error';
      }
    }

    // 检查 MCP 连接状态
    const mcpConnections = getMcpConnections();
    const mcpStatus: Record<string, 'connected' | 'failed' | 'disconnected'> = {};
    for (const conn of mcpConnections) {
      mcpStatus[conn.name] = conn.status === 'connected' ? 'connected'
        : conn.status === 'failed' ? 'failed'
        : 'disconnected';
    }

    // 综合状态判定
    const hasError = databaseStatus === 'error';
    const hasDegraded = ftsStatus === 'error' || Object.values(mcpStatus).some(s => s === 'failed');
    const status = hasError ? 'unhealthy' : hasDegraded ? 'degraded' : 'ok';

    return {
      status,
      timestamp: new Date().toISOString(),
      checks: {
        database: databaseStatus,
        fts: ftsStatus,
        mcp: mcpStatus,
      },
    };
  });

  // 就绪检查端点，供编排系统判断服务是否可接受流量
  app.get('/readiness', async () => {
    try {
      getDb();
      return { ready: true, details: '服务就绪' };
    } catch {
      return { ready: false, details: '数据库未初始化' };
    }
  });

  // onReady 不阻塞：启动 DB 初始化后立即返回，让服务器先起来
  app.addHook('onReady', async () => {
    initDb().catch((err) => {
      logger.error(err, '[启动] initDb 失败 — 无法继续启动');
      process.exit(1);
    });
    logger.info(`[启动] AI Chat 后端服务已启动，监听端口: ${env.PORT}`);
  });

  app.addHook('onClose', async () => {
    // @robustness 关闭流程中任一步骤失败不应中断后续清理，
    // 否则可能导致数据库连接或子进程残留。分别 try/catch 并记录日志。
    try {
      await pluginManager.stopAll();
    } catch (err) {
      logger.error(err, '[关闭] pluginManager.stopAll 失败，继续关闭流程');
    }
    try {
      await closeDb();
    } catch (err) {
      logger.error(err, '[关闭] closeDb 失败');
    }
    logger.info('[关闭] AI Chat 后端服务正在关闭...');
  });

  try {
    await app.listen({ port: env.PORT, host: process.env.HOST || '127.0.0.1' });
  } catch (err) {
    logger.error(err, '启动失败');
    process.exit(1);
  }

  // 非关键初始化在后台执行，不阻塞服务器启动
  setImmediate(async () => {
    try {
      await waitForDb(); // 等待 DB 初始化完成（在 onReady 中已启动）
      // 注入虚拟路径映射，解耦 core/validation/path 对 config/ 和 prompts/ 的直接依赖
      setupVirtualPathMapping({
        memoryRootDir: path.resolve(autoDreamConfig.memoryRootDir),
        systemPromptsDir: path.resolve(autoDreamConfig.systemPromptsDir),
        promptDir: path.resolve(PROMPT_DIR),
      });
      initializeTools();
      // 初始化 FTS5 全文搜索索引并同步现有记忆
      initializeFts();
      syncDbMemoriesToFts();
      // 初始化技能注册表
      const skillsDir = path.join(path.resolve(PROMPT_DIR), '..', 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });
      initSkillRegistry(skillsDir);
      // 初始化 MCP 客户端：加载配置并连接已配置的 Server
      const mcpConfigPath = path.join(path.resolve(PROMPT_DIR), '..', 'mcp_servers.json');
      setMcpConfigPath(mcpConfigPath);
      const mcpServers = loadMcpConfig(mcpConfigPath);
      if (mcpServers.length > 0) {
        connectMcpServers(mcpServers).then((results) => {
          for (const r of results) {
            if (r.status === 'connected') {
              logger.info('[MCP] %s 已连接 (%d 工具)', r.name, r.toolCount ?? 0);
            } else {
              logger.warn('[MCP] %s 连接失败: %s', r.name, r.error);
            }
          }
        }).catch((e) => {
          logger.warn('[MCP] 初始化异常: %s', e instanceof Error ? e.message : String(e));
        });
      }
      await syncEnvApiKey();

      // 确保记忆和提示词目录存在
      const memoryRoot = path.resolve(autoDreamConfig.memoryRootDir);
      const systemPromptsDir = path.resolve(autoDreamConfig.systemPromptsDir);
      fs.mkdirSync(memoryRoot, { recursive: true });
      fs.mkdirSync(systemPromptsDir, { recursive: true });

      // 执行数据迁移（旧版目录结构 → 新版）
      migrateSystemPrompts(getDb());
      ensureMemoryDirExists();
      migrateAutoDreamFiles();
      ensureAutoDreamDirExists();
      migrateAutoDreamNestedStructure();
      migrateSessionNotesToSessionMemory();
      migratePromptDir();
      migrateMainPromptToDb(); // 显式迁移：文件 → 数据库（原隐藏在 loadMainPrompt 中的副作用）

      // 确保默认提示词文件存在（首次安装时创建）
      const promptsDir = path.resolve(PROMPT_DIR);
      fs.mkdirSync(promptsDir, { recursive: true });
      const mainPromptPath = path.join(promptsDir, 'main_prompt.md');
      if (!fs.existsSync(mainPromptPath)) {
        const defaultMainPrompt = [
          'You are a helpful AI assistant.',
          '',
          '## Guidelines',
          '- Answer questions accurately and concisely.',
          '- When writing code, prefer clarity and correctness over cleverness.',
          '- If you are unsure about something, say so rather than guessing.',
          '- Use tools when appropriate to gather information or perform actions.',
        ].join('\n');
        fs.writeFileSync(mainPromptPath, defaultMainPrompt, 'utf-8');
        logger.info('[启动] 已创建默认 main_prompt.md');
      }
      initAutoDream();

      logger.info(`[启动] 记忆文件根目录: ${memoryRoot}`);
      logger.info(`[启动] System Prompts 目录: ${systemPromptsDir}`);

      // 安全告警：检测不安全的默认配置
      if (authConfig.jwtSecret === 'your-super-secret-jwt-key-change-this-in-production') {
        logger.warn('[安全] JWT_SECRET 仍为默认值，请在生产环境中修改！当前配置存在严重安全隐患。');
      }

      // @security 加密密钥现在由 encryption.ts 自动生成，始终有效
      // 仅检测已知的弱/默认密钥
      const { encryptionConfig } = await import('./config/index.js');
      const WEAK_KEYS = [
        '0123456789abcdef0123456789abcdef',
        'generate-a-32-byte-hex-key-for-production',
      ];
      if (WEAK_KEYS.includes(encryptionConfig.encryptionKey)) {
        logger.warn('[安全] ENCRYPTION_KEY 使用了已知的弱/默认密钥，生产环境请更换为随机 32 字节密钥！');
      }

      // @security 迁移历史明文敏感数据为加密存储
      await migratePlaintextSettings();
    } catch (err) {
      logger.error(err, '[启动] 后台初始化失败');
    }
  });

  // 优雅关闭：收到终止信号时调用 app.close() 触发 onClose 钩子
  const gracefulShutdown = async (signal: string) => {
    logger.info(`[关闭] 收到 ${signal} 信号，开始优雅关闭...`);
    try {
      await disconnectAllMcpServers();
      await app.close();
    } catch (err) {
      logger.error(err, '[关闭] 优雅关闭过程中发生错误');
      process.exit(1);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
