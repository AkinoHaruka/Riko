/**
 * Provider 管理 API 路由
 *
 * 提供 AI 提供商的查询和连通性测试接口。
 *
 * GET  /providers           — 列出所有 Provider 及其模型和 API Key 状态
 * GET  /providers/models    — 列出所有 Provider 的所有模型（模型选择器用）
 * GET  /providers/:id/models — 列出指定 Provider 的模型
 * POST /providers/:id/test  — 测试指定 Provider 的 API Key 连通性
 */

import type { FastifyInstance } from 'fastify';
import { getCurrentUser } from '../../core/middleware/index.js';
import { createLogger } from '../../core/logger/index.js';
import {
  getAllProviders,
  getProviderById,
  getProviderModels,
  getAllModels,
} from '../../core/ai/providers/index.js';
import { resolveApiKey, createTransport } from '../../core/ai/client.js';

const logger = createLogger('ProviderRoutes');

export async function providerRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /providers
   * 列出所有可用的 Provider，包含模型列表和 API Key 配置状态。
   *
   * 响应：Provider 列表，每项含 id、name、apiMode、models、hasApiKey
   */
  app.get('/', async (request, reply) => {
    const user = getCurrentUser(request);
    try {
      const providers = getAllProviders();
      // 并行检查每个 Provider 的 API Key 状态
      const results = await Promise.all(
        providers.map(async (p) => {
          const apiKey = await resolveApiKey(user.userId, p);
          return {
            id: p.id,
            name: p.name,
            apiMode: p.apiMode,
            baseUrl: p.baseUrl,
            supportsThinking: p.supportsThinking,
            supportsToolCalls: p.supportsToolCalls,
            models: p.models,
            hasApiKey: !!apiKey,
          };
        }),
      );
      return reply.send({ providers: results });
    } catch (err) {
      logger.error({ err }, 'GET /providers 失败');
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '获取 Provider 列表失败' });
    }
  });

  /**
   * GET /providers/models
   * 列出所有 Provider 的所有模型，供模型选择器使用。
   *
   * 响应：模型列表，每项含 providerId、id、name、contextWindow 等
   */
  app.get('/models', async (_request, reply) => {
    try {
      const models = getAllModels();
      return reply.send({ models });
    } catch (err) {
      logger.error({ err }, 'GET /providers/models 失败');
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '获取模型列表失败' });
    }
  });

  /**
   * GET /providers/:id/models
   * 列出指定 Provider 的模型列表。
   *
   * 路径参数：id — Provider 唯一标识
   * 响应：模型列表
   */
  app.get('/:id/models', async (request, reply) => {
    const { id } = request.params as { id: string };

    const provider = getProviderById(id);
    if (!provider) {
      return reply.status(404).send({ error: `未找到 Provider: ${id}` });
    }

    try {
      const models = getProviderModels(id);
      return reply.send({ providerId: id, models });
    } catch (err) {
      logger.error({ err }, `GET /providers/${id}/models 失败`);
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : '获取模型列表失败' });
    }
  });

  /**
   * POST /providers/:id/test
   * 测试指定 Provider 的 API Key 连通性。
   *
   * 通过创建 Transport 并调用 listModels() 来验证 API Key 是否有效。
   * 成功返回模型列表，失败返回错误信息。
   *
   * 路径参数：id — Provider 唯一标识
   * 响应：{ success: boolean, models?: NormalizedModel[], error?: string }
   */
  app.post('/:id/test', async (request, reply) => {
    const user = getCurrentUser(request);
    const { id } = request.params as { id: string };

    const provider = getProviderById(id);
    if (!provider) {
      return reply.status(404).send({ error: `未找到 Provider: ${id}` });
    }

    try {
      const apiKey = await resolveApiKey(user.userId, provider);
      if (!apiKey) {
        return reply.status(400).send({
          success: false,
          error: `${provider.name} API Key 未配置，请在设置中配置或设置环境变量 ${provider.envVarKey}`,
        });
      }

      const transport = createTransport(provider, apiKey);
      const models = await transport.listModels();

      return reply.send({ success: true, models });
    } catch (err) {
      const message = err instanceof Error ? err.message : '连通性测试失败';
      logger.warn({ err, providerId: id }, `Provider ${id} 连通性测试失败`);
      return reply.send({ success: false, error: message });
    }
  });
}
