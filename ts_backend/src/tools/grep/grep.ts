/**
 * 文件内容搜索工具核心实现
 *
 * 基于正则表达式搜索文件内容，支持三种输出模式：
 * - files_with_matches：仅返回匹配的文件路径列表
 * - content：返回匹配行的内容（带文件名和行号）
 * - count：返回各文件的匹配次数
 *
 * 安全机制：
 * - 路径必须经过 validateCommonPath 验证
 * - 正则表达式长度超过 200 字符或包含危险嵌套量词时拒绝执行（ReDoS 防护）
 * - 超长行截断到 MAX_COLUMNS 列
 * - 自动跳过版本控制目录和符号链接
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  type GrepRequest,
  type GrepResult,
  type GrepError,
  type GrepResponse,
  PATH_NOT_FOUND,
  INVALID_PATTERN,
  INVALID_MODE,
  EMPTY_PATTERN,
  MAX_COLUMNS,
  VCS_DIRECTORIES,
} from '../types.js';
import { validateCommonPath, resolveVirtualPath } from '../../core/validation/path.js';

/**
 * 验证 grep 搜索路径的安全性和存在性。
 *
 * @security 通过 resolveVirtualPath + validateCommonPath 双重验证路径安全性。
 *
 * @param filePath   - 搜索路径
 * @param memoryRoot - 允许操作的根目录
 * @returns [解析后的绝对路径, 错误代码]
 */
function validateGrepPath(filePath: string, memoryRoot?: string): [string | null, string | null] {
  const { physicalRoot, relativePath } = resolveVirtualPath(filePath, memoryRoot);
  const result = validateCommonPath(relativePath, physicalRoot);
  if (result.error) {
    return [null, result.error];
  }
  const resolvedPath = result.resolvedPath!;
  try {
    fs.accessSync(resolvedPath, fs.constants.F_OK);
  } catch {
    return [null, PATH_NOT_FOUND];
  }
  return [resolvedPath, null];
}

/**
 * 解析 glob 过滤模式字符串。
 *
 * 支持三种格式：
 * - 花括号展开：*.{ts,tsx} → ["*.ts", "*.tsx"]
 * - 逗号分隔：*.ts,*.tsx → ["*.ts", "*.tsx"]
 * - 空格分隔：*.ts *.tsx → ["*.ts", "*.tsx"]
 *
 * @param globStr - glob 模式字符串
 * @returns 解析后的模式数组
 */
function parseGlobPatterns(globStr: string): string[] {
  if (!globStr || !globStr.trim()) return [];
  const s = globStr.trim();
  if (s.includes('{') && s.includes('}')) {
    const prefix = s.slice(0, s.indexOf('{'));
    const suffix = s.slice(s.lastIndexOf('}') + 1);
    const inner = s.slice(s.indexOf('{') + 1, s.lastIndexOf('}'));
    return inner
      .split(',')
      .map((p) => prefix + p.trim() + suffix)
      .filter(Boolean);
  }
  if (s.includes(',')) {
    return s
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return s
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * 递归遍历目录，按 glob 模式过滤后生成文件路径。
 * 自动跳过版本控制目录和符号链接。
 */
function* walkFiles(root: string, globPatterns: string[]): Generator<string> {
  const vcsSet = new Set(VCS_DIRECTORIES);
  function* recurse(dir: string): Generator<string> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (vcsSet.has(entry.name)) continue;
        yield* recurse(path.join(dir, entry.name));
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        if (globPatterns.length > 0) {
          if (!globPatterns.some((pat) => matchGlob(entry.name, pat))) continue;
        }
        yield path.join(dir, entry.name);
      }
    }
  }
  yield* recurse(root);
}

/** glob 正则缓存，避免对同一 pattern 重复编译 */
const _globRegexCache = new Map<string, RegExp>();

/** 简单的文件名 glob 匹配，将 * 和 ? 转换为正则表达式（带缓存） */
function matchGlob(name: string, pattern: string): boolean {
  let regex = _globRegexCache.get(pattern);
  if (!regex) {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    regex = new RegExp(`^${regexStr}$`);
    _globRegexCache.set(pattern, regex);
  }
  return regex.test(name);
}

/**
 * 对结果列表应用 head_limit 和 offset 分页。
 *
 * @param items     - 待分页的列表
 * @param headLimit - 返回数量限制，0 表示不限
 * @param offset    - 跳过的条目数
 * @returns [分页后的列表, 实际应用的 limit（未截断时为 null）]
 */
function applyHeadLimit<T>(
  items: T[],
  headLimit: number,
  offset: number = 0,
): [T[], number | null] {
  if (headLimit === 0) {
    return [items.slice(offset), null];
  }
  const sliced = items.slice(offset, offset + headLimit);
  const wasTruncated = items.length - offset > headLimit;
  return [sliced, wasTruncated ? headLimit : null];
}

/** 将超长行截断到 MAX_COLUMNS 列并添加截断标记 */
function truncateLine(line: string): string {
  if (line.length > MAX_COLUMNS) {
    return line.slice(0, MAX_COLUMNS) + '...[truncated]';
  }
  return line;
}

/**
 * files_with_matches 模式：仅返回包含匹配的文件路径列表。
 * 结果按修改时间降序排列。
 *
 * 使用逐行读取 + 匹配到即停，避免将整个文件加载到内存。
 */
async function searchFilesWithMatches(
  root: string,
  compiled: RegExp,
  globPatterns: string[],
  headLimit: number,
  offset: number,
): Promise<[string[], number, number | null, number | null]> {
  const matches: [number, string][] = [];
  for (const filepath of walkFiles(root, globPatterns)) {
    try {
      const stat = fs.statSync(filepath);
      // 逐行读取，匹配到第一行即停止，避免读取整个大文件
      const rl = readline.createInterface({
        input: fs.createReadStream(filepath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });
      let found = false;
      for await (const line of rl) {
        if (compiled.test(line)) {
          found = true;
          rl.close();
          break;
        }
      }
      if (found) {
        const relPath = path.relative(root, filepath);
        matches.push([stat.mtimeMs, relPath]);
      }
    } catch {
      continue;
    }
  }
  matches.sort((a, b) => b[0] - a[0]);
  const allFilenames = matches.map((m) => m[1]);
  const total = allFilenames.length;
  const [paged, appliedLimit] = applyHeadLimit(allFilenames, headLimit, offset);
  const appliedOffset = offset > 0 ? offset : null;
  return [paged, total, appliedLimit, appliedOffset];
}

/**
 * content 模式：返回匹配行的内容，带文件名和行号。
 * 匹配行格式：filename:lineNum:content
 * 上下文行格式：filename-lineNum-content
 */
function searchContent(
  root: string,
  compiled: RegExp,
  globPatterns: string[],
  headLimit: number,
  offset: number,
  context: number,
): [string, number, number, number | null, number | null] {
  const outputLines: string[] = [];
  let fileCount = 0;
  for (const filepath of walkFiles(root, globPatterns)) {
    let lines: string[];
    try {
      lines = fs.readFileSync(filepath, 'utf-8').split(/\r?\n/);
    } catch {
      continue;
    }
    const relPath = path.relative(root, filepath);
    const matchedLineIndices = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      if (compiled.test(lines[i])) {
        matchedLineIndices.add(i);
      }
    }
    if (matchedLineIndices.size === 0) continue;
    fileCount++;
    // 根据上下文参数决定显示哪些行
    let displayIndices: number[];
    if (context > 0) {
      const displaySet = new Set<number>();
      for (const idx of matchedLineIndices) {
        const start = Math.max(0, idx - context);
        const end = Math.min(lines.length, idx + context + 1);
        for (let ci = start; ci < end; ci++) {
          displaySet.add(ci);
        }
      }
      displayIndices = Array.from(displaySet).sort((a, b) => a - b);
    } else {
      displayIndices = Array.from(matchedLineIndices).sort((a, b) => a - b);
    }
    for (const idx of displayIndices) {
      const truncated = truncateLine(lines[idx]);
      if (matchedLineIndices.has(idx)) {
        outputLines.push(`${relPath}:${idx + 1}:${truncated}`);
      } else {
        outputLines.push(`${relPath}-${idx + 1}-${truncated}`);
      }
    }
  }
  const totalLines = outputLines.length;
  const [paged, appliedLimit] = applyHeadLimit(outputLines, headLimit, offset);
  const appliedOffset = offset > 0 ? offset : null;
  return [paged.join('\n'), fileCount, totalLines, appliedLimit, appliedOffset];
}

/**
 * count 模式：返回各文件的匹配次数。
 * 输出格式：filename:count
 */
function searchCount(
  root: string,
  compiled: RegExp,
  globPatterns: string[],
  headLimit: number,
  offset: number,
): [string, number, number, number | null, number | null] {
  const counts: [string, number][] = [];
  for (const filepath of walkFiles(root, globPatterns)) {
    let lines: string[];
    try {
      lines = fs.readFileSync(filepath, 'utf-8').split(/\r?\n/);
    } catch {
      continue;
    }
    const relPath = path.relative(root, filepath);
    let matchCount = 0;
    for (const line of lines) {
      if (compiled.test(line)) matchCount++;
    }
    if (matchCount > 0) {
      counts.push([relPath, matchCount]);
    }
  }
  const totalMatches = counts.reduce((sum, c) => sum + c[1], 0);
  const totalFiles = counts.length;
  const allLines = counts.map(([relPath, count]) => `${relPath}:${count}`);
  const [paged, appliedLimit] = applyHeadLimit(allLines, headLimit, offset);
  const appliedOffset = offset > 0 ? offset : null;
  return [paged.join('\n'), totalFiles, totalMatches, appliedLimit, appliedOffset];
}

/**
 * 执行文件内容搜索操作。
 *
 * 流程：校验搜索模式 → 验证路径 → 编译正则 → ReDoS 防护检查 →
 * 按输出模式分发搜索 → 返回结果
 *
 * @security ReDoS 防护：拒绝超过 200 字符的正则和包含危险嵌套量词的模式
 */
export async function executeGrep(request: GrepRequest): Promise<GrepResponse> {
  if (!request.pattern || !request.pattern.trim()) {
    return {
      success: false,
      error_code: EMPTY_PATTERN,
      message: errorMessage(EMPTY_PATTERN, ''),
    } as GrepError;
  }
  const filePath = request.path ?? '';
  const [resolvedPath, pathError] = validateGrepPath(filePath, request.memoryRoot);
  if (pathError) {
    return {
      success: false,
      error_code: pathError,
      message: errorMessage(pathError, filePath),
    } as GrepError;
  }
  const flags = request.case_insensitive ? 'i' : '';
  let compiled: RegExp;
  try {
    compiled = new RegExp(request.pattern, flags);
  } catch (e) {
    return {
      success: false,
      error_code: INVALID_PATTERN,
      message: `无效的正则表达式: ${request.pattern} (${e instanceof Error ? e.message : String(e)})`,
    } as GrepError;
  }
  // ReDoS 防护：检测嵌套量词等危险模式
  const dangerousNesting = /(?:\([^)]*\)[+*])[+*]|\([^)]*[+*][^)]*\)[+*]/;
  if (request.pattern.length > 200 || dangerousNesting.test(request.pattern)) {
    return {
      success: false,
      error_code: INVALID_PATTERN,
      message: '正则表达式过于复杂或包含危险嵌套量词',
    } as GrepError;
  }
  const globPatterns = parseGlobPatterns(request.glob ?? '');
  const mode = request.output_mode ?? 'files_with_matches';
  const headLimit = request.head_limit ?? 100;
  const offset = request.offset ?? 0;
  const context = request.before_context ?? request.after_context ?? request.context ?? 0;
  if (mode === 'files_with_matches') {
    const [filenames, numFiles, appliedLimit, appliedOffset] = await searchFilesWithMatches(
      resolvedPath!,
      compiled,
      globPatterns,
      headLimit,
      offset,
    );
    return {
      success: true,
      mode,
      num_files: numFiles,
      filenames,
      applied_limit: appliedLimit,
      applied_offset: appliedOffset,
    } as GrepResult;
  }
  if (mode === 'content') {
    const [content, numFiles, numLines, appliedLimit, appliedOffset] = searchContent(
      resolvedPath!,
      compiled,
      globPatterns,
      headLimit,
      offset,
      context,
    );
    return {
      success: true,
      mode,
      num_files: numFiles,
      content,
      num_lines: numLines,
      applied_limit: appliedLimit,
      applied_offset: appliedOffset,
    } as GrepResult;
  }
  if (mode === 'count') {
    const [content, numFiles, numMatches, appliedLimit, appliedOffset] = searchCount(
      resolvedPath!,
      compiled,
      globPatterns,
      headLimit,
      offset,
    );
    return {
      success: true,
      mode,
      num_files: numFiles,
      content,
      num_matches: numMatches,
      applied_limit: appliedLimit,
      applied_offset: appliedOffset,
    } as GrepResult;
  }
  return {
    success: false,
    error_code: INVALID_MODE,
    message: `不支持的输出模式: ${mode}`,
  } as GrepError;
}

/** 根据错误代码生成人类可读的错误消息 */
function errorMessage(errorCode: string, filePath: string): string {
  const messages: Record<string, string> = {
    PATH_UNSAFE: `路径不安全: ${filePath}`,
    PATH_OUTSIDE_ROOT: `路径超出根目录范围: ${filePath}`,
    PATH_NOT_FOUND: `路径不存在: ${filePath}`,
    INVALID_PATTERN: '无效的正则表达式模式',
    INVALID_MODE: '不支持的输出模式',
    EMPTY_PATTERN: '搜索模式不能为空',
  };
  return messages[errorCode] ?? `未知错误: ${errorCode}`;
}

export { validateGrepPath, parseGlobPatterns };
