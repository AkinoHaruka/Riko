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
import { registerCrudRoutes, registerToolRoutes, registerChatRoutes, registerEventsRoutes } from '../../src/api/index.js';
import { initDb, closeDb, getDb } from '../../src/core/database/index.js';
import { ensureMemoryDirExists, ensureAutoDreamDirExists } from '../../src/memoryStorage/paths.js';
import { migrateSystemPrompts, migrateAutoDreamFiles, migrateSessionNotesToSessionMemory, migrateAutoDreamNestedStructure } from '../../src/memoryStorage/migrator.js';
import { initializeTools } from '../../src/tools/index.js';
import fs from 'fs';
import path from 'path';

export async function buildE2EApp() {
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024, trustProxy: true });
  await app.register(websocket);
  await registerAllMiddleware(app);
  await registerCrudRoutes(app);
  await registerToolRoutes(app);
  await registerChatRoutes(app);
  await registerEventsRoutes(app);
  app.get('/health', async () => ({ status: 'ok' }));

  await initDb();

  initializeTools();

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
  migrateSystemPrompts(getDb());
  ensureMemoryDirExists();
  migrateAutoDreamFiles();
  ensureAutoDreamDirExists();
  migrateAutoDreamNestedStructure();
  migrateSessionNotesToSessionMemory();

  await app.ready();
  return app;
}

export async function teardownE2EApp(app: FastifyInstance) {
  closeDb();
  await app.close();
}

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
