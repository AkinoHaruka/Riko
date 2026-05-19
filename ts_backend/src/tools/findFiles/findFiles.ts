// 文件查找工具：按 glob 模式匹配文件名，支持 ** 递归通配，结果按修改时间排序
import fs from 'fs';
import path from 'path';
import { validateCommonPath } from '../../core/validation/path.js';
import {
  PATH_UNSAFE,
  PATH_OUTSIDE_ROOT,
  PATH_NOT_FOUND,
  NOT_A_DIRECTORY,
  VCS_DIRECTORIES,
} from '../types.js';
import type { FindRequest, FindResult, FindError, FindResponse } from '../types.js';

const VCS_SET: ReadonlySet<string> = new Set(VCS_DIRECTORIES);

export function validateFindPath(
  filePath: string,
  memoryRoot: string,
): [resolvedPath: string | null, errorCode: string | null] {
  const { resolvedPath, error } = validateCommonPath(filePath, memoryRoot);
  if (error !== null) {
    return [null, error];
  }

  try {
    const stat = fs.statSync(resolvedPath!);
    if (!stat.isDirectory()) {
      return [null, NOT_A_DIRECTORY];
    }
  } catch {
    return [null, PATH_NOT_FOUND];
  }

  return [resolvedPath, null];
}

export function extractGlobBaseDirectory(
  pattern: string,
): [baseDir: string, relativePattern: string] {
  const globChars = ['*', '?', '[', '{'];
  let minPos = pattern.length;
  for (const ch of globChars) {
    const pos = pattern.indexOf(ch);
    if (pos !== -1 && pos < minPos) {
      minPos = pos;
    }
  }

  if (minPos < pattern.length) {
    const baseDir = pattern.slice(0, minPos).replace(/[/\\]+$/, '');
    const relativePattern = pattern.slice(minPos).replace(/^[/\\]+/, '');
    return [baseDir, relativePattern];
  }

  const sepPos = Math.max(pattern.lastIndexOf('/'), pattern.lastIndexOf('\\'));
  if (sepPos !== -1) {
    return [pattern.slice(0, sepPos), pattern.slice(sepPos + 1)];
  }
  return ['', pattern];
}

function fnmatchStyle(name: string, pat: string): boolean {
  const regexStr = pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/\?/g, '[^/\\\\]');
  try {
    return new RegExp(`^${regexStr}$`).test(name);
  } catch {
    return false;
  }
}

function matchParts(
  pathParts: readonly string[],
  pi: number,
  patternParts: readonly string[],
  gi: number,
): boolean {
  if (gi === patternParts.length && pi === pathParts.length) {
    return true;
  }
  if (gi === patternParts.length) {
    return false;
  }
  if (patternParts[gi] === '**') {
    if (gi + 1 === patternParts.length) {
      return true;
    }
    for (let skip = pi; skip <= pathParts.length; skip++) {
      if (matchParts(pathParts, skip, patternParts, gi + 1)) {
        return true;
      }
    }
    return false;
  }
  if (pi === pathParts.length) {
    return false;
  }
  if (fnmatchStyle(pathParts[pi], patternParts[gi])) {
    return matchParts(pathParts, pi + 1, patternParts, gi + 1);
  }
  return false;
}

export function globMatch(relPath: string, pattern: string): boolean {
  if (!pattern.includes('**')) {
    return fnmatchStyle(relPath, pattern);
  }

  const normalizedPath = relPath.replace(/\\/g, '/');
  const patternParts = pattern.split('/');
  const pathParts = normalizedPath.split('/').filter(Boolean);
  return matchParts(pathParts, 0, patternParts, 0);
}

export function errorMessage(errorCode: string, filePath: string): string {
  const messages: Record<string, string> = {
    [PATH_UNSAFE]: `路径不安全: ${filePath}`,
    [PATH_OUTSIDE_ROOT]: `路径超出根目录范围: ${filePath}`,
    [PATH_NOT_FOUND]: `路径不存在: ${filePath}`,
    [NOT_A_DIRECTORY]: `路径不是目录: ${filePath}`,
  };
  return messages[errorCode] ?? `未知错误: ${errorCode}`;
}

export function executeFind(request: FindRequest, memoryRoot: string): FindResponse {
  const [resolvedPath, pathError] = validateFindPath(request.path ?? '', memoryRoot);
  if (pathError !== null) {
    return {
      success: false,
      error_code: pathError,
      message: errorMessage(pathError, request.path ?? ''),
    } satisfies FindError;
  }

  const [baseDir, relativePattern] = extractGlobBaseDirectory(request.pattern);

  let searchRoot: string;
  if (baseDir) {
    searchRoot = path.join(resolvedPath!, baseDir);
    try {
      const stat = fs.statSync(searchRoot);
      if (!stat.isDirectory()) {
        return {
          success: false,
          error_code: NOT_A_DIRECTORY,
          message: `glob 模式中的路径前缀不是目录: ${baseDir}`,
        } satisfies FindError;
      }
    } catch {
      return {
        success: true,
        filenames: [],
        num_files: 0,
        truncated: false,
      } satisfies FindResult;
    }
  } else {
    searchRoot = resolvedPath!;
  }

  const memoryRootResolved = path.resolve(memoryRoot);
  const matches: [mtime: number, relPath: string][] = [];

  function walkDir(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (VCS_SET.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          const relToSearch = path.relative(searchRoot, fullPath);
          if (globMatch(relToSearch, relativePattern)) {
            const relToRoot = path.relative(memoryRootResolved, fullPath);
            matches.push([stat.mtimeMs, relToRoot]);
          }
        } catch {
          continue;
        }
      }
    }
  }

  walkDir(searchRoot);

  matches.sort((a, b) => b[0] - a[0]);
  const allFilenames = matches.map((m) => m[1]);
  const total = allFilenames.length;

  const limit = request.limit ?? 100;
  const offset = request.offset ?? 0;
  const start = offset;
  const end = limit > 0 ? start + limit : total;
  const paged = allFilenames.slice(start, end);
  const truncated = end < total;

  const appliedLimit = truncated ? limit : null;
  const appliedOffset = offset > 0 ? offset : null;

  return {
    success: true,
    filenames: paged,
    num_files: total,
    truncated,
    applied_limit: appliedLimit,
    applied_offset: appliedOffset,
  } satisfies FindResult;
}
