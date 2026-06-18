/**
 * 工具 Policy Pipeline（3 层过滤，Riko 单用户场景简化为 2 层）。
 *
 * 根据上下文过滤工具可见性，避免向 AI 暴露不适用的工具：
 * 1. **Provider 层**：根据 Provider 能力过滤（如 Ollama 不支持 memorySearch）
 * 2. **Session 层**：根据会话类型过滤（如 compact 子代理仅允许只读工具）
 *
 * 原 spec 中的 User 层在 Riko 单用户本地应用中无意义，已省略。
 *
 * @module domain/chat/toolPolicy
 */
import type { ApiMode } from '../../core/ai/providers/types.js';

/** 会话类型，决定 Session 层过滤策略 */
export type SessionType = 'main' | 'compact' | 'session_memory' | 'dream';

/** 工具 Policy 上下文 */
export interface ToolPolicyContext {
  /** Provider ID（如 'deepseek'、'anthropic'、'ollama'） */
  providerId: string;
  /** API 协议类型 */
  apiMode: ApiMode;
  /** 会话类型，未指定时按 'main' 处理 */
  sessionType?: SessionType;
}

/** 可过滤的工具定义最小结构 */
interface FilterableTool {
  /** 工具名称 */
  name: string;
  /** 工具分类标签（来自 ToolMetadata.categories） */
  categories?: string[];
  /** 是否为只读工具（来自 ToolMetadata.readOnly） */
  readOnly?: boolean;
}

// ─── Provider 层过滤规则 ───

/**
 * Provider 层过滤规则：按 providerId 定义禁用的工具。
 *
 * 规则来源：
 * - ollama：本地模型，不支持记忆搜索（依赖后端 FTS5，但 Ollama 场景通常无后端数据库）
 *           实际上 Riko 后端始终有数据库，但 Ollama 用户通常不配置记忆功能，禁用避免误导
 */
const PROVIDER_DISABLED_TOOLS: Record<string, Set<string>> = {
  ollama: new Set(['SearchMemory', 'SkillsList', 'SkillView']),
};

/**
 * 应用 Provider 层过滤。
 *
 * @param tools - 原始工具列表
 * @param providerId - Provider ID
 * @returns 过滤后的工具列表
 */
function applyProviderPolicy<T extends FilterableTool>(tools: T[], providerId: string): T[] {
  const disabled = PROVIDER_DISABLED_TOOLS[providerId];
  if (!disabled || disabled.size === 0) return tools;
  return tools.filter((t) => !disabled.has(t.name));
}

// ─── Session 层过滤规则 ───

/**
 * 应用 Session 层过滤。
 *
 * 对于 compact/session_memory/dream 会话，仅保留只读工具。
 * 通过 ToolMetadata.readOnly 判断（若工具未声明 metadata，默认视为非只读，被过滤）。
 *
 * @param tools - 原始工具列表
 * @param sessionType - 会话类型
 * @returns 过滤后的工具列表
 */
function applySessionPolicy<T extends FilterableTool>(
  tools: T[],
  sessionType: SessionType,
): T[] {
  // main 会话不过滤
  if (sessionType === 'main') return tools;

  // 子代理会话：仅保留只读工具
  // 注意：readOnly 未定义时视为 false（保守策略，防止子代理调用写入工具）
  return tools.filter((t) => t.readOnly === true);
}

/**
 * 应用完整的工具 Policy Pipeline。
 *
 * 执行顺序：Provider 层 → Session 层（取交集）。
 * 两层过滤独立执行，结果取交集（即两层都允许的工具才保留）。
 *
 * @param tools - 原始工具列表
 * @param context - Policy 上下文
 * @returns 过滤后的工具列表（顺序保持不变）
 */
export function applyToolPolicy<T extends FilterableTool>(
  tools: T[],
  context: ToolPolicyContext,
): T[] {
  const sessionType: SessionType = context.sessionType ?? 'main';

  // Provider 层过滤
  let result = applyProviderPolicy(tools, context.providerId);

  // Session 层过滤
  result = applySessionPolicy(result, sessionType);

  return result;
}
