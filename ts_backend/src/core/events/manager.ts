/**
 * WebSocket 事件管理器。
 * 维护客户端连接集合，提供广播能力。设置最大连接数以保护服务端资源。
 * 自动清理已断开/出错的连接，防止僵尸连接堆积。
 */
import { WebSocket } from 'ws';
import { createLogger } from '../logger/index.js';

const logger = createLogger('EventManager');

const MAX_CLIENTS = 10000;

export class EventManager {
  private clients: Set<WebSocket> = new Set();

  addClient(websocket: WebSocket): void {
    if (this.clients.size >= MAX_CLIENTS) {
      logger.warn(`[WS] 连接数已达上限 ${MAX_CLIENTS}，拒绝新连接`);
      websocket.close(1013, '连接数已达上限');
      return;
    }

    this.clients.add(websocket);

    // 注册一次性清理回调，防止僵尸连接
    websocket.once('close', () => {
      this.removeClient(websocket);
    });
    websocket.once('error', (err) => {
      logger.error(err, '[WS] 连接发生错误');
      this.removeClient(websocket);
    });

    logger.info(`[WS] 客户端已连接，当前连接数: ${this.clients.size}`);
  }

  removeClient(websocket: WebSocket): void {
    // 防重入：先检查再删除
    if (!this.clients.has(websocket)) return;
    this.clients.delete(websocket);
    logger.info(`[WS] 客户端已断开，当前连接数: ${this.clients.size}`);
  }

  broadcast(eventType: string, payload: unknown): void {
    let eventJson: string;
    try {
      eventJson = JSON.stringify({ type: eventType, payload });
    } catch (err) {
      logger.error(err, `[WS] 序列化事件失败，eventType: ${eventType}`);
      return;
    }

    const deadClients: WebSocket[] = [];

    for (const ws of this.clients) {
      // 仅向处于 OPEN 状态的连接发送
      if (ws.readyState !== WebSocket.OPEN) {
        deadClients.push(ws);
        continue;
      }
      try {
        ws.send(eventJson);
      } catch {
        deadClients.push(ws);
      }
    }

    for (const ws of deadClients) {
      this.removeClient(ws);
    }
  }

  clientCount(): number {
    return this.clients.size;
  }
}

export const eventManager = new EventManager();
