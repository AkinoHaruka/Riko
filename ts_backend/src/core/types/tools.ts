/**
 * AI 工具系统的共享类型定义。
 *
 * 定义工具执行上下文、工具处理器接口、工具注册表接口。
 * 这些类型是 domain 层和 tools 层的共享契约，
 * 放在 core/types/ 以避免 domain → tools 的反向依赖。
 *
 * @module core/types/tools
 */

/** AI 工具执行上下文 */
export interface ToolContext {
  /** 当前会话 ID */
  conversationId: string;
  /** 允许操作的根目录绝对路径 */
  memoryRoot: string;
}

/** 工具调用结果 */
export interface ToolCallResult {
  /** 工具执行是否成功 */
  success: boolean;
  /** 允许扩展字段（如 content、isError 等） */
  [key: string]: unknown;
}

/** 工具处理器接口 */
export interface ToolHandler {
  /** 工具名称，需与 OpenAI function schema 中的 name 一致 */
  name: string;
  /** 可选的执行权限要求，未设置则所有已认证用户均可调用 */
  requiredRole?: string;
  /** 可选的前置参数校验，在 execute 之前调用 */
  validate?(
    args: Record<string, unknown>,
    context: ToolContext,
  ): { valid: boolean; error?: string };
  /** 执行工具逻辑并返回结果 */
  execute(args: Record<string, unknown>, context: ToolContext): ToolCallResult | Promise<ToolCallResult>;
}

/** 工具注册表接口 */
export interface ToolRegistry {
  /** 注册工具处理器 */
  register(handler: ToolHandler): void;
  /** 按名称查找工具处理器 */
  get(name: string): ToolHandler | undefined;
  /** 判断工具是否已注册 */
  has(name: string): boolean;
  /** 列出所有已注册工具的名称 */
  listNames(): string[];
  /** 注销工具处理器 */
  unregister(name: string): boolean;
}

/** 工具注册表注入函数类型 */
export type ToolRegistryProvider = () => ToolRegistry;
