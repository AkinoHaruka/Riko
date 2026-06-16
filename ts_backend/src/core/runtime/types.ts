/**
 * 插件系统类型定义。
 *
 * 定义插件元数据、生命周期、上下文和管理器接口。
 * 所有插件必须实现 PluginLifecycle，通过 PluginContext 与核心层交互。
 *
 * @module core/runtime/types
 */
import type { FastifyInstance } from 'fastify';
import type { EventHandler, Unsubscribe } from '../events/types.js';

// ─── 插件元数据 ──────────────────────────────────────────────

/** 插件元数据 */
export interface PluginMeta {
  /** 插件唯一标识，如 'auth', 'monitor', 'chat' */
  id: string;
  /** 语义化版本 */
  version: string;
  /** 人类可读名称 */
  name: string;
  /** 依赖的其他插件 ID（按加载顺序排列） */
  dependencies: string[];
  /** 插件是否可选（允许加载失败不阻塞启动） */
  optional?: boolean;
}

// ─── 插件生命周期 ──────────────────────────────────────────────

/**
 * 插件生命周期钩子。
 *
 * - install: 注册路由、工具、设置项、事件监听。此时插件还未运行。
 * - bootstrap: 所有插件 install 完成后按依赖顺序调用。可安全访问其他插件资源。
 * - destroy: 清理定时器、关闭连接、释放资源。
 */
export interface PluginLifecycle {
  /**
   * 安装阶段：注册路由、工具、设置项、订阅事件。
   * 此时其他插件可能尚未安装，不可访问其他插件注册的资源。
   */
  install(ctx: PluginContext): Promise<void>;

  /**
   * 启动阶段：所有插件 install 完成后，按依赖顺序调用。
   * 此时可安全地访问其他插件注册的资源。
   */
  bootstrap?(ctx: PluginContext): Promise<void>;

  /**
   * 销毁阶段：清理定时器、关闭连接、释放资源。
   * 按依赖逆序调用。
   */
  destroy?(ctx: PluginContext): Promise<void>;
}

// ─── 插件上下文 ──────────────────────────────────────────────

/**
 * 插件上下文：核心层注入给插件的唯一接口。
 * 插件通过上下文与核心交互，不直接 import 核心模块。
 */
export interface PluginContext {
  // --- 路由注册 ---
  /** 注册 Fastify 子路由（带可选前缀） */
  registerRoutes(prefix: string, routes: (app: FastifyInstance) => Promise<void>): void;

  // --- 事件通信 ---
  /** 发布事件（通知所有订阅者 + WebSocket 广播） */
  emit<T = unknown>(event: string, payload: T): void;
  /** 订阅事件 */
  on<T = unknown>(event: string, handler: EventHandler<T>): Unsubscribe;
  /** 请求-响应模式 */
  request<T = unknown, R = unknown>(event: string, payload: T, timeoutMs?: number): Promise<R>;
  /** 响应请求 */
  resolve<T = unknown>(requestId: string, data: T): void;

  // --- 日志 ---
  /** 获取插件专属 logger（自动加 [PluginId] 前缀） */
  getLogger(): PluginLogger;
}

/** 插件日志接口 */
export interface PluginLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

// ─── 组合类型 ──────────────────────────────────────────────

/** 完整插件定义 = 元数据 + 生命周期 */
export type Plugin = PluginMeta & PluginLifecycle;

// ─── 插件管理器 ──────────────────────────────────────────────

/** 插件管理器接口 */
export interface PluginManager {
  /** 注册插件 */
  register(plugin: Plugin): void;
  /** 按依赖拓扑排序后依次调用 install → bootstrap */
  startAll(app: FastifyInstance): Promise<void>;
  /** 按依赖逆序调用 destroy */
  stopAll(): Promise<void>;
  /** 获取已注册插件列表 */
  getPlugins(): ReadonlyArray<PluginMeta>;
  /** 重置管理器状态（仅用于测试） */
  reset(): void;
}
