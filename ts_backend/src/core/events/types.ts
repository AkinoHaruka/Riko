/**
 * 事件系统类型定义。
 *
 * 包含 WebSocket 广播事件结构和进程内事件总线的类型。
 *
 * @module core/events/types
 */

/** WebSocket 广播事件的基本结构 */
export interface EventMessage {
  type: string;
  payload: unknown;
}

/** 事件处理器类型 */
export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

/** 取消订阅函数 */
export type Unsubscribe = () => void;

/**
 * 标准事件名称常量。
 * 插件之间通过这些事件通信，避免魔法字符串。
 *
 * 命名规范：{domain}.{action}
 * 请求/响应：{domain}.{action}:request / {domain}.{action}:response
 */
export const PluginEvents = {
  // 对话生命周期
  CONVERSATION_CREATED: 'conversation.created',
  CONVERSATION_ARCHIVED: 'conversation.archived',
  CONVERSATION_CLEARED: 'conversation.cleared',

  // 消息生命周期
  MESSAGE_RECEIVED: 'message.received',
  MESSAGE_STREAMING: 'message.streaming',
  MESSAGE_COMPLETED: 'message.completed',

  // 后台任务触发
  COMPACT_REQUESTED: 'compact.requested',
  SESSION_MEMORY_REQUESTED: 'sessionMemory.requested',
  DREAM_REQUESTED: 'dream.requested',
  DREAM_COMPLETED: 'dream.completed',

  // 设置变更
  SETTING_CHANGED: 'setting.changed',

  // 子代理活动
  SUB_AGENT_STARTED: 'subAgent.started',
  SUB_AGENT_COMPLETED: 'subAgent.completed',

  // 请求/响应模式
  MEMORY_SEARCH: 'memory.search',
  SETTING_GET: 'setting.get',

  // 后采样钩子（chat → compact/sessionMemory/autoDream）
  // 分阶段串行：compact 先执行，完成后再触发 sessionMemory，避免并发写 messages 表
  CHAT_POST_SAMPLING: 'chat.postSampling',
  CHAT_POST_COMPACT: 'chat.postCompact',
  CHAT_POST_SESSION_MEMORY: 'chat.postSessionMemory',

  // MCP 事件
  MCP_SERVER_CONNECTED: 'mcp:server:connected',
  MCP_SERVER_DISCONNECTED: 'mcp:server:disconnected',
  MCP_SERVER_ERROR: 'mcp:server:error',
  MCP_TOOL_CALLED: 'mcp:tool:called',

  // 技能事件
  SKILL_LOADED: 'skill:loaded',
  SKILL_ERROR: 'skill:error',

  // 安全事件
  SECURITY_THREAT_DETECTED: 'security:threat:detected',
  SECURITY_GUARDRAIL_BLOCKED: 'security:guardrail:blocked',
} as const;
