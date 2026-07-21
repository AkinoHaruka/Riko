/**
 * SearchMemory 工具的 ToolHandler 实现
 *
 * 将 AI 的工具调用参数转换为搜索请求，
 * 同时使用 FTS5 全文搜索和文件扫描搜索，合并结果。
 * FTS5 提供语义排序和数据库记忆搜索，文件扫描提供 .md 文件的逐行匹配。
 */
import type { ToolHandler, ToolContext, ToolCallResult } from '../types.js';
import { executeSearchMemory } from './searchMemory.js';
import { ftsSearch } from '../../domain/memory/ftsSearch.js';

export const memorySearchToolHandler: ToolHandler = {
  name: 'SearchMemory',
  metadata: { readOnly: true, mutating: false, categories: ['memory'] },

  /** 执行长期记忆搜索（FTS5 + 文件扫描混合） */
  execute(args: Record<string, unknown>, context: ToolContext): ToolCallResult {
    const query = (args.query as string) ?? '';
    const type = args.type as string | undefined;

    // FTS5 全文搜索：覆盖数据库记忆 + 已索引的文件记忆
    // userId 来自 ToolContext，用于按 user_id 过滤记忆（多用户隔离）；
    // 单用户场景下 userId 可能为 undefined，ftsSearch 会跳过 user_id 过滤条件。
    const ftsResults = ftsSearch(query, {
      limit: 10,
      userId: context.userId,
      type,
    });

    // 文件扫描搜索：覆盖 auto_dream/ 目录下的 .md 文件
    const fileResult = executeSearchMemory({ query, type });

    // 合并结果：FTS5 结果优先（有相关性排序），文件扫描结果补充
    const ftsMatches = ftsResults.map((r) => ({
      source: r.source,
      id: r.id,
      snippet: r.snippet,
      score: r.score,
      key: r.key,
      content: r.content?.slice(0, 300),
    }));

    const fileMatches = fileResult.matches?.map((m) => ({
      source: 'file',
      file: m.file,
      line: m.line,
    })) ?? [];

    return {
      success: true,
      fts_matches: ftsMatches,
      file_matches: fileMatches,
      message: ftsMatches.length > 0
        ? `找到 ${ftsMatches.length} 条相关记忆（FTS5）+ ${fileMatches.length} 条文件匹配`
        : fileResult.message ?? `文件扫描找到 ${fileMatches.length} 条匹配`,
    } as unknown as ToolCallResult;
  },
};
