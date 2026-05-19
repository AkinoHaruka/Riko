// 记忆文件扫描器：递归扫描记忆目录中的 .md 文件，解析 frontmatter 生成文件头列表
import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger/index.js';
import { parseFrontmatter } from '../core/validation/frontmatter.js';
import { MAX_MEMORY_FILES, FRONTMATTER_MAX_LINES, parseMemoryType } from './types.js';
import type { MemoryHeader } from './types.js';

export function scanMemoryFiles(memoryRoot: string): MemoryHeader[] {
  if (!fs.existsSync(memoryRoot)) {
    return [];
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(memoryRoot, { recursive: true }) as string[];
  } catch {
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
      const headLines = content.split('\n').slice(0, FRONTMATTER_MAX_LINES);
      const headContent = headLines.join('\n');

      const { frontmatter } = parseFrontmatter(headContent, filePath);

      const name = frontmatter.name != null ? String(frontmatter.name) : '';
      const description = frontmatter.description != null ? String(frontmatter.description) : null;
      const memType = parseMemoryType(frontmatter.type);

      results.push({
        filename: path.basename(relativePath),
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

  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results.slice(0, MAX_MEMORY_FILES);
}

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
