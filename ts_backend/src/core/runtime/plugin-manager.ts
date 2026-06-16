/**
 * 插件管理器实现。
 *
 * 负责插件的注册、依赖拓扑排序、生命周期编排。
 *
 * 启动流程：
 * 1. register() 收集所有插件
 * 2. startAll() 拓扑排序 → 依次调用 install() → 依次调用 bootstrap()
 *
 * 关闭流程：
 * 1. stopAll() 按依赖逆序调用 destroy()
 *
 * @module core/runtime/plugin-manager
 */
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { Plugin, PluginMeta, PluginContext, PluginManager, PluginLogger } from './types.js';
import { eventManager } from '../events/manager.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('PluginManager');

/**
 * 创建插件上下文。
 * 每个插件获得独立的上下文实例，logger 自动带插件 ID 前缀。
 */
function createPluginContext(pluginId: string, app: FastifyInstance): PluginContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pinoLogger = logger.child({ module: pluginId }) as any;
  const pluginLogger: PluginLogger = {
    info: (msg: string, ...args: unknown[]) => pinoLogger.info(msg, ...args),
    warn: (msg: string, ...args: unknown[]) => pinoLogger.warn(msg, ...args),
    error: (msg: string | Error, ...args: unknown[]) => {
      if (msg instanceof Error) {
        pinoLogger.error(msg);
      } else {
        pinoLogger.error(msg, ...args);
      }
    },
    debug: (msg: string, ...args: unknown[]) => pinoLogger.debug(msg, ...args),
  };

  return {
    registerRoutes(prefix, routes) {
      pluginLogger.info(`注册路由: ${prefix || '/'}`);
      if (prefix) {
        app.register(routes as FastifyPluginCallback, { prefix });
      } else {
        app.register(routes as FastifyPluginCallback);
      }
    },

    emit(event, payload) {
      eventManager.emit(event, payload);
    },

    on(event, handler) {
      return eventManager.on(event, handler);
    },

    request(event, payload, timeoutMs) {
      return eventManager.request(event, payload, timeoutMs);
    },

    resolve(requestId, data) {
      eventManager.resolve(requestId, data);
    },

    getLogger() {
      return pluginLogger;
    },
  };
}

/**
 * 拓扑排序：根据依赖关系确定插件加载顺序。
 * 使用 Kahn 算法，检测循环依赖时抛出错误。
 */
function topologicalSort(plugins: Plugin[]): Plugin[] {
  const idMap = new Map<string, Plugin>();
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep → [plugins that depend on it]

  for (const p of plugins) {
    idMap.set(p.id, p);
    inDegree.set(p.id, 0);
    dependents.set(p.id, []);
  }

  // 计算入度
  for (const p of plugins) {
    for (const dep of p.dependencies) {
      if (!idMap.has(dep)) {
        if (p.optional) {
          logger.warn(`可选插件 [${p.id}] 依赖的 [${dep}] 不存在，跳过`);
          continue;
        }
        throw new Error(`插件 [${p.id}] 依赖 [${dep}]，但 [${dep}] 未注册`);
      }
      inDegree.set(p.id, (inDegree.get(p.id) ?? 0) + 1);
      dependents.get(dep)!.push(p.id);
    }
  }

  // Kahn 算法
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: Plugin[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(idMap.get(id)!);
    for (const dependent of dependents.get(id) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  if (sorted.length !== plugins.length) {
    const remaining = plugins.filter((p) => !sorted.includes(p)).map((p) => p.id);
    throw new Error(`检测到循环依赖: ${remaining.join(' → ')}`);
  }

  return sorted;
}

/** 插件管理器实现 */
export class DefaultPluginManager implements PluginManager {
  private plugins: Plugin[] = [];
  private sorted: Plugin[] = [];
  private contexts: Map<string, PluginContext> = new Map();
  private app: FastifyInstance | null = null;
  private started = false;

  register(plugin: Plugin): void {
    if (this.plugins.some((p) => p.id === plugin.id)) {
      return;
    }
    this.plugins.push(plugin);
    logger.info(`注册插件: ${plugin.name} (${plugin.id}@${plugin.version})`);
  }

  async startAll(app: FastifyInstance): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.app = app;
    this.sorted = topologicalSort(this.plugins);

    logger.info(`共 ${this.sorted.length} 个插件，加载顺序: ${this.sorted.map((p) => p.id).join(' → ')}`);

    // Install 阶段
    for (const plugin of this.sorted) {
      const ctx = createPluginContext(plugin.id, app);
      this.contexts.set(plugin.id, ctx);

      try {
        logger.info(`[${plugin.id}] install...`);
        await plugin.install(ctx);
        logger.info(`[${plugin.id}] install ✓`);
      } catch (err) {
        if (plugin.optional) {
          logger.warn(`可选插件 [${plugin.id}] install 失败，跳过: ${err}`);
          continue;
        }
        throw new Error(`插件 [${plugin.id}] install 失败: ${err}`);
      }
    }

    // Bootstrap 阶段
    for (const plugin of this.sorted) {
      if (!plugin.bootstrap) continue;
      const ctx = this.contexts.get(plugin.id);
      if (!ctx) continue; // 可选插件 install 失败时跳过

      try {
        logger.info(`[${plugin.id}] bootstrap...`);
        await plugin.bootstrap(ctx);
        logger.info(`[${plugin.id}] bootstrap ✓`);
      } catch (err) {
        if (plugin.optional) {
          logger.warn(`可选插件 [${plugin.id}] bootstrap 失败，跳过: ${err}`);
          continue;
        }
        throw new Error(`插件 [${plugin.id}] bootstrap 失败: ${err}`);
      }
    }

    logger.info('所有插件启动完成');
  }

  async stopAll(): Promise<void> {
    // 按依赖逆序销毁
    const reversed = [...this.sorted].reverse();
    for (const plugin of reversed) {
      if (!plugin.destroy) continue;
      const ctx = this.contexts.get(plugin.id);
      if (!ctx) continue;

      try {
        await plugin.destroy(ctx);
        logger.info(`[${plugin.id}] destroy ✓`);
      } catch (err) {
        logger.error(`[${plugin.id}] destroy 失败: ${err}`);
      }
    }
  }

  getPlugins(): ReadonlyArray<PluginMeta> {
    return this.plugins.map(({ id, version, name, dependencies, optional }) => ({
      id,
      version,
      name,
      dependencies,
      optional,
    }));
  }

  /** 重置管理器状态（仅用于测试），清除已注册插件和启动标记 */
  reset(): void {
    this.plugins = [];
    this.sorted = [];
    this.contexts.clear();
    this.started = false;
    this.app = null;
  }
}

/** 全局单例 */
export const pluginManager: PluginManager = new DefaultPluginManager();