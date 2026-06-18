/**
 * Prompt Cache 检测与断点规划。
 *
 * 检测当前 Provider 是否支持 Prompt Cache，并为支持的 Provider 规划 cache_control 断点位置。
 * 当前仅 Anthropic 支持 Prompt Cache，采用 `system_and_3` 策略（最多 4 个断点）：
 *   1. System prompt 末尾（主提示词 + 工具规则 + 常驻记忆）
 *   2. 工具定义列表末尾
 *   3. compact 摘要末尾（若存在）
 *   4. 最近 N 条消息末尾（N 由 Provider 决定）
 *
 * 断点位置仅作为元数据返回，由 Transport 层（如 AnthropicTransport）负责实际注入 cache_control 字段。
 *
 * @module domain/chat/promptCache
 */
import type { ApiMode } from '../../core/ai/providers/types.js';

/** cache_control 断点位置标识 */
export type CacheBreakpointPosition = 'system' | 'tools' | 'compact' | 'recent';

/** 单个 cache_control 断点描述 */
export interface CacheBreakpoint {
  /** 断点位置语义 */
  position: CacheBreakpointPosition;
  /**
   * 断点所在数组中的索引：
   * - system：固定为 0（system 段在 Anthropic 中是单独字段，索引无意义，保留为 0）
   * - tools：tools 数组中最后一个工具的索引
   * - compact：messages 数组中 compact 摘要消息的索引
   * - recent：messages 数组中最近 N 条消息的末尾索引
   */
  index: number;
}

/** Provider 的 Prompt Cache 能力描述 */
export interface CacheCapability {
  /** 是否支持 Prompt Cache */
  supports: boolean;
  /** 支持的断点策略，当前仅 'system_and_3' */
  strategy?: 'system_and_3';
  /** 最近消息断点建议保留的消息数（仅 supports=true 时有意义） */
  recentMessageCount?: number;
}

/** Anthropic 最近消息断点建议保留的消息数（官方建议 10 条左右） */
const ANTHROPIC_RECENT_MESSAGE_COUNT = 10;

/**
 * 检测指定 apiMode 的 Provider 是否支持 Prompt Cache。
 *
 * 当前实现：
 * - `anthropic-messages` → 支持，策略 `system_and_3`，最近 10 条
 * - 其他 → 不支持
 *
 * @param apiMode - Provider 的 API 协议类型
 * @returns CacheCapability 描述
 */
export function detectCacheCapability(apiMode: ApiMode): CacheCapability {
  if (apiMode === 'anthropic-messages') {
    return {
      supports: true,
      strategy: 'system_and_3',
      recentMessageCount: ANTHROPIC_RECENT_MESSAGE_COUNT,
    };
  }
  return { supports: false };
}

/**
 * 规划 system_and_3 策略的 cache_control 断点。
 *
 * 根据请求中实际存在的段落，按以下顺序生成断点（最多 4 个）：
 * 1. system 段末尾（仅当 hasSystem=true）
 * 2. tools 段末尾（仅当 hasTools=true）
 * 3. compact 段末尾（仅当 hasCompact=true）
 * 4. recent 段末尾（仅当 recentMessageCount>0）
 *
 * Anthropic 限制最多 4 个 cache_control 断点，超出会被拒绝。
 * 本函数严格按上述顺序生成，调用方需保证传入参数反映真实请求结构。
 *
 * @param params - 请求结构描述
 * @returns 断点列表（按位置顺序排列，可能少于 4 个）
 */
export function planSystemAnd3Breakpoints(params: {
  hasSystem: boolean;
  hasTools: boolean;
  hasCompact: boolean;
  recentMessageCount: number;
}): CacheBreakpoint[] {
  const breakpoints: CacheBreakpoint[] = [];

  // 1. system 段：Anthropic 中 system 是单独字段，index 仅占位
  if (params.hasSystem) {
    breakpoints.push({ position: 'system', index: 0 });
  }

  // 2. tools 段：最后一个工具的索引
  if (params.hasTools) {
    // tools 数组长度未知，由调用方在注入时计算末尾索引；
    // 这里返回 -1 作为占位符，表示"末尾"，由 Transport 层解析
    breakpoints.push({ position: 'tools', index: -1 });
  }

  // 3. compact 段：compact 摘要在 messages 中的索引
  if (params.hasCompact) {
    // compact 摘要位置由调用方在注入时确定，这里返回 -1 作为占位符
    breakpoints.push({ position: 'compact', index: -1 });
  }

  // 4. recent 段：最近 N 条消息的末尾索引
  if (params.recentMessageCount > 0) {
    // recent 段位置由调用方在注入时确定，这里返回 -1 作为占位符
    breakpoints.push({ position: 'recent', index: -1 });
  }

  // Anthropic 限制最多 4 个断点，按优先级保留前 4 个
  // 优先级顺序：system > tools > compact > recent（前面的更稳定，缓存价值更高）
  return breakpoints.slice(0, 4);
}

/**
 * 便捷方法：根据 apiMode 和请求结构，返回应注入的断点列表。
 * 不支持 Prompt Cache 的 Provider 返回空数组。
 *
 * @param apiMode - Provider 的 API 协议类型
 * @param params - 请求结构描述
 * @returns 断点列表（不支持时为空数组）
 */
export function planCacheBreakpoints(
  apiMode: ApiMode,
  params: {
    hasSystem: boolean;
    hasTools: boolean;
    hasCompact: boolean;
    recentMessageCount: number;
  },
): CacheBreakpoint[] {
  const capability = detectCacheCapability(apiMode);
  if (!capability.supports || capability.strategy !== 'system_and_3') {
    return [];
  }
  // 使用 Provider 建议的 recentMessageCount，但若调用方传入更小的值则尊重调用方
  const effectiveRecent = Math.min(
    params.recentMessageCount,
    capability.recentMessageCount ?? params.recentMessageCount,
  );
  return planSystemAnd3Breakpoints({
    ...params,
    recentMessageCount: effectiveRecent,
  });
}
