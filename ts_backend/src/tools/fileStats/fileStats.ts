// 文件统计工具：获取文件/目录的元数据（大小、时间、类型、权限）
import fs from 'fs';
import { validateCommonPath, resolveVirtualPath } from '../../core/validation/path.js';
import { MAX_FILE_SIZE, PATH_UNSAFE, PATH_OUTSIDE_ROOT, PATH_NOT_FOUND } from '../types.js';
import type { StatRequest, StatResult, StatError, StatResponse } from '../types.js';

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes}B`;
  } else if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)}KB`;
  } else if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  } else {
    return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  }
}

function formatTimestamp(msEpoch: number): string {
  const dt = new Date(msEpoch);
  return dt.toISOString();
}

export function executeStat(request: StatRequest): StatResponse {
  const virtual = resolveVirtualPath(request.file_path);
  const memoryRoot = virtual.physicalRoot;
  const relativePath = virtual.relativePath;

  const { resolvedPath, error: pathError } = validateCommonPath(relativePath, memoryRoot);
  if (pathError) {
    return {
      success: false,
      error_code: pathError,
      message: errorMessage(pathError, request.file_path),
    } as StatError;
  }

  if (!fs.existsSync(resolvedPath!)) {
    return {
      success: false,
      error_code: PATH_NOT_FOUND,
      message: errorMessage(PATH_NOT_FOUND, request.file_path),
    } as StatError;
  }

  let statResult: fs.Stats;
  try {
    statResult = fs.statSync(resolvedPath!, { throwIfNoEntry: false })!;
  } catch {
    return {
      success: false,
      error_code: PATH_NOT_FOUND,
      message: `无法获取文件状态: ${request.file_path}`,
    } as StatError;
  }

  if (!statResult) {
    return {
      success: false,
      error_code: PATH_NOT_FOUND,
      message: `无法获取文件状态: ${request.file_path}`,
    } as StatError;
  }

  let fileType: string;
  try {
    if (fs.lstatSync(resolvedPath!).isSymbolicLink()) {
      fileType = 'symlink';
    } else if (statResult.isDirectory()) {
      fileType = 'directory';
    } else {
      fileType = 'file';
    }
  } catch {
    fileType = statResult.isDirectory() ? 'directory' : 'file';
  }

  const sizeBytes = statResult.size;
  const withinSizeLimit = fileType === 'directory' ? true : sizeBytes <= MAX_FILE_SIZE;

  return {
    success: true,
    file_path: request.file_path,
    size_bytes: sizeBytes,
    size_human: formatFileSize(sizeBytes),
    mtime: formatTimestamp(statResult.mtimeMs),
    atime: formatTimestamp(statResult.atimeMs),
    ctime: formatTimestamp(statResult.ctimeMs),
    mode: (statResult.mode & 0o77777).toString(8),
    file_type: fileType,
    within_size_limit: withinSizeLimit,
    max_size_bytes: MAX_FILE_SIZE,
  } as StatResult;
}

function errorMessage(errorCode: string, filePath: string): string {
  const messages: Record<string, string> = {
    [PATH_UNSAFE]: `路径不安全: ${filePath}`,
    [PATH_OUTSIDE_ROOT]: `路径超出根目录范围: ${filePath}`,
    [PATH_NOT_FOUND]: `路径不存在: ${filePath}`,
  };
  return messages[errorCode] ?? `未知错误: ${errorCode}`;
}
