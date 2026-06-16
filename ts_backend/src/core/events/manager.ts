/**
 * 通用事件总线 + WebSocket 广播管理器。
 *
 * 双重职责：
 * 1. WebSocket 连接管理：维护客户端连接池，支持全局广播和按 userId 定向推送。
 *    上层模块通过 eventManager.broadcast() 将状态变更实时推送到前端。
 * 2. 进程内事件总线：支持 on/off/emit/request 模式，
 *    插件之间通过事件总线通信，避免直接 import。
 *
 * 连接管理：
 * - 最大连接数 10000，超限拒绝新连接（返回 1013 状态码）
 * - 自动清理已断开或发送失败的连接
 *
 * @module core/events/manager
 */
import { WebSocket } from 'ws';
import { createLogger } from '../logger/index.js';

const logger = createLogger('EventManager');

/** 最大 WebSocket 客户端连接数 */
const MAX_CLIENTS = 10000;

/**
 * 需要通过 WebSocket 广播到前端的事件白名单。
 *
 * emit() / emitAsync() 仅对白名单内的事件自动广播，
 * 内部插件事件（如 chat.postSampling）不再泄漏到前端 WebSocket。
 * 上层模块仍可通过 eventManager.broadcast() 显式广播任意事件。
 */
const WS_BROADCAST_EVENTS = new Set([
  'conversation_created', 'conversation_updated', 'conversation_deleted',
  'message_created', 'message_updated', 'message_deleted',
  'data_imported',
  'dream_started', 'dream_activity',
  'session_memory_activity', 'compact_activity',
  'messages_compacted',
  'tool_call', 'compact',
  'mcp:server:connected', 'mcp:server:disconnected', 'mcp:server:error', 'mcp:tool:called',
  'skill:loaded', 'skill:error',
  'security:threat:detected', 'security:guardrail:blocked',
]);

/** 事件处理器类型 */
type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

/** 取消订阅函数 */
type Unsubscribe = () => void;

/**
 * 通用事件总线 + WebSocket 广播管理器。
 * 维护客户端连接池，支持全局广播和按 userId 定向推送。
 * 同时提供进程内事件总线，支持插件间松耦合通信。
 */
export class EventManager {
  /** 客户端连接池：WebSocket → 关联的 userId（未认证时为 null） */
  private clients: Map<WebSocket, string | null> = new Map();
  /** 进程内事件监听器：eventType → handler[] */
  private listeners: Map<string, Set<EventHandler>> = new Map();
  /** request/response 等待队列：requestId → resolve */
  private pendingRequests: Map<string, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }> = new Map();

  // ──────────────────────────────────────────────
  // WebSocket 连接管理（保持向后兼容）
  // ──────────────────────────────────────────────

  /**
   * 注册新的 WebSocket 客户端。
   * 超过最大连接数时拒绝连接。注册后自动监听 close/error 事件进行清理。
   *
   * @param websocket - WebSocket 连接实例
   * @param userId - 关联的用户 ID，未认证时为 null
   */
  addClient(websocket: WebSocket, userId: string | null): void {
    if (this.clients.size >= MAX_CLIENTS) {
      logger.warn(`[WS] 连接数已达上限 ${MAX_CLIENTS}，拒绝新连接`);
      websocket.close(1013, '连接数已达上限');
      return;
    }

    this.clients.set(websocket, userId);

    websocket.once('close', () => {
      this.removeClient(websocket);
    });
    websocket.once('error', (err) => {
      logger.error(err, '[WS] 连接发生错误');
      this.removeClient(websocket);
    });

    logger.info(`[WS] 客户端已连接，当前连接数: ${this.clients.size}, userId: ${userId ?? 'anonymous'}`);
  }

  /**
   * 移除指定 WebSocket 客户端。
   *
   * @param websocket - 需要移除的 WebSocket 连接
   */
  removeClient(websocket: WebSocket): void {
    if (!this.clients.has(websocket)) return;
    this.clients.delete(websocket);
    logger.info(`[WS] 客户端已断开，当前连接数: ${this.clients.size}`);
  }

  /**
   * 广播事件到所有或指定用户的 WebSocket 客户端。
   * 自动清理已断开或发送失败的连接。
   *
   * @param eventType - 事件类型标识（如 conversation_created、message_updated）
   * @param payload - 事件数据
   * @param targetUserId - 指定目标用户 ID，为空时广播给所有客户端
   */
  broadcast(eventType: string, payload: unknown, targetUserId?: string): void {
    let eventJson: string;
    try {
      eventJson = JSON.stringify({ type: eventType, payload });
    } catch (err) {
      logger.error(err, `[WS] 序列化事件失败，eventType: ${eventType}`);
      return;
    }

    const deadClients: WebSocket[] = [];

    for (const [ws, clientUserId] of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) {
        deadClients.push(ws);
        continue;
      }

      if (targetUserId && clientUserId && clientUserId !== targetUserId) {
        continue;
      }

      ws.send(eventJson, (err) => {
        if (err) {
          deadClients.push(ws);
        }
      });
    }

    for (const ws of deadClients) {
      this.removeClient(ws);
    }
  }

  /** 获取当前连接的客户端数量 */
  clientCount(): number {
    return this.clients.size;
  }

  // ──────────────────────────────────────────────
  // 进程内事件总线（新增）
  // ──────────────────────────────────────────────

  /**
   * 订阅事件。
   * @param event - 事件名称
   * @param handler - 事件处理器
   * @returns 取消订阅函数
   */
  on<T = unknown>(event: string, handler: EventHandler<T>): Unsubscribe {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler);
    return () => {
      this.off(event, handler);
    };
  }

  /**
   * 取消订阅事件。
   * @param event - 事件名称
   * @param handler - 要移除的处理器
   */
  off<T = unknown>(event: string, handler: EventHandler<T>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * 发布事件（同步触发所有监听器，不等待异步处理器完成）。
   * 同时通过 WebSocket 广播到前端。
   *
   * @param event - 事件名称
   * @param payload - 事件数据
   */
  emit<T = unknown>(event: string, payload: T): void {
    // 进程内通知
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          const result = handler(payload);
          // 如果 handler 返回 Promise，catch 其错误但不阻塞其他 handler
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch((err) => {
              logger.error(err, `[EventBus] 异步处理器错误，event: ${event}`);
            });
          }
        } catch (err) {
          logger.error(err, `[EventBus] 处理器错误，event: ${event}`);
        }
      }
    }

    // 仅白名单内事件广播到前端 WebSocket，避免内部插件事件泄漏
    if (WS_BROADCAST_EVENTS.has(event)) {
      this.broadcast(event, payload);
    }
  }

  /**
   * 异步发布事件，等待所有异步处理器完成。
   * 适用于需要所有 handler 执行完毕后才继续的流程（如 postSampling）。
   *
   * 单个 handler 失败不影响其他 handler，错误记录日志后继续。
   *
   * @param event - 事件名称
   * @param payload - 事件数据
   */
  async emitAsync<T = unknown>(event: string, payload: T): Promise<void> {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) return;

    const promises = Array.from(handlers).map(async (handler) => {
      try {
        await handler(payload);
      } catch (err) {
        logger.error(err, `[EventBus] async handler 错误，event: ${event}`);
      }
    });

    await Promise.all(promises);

    // 仅白名单内事件广播到前端 WebSocket，避免内部插件事件泄漏
    if (WS_BROADCAST_EVENTS.has(event)) {
      this.broadcast(event, payload);
    }
  }

  /**
   * 请求-响应模式：发送请求并等待某个监听器响应。
   * 监听器通过 eventBus.resolve(requestId, data) 返回结果。
   *
   * @param event - 请求事件名称（建议以 :request 后缀命名）
   * @param payload - 请求数据
   * @param timeoutMs - 超时时间（毫秒），默认 5000
   * @returns 响应数据
   */
  async request<T = unknown, R = unknown>(event: string, payload: T, timeoutMs = 5000): Promise<R> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`[EventBus] 请求超时: ${event} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        timer,
      });

      // 发布请求事件，附带 requestId 供响应方使用
      this.emit(`${event}:request`, { requestId, payload });
    });
  }

  /**
   * 响应请求：由监听器调用，将结果返回给 request() 的调用方。
   *
   * @param requestId - 请求 ID（从事件 payload 中获取）
   * @param data - 响应数据
   */
  resolve<T = unknown>(requestId: string, data: T): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.resolve(data);
    }
  }

  /**
   * 获取所有已注册的事件名称（调试用）。
   */
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }
}

/** 全局单例，供上层模块直接使用 */
export const eventManager = new EventManager();
