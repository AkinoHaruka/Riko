/**
 * 事件推送路由模块
 *
 * 职责：提供 WebSocket 端点，将后端事件（消息更新、压缩完成、数据导入等）
 * 实时推送给前端客户端。支持多客户端连接，每个连接维护独立的心跳。
 *
 * 端点概览：
 *   GET /ws/events — WebSocket 连接，接收实时事件推送
 */
import type { FastifyInstance } from 'fastify';
import { eventManager } from '../../core/events/manager.js';
import { verifyToken } from '../../domain/auth/jwt.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('EventsRoutes');

export function registerEventsRoutes(app: FastifyInstance): void {
  /**
   * GET /ws/events
   * WebSocket 端点，客户端连接后接收服务端实时事件推送。
   *
   * 连接方式：ws://host:port/ws/events?token=<JWT>
   *
   * @security 通过 query 参数传递 JWT token 进行身份验证。
   *           无效 token 时关闭连接（code 4003）。
   *           无 token 时视为默认用户（兼容旧客户端），但会记录警告日志。
   *
   * 心跳机制：每 30 秒发送 { type: 'heartbeat' } 保持连接活跃
   * 事件格式：由 eventManager 统一管理，如 { type: 'message_updated', ... }
   */
  app.get('/ws/events', { websocket: true }, (socket, request) => {
    const token = (request.query as Record<string, string | undefined>).token;
    let userId: string | null = null;

    if (token) {
      const user = verifyToken(token);
      if (!user) {
        // @security token 无效时立即关闭连接
        socket.close(4003, 'Invalid token');
        return;
      }
      userId = user.userId;
    } else {
      logger.warn('[WS] 无 token 的 WebSocket 连接被拒绝, IP=%s', request.ip);
      socket.close(4001, 'Authentication required');
      return;
    }

    eventManager.addClient(socket, userId);

    // @TODO 事件广播应按 userId 过滤。
    //        当前 eventManager.broadcast() 向所有客户端广播事件，
    //        多用户场景下需确保事件仅推送给拥有该数据的用户。
    //        例如：message_updated 事件应只推送给该消息所属对话的 userId，
    //        而非所有已连接的 WebSocket 客户端。
    //        eventManager.addClient 已传入 userId，后续需在 broadcast 中增加 userId 过滤逻辑。

    // 定时心跳，检测连接是否仍然活跃
    const heartbeat = setInterval(() => {
      if (socket.readyState === 1) {
        try {
          socket.send(JSON.stringify({ type: 'heartbeat' }));
        } catch {
          clearInterval(heartbeat);
        }
      } else {
        clearInterval(heartbeat);
      }
    }, 30_000);

    // 客户端消息暂不处理，保留接口以备扩展
    socket.on('message', () => {});

    socket.on('close', () => {
      clearInterval(heartbeat);
      eventManager.removeClient(socket);
    });

    socket.on('error', () => {
      clearInterval(heartbeat);
      eventManager.removeClient(socket);
    });
  });
}
