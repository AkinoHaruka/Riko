// WebSocket 事件推送：建立 WS 连接、心跳保活、客户端管理
import type { FastifyInstance } from 'fastify';
import { eventManager } from '../../core/events/manager.js';
import { verifyToken } from '../../domain/auth/jwt.js';

export function registerEventsRoutes(app: FastifyInstance): void {
  app.get('/ws/events', { websocket: true }, (socket, request) => {
    const token = (request.query as Record<string, string | undefined>).token;
    // 允许无 token 连接，视为默认用户
    if (token) {
      const user = verifyToken(token);
      if (!user) {
        socket.close(4003, 'Invalid token');
        return;
      }
    }

    eventManager.addClient(socket);

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
