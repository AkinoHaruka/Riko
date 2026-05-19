// 文件写入工具：创建或覆盖写入文件，支持路径安全验证和原子写入
import fs from 'fs';
import path from 'path';
import {
  CONTENT_TOO_LARGE,
  IS_DIRECTORY,
  FILE_TOO_LARGE,
  PATH_UNSAFE,
  PATH_OUTSIDE_ROOT,
  MAX_FILE_SIZE,
  MAX_CONTENT_SIZE,
  type WriteRequest,
  type WriteResult,
  type WriteError,
  type WriteResponse,
} from '../../tools/types.js';
import { validateCommonPath, resolveVirtualPath } from '../../core/validation/path.js';
import { atomicWrite, generateDiff } from '../editFile/editFile.js';

interface WriteContext {
  resolvedPath: string;
  fileExists: boolean;
}

type ValidateWriteResult = [WriteContext | Record<string, unknown>, string | null];

export function validateWrite(
  filePath: string,
  content: string,
  memoryRoot?: string,
): ValidateWriteResult {
  const { physicalRoot, relativePath } = resolveVirtualPath(filePath, memoryRoot);
  const pathResult = validateCommonPath(relativePath, physicalRoot);

  if (pathResult.error) {
    return [{}, pathResult.error];
  }

  const resolvedPath = pathResult.resolvedPath!;

  if (content.length > MAX_CONTENT_SIZE) {
    return [{}, CONTENT_TOO_LARGE];
  }

  if (fs.existsSync(resolvedPath)) {
    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      return [{}, IS_DIRECTORY];
    }
    if (stat.size > MAX_FILE_SIZE) {
      return [{}, FILE_TOO_LARGE];
    }
  }

  return [
    {
      resolvedPath,
      fileExists: fs.existsSync(resolvedPath),
    },
    null,
  ];
}

export function executeWrite(request: WriteRequest): WriteResponse {
  const [context, error] = validateWrite(request.file_path, request.content, request.memoryRoot);

  if (error) {
    return {
      success: false,
      error_code: error,
      message: errorMessage(error, request.file_path),
    } satisfies WriteError;
  }

  const ctx = context as WriteContext;
  const { resolvedPath, fileExists } = ctx;

  let oldContent: string | null = null;
  if (fileExists) {
    oldContent = fs.readFileSync(resolvedPath, 'utf-8');
  }

  const writeType: 'create' | 'update' = fileExists ? 'update' : 'create';

  const parentDir = path.dirname(resolvedPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  atomicWrite(resolvedPath, request.content);

  const diff = generateDiff(request.file_path, oldContent ?? '', request.content);

  const linesWritten =
    request.content.length > 0
      ? request.content.split('\n').length - (request.content.endsWith('\n') ? 1 : 0)
      : 0;

  const message =
    writeType === 'create'
      ? `已创建文件: ${request.file_path}`
      : `已更新文件: ${request.file_path}`;

  return {
    success: true,
    type: writeType,
    file_path: request.file_path,
    diff,
    old_content: oldContent,
    lines_written: linesWritten,
    message,
  } satisfies WriteResult;
}

export function errorMessage(errorCode: string, filePath: string): string {
  const messages: Record<string, string> = {
    [PATH_UNSAFE]: `路径不安全: ${filePath}`,
    [PATH_OUTSIDE_ROOT]: `路径超出根目录范围: ${filePath}`,
    [FILE_TOO_LARGE]: `文件超过 10MB 大小限制: ${filePath}`,
    [CONTENT_TOO_LARGE]: `写入内容超过 10MB 大小限制: ${filePath}`,
    [IS_DIRECTORY]: `目标路径是一个目录，无法写入: ${filePath}`,
  };
  return messages[errorCode] ?? `未知错误: ${errorCode}`;
}
