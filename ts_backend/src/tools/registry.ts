// 工具注册表：维护 AI 可用的工具处理器集合，支持注册/查找/枚举
import type { ToolHandler, ToolRegistry } from './types.js';

class DefaultToolRegistry implements ToolRegistry {
  private handlers = new Map<string, ToolHandler>();

  register(handler: ToolHandler): void {
    this.handlers.set(handler.name, handler);
  }

  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  listNames(): string[] {
    return Array.from(this.handlers.keys());
  }
}

export const toolRegistry = new DefaultToolRegistry();
