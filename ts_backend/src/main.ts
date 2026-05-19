// 应用入口：初始化 Fastify 服务器，注册路由、中间件、WebSocket 和后台任务
import Fastify, { type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { env, authConfig, autoDreamConfig } from './config/index.js';
import { initDb, closeDb, getDb, waitForDb } from './core/database/index.js';
import { registerAllMiddleware } from './core/middleware/index.js';
import { createLogger } from './core/logger/index.js';
import {
  registerCrudRoutes,
  registerToolRoutes,
  registerChatRoutes,
  registerEventsRoutes,
} from './api/index.js';
import { migratePromptDir, PROMPT_DIR } from './prompts/index.js';
import { initAutoDream } from './domain/autoDream/service.js';
import { ensureAutoDreamDirExists, ensureMemoryDirExists } from './memoryStorage/paths.js';
import {
  migrateSystemPrompts,
  migrateAutoDreamFiles,
  migrateSessionNotesToSessionMemory,
  migrateAutoDreamNestedStructure,
} from './memoryStorage/migrator.js';
import { initializeTools } from './tools/index.js';
import fs from 'fs';
import path from 'path';

const logger = createLogger('Main');

async function syncEnvApiKey(): Promise<void> {
  const envKey = env.DEEPSEEK_API_KEY?.trim();
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
      userId = generateId('users');
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('default', 10);
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

    const { encrypt: encryptValue } = await import('./core/encryption/index.js');
    const { isEncryptionKeyValid } = await import('./config/index.js');
    let storedValue = envKey;
    let isEncrypted = 0;
    if (isEncryptionKeyValid()) {
      storedValue = encryptValue(envKey);
      isEncrypted = 1;
    }

    const settingId = generateId('settings');
    db.prepare(
      'INSERT INTO settings (id, user_id, key, value, is_encrypted) VALUES (?, ?, ?, ?, ?)',
    ).run(settingId, userId, 'apikey_deepseek', storedValue, isEncrypted);

    logger.info('[启动] 已从 .env 同步 API Key 到数据库');
  } catch (err) {
    logger.error(err, '[启动] 同步 API Key 失败');
  }
}

async function bootstrap(): Promise<void> {
  const app = Fastify({
    logger: false,
    bodyLimit: 100 * 1024 * 1024,
    trustProxy: true,
  });

  app.addContentTypeParser(
    'application/octet-stream',
    (
      _req: FastifyRequest,
      payload: NodeJS.ReadableStream,
      done: (err: Error | null, body?: Buffer) => void,
    ) => {
      const chunks: Buffer[] = [];
      payload.on('data', (chunk: Buffer) => chunks.push(chunk));
      payload.on('end', () => done(null, Buffer.concat(chunks)));
      payload.on('error', (err: Error) => done(err));
    },
  );

  app.setErrorHandler((error, request, reply) => {
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
  await registerAllMiddleware(app);
  await registerCrudRoutes(app);
  await registerToolRoutes(app);
  await registerChatRoutes(app);
  await registerEventsRoutes(app);

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // onReady 不阻塞：启动 DB 初始化后立即返回，让服务器先起来
  app.addHook('onReady', async () => {
    initDb(); // fire-and-forget — auth 中间件会在首次请求时自动等待
    logger.info(`[启动] AI Chat 后端服务已启动，监听端口: ${env.PORT}`);
  });

  app.addHook('onClose', async () => {
    closeDb();
    logger.info('[关闭] AI Chat 后端服务正在关闭...');
  });

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    logger.error(err, '启动失败');
    process.exit(1);
  }

  // 非关键初始化在后台执行，不阻塞服务器启动
  setImmediate(async () => {
    try {
      await waitForDb(); // 等待 DB 初始化完成（在 onReady 中已启动）
      initializeTools();
      await syncEnvApiKey();

      const memoryRoot = path.resolve(autoDreamConfig.memoryRootDir);
      const systemPromptsDir = path.resolve(autoDreamConfig.systemPromptsDir);
      fs.mkdirSync(memoryRoot, { recursive: true });
      fs.mkdirSync(systemPromptsDir, { recursive: true });
      migrateSystemPrompts(getDb());
      ensureMemoryDirExists();
      migrateAutoDreamFiles();
      ensureAutoDreamDirExists();
      migrateAutoDreamNestedStructure();
      migrateSessionNotesToSessionMemory();
      migratePromptDir();

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

      if (authConfig.jwtSecret === 'your-super-secret-jwt-key-change-this-in-production') {
        logger.warn('[安全] JWT_SECRET 仍为默认值，请在生产环境中修改！当前配置存在严重安全隐患。');
      }

      const { isEncryptionKeyValid } = await import('./config/index.js');
      if (!isEncryptionKeyValid()) {
        logger.warn('[安全] ENCRYPTION_KEY 未配置或长度不足 32 字节，API Key 将以明文存储！');
      }
    } catch (err) {
      logger.error(err, '[启动] 后台初始化失败');
    }
  });

  // 优雅关闭：收到终止信号时调用 app.close() 触发 onClose 钩子
  const gracefulShutdown = async (signal: string) => {
    logger.info(`[关闭] 收到 ${signal} 信号，开始优雅关闭...`);
    try {
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

bootstrap();
