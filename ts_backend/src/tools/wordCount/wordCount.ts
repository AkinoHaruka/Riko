// 字数统计工具：统计文件的行数/字数/字节数，支持单文件和目录批量模式
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

const VCS_SET: ReadonlySet<string> = new Set(VCS_DIRECTORIES);

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes}B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)}KB`;
  }
  if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

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
