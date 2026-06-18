/**
 * 工具注册表
 *
 * 维护 AI 可调用的工具处理器集合，支持注册、按名称查找和枚举。
 * 所有工具在 initializeTools() 中注册到全局单例 toolRegistry。
 *
 * TODO: 在执行工具前校验用户角色与 handler.requiredRole 是否匹配，
 *   不匹配时返回权限不足错误。需从 ToolContext 或调用链中获取当前用户角色。
 */
import type { ToolHandler, ToolRegistry, ToolMetadata } from '../core/types/tools.js';

class DefaultToolRegistry implements ToolRegistry {
  private handlers = new Map<string, ToolHandler>();

  /** 注册工具处理器，同名处理器会被覆盖 */
  register(handler: ToolHandler): void {
    this.handlers.set(handler.name, handler);
  }

  /** 按名称查找工具处理器 */
  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  /** 按名称查找工具元数据 */
  getMetadata(name: string): ToolMetadata | undefined {
    return this.handlers.get(name)?.metadata;
  }

  /** 判断指定名称的工具是否已注册 */
  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /** 返回所有已注册工具的名称列表 */
  listNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /** 注销工具处理器（用于 MCP Server 断开时移除其工具） */
  unregister(name: string): boolean {
    return this.handlers.delete(name);
  }
}

/** 全局工具注册表单例 */
export const toolRegistry = new DefaultToolRegistry();
