/**
 * API 路由统一导出
 *
 * 将 routes.ts 中的路由注册函数统一导出，供 main.ts 引用。
 * 分为三类：CRUD 路由、聊天路由、事件路由、工具路由。
 */
export {
  registerCrudRoutes,
  registerToolRoutes,
  registerChatRoutes,
  registerEventsRoutes,
} from './routes.js';
