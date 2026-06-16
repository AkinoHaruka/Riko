/**
 * 文件读取工具核心实现
 *
 * 按路径读取文件内容，支持行号偏移和范围截取，
 * 自动解析 frontmatter 并生成记忆新鲜度提示。
 * 输出格式为带行号的文本（行号右对齐 + → 分隔符）。
 */
import fs from 'fs';
import { validateCommonPath, resolveVirtualPath } from '../../core/validation/path.js';
import { parseFrontmatter } from '../../core/validation/frontmatter.js';
import {
  FILE_NOT_FOUND,
  FILE_TOO_LARGE,
  IS_DIRECTORY,
  MAX_FILE_SIZE,
  PATH_UNSAFE,
  PATH_OUTSIDE_ROOT,
} from '../types.js';
import type { CatRequest, CatResult, CatError, CatResponse } from '../types.js';

/**
 * 按行号范围截取文本并添加行号格式化。
 *
 * @param text     - 完整文件内容
 * @param offset   - 起始行号（从 1 开始），默认 1
 * @param limit    - 读取行数，0 表示读取到末尾
 * @returns [格式化后的内容, 文件总行数, 结束行号]
 */
export function readFileInRange(
  text: string,
  offset: number = 1,
  limit: number = 0,
): [string, number, number] {
  const lines = text.split('\n');
  const totalLines = lines.length;

  const startIdx = Math.max(0, offset - 1);
  const selected = limit === 0 ? lines.slice(startIdx) : lines.slice(startIdx, startIdx + limit);

  if (selected.length === 0) {
    return ['', totalLines, Math.max(1, offset)];
  }

  const endLine = startIdx + selected.length;
  const width = String(endLine).length;

  const formattedLines: string[] = [];
  for (let i = 0; i < selected.length; i++) {
    const lineNum = startIdx + i + 1;
    formattedLines.push(`${String(lineNum).padStart(width)}\u2192${selected[i]}`);
  }

  return [formattedLines.join('\n'), totalLines, endLine];
}

/**
 * 生成记忆新鲜度提示文本。
 *
 * 根据文件的最后修改时间计算距今天数，
 * 超过 0 天时返回过时警告，提醒 AI 验证内容有效性。
 *
 * @param mtimeMs - 文件最后修改时间的毫秒时间戳
 * @returns 新鲜度提示文本，刚更新时返回空字符串
 */
export function memoryFreshnessNote(mtimeMs: number): string {
  const nowMs = Date.now();
  const days = Math.max(0, Math.floor((nowMs - mtimeMs) / 86400000));

  if (days === 0) {
    return '';
  }
  return `此记忆已 ${days} 天未更新，内容可能已过时，请验证后再使用`;
}

/**
 * 执行文件读取操作。
 *
 * 流程：验证路径安全性 → 检查文件存在性和类型 → 检查文件大小 →
 * 读取内容 → 解析 frontmatter → 按范围截取并格式化 → 生成新鲜度提示
 *
 * @param request - 包含文件路径和可选范围参数的请求
 * @returns 文件内容或错误信息
 */
export function executeCat(request: CatRequest): CatResponse {
  const virtual = resolveVirtualPath(request.file_path, request.memoryRoot);
  const memoryRoot = virtual.physicalRoot;
  const relativePath = virtual.relativePath;

  const { resolvedPath, error: pathError } = validateCommonPath(relativePath, memoryRoot);
  if (pathError) {
    return {
      success: false,
      error_code: pathError,
      message: errorMessage(pathError, request.file_path),
    } as CatError;
  }

  if (!fs.existsSync(resolvedPath!)) {
    return {
      success: false,
      error_code: FILE_NOT_FOUND,
      message: errorMessage(FILE_NOT_FOUND, request.file_path),
    } as CatError;
  }

  const stat = fs.statSync(resolvedPath!);
  if (stat.isDirectory()) {
    return {
      success: false,
      error_code: IS_DIRECTORY,
      message: errorMessage(IS_DIRECTORY, request.file_path),
    } as CatError;
  }

  if (stat.size > MAX_FILE_SIZE) {
    return {
      success: false,
      error_code: FILE_TOO_LARGE,
      message: errorMessage(FILE_TOO_LARGE, request.file_path),
    } as CatError;
  }

  const rawContent = fs.readFileSync(resolvedPath!, 'utf-8');
  const parsed = parseFrontmatter(rawContent, request.file_path);

  const offset = request.offset ?? 1;
  const limit = request.limit ?? 0;
  const [content, totalLines, endLine] = readFileInRange(rawContent, offset, limit);

  const startLine = offset;
  const mtimeMs = stat.mtimeMs;
  const freshnessNote = memoryFreshnessNote(mtimeMs);

  return {
    success: true,
    file_path: request.file_path,
    content,
    total_lines: totalLines,
    start_line: startLine,
    end_line: endLine,
    file_size: stat.size,
    mtime_ms: mtimeMs,
    frontmatter: parsed.frontmatter,
    freshness_note: freshnessNote,
  } as CatResult;
}

/** 根据错误代码生成人类可读的错误消息 */
function errorMessage(errorCode: string, filePath: string): string {
  const messages: Record<string, string> = {
    [PATH_UNSAFE]: `路径不安全: ${filePath}`,
    [PATH_OUTSIDE_ROOT]: `路径超出根目录范围: ${filePath}`,
    [FILE_NOT_FOUND]: `文件不存在: ${filePath}`,
    [FILE_TOO_LARGE]: `文件超过 10MB 大小限制: ${filePath}`,
    [IS_DIRECTORY]: `路径是目录而非文件: ${filePath}`,
  };
  return messages[errorCode] ?? `未知错误: ${errorCode}`;
}
