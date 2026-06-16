/**
 * 字数统计工具核心实现
 *
 * 统计文件的行数、字数和字节数，支持两种模式：
 * - 单文件模式：指定 file_path 统计单个文件
 * - 批量模式：指定 path 目录路径，递归统计目录下匹配 glob 模式的所有文件
 *
 * 超过 MAX_FILE_SIZE 的文件跳过内容统计（行数和字数记为 0），
 * 仅统计字节数，避免读取大文件导致性能问题。
 */
import fs from 'fs';
import path from 'path';
import {
  type WcRequest,
  type WcResult,
  type WcError,
  type WcFileResult,
  MAX_FILE_SIZE,
  VCS_DIRECTORIES,
  PATH_UNSAFE,
  PATH_OUTSIDE_ROOT,
  PATH_NOT_FOUND,
  FILE_TOO_LARGE,
  NO_PATH_SPECIFIED,
  NOT_A_DIRECTORY,
} from '../types.js';
import { validateCommonPath } from '../../core/validation/path.js';
import { autoDreamConfig } from '../../config/auto_dream.js';
import { extractGlobBaseDirectory, globMatch } from '../findFiles/index.js';
import { formatFileSize } from '../shared/formatFileSize.js';

const VCS_SET: ReadonlySet<string> = new Set(VCS_DIRECTORIES);

/**
 * 统计单个文件的行数、字数和字节数。
 *
 * 超过大小限制的文件仅统计字节数，行数和字数记为 0，
 * 避免读取大文件导致内存和性能问题。
 *
 * @param filePath - 文件的绝对路径
 * @returns 文件统计结果
 */
export function countFileStats(filePath: string): {
  lines: number;
  words: number;
  bytes_count: number;
  size_human: string;
  within_size_limit: boolean;
} {
  const stat = fs.statSync(filePath);
  const bytesCount = stat.size;
  const withinSizeLimit = bytesCount <= MAX_FILE_SIZE;

  let lines = 0;
  let words = 0;

  if (withinSizeLimit) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      lines = content.split(/\r?\n/).length;
      words = content.split(/\s+/).filter((w) => w.length > 0).length;
    } catch {
      lines = 0;
      words = 0;
    }
  }

  return {
    lines,
    words,
    bytes_count: bytesCount,
    size_human: formatFileSize(bytesCount),
    within_size_limit: withinSizeLimit,
  };
}

/**
 * 验证字数统计路径的安全性和存在性。
 *
 * @security 通过 validateCommonPath 确保路径不越界。
 */
function validateWcPath(
  filePath: string,
  memoryRoot: string,
): { resolvedPath: string | null; error: string | null } {
  const result = validateCommonPath(filePath, memoryRoot);
  if (result.error) {
    return { resolvedPath: null, error: result.error };
  }

  if (!fs.existsSync(result.resolvedPath!)) {
    return { resolvedPath: null, error: PATH_NOT_FOUND };
  }

  return { resolvedPath: result.resolvedPath, error: null };
}

/**
 * 单文件统计模式。
 *
 * @param request    - 统计请求
 * @param memoryRoot - 允许操作的根目录
 */
function executeSingle(request: WcRequest, memoryRoot: string): WcResult | WcError {
  const { resolvedPath, error: pathError } = validateWcPath(request.file_path!, memoryRoot);
  if (pathError) {
    return {
      success: false,
      error_code: pathError,
      message: errorMessage(pathError, request.file_path!),
    };
  }

  const stat = fs.statSync(resolvedPath!);
  if (!stat.isFile()) {
    return {
      success: false,
      error_code: PATH_NOT_FOUND,
      message: errorMessage(PATH_NOT_FOUND, request.file_path!),
    };
  }

  const stats = countFileStats(resolvedPath!);
  if (!stats.within_size_limit) {
    return {
      success: false,
      error_code: FILE_TOO_LARGE,
      message: errorMessage(FILE_TOO_LARGE, request.file_path!),
    };
  }

  const fileResult: WcFileResult = {
    file_path: request.file_path!,
    lines: stats.lines,
    words: stats.words,
    bytes_count: stats.bytes_count,
    size_human: stats.size_human,
    within_size_limit: stats.within_size_limit,
  };

  return {
    success: true,
    mode: 'single',
    files: [fileResult],
    total_lines: stats.lines,
    total_words: stats.words,
    total_bytes: stats.bytes_count,
    num_files: 1,
  };
}

/**
 * 目录批量统计模式。
 *
 * 递归遍历目录，按 glob 模式过滤文件后统计每个文件的行数/字数/字节数。
 * 自动跳过版本控制目录和符号链接。
 */
function executeBatch(request: WcRequest, memoryRoot: string): WcResult | WcError {
  const { resolvedPath, error: pathError } = validateWcPath(request.path!, memoryRoot);
  if (pathError) {
    return {
      success: false,
      error_code: pathError,
      message: errorMessage(pathError, request.path!),
    };
  }

  const stat = fs.statSync(resolvedPath!);
  if (!stat.isDirectory()) {
    return {
      success: false,
      error_code: NOT_A_DIRECTORY,
      message: errorMessage(NOT_A_DIRECTORY, request.path!),
    };
  }

  const globPattern = request.glob?.trim() || '*.md';
  const [baseDir, filenamePattern] = extractGlobBaseDirectory(globPattern);

  // 如果 glob 模式包含目录前缀，将其拼接到搜索根目录
  let searchRoot: string;
  if (baseDir) {
    searchRoot = path.join(resolvedPath!, baseDir);
    if (!fs.existsSync(searchRoot)) {
      return {
        success: true,
        mode: 'batch',
        files: [],
        total_lines: 0,
        total_words: 0,
        total_bytes: 0,
        num_files: 0,
      };
    }
    const searchStat = fs.statSync(searchRoot);
    if (!searchStat.isDirectory()) {
      return {
        success: false,
        error_code: NOT_A_DIRECTORY,
        message: `glob 模式中的路径前缀不是目录: ${baseDir}`,
      };
    }
  } else {
    searchRoot = resolvedPath!;
  }

  const fileResults: WcFileResult[] = [];
  let totalLines = 0;
  let totalWords = 0;
  let totalBytes = 0;

  /** 递归遍历目录，统计匹配文件的行数/字数/字节数 */
  function walkDir(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (VCS_SET.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      // 跳过符号链接，避免重复统计或循环引用
      try {
        const lstat = fs.lstatSync(fullPath);
        if (lstat.isSymbolicLink()) continue;
      } catch {
        continue;
      }

      const relToSearch = path.relative(searchRoot, fullPath).replace(/\\/g, '/');
      if (!globMatch(relToSearch, filenamePattern)) continue;

      const relPath = path.relative(resolvedPath!, fullPath).replace(/\\/g, '/');
      const stats = countFileStats(fullPath);

      fileResults.push({
        file_path: relPath,
        lines: stats.lines,
        words: stats.words,
        bytes_count: stats.bytes_count,
        size_human: stats.size_human,
        within_size_limit: stats.within_size_limit,
      });

      // 仅在文件大小合规时累加行数和字数
      if (stats.within_size_limit) {
        totalLines += stats.lines;
        totalWords += stats.words;
      }
      totalBytes += stats.bytes_count;
    }
  }

  walkDir(searchRoot);

  return {
    success: true,
    mode: 'batch',
    files: fileResults,
    total_lines: totalLines,
    total_words: totalWords,
    total_bytes: totalBytes,
    num_files: fileResults.length,
  };
}

/**
 * 执行字数统计操作。
 *
 * 根据 request 中的参数自动选择单文件或批量模式：
 * - 有 file_path 时走单文件模式
 * - 有 path 时走批量模式
 * - 两者都没有时返回错误
 *
 * @param request    - 统计请求
 * @param memoryRoot - 允许操作的根目录，未提供时使用配置默认值
 */
export function executeWc(request: WcRequest, memoryRoot?: string): WcResult | WcError {
  const root = memoryRoot || autoDreamConfig.memoryRootDir;

  if (request.file_path) {
    return executeSingle(request, root);
  }

  if (request.path) {
    return executeBatch(request, root);
  }

  return {
    success: false,
    error_code: NO_PATH_SPECIFIED,
    message: errorMessage(NO_PATH_SPECIFIED, ''),
  };
}

/** 根据错误代码生成人类可读的错误消息 */
export function errorMessage(errorCode: string, filePath: string): string {
  const messages: Record<string, string> = {
    [PATH_UNSAFE]: `路径不安全: ${filePath}`,
    [PATH_OUTSIDE_ROOT]: `路径超出根目录范围: ${filePath}`,
    [PATH_NOT_FOUND]: `路径不存在: ${filePath}`,
    [FILE_TOO_LARGE]: `文件超过 10MB 大小限制: ${filePath}`,
    [NO_PATH_SPECIFIED]: '未指定文件路径或目录路径',
    [NOT_A_DIRECTORY]: `路径不是目录: ${filePath}`,
  };
  return messages[errorCode] || `未知错误: ${errorCode}`;
}
