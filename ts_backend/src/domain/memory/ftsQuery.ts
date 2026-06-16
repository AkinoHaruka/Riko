/**
 * FTS5 全文搜索查询构建器
 *
 * 将自由文本转为 FTS5 MATCH 表达式。核心设计：
 * - 使用 Unicode 正则分词，覆盖 CJK 字符
 * - 每个 token 用双引号包裹为短语字面量，防止 FTS5 语法注入
 * - 所有 token 用 OR 连接（而非 AND），让 BM25 按匹配词数/稀有度排序
 * - 配合相对分数底线过滤噪声结果
 *
 * 移植自 MiMo-Code packages/opencode/src/memory/fts-query.ts
 */

/**
 * 将原始搜索文本构建为 FTS5 MATCH 表达式。
 *
 * @param raw - 用户输入的搜索文本
 * @returns FTS5 MATCH 表达式，无有效 token 时返回 null
 */
export function buildFtsQuery(raw: string): string | null {
  // Unicode 分词：提取连续的字母、数字、下划线序列
  // \p{L} 覆盖 CJK 字符，\p{N} 覆盖数字
  const tokens = raw.match(/[\p{L}\p{N}_]+/gu);
  if (!tokens || tokens.length === 0) return null;

  // 每个 token 用双引号包裹为短语字面量，移除内部双引号防止语法注入
  const phrases = tokens.map((t) => `"${t.replace(/"/g, '')}"`);

  // OR 连接：任一词匹配即可返回，BM25 按匹配质量排序
  return phrases.join(' OR ');
}
