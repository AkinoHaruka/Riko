import fs from 'fs';
import path from 'path';
import { getAutoDreamRoot } from '../../memoryStorage/paths.js';

export interface SearchMemoryRequest {
  query: string;
  type?: string;
}

export interface SearchMemoryResult {
  success: boolean;
  matches?: Array<{ file: string; line: string }>;
  message?: string;
}

const MAX_FILE_BYTES = 512 * 1024; // 512KB per file limit
const MAX_MATCHES = 100;
const CONTEXT_LINES = 1;

function* walkMdFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMdFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield fullPath;
    }
  }
}

export function executeSearchMemory(req: SearchMemoryRequest): SearchMemoryResult {
  const memoryRoot = getAutoDreamRoot();

  if (!fs.existsSync(memoryRoot)) {
    return { success: true, matches: [], message: '长期记忆目录尚不存在' };
  }

  const searchPath = req.type ? path.join(memoryRoot, req.type) : memoryRoot;

  if (req.type && !fs.existsSync(searchPath)) {
    return { success: true, matches: [], message: `记忆类型目录不存在: ${req.type}` };
  }

  const query = req.query.trim();
  if (!query) {
    return { success: false, message: '搜索关键词不能为空' };
  }

  // Escape special regex characters for literal search
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let compiled: RegExp;
  try {
    compiled = new RegExp(escapedQuery, 'i');
  } catch {
    return { success: false, message: `无效的搜索关键词: ${query}` };
  }

  const matches: Array<{ file: string; line: string }> = [];

  for (const filePath of walkMdFiles(searchPath)) {
    if (matches.length >= MAX_MATCHES) break;

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_BYTES) continue;
    } catch {
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const relPath = path.relative(searchPath, filePath);
    const matchedIndices = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
      if (compiled.test(lines[i])) {
        matchedIndices.add(i);
      }
    }

    if (matchedIndices.size === 0) continue;

    // Collect lines with context
    const displayIndices = new Set<number>();
    for (const idx of matchedIndices) {
      for (
        let ci = Math.max(0, idx - CONTEXT_LINES);
        ci <= Math.min(lines.length - 1, idx + CONTEXT_LINES);
        ci++
      ) {
        displayIndices.add(ci);
      }
    }

    const sorted = Array.from(displayIndices).sort((a, b) => a - b);
    for (const idx of sorted) {
      if (matches.length >= MAX_MATCHES) break;
      matches.push({ file: relPath, line: lines[idx].slice(0, 200) });
    }
  }

  return { success: true, matches };
}
