/**
 * 事件模块入口。
 * 导出 WebSocket 事件广播管理器及事件消息类型，供 domain 层推送实时事件。
 *
 * @module core/events
 */
export { EventManager, eventManager } from './manager.js';
export type { EventMessage } from './types.js';
