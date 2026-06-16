/**
 * 文件写入工具核心实现
 *
 * 创建新文件或完全覆盖已有文件，支持路径安全验证和原子写入。
 * 写入前会保存旧内容用于生成 unified diff，写入后自动创建不存在的父目录。
 *
 * 安全机制：
 * - 路径必须经过 validateCommonPath 验证，防止目录遍历
 * - 写入内容大小超过 MAX_CONTENT_SIZE 时拒绝操作
 * - 目标文件超过 MAX_FILE_SIZE 时拒绝覆盖
 * - 目标路径是目录时拒绝写入
 * - 使用原子写入（先写临时文件再重命名）防止写入中断导致数据损坏
 */
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

/**
 * 写入操作的前置校验。
 *
 * 校验顺序：路径安全性 → 写入内容大小 → 目标路径类型 → 目标文件大小
 *
 * @param filePath   - 目标文件路径
 * @param content    - 要写入的内容
 * @param memoryRoot - 允许操作的根目录
 * @returns [写入上下文, 错误代码] — 校验通过时错误代码为 null
 */
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

/**
 * 执行文件写入操作。
 *
 * 流程：校验 → 读取旧内容 → 确保父目录存在 → 原子写入 → 生成 diff
 *
 * @param request - 写入请求参数
 * @returns 写入成功或失败的结果
 */
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

  // 计算写入行数，排除末尾空行
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
    lines_written: linesWritten,
    message,
  } satisfies WriteResult;
}

/** 根据错误代码生成人类可读的错误消息 */
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
