/**
 * 文件元数据统计工具
 *
 * 获取文件或目录的元数据信息，包括大小、修改/访问/创建时间、权限模式和文件类型。
 * 对于目录类型，大小限制检查自动通过；对于文件，会检查是否超过 MAX_FILE_SIZE。
 */
import fs from 'fs';
import { validateCommonPath, resolveVirtualPath } from '../../core/validation/path.js';
import { MAX_FILE_SIZE, PATH_UNSAFE, PATH_OUTSIDE_ROOT, PATH_NOT_FOUND } from '../types.js';
import type { StatRequest, StatResult, StatError, StatResponse } from '../types.js';
import { formatFileSize } from '../shared/formatFileSize.js';

/** 将毫秒时间戳转换为 ISO 格式字符串 */
function formatTimestamp(msEpoch: number): string {
  const dt = new Date(msEpoch);
  return dt.toISOString();
}

/**
 * 执行文件元数据查询。
 *
 * @param request - 包含目标文件路径的请求
 * @returns 文件元数据或错误信息
 */
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

  // 判断文件类型：先检查是否为符号链接，再判断目录/文件
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
  // 目录不做大小限制检查，因为目录的 size 本身无实际意义
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

/** 根据错误代码生成人类可读的错误消息 */
function errorMessage(errorCode: string, filePath: string): string {
  const messages: Record<string, string> = {
    [PATH_UNSAFE]: `路径不安全: ${filePath}`,
    [PATH_OUTSIDE_ROOT]: `路径超出根目录范围: ${filePath}`,
    [PATH_NOT_FOUND]: `路径不存在: ${filePath}`,
  };
  return messages[errorCode] ?? `未知错误: ${errorCode}`;
}
