// 中心路由注册：将所有 API 子路由挂载到 Fastify 实例
import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth/auth.routes.js';
import { conversationRoutes } from './conversation/conversation.routes.js';
import { messageRoutes } from './message/message.routes.js';
import { settingRoutes } from './setting/setting.routes.js';
import { memoryRoutes } from './memory/memory.routes.js';
import { memoryFilesRoutes } from './memory/memory-files.routes.js';
import { sessionMemoryRoutes } from './sessionMemory/sessionMemory.routes.js';
import { compactRoutes } from './compact/compact.routes.js';
import { dreamRoutes } from './dream/dream.routes.js';
import { monitorRoutes } from './monitor/monitor.routes.js';
import { dataRoutes } from './data/data.routes.js';
import { registerChatRoutes as registerChat } from './chat/chat.routes.js';
import { registerToolRoutes } from './tool/tool.routes.js';
import { registerEventsRoutes as registerEvents } from './events/events.routes.js';

export async function registerCrudRoutes(app: FastifyInstance): Promise<void> {
  app.register(authRoutes, { prefix: '/auth' });
  app.register(conversationRoutes, { prefix: '/conversations' });
  app.register(messageRoutes, { prefix: '/messages' });
  app.register(settingRoutes, { prefix: '/settings' });
  app.register(memoryRoutes, { prefix: '/memories' });
  app.register(memoryFilesRoutes, { prefix: '/memory-files' });
  app.register(sessionMemoryRoutes, { prefix: '/session-notes' });
  app.register(compactRoutes);
  app.register(dreamRoutes);
  app.register(monitorRoutes);
  app.register(dataRoutes);
}

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  await registerChat(app);
}

export async function registerEventsRoutes(app: FastifyInstance): Promise<void> {
  await registerEvents(app);
}

export { registerToolRoutes };
