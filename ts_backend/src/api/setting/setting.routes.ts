/**
 * 设置路由模块
 *
 * 职责：提供应用设置的 CRUD 操作，包括页面数据聚合查询、单项/批量保存、
 * 功能开关、参数配置、API Key 管理等。所有端点需要认证，通过 userId 实现数据隔离。
 *
 * 端点概览：
 *   GET    /settings/page-data  — 获取设置页面全部数据（聚合接口）
 *   POST   /settings            — 保存单项设置
 *   POST   /settings/batch      — 批量保存设置
 *   GET    /settings/features   — 获取功能开关
 *   GET    /settings/params     — 获取所有参数
 *   PUT    /settings/params     — 批量更新参数
 *   GET    /settings/apikey     — 获取 API Key
 *   POST   /settings/apikey     — 保存 API Key
 *   GET    /settings/:key       — 获取指定设置项
 *   GET    /settings            — 获取所有设置
 *   DELETE /settings/:key       — 删除指定设置项
 */
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
import { settingRequestSchema, apiKeyRequestSchema, batchSettingSchema, batchUpdateParamsSchema, errorResponse } from '../../core/validation/schemas.js';

const logger = createLogger('SettingsRoutes');

export async function settingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /settings/page-data
   * 获取设置页面所需的全部数据（聚合接口，减少前端多次请求）。
   *
   * 响应：包含所有设置、功能开关、参数和 API Key 状态的聚合对象
   *
   * @security 通过 user.userId 隔离
   */
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

  /**
   * POST /settings
   * 保存单项设置。使用 Zod schema 校验请求体。
   *
   * 请求体：SettingRequest { key: string, value: string }
   * 响应：保存结果
   *
   * @security 通过 user.userId 隔离，设置绑定到当前用户
   */
  app.post('', async (request, reply) => {
    const user = getCurrentUser(request);
    const parsed = settingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data as SettingRequest;

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

  /**
   * POST /settings/batch
   * 批量保存设置项。使用 Zod schema 校验请求体。
   *
   * 请求体：{ items: Array<{ key: string, value: string }> }
   * 响应：批量保存结果
   *
   * @security 通过 Zod schema 校验每个 item 的 key 和 value
   */
  app.post('/batch', async (request, reply) => {
    const user = getCurrentUser(request);
    const parsed = batchSettingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data;

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

  /**
   * GET /settings/features
   * 获取功能开关状态。
   *
   * 响应：功能开关对象
   *
   * @security 通过 user.userId 隔离
   */
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

  /**
   * GET /settings/params
   * 获取所有参数配置。
   *
   * 响应：参数对象
   *
   * @security 通过 user.userId 隔离
   */
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

  /**
   * PUT /settings/params
   * 批量更新参数配置。使用 Zod schema 校验请求体。
   *
   * 请求体：{ params: Array<{ key: string, value: number }> }
   * 响应：更新结果
   *
   * @security 通过 Zod schema 校验每个 param 的 key 和 value
   */
  app.put('/params', async (request, reply) => {
    const user = getCurrentUser(request);
    const parsed = batchUpdateParamsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data;

    try {
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

  /**
   * GET /settings/apikey
   * 获取当前用户的 API Key（脱敏处理，由 service 层控制）。
   *
   * 响应：API Key 信息对象
   *
   * @security 通过 user.userId 隔离；service 层返回脱敏后的 key
   */
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

  /**
   * POST /settings/apikey
   * 保存 API Key。
   *
   * 请求体：ApiKeyRequest
   * 响应：保存结果
   *
   * @security 通过 user.userId 隔离；service 层负责加密存储
   */
  app.post('/apikey', async (request, reply) => {
    const user = getCurrentUser(request);
    const parsed = apiKeyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data as ApiKeyRequest;

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

  /**
   * GET /settings/:key
   * 获取指定键名的设置项。
   *
   * 路径参数：key — 设置键名
   * 响应：设置值对象
   *
   * @security 通过 user.userId 隔离
   */
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

  /**
   * GET /settings
   * 获取当前用户的所有设置项。
   *
   * 响应：Setting[]
   *
   * @security 通过 user.userId 隔离
   */
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

  /**
   * DELETE /settings/:key
   * 删除指定键名的设置项。
   *
   * 路径参数：key — 设置键名
   * 响应：删除结果
   *
   * @security 通过 user.userId 隔离
   */
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
