/**
 * 文件查找工具核心实现
 *
 * 按 glob 模式匹配文件名，支持 ** 递归通配符，结果按修改时间降序排序。
 * 自动跳过版本控制目录（.git、.svn 等）以避免无意义的搜索结果。
 *
 * glob 匹配算法：
 * - 不含 ** 时，使用 fnmatch 风格的单层匹配
 * - 含 ** 时，递归拆分路径段进行多层级匹配
 */
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

/**
 * 验证查找路径的安全性和有效性。
 *
 * @security 通过 validateCommonPath 确保路径不越界，
 *           并额外验证路径必须是已存在的目录。
 *
 * @param filePath   - 待验证的路径
 * @param memoryRoot - 允许操作的根目录
 * @returns [解析后的绝对路径, 错误代码]
 */
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

/**
 * 从 glob 模式中提取基础目录和相对模式。
 *
 * 例如 "docs/*.md" 解析为 ["docs", "*.md"]
 * 例如 "*.txt" 解析为 ["", "*.txt"]
 * 支持递归通配符（双星号）模式，通配符之前的部分视为目录前缀，用于缩小搜索范围。
 *
 * @param pattern - glob 模式字符串
 * @returns [基础目录, 剩余的 glob 模式]
 */
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

  // 无通配符时，以最后一个路径分隔符为界
  const sepPos = Math.max(pattern.lastIndexOf('/'), pattern.lastIndexOf('\\'));
  if (sepPos !== -1) {
    return [pattern.slice(0, sepPos), pattern.slice(sepPos + 1)];
  }
  return ['', pattern];
}

/**
 * fnmatch 风格的单层 glob 匹配。
 *
 * 将 glob 模式转换为正则表达式：
 * - * 匹配除路径分隔符外的任意字符
 * - ? 匹配除路径分隔符外的单个字符
 */
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

/**
 * 递归路径段匹配，支持 ** 通配符。
 *
 * ** 匹配零个或多个路径段，通过回溯搜索所有可能的匹配路径。
 */
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
    // ** 在模式末尾时匹配剩余所有路径段
    if (gi + 1 === patternParts.length) {
      return true;
    }
    // 尝试跳过 0 到 N 个路径段，寻找后续模式的匹配
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

/**
 * 判断相对路径是否匹配 glob 模式。
 *
 * @param relPath - 相对于搜索根目录的文件路径
 * @param pattern - glob 匹配模式
 */
export function globMatch(relPath: string, pattern: string): boolean {
  if (!pattern.includes('**')) {
    return fnmatchStyle(relPath, pattern);
  }

  const normalizedPath = relPath.replace(/\\/g, '/');
  const patternParts = pattern.split('/');
  const pathParts = normalizedPath.split('/').filter(Boolean);
  return matchParts(pathParts, 0, patternParts, 0);
}

/** 根据错误代码生成人类可读的错误消息 */
export function errorMessage(errorCode: string, filePath: string): string {
  const messages: Record<string, string> = {
    [PATH_UNSAFE]: `路径不安全: ${filePath}`,
    [PATH_OUTSIDE_ROOT]: `路径超出根目录范围: ${filePath}`,
    [PATH_NOT_FOUND]: `路径不存在: ${filePath}`,
    [NOT_A_DIRECTORY]: `路径不是目录: ${filePath}`,
  };
  return messages[errorCode] ?? `未知错误: ${errorCode}`;
}

/**
 * 执行文件查找操作。
 *
 * 流程：验证路径 → 提取 glob 基础目录 → 递归遍历文件 →
 * glob 匹配 → 按修改时间排序 → 分页截取
 *
 * @param request    - 查找请求参数
 * @param memoryRoot - 允许操作的根目录
 */
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

  // 如果 glob 模式包含目录前缀，将其拼接到搜索根目录
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
      // 基础目录不存在时返回空结果而非错误
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

  /** 递归遍历目录，收集匹配的文件 */
  function walkDir(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // 跳过版本控制目录
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
            // 返回相对于 memoryRoot 的路径，确保调用方能定位文件
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

  // 按修改时间降序排列，最新修改的文件排在前面
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
