/**
 * 工具顺序稳定化与缓存键计算。
 *
 * 不同轮次中，工具定义的注册顺序可能因 MCP Server 连接时机、运行时动态注册等因素而不同，
 * 但工具集合本身不变。这会导致 Prompt Cache 的工具段缓存键变化，命中率下降。
 *
 * 本模块通过字典序排序稳定化工具定义顺序，并计算稳定的缓存键，
 * 使相同工具集合（无论原始顺序）生成相同的缓存键，提升缓存命中率。
 *
 * @module domain/chat/toolStability
 */
import crypto from 'crypto';

/** 可排序的工具定义最小结构 */
interface SortableTool {
  /** 工具名称 */
  name: string;
  /** 工具描述（可选，用于次级排序） */
  description?: string;
}

/**
 * 稳定化工具定义顺序。
 *
 * 排序规则（按优先级）：
 * 1. 按 `name` 字典序升序
 * 2. 同名工具按 `description` 长度升序（短的在前，减少缓存键体积）
 *
 * 返回新数组，不修改原数组。
 *
 * @param tools - 原始工具定义列表
 * @returns 排序后的工具定义列表
 */
export function stabilizeToolOrder<T extends SortableTool>(tools: T[]): T[] {
  return [...tools].sort((a, b) => {
    // 主排序：name 字典序
    const nameCompare = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    if (nameCompare !== 0) return nameCompare;

    // 次排序：description 长度（短的在前，undefined 视为最长）
    const lenA = a.description?.length ?? Number.MAX_SAFE_INTEGER;
    const lenB = b.description?.length ?? Number.MAX_SAFE_INTEGER;
    return lenA - lenB;
  });
}

/**
 * 计算工具定义列表的稳定缓存键。
 *
 * 缓存键基于工具的 `name` + `description` + `parameters` 的稳定序列化，
 * 使用 SHA-256 哈希压缩为 64 字符十六进制字符串。
 * 键序无关：相同工具集合（不同顺序）生成相同缓存键。
 *
 * 实现细节：
 * 1. 对工具列表按 name 排序（键序无关）
 * 2. 对每个工具的 parameters 做键序无关序列化（stableStringify）
 * 3. 拼接后计算 SHA-256
 *
 * @param tools - 工具定义列表
 * @returns 64 字符十六进制 SHA-256 哈希
 */
export function computeToolCacheKey(tools: unknown[]): string {
  // 按 name 排序，确保键序无关
  const sorted = [...tools].sort((a, b) => {
    const nameA = (a as { function?: { name?: string } })?.function?.name ?? '';
    const nameB = (b as { function?: { name?: string } })?.function?.name ?? '';
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
  });

  // 序列化每个工具，使用稳定序列化确保 parameters 键序无关
  const serialized = sorted.map((tool) => {
    const t = tool as {
      type?: string;
      function?: { name?: string; description?: string; parameters?: unknown };
    };
    return JSON.stringify({
      type: t.type ?? 'function',
      function: {
        name: t.function?.name ?? '',
        description: t.function?.description ?? '',
        parameters: stableStringify(t.function?.parameters),
      },
    });
  });

  const payload = serialized.join('\n');
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * 键序无关的对象序列化。
 *
 * 对象的键按字典序排序后序列化，确保 `{a:1,b:2}` 与 `{b:2,a:1}` 生成相同字符串。
 * 用于计算工具参数的稳定哈希，避免参数键序差异导致缓存键变化。
 *
 * @param obj - 任意值
 * @returns 键序无关的 JSON 字符串
 */
export function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}
