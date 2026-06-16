/**
 * 文件尾部读取工具核心实现
 *
 * 读取文件末尾指定行数，带行号格式化输出。
 * 默认显示最后 10 行，lines=0 表示读取全部内容。
 * 行号从文件的实际位置开始，而非从 1 开始。
 */
import fs from 'fs';
import {
  type TailRequest,
  type TailResult,
  type TailError,
  PATH_UNSAFE,
  PATH_OUTSIDE_ROOT,
  FILE_NOT_FOUND,
  IS_DIRECTORY,
  INVALID_LINES,
} from '../types.js';
import { validateCommonPath, resolveVirtualPath } from '../../core/validation/path.js';
import { formatLinesWithNumbers } from '../shared/formatLines.js';

/**
 * 读取文本的尾部指定行数并格式化。
 *
 * @param text  - 完整文件内容
 * @param lines - 读取行数，0 表示全部，默认 10
 * @returns [格式化后的内容, 文件总行数, 结束行号]
 */
export function readFileTailFast(
  text: string,
  lines: number = 10,
): [content: string, totalLines: number, endLine: number] {
  const allLines = text.split(/\r?\n/);
  const totalLines = allLines.length;

  let selected: string[];
  if (lines === 0 || lines >= totalLines) {
    selected = allLines;
  } else {
    selected = allLines.slice(-lines);
  }

  if (selected.length === 0) {
    return ['', totalLines, Math.max(1, totalLines)];
  }

  // 尾部读取时行号从实际位置开始，而非从 1
  const startLine = totalLines - selected.length + 1;
  const [content, endLine] = formatLinesWithNumbers(selected, startLine);
  return [content, totalLines, endLine];
}

/**
 * 执行文件尾部读取操作。
 *
 * @param request - 包含文件路径和可选行数参数的请求
 * @returns 文件尾部内容或错误信息
 */
export function executeTail(request: TailRequest): TailResult | TailError {
  if (request.lines !== undefined && request.lines < 0) {
    return {
      success: false,
      error_code: INVALID_LINES,
      message: errorMessage(INVALID_LINES, request.file_path),
    };
  }

  if (!request.file_path || request.file_path === '.') {
    return {
      success: false,
      error_code: PATH_UNSAFE,
      message: errorMessage(PATH_UNSAFE, request.file_path),
    };
  }

  const { physicalRoot, relativePath } = resolveVirtualPath(request.file_path);
  const { resolvedPath, error: pathError } = validateCommonPath(relativePath, physicalRoot);
  if (pathError) {
    return {
      success: false,
      error_code: pathError,
      message: errorMessage(pathError, request.file_path),
    };
  }

  if (!fs.existsSync(resolvedPath!)) {
    return {
      success: false,
      error_code: FILE_NOT_FOUND,
      message: errorMessage(FILE_NOT_FOUND, request.file_path),
    };
  }

  const stat = fs.statSync(resolvedPath!);
  if (stat.isDirectory()) {
    return {
      success: false,
      error_code: IS_DIRECTORY,
      message: errorMessage(IS_DIRECTORY, request.file_path),
    };
  }

  const fileSize = stat.size;
  const rawContent = fs.readFileSync(resolvedPath!, 'utf-8');
  const [content, totalLines, endLine] = readFileTailFast(rawContent, request.lines ?? 10);

  const selectedCount =
    request.lines === 0 ? totalLines : Math.min(request.lines ?? 10, totalLines);
  const startLine = Math.max(1, totalLines - selectedCount + 1);

  return {
    success: true,
    file_path: request.file_path,
    content,
    total_lines: totalLines,
    start_line: startLine,
    end_line: endLine,
    file_size: fileSize,
  };
}

/** 根据错误代码生成人类可读的错误消息 */
export function errorMessage(errorCode: string, filePath: string): string {
  const messages: Record<string, string> = {
    [PATH_UNSAFE]: `路径不安全: ${filePath}`,
    [PATH_OUTSIDE_ROOT]: `路径超出根目录范围: ${filePath}`,
    [FILE_NOT_FOUND]: `文件不存在: ${filePath}`,
    [IS_DIRECTORY]: `路径是目录而非文件: ${filePath}`,
    [INVALID_LINES]: `行数参数无效（不能为负数）: ${filePath}`,
  };
  return messages[errorCode] || `未知错误: ${errorCode}`;
}
