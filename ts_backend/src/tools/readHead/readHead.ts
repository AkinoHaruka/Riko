// 文件头部读取工具：读取文件开头指定行数，带行号格式化输出
import fs from 'fs';
import {
  type HeadRequest,
  type HeadResult,
  type HeadError,
  PATH_UNSAFE,
  PATH_OUTSIDE_ROOT,
  FILE_NOT_FOUND,
  IS_DIRECTORY,
  INVALID_LINES,
} from '../types.js';
import { validateCommonPath, resolveVirtualPath } from '../../core/validation/path.js';

export function formatLinesWithNumbers(
  lines: string[],
  startLine: number,
): [content: string, endLine: number] {
  const endLine = startLine + lines.length - 1;
  const width = String(endLine).length;

  const formattedLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNum = startLine + i;
    formattedLines.push(`${String(lineNum).padStart(width)}\u2192${lines[i]}`);
  }

  return [formattedLines.join('\n'), endLine];
}

export function readFileHead(
  text: string,
  lines: number = 10,
): [content: string, totalLines: number, endLine: number] {
  const allLines = text.split(/\r?\n/);
  const totalLines = allLines.length;

  let selected: string[];
  if (lines === 0 || lines >= totalLines) {
    selected = allLines;
  } else {
    selected = allLines.slice(0, lines);
  }

  if (selected.length === 0) {
    return ['', totalLines, Math.max(1, totalLines)];
  }

  const [content, endLine] = formatLinesWithNumbers(selected, 1);
  return [content, totalLines, endLine];
}

export function executeHead(request: HeadRequest): HeadResult | HeadError {
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
  const [content, totalLines, endLine] = readFileHead(rawContent, request.lines ?? 10);

  return {
    success: true,
    file_path: request.file_path,
    content,
    total_lines: totalLines,
    start_line: 1,
    end_line: endLine,
    file_size: fileSize,
  };
}

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
