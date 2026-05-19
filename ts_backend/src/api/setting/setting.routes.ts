// 设置 API：页面数据、参数、功能开关、API Key 的 CRUD 操作
import type { FastifyInstance } from 'fastify';
import { getCurrentUser } from '../../core/middleware/index.js';
import { HttpError } from '../../core/utils/index.js';
import { createLogger } from '../../core/logger/index.js';
import {
  saveSetting,
  batchSaveSettings,
  getSetting,
  getAllSettings,
  getApiKey,
  saveApiKey,
  deleteSetting,
  getFeatureToggles,
  getAllParams,
  batchUpdateParams,
  getSettingsPageData,
} from '../../domain/setting/index.js';
import type { SettingRequest, ApiKeyRequest } from '../../domain/setting/types.js';

const logger = createLogger('SettingsRoutes');

export async function settingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/page-data', async (request, reply) => {
    const user = getCurrentUser(request);
    try {
      const result = getSettingsPageData(user.userId);
      return reply.send(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '获取设置数据失败' });
    }
  });

  app.post('', async (request, reply) => {
    const user = getCurrentUser(request);
    const body = request.body as SettingRequest;

    try {
      const result = saveSetting(user.userId, body);
      return reply.send(result);
    } catch (err) {
      logger.error({ err }, `POST /settings 失败`);
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply.status(500).send({ error: err instanceof Error ? err.message : '保存设置失败' });
    }
  });

  app.post('/batch', async (request, reply) => {
    const user = getCurrentUser(request);
    const body = request.body as { items: { key: string; value: string }[] };

    try {
      const result = batchSaveSettings(user.userId, body.items);
      return reply.send(result);
    } catch (err) {
      logger.error({ err }, `POST /settings/batch 失败`);
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '批量保存设置失败' });
    }
  });

  app.get('/features', async (request, reply) => {
    const user = getCurrentUser(request);

    try {
      const toggles = getFeatureToggles(user.userId);
      return reply.send(toggles);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '获取功能开关失败' });
    }
  });

  app.get('/params', async (request, reply) => {
    const user = getCurrentUser(request);

    try {
      const result = getAllParams(user.userId);
      return reply.send(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply.status(500).send({ error: err instanceof Error ? err.message : '获取参数失败' });
    }
  });

  app.put('/params', async (request, reply) => {
    const user = getCurrentUser(request);
    const body = request.body as { params: { key: string; value: number }[] };

    try {
      if (!body.params || !Array.isArray(body.params)) {
        return reply.status(400).send({ error: 'params 必须为数组' });
      }
      const result = batchUpdateParams(user.userId, body.params);
      return reply.send(result);
    } catch (err) {
      logger.error({ err }, `PUT /settings/params 失败`);
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply.status(500).send({ error: err instanceof Error ? err.message : '更新参数失败' });
    }
  });

  app.get('/apikey', async (request, reply) => {
    const user = getCurrentUser(request);

    try {
      const result = getApiKey(user.userId);
      return reply.send(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '获取 API Key 失败' });
    }
  });

  app.post('/apikey', async (request, reply) => {
    const user = getCurrentUser(request);
    const body = request.body as ApiKeyRequest;

    try {
      const result = saveApiKey(user.userId, body);
      return reply.send(result);
    } catch (err) {
      logger.error({ err }, `POST /settings/apikey 失败`);
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '保存 API Key 失败' });
    }
  });

  app.get('/:key', async (request, reply) => {
    const user = getCurrentUser(request);
    const { key } = request.params as { key: string };

    try {
      const result = getSetting(user.userId, key);
      return reply.send(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply.status(500).send({ error: err instanceof Error ? err.message : '获取设置失败' });
    }
  });

  app.get('', async (request, reply) => {
    const user = getCurrentUser(request);

    try {
      const result = getAllSettings(user.userId);
      return reply.send(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply.status(500).send({ error: err instanceof Error ? err.message : '获取设置失败' });
    }
  });

  app.delete('/:key', async (request, reply) => {
    const user = getCurrentUser(request);
    const { key } = request.params as { key: string };

    try {
      const result = deleteSetting(user.userId, key);
      return reply.send(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply.status(500).send({ error: err instanceof Error ? err.message : '删除设置失败' });
    }
  });
}
