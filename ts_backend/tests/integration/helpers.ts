import Fastify from 'fastify';
import { authMiddleware } from '../../src/core/middleware/auth.js';
import { registerCrudRoutes } from '../../src/api/index.js';
import { initDb, closeDb } from '../../src/core/database/index.js';

export async function buildApp() {
  const app = Fastify();
  app.addHook('onRequest', authMiddleware);
  await registerCrudRoutes(app);
  await initDb();
  return app;
}

export async function teardownApp(app: Fastify.FastifyInstance) {
  closeDb();
  await app.close();
}

export async function registerUser(
  app: Fastify.FastifyInstance,
  username = 'testuser',
  password = 'password123',
) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password },
  });
  return response.json() as { token: string; user: { id: string; username: string } };
}
