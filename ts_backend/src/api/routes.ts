/**
 * 中心路由注册模块
 *
 * 职责：将所有 API 子路由模块挂载到 Fastify 实例上，统一管理路由前缀。
 * 注意：auth 和 monitor 路由已迁移至 plugins/auth 和 plugins/monitor，
 *       由 PluginManager 在启动时自动注册。
 *
 * 路由前缀映射：
 *   /conversations → conversationRoutes — 会话 CRUD
 *   /messages      → messageRoutes    — 消息 CRUD
 *   /settings      → settingRoutes    — 设置 CRUD
 *   /memories      → memoryRoutes     — 记忆 CRUD
 *   /memory-files  → memoryFilesRoutes — 记忆文件浏览
 *   /session-notes → sessionMemoryRoutes — 会话笔记
 *   /providers     → providerRoutes   — Provider 管理与连通性测试
 *   （无前缀）      → compactRoutes    — 上下文压缩
 *   （无前缀）      → dreamRoutes      — 梦境任务
 *   （无前缀）      → dataRoutes       — 数据导入导出
 */
import type { FastifyInstance } from 'fastify';
import { conversationRoutes } from './conversation/conversation.routes.js';
import { messageRoutes } from './message/message.routes.js';
import { settingRoutes } from './setting/setting.routes.js';
import { memoryRoutes } from './memory/memory.routes.js';
import { memoryFilesRoutes } from './memory/memory-files.routes.js';
import { sessionMemoryRoutes } from './sessionMemory/sessionMemory.routes.js';
import { compactRoutes } from './compact/compact.routes.js';
import { dreamRoutes } from './dream/dream.routes.js';
import { dataRoutes } from './data/data.routes.js';
import { registerChatRoutes as registerChat } from './chat/chat.routes.js';
import { registerToolRoutes } from './tool/tool.routes.js';
import { registerEventsRoutes as registerEvents } from './events/events.routes.js';
import { mcpRoutes } from './mcp/routes.js';
import { providerRoutes } from './provider/index.js';

/** 注册所有 CRUD 子路由（带前缀挂载） */
export async function registerCrudRoutes(app: FastifyInstance): Promise<void> {
  app.register(conversationRoutes, { prefix: '/conversations' });
  app.register(messageRoutes, { prefix: '/messages' });
  app.register(settingRoutes, { prefix: '/settings' });
  app.register(memoryRoutes, { prefix: '/memories' });
  app.register(memoryFilesRoutes, { prefix: '/memory-files' });
  app.register(sessionMemoryRoutes, { prefix: '/session-notes' });
  app.register(compactRoutes);
  app.register(dreamRoutes);
  app.register(dataRoutes);
  app.register(mcpRoutes);
  app.register(providerRoutes, { prefix: '/providers' });
}

/** 注册聊天补全路由（独立注册，因中间件配置不同） */
export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  await registerChat(app);
}

/** 注册 WebSocket 事件推送路由（独立注册，因 WebSocket 插件需求） */
export async function registerEventsRoutes(app: FastifyInstance): Promise<void> {
  await registerEvents(app);
}

export { registerToolRoutes };
