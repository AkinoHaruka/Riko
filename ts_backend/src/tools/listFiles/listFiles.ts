/**
 * 记忆文件列表工具核心实现
 *
 * 扫描记忆目录中的 .md 文件，解析 frontmatter 提取描述和类型信息，
 * 按修改时间降序排列，并生成人类可读的文件清单文本。
 * 结果数量限制为 MAX_MEMORY_FILES，避免返回过多数据。
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { validateCommonPath, resolveVirtualPath } from '../../core/validation/path.js';
import { parseFrontmatter } from '../../core/validation/frontmatter.js';
import { parseMemoryType } from '../../memoryStorage/types.js';
import {
  MAX_MEMORY_FILES,
  FRONTMATTER_READ_LINES,
  PATH_UNSAFE,
  PATH_OUTSIDE_ROOT,
  PATH_NOT_FOUND,
} from '../types.js';
import type { MemoryHeader, LsRequest, LsResult, LsError, LsResponse } from '../types.js';

/**
 * 将 frontmatter 值安全地转换为字符串或 null。
 * 数组和纯对象类型返回 null，因为它们不适合作为描述或类型字段。
 */
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

/**
 * 扫描记忆目录中的 .md 文件并提取头部摘要信息。
 *
 * 使用 readline 只读取每个文件的前 FRONTMATTER_READ_LINES 行来解析 frontmatter，
 * 避免读取大文件的完整内容。结果按修改时间降序排列，
 * 最多返回 maxFiles 个文件。
 *
 * @param memoryRoot - 记忆根目录的绝对路径
 * @param subPath    - 子目录相对路径，空或 '.' 表示根目录
 * @param maxFiles   - 最大返回文件数
 * @returns 文件头部摘要列表
 */
export async function scanMemoryFiles(
  memoryRoot: string,
  subPath: string = '',
  maxFiles: number = MAX_MEMORY_FILES,
): Promise<MemoryHeader[]> {
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

  /** 递归遍历目录，收集 .md 文件路径和修改时间 */
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

  // 按修改时间降序排列，取前 maxFiles 个
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const topEntries = entries.slice(0, maxFiles);

  const headers: MemoryHeader[] = [];
  for (const entry of topEntries) {
    try {
      // 使用 readline 只读前 FRONTMATTER_READ_LINES 行，避免读取整个大文件
      const lines: string[] = [];
      const rl = readline.createInterface({
        input: fs.createReadStream(entry.filepath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });
      for await (const line of rl) {
        lines.push(line);
        if (lines.length >= FRONTMATTER_READ_LINES) {
          rl.close();
          break;
        }
      }
      const headContent = lines.join('\n');

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

/**
 * 将文件头部摘要列表格式化为人类可读的清单文本。
 *
 * 格式：- [type] filename (ISO时间): description
 *
 * @param headers - 文件头部摘要列表
 * @returns 格式化的清单文本
 */
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

/**
 * 执行记忆文件列表查询。
 *
 * @param request - 包含可选路径参数的请求
 * @returns 文件列表和格式化清单，或错误信息
 */
export async function executeLs(request: LsRequest): Promise<LsResponse> {
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

  const headers = await scanMemoryFiles(memoryRoot, relativePath);
  const manifest = formatMemoryManifest(headers);

  return {
    success: true,
    files: headers,
    manifest,
    total: headers.length,
  } as LsResult;
}

/** 根据错误代码生成人类可读的错误消息 */
function errorMessage(errorCode: string, filePath: string): string {
  const messages: Record<string, string> = {
    [PATH_UNSAFE]: `路径不安全: ${filePath}`,
    [PATH_OUTSIDE_ROOT]: `路径超出根目录范围: ${filePath}`,
    [PATH_NOT_FOUND]: `路径不存在: ${filePath}`,
  };
  return messages[errorCode] ?? `未知错误: ${errorCode}`;
}
