/**
 * 记忆文件扫描器
 *
 * 递归扫描记忆目录中的 .md 文件，解析 YAML frontmatter 提取文件头信息，
 * 生成按修改时间排序的 MemoryHeader 列表。用于梦境合并时获取当前记忆全貌。
 */
import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger/index.js';
import { parseFrontmatter } from '../core/validation/frontmatter.js';
import { MAX_MEMORY_FILES, FRONTMATTER_MAX_LINES, parseMemoryType } from './types.js';
import type { MemoryHeader } from './types.js';

/**
 * 扫描指定记忆目录下的所有 .md 文件，解析 frontmatter 生成文件头列表。
 *
 * - 跳过 MEMORY.md 和 INDEX.md（它们是索引文件，不是记忆条目）
 * - 只读取文件前 FRONTMATTER_MAX_LINES 行，避免大文件拖慢扫描
 * - 结果按修改时间降序排列，取前 MAX_MEMORY_FILES 条
 */
export function scanMemoryFiles(memoryRoot: string): MemoryHeader[] {
  if (!fs.existsSync(memoryRoot)) {
    return [];
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(memoryRoot, { recursive: true }) as string[];
  } catch (e) {
    logger.warn('读取记忆目录失败 %s: %s', memoryRoot, e);
    return [];
  }

  const mdFiles = entries.filter(
    (f) => f.endsWith('.md') && !['MEMORY.md', 'INDEX.md'].includes(path.basename(f)),
  );

  const results: MemoryHeader[] = [];

  for (const relativePath of mdFiles) {
    const filePath = path.join(memoryRoot, relativePath);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      // 只取前 N 行用于解析 frontmatter，避免读取整个大文件
      const headLines = content.split('\n').slice(0, FRONTMATTER_MAX_LINES);
      const headContent = headLines.join('\n');

      const { frontmatter } = parseFrontmatter(headContent, filePath);

      const name = frontmatter.name != null ? String(frontmatter.name) : '';
      const description = frontmatter.description != null ? String(frontmatter.description) : null;
      const memType = parseMemoryType(frontmatter.type);

      results.push({
        filename: path.basename(relativePath),
        // 统一使用正斜杠，保证跨平台路径一致性
        filePath: relativePath.replace(/\\/g, '/'),
        mtimeMs: stat.mtimeMs,
        name,
        description,
        type: memType,
      });
    } catch (e) {
      logger.warn(`扫描记忆文件失败 ${filePath}: ${e}`);
    }
  }

  // 按修改时间降序排列，最新的排在前面
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results.slice(0, MAX_MEMORY_FILES);
}

/**
 * 将记忆文件头列表格式化为可读的清单文本。
 *
 * 每行格式：`- [类型] 文件名 (ISO时间): 描述`
 * 用于梦境合并提示词中展示当前记忆概况。
 */
export function formatMemoryManifest(memories: MemoryHeader[]): string {
  if (memories.length === 0) {
    return '';
  }

  return memories
    .map((m) => {
      const typeTag = m.type ?? 'unknown';
      const ts = new Date(m.mtimeMs).toISOString();
      const desc = m.description ?? '';
      return `- [${typeTag}] ${m.filename} (${ts}): ${desc}`;
    })
    .join('\n');
}
