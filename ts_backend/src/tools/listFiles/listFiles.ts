// 记忆文件列表工具：扫描记忆目录中的 .md 文件，解析 frontmatter，按修改时间排序
import fs from 'fs';
import path from 'path';
import { validateCommonPath, resolveVirtualPath } from '../../core/validation/path.js';
import { parseFrontmatter, parseMemoryType } from '../../core/validation/frontmatter.js';
import {
  MAX_MEMORY_FILES,
  FRONTMATTER_READ_LINES,
  PATH_UNSAFE,
  PATH_OUTSIDE_ROOT,
  PATH_NOT_FOUND,
} from '../types.js';
import type { MemoryHeader, LsRequest, LsResult, LsError, LsResponse } from '../types.js';

export function coerceToStringOrNull(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (
    Array.isArray(value) ||
    (typeof value === 'object' && value !== null && value.constructor === Object)
  ) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

export function scanMemoryFiles(
  memoryRoot: string,
  subPath: string = '',
  maxFiles: number = MAX_MEMORY_FILES,
): MemoryHeader[] {
  const rootResolved = path.resolve(memoryRoot);

  let scanRoot: string;
  if (!subPath || subPath === '.') {
    scanRoot = rootResolved;
  } else {
    const { resolvedPath, error } = validateCommonPath(subPath, memoryRoot);
    if (error || !resolvedPath) {
      return [];
    }
    scanRoot = resolvedPath;
  }

  if (!fs.existsSync(scanRoot) || !fs.statSync(scanRoot).isDirectory()) {
    return [];
  }

  const entries: Array<{ filepath: string; mtimeMs: number }> = [];

  function walkDir(dir: string): void {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      const fullPath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        walkDir(fullPath);
      } else if (dirent.isFile() && dirent.name.endsWith('.md')) {
        try {
          const stat = fs.statSync(fullPath);
          entries.push({ filepath: fullPath, mtimeMs: stat.mtimeMs });
        } catch {
          continue;
        }
      }
    }
  }

  walkDir(scanRoot);

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const topEntries = entries.slice(0, maxFiles);

  const headers: MemoryHeader[] = [];
  for (const entry of topEntries) {
    try {
      const fileContent = fs.readFileSync(entry.filepath, 'utf-8');
      const fileLines = fileContent.split('\n');
      const headLines = fileLines.slice(0, FRONTMATTER_READ_LINES);
      const headContent = headLines.join('\n');

      const parsed = parseFrontmatter(headContent, entry.filepath);
      const fm = parsed.frontmatter;

      const description = coerceToStringOrNull(fm['description']);
      const memoryType = parseMemoryType(fm['type']);

      let relPath = path.relative(rootResolved, entry.filepath);
      relPath = relPath.replace(/\\/g, '/');

      headers.push({
        filename: relPath,
        mtime_ms: entry.mtimeMs,
        description,
        memory_type: memoryType,
      });
    } catch {
      continue;
    }
  }

  return headers;
}

export function formatMemoryManifest(headers: MemoryHeader[]): string {
  const lines: string[] = [];

  for (const h of headers) {
    const dt = new Date(h.mtime_ms);
    const isoTs = dt.toISOString();

    const typePart = h.memory_type ? `[${h.memory_type}] ` : '';
    const descPart = h.description ? `: ${h.description}` : '';

    lines.push(`- ${typePart}${h.filename} (${isoTs})${descPart}`);
  }

  return lines.join('\n');
}

export function executeLs(request: LsRequest): LsResponse {
  const reqPath = request.path ?? '';

  const virtual = resolveVirtualPath(reqPath);
  const memoryRoot = virtual.physicalRoot;
  const relativePath = virtual.relativePath;

  if (reqPath && reqPath !== '.') {
    const { resolvedPath, error: pathError } = validateCommonPath(relativePath, memoryRoot);
    if (pathError) {
      return {
        success: false,
        error_code: pathError,
        message: errorMessage(pathError, reqPath),
      } as LsError;
    }
    if (!fs.existsSync(resolvedPath!)) {
      return {
        success: false,
        error_code: PATH_NOT_FOUND,
        message: errorMessage(PATH_NOT_FOUND, reqPath),
      } as LsError;
    }
  }

  const headers = scanMemoryFiles(memoryRoot, relativePath);
  const manifest = formatMemoryManifest(headers);

  return {
    success: true,
    files: headers,
    manifest,
    total: headers.length,
  } as LsResult;
}

function errorMessage(errorCode: string, filePath: string): string {
  const messages: Record<string, string> = {
    [PATH_UNSAFE]: `路径不安全: ${filePath}`,
    [PATH_OUTSIDE_ROOT]: `路径超出根目录范围: ${filePath}`,
    [PATH_NOT_FOUND]: `路径不存在: ${filePath}`,
  };
  return messages[errorCode] ?? `未知错误: ${errorCode}`;
}
