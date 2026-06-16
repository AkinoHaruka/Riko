/**
 * 文件编辑工具核心实现
 *
 * 实现精确字符串替换、unified diff 差异生成和原子写入。
 * 支持的操作模式：
 * - 替换：old_string 非空时，在文件中查找并替换指定文本
 * - 创建：old_string 为空且文件不存在时，创建新文件
 * - 清空：new_string 为空时，删除匹配的文本内容
 *
 * 安全机制：
 * - 路径必须经过 validateCommonPath 验证，防止目录遍历
 * - 文件大小超过 MAX_FILE_SIZE 时拒绝操作
 * - 非唯一匹配且未启用 replace_all 时拒绝操作
 * - 使用原子写入（先写临时文件再重命名）防止写入中断导致数据损坏
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  SAME_STRING,
  PATH_UNSAFE,
  PATH_OUTSIDE_ROOT,
  FILE_NOT_FOUND,
  FILE_EXISTS,
  STRING_NOT_FOUND,
  MULTIPLE_MATCHES,
  FILE_TOO_LARGE,
  MAX_FILE_SIZE,
  type EditRequest,
  type EditResult,
  type EditError,
  type EditResponse,
} from '../../tools/types.js';
import { validateCommonPath, resolveVirtualPath } from '../../core/validation/path.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('EditFile');

type ValidatePathResult = [string | null, string | null];

/**
 * 验证编辑操作的文件路径安全性。
 *
 * @security 通过 resolveVirtualPath + validateCommonPath 双重验证，
 *           确保路径不会越界到 memoryRoot 之外。
 *
 * @param filePath   - 待验证的文件路径
 * @param memoryRoot - 允许操作的根目录
 * @returns [解析后的绝对路径, 错误代码] — 路径无效时第一个元素为 null
 */
export function validateEditPath(filePath: string, memoryRoot?: string): ValidatePathResult {
  if (!filePath || filePath.trim() === '' || filePath.trim() === '.') {
    return [null, PATH_UNSAFE];
  }

  const { physicalRoot, relativePath } = resolveVirtualPath(filePath, memoryRoot);
  const result = validateCommonPath(relativePath, physicalRoot);

  if (result.error) {
    return [null, result.error];
  }

  return [result.resolvedPath, null];
}

interface EditContext {
  resolvedPath: string;
  fileContent: string;
  fileExists: boolean;
}

type ValidateEditResult = [EditContext | Record<string, unknown>, string | null];

/**
 * 编辑操作的完整前置校验。
 *
 * 校验顺序：新旧字符串是否相同 → 路径安全性 → 文件大小 →
 * 文件存在性（old_string 非空时文件必须存在）→
 * 文件非空（old_string 为空时文件必须不存在或为空）→
 * 文本匹配存在性 → 匹配唯一性
 *
 * @param filePath    - 目标文件路径
 * @param oldString   - 待替换的原始文本
 * @param newString   - 替换后的新文本
 * @param replaceAll  - 是否替换所有匹配
 * @param memoryRoot  - 允许操作的根目录
 * @returns [编辑上下文或附加信息, 错误代码] — 校验通过时错误代码为 null
 */
export function validateEdit(
  filePath: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  memoryRoot?: string,
): ValidateEditResult {
  if (oldString === newString) {
    return [{}, SAME_STRING];
  }

  const [resolvedPath, pathError] = validateEditPath(filePath, memoryRoot);
  if (pathError) {
    return [{}, pathError];
  }
  if (!resolvedPath) {
    return [{}, PATH_UNSAFE];
  }

  const fileExists = fs.existsSync(resolvedPath);

  if (fileExists) {
    const stat = fs.statSync(resolvedPath);
    if (stat.size > MAX_FILE_SIZE) {
      return [{}, FILE_TOO_LARGE];
    }
  }

  let fileContent = '';
  if (fileExists) {
    fileContent = fs.readFileSync(resolvedPath, 'utf-8');
  }

  // old_string 非空但文件不存在，无法执行替换
  if (oldString && !fileExists) {
    return [{}, FILE_NOT_FOUND];
  }

  // old_string 为空但文件已存在且非空，不能覆盖已有内容
  if (!oldString && fileExists && fileContent.trim() !== '') {
    return [{}, FILE_EXISTS];
  }

  if (oldString && !fileContent.includes(oldString)) {
    return [{}, STRING_NOT_FOUND];
  }

  // 未启用 replace_all 时，要求 old_string 在文件中唯一匹配
  if (oldString && !replaceAll) {
    const count = fileContent.split(oldString).length - 1;
    if (count > 1) {
      return [{ match_count: count }, MULTIPLE_MATCHES];
    }
  }

  return [
    {
      resolvedPath: resolvedPath,
      fileContent,
      fileExists,
    },
    null,
  ];
}

/**
 * 去除行尾空白字符。
 * Markdown 文件保留原始空白（尾随空格可能是语法的一部分，如硬换行），
 * 其他文件类型则清理行尾空白以减少无意义差异。
 */
function stripTrailingWhitespace(text: string, isMarkdown: boolean): string {
  if (isMarkdown) {
    return text;
  }

  const lines = text.split('\n');
  const stripped = lines.map((line) => line.replace(/\s+$/, ''));
  return stripped.join('\n');
}

/**
 * 对文件内容应用字符串替换操作。
 *
 * @param content     - 文件原始内容
 * @param oldString   - 待替换文本
 * @param newString   - 替换文本
 * @param replaceAll  - 是否替换所有匹配
 * @param isMarkdown  - 是否为 Markdown 文件（影响尾随空白处理）
 * @returns 替换后的文件内容
 */
export function applyEditToFile(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  isMarkdown: boolean,
): string {
  const processedNew = newString ? stripTrailingWhitespace(newString, isMarkdown) : '';

  if (oldString) {
    const replaceFn = replaceAll
      ? (c: string, s: string, r: string) => c.replaceAll(s, () => r)
      : (c: string, s: string, r: string) => c.replace(s, () => r);

    // 删除内容时，如果 oldString 末尾没有换行但文件中匹配文本后跟换行，
    // 则连同换行一起删除，避免留下空行
    if (!processedNew) {
      if (!oldString.endsWith('\n') && content.includes(oldString + '\n')) {
        return replaceFn(content, oldString + '\n', processedNew);
      }
    }

    return replaceFn(content, oldString, processedNew);
  }

  // old_string 为空时，整个文件内容替换为 new_string
  return processedNew;
}

/**
 * 生成 unified diff 格式的差异文本。
 *
 * @param filePath    - 文件路径（用于 diff 头部标识）
 * @param oldContent  - 变更前的内容
 * @param newContent  - 变更后的内容
 * @returns unified diff 格式的字符串，无差异时返回空字符串
 */
export function generateDiff(filePath: string, oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const hunks = computeUnifiedHunks(oldLines, newLines, 3);

  if (hunks.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);

  for (const hunk of hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
    for (const hunkLine of hunk.lines) {
      lines.push(hunkLine);
    }
  }

  return lines.join('\n') + '\n';
}

/** unified diff 的一个差异块 */
interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

/**
 * 计算两组行之间的 unified diff hunks。
 *
 * 算法：先通过 LCS 找出公共行，再根据 LCS 结果计算增删变更，
 * 最后将相邻变更合并为 hunks 并添加上下文行。
 *
 * @param oldLines - 原始行数组
 * @param newLines - 新行数组
 * @param context  - 上下文行数（默认 3）
 */
function computeUnifiedHunks(oldLines: string[], newLines: string[], context: number): Hunk[] {
  const lcs = computeLCS(oldLines, newLines);
  const changes = computeChanges(oldLines, newLines, lcs);

  if (changes.length === 0) {
    return [];
  }

  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;

  for (const change of changes) {
    const oldStart = Math.max(1, change.oldIdx - context + 1);
    const newStart = Math.max(1, change.newIdx - context + 1);

    // 当变更与前一个 hunk 足够接近时，合并到同一个 hunk
    if (
      currentHunk &&
      (oldStart <= currentHunk.oldStart + currentHunk.oldCount + context * 2 ||
        newStart <= currentHunk.newStart + currentHunk.newCount + context * 2)
    ) {
      extendHunk(currentHunk, change, oldLines, newLines, context);
    } else {
      if (currentHunk) {
        finalizeHunk(currentHunk, oldLines, newLines, context);
        hunks.push(currentHunk);
      }
      currentHunk = createHunk(change, oldLines, newLines, context);
    }
  }

  if (currentHunk) {
    finalizeHunk(currentHunk, oldLines, newLines, context);
    hunks.push(currentHunk);
  }

  return hunks;
}

/** 单行变更记录 */
interface Change {
  type: 'add' | 'delete';
  oldIdx: number;
  newIdx: number;
  line: string;
}

/**
 * 计算最长公共子序列（LCS）。
 *
 * 对于小文件（≤5000行）使用标准动态规划算法，精确度最高；
 * 对于大文件降级为贪心算法，避免 O(mn) 的时间和空间开销。
 *
 * @returns Map<oldLineIdx, newLineIdx> — 匹配行的索引映射
 */
function computeLCS(oldLines: string[], newLines: string[]): Map<number, number> {
  const m = oldLines.length;
  const n = newLines.length;

  // 大文件降级为贪心算法，避免内存和性能问题
  if (m > 5000 || n > 5000) {
    return computeSimpleLCS(oldLines, newLines);
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯找出匹配行的对应关系
  const matches = new Map<number, number>();
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      matches.set(i - 1, j - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return matches;
}

/**
 * 贪心 LCS 近似算法。
 *
 * 按顺序遍历旧行，对每行在新行中找到第一个出现在上次匹配位置之后的匹配。
 * 牺牲精确度换取 O(m+n) 的时间复杂度，适用于大文件。
 */
function computeSimpleLCS(oldLines: string[], newLines: string[]): Map<number, number> {
  const matches = new Map<number, number>();
  const newSet = new Map<string, number[]>();

  for (let j = 0; j < newLines.length; j++) {
    const line = newLines[j];
    if (!newSet.has(line)) {
      newSet.set(line, []);
    }
    newSet.get(line)!.push(j);
  }

  let lastNewIdx = -1;
  for (let i = 0; i < oldLines.length; i++) {
    const candidates = newSet.get(oldLines[i]);
    if (candidates) {
      for (const j of candidates) {
        if (j > lastNewIdx) {
          matches.set(i, j);
          lastNewIdx = j;
          break;
        }
      }
    }
  }

  return matches;
}

/**
 * 根据 LCS 匹配结果计算增删变更列表。
 * 未在 LCS 中的旧行标记为 delete，未在 LCS 中的新行标记为 add。
 */
function computeChanges(
  oldLines: string[],
  newLines: string[],
  lcs: Map<number, number>,
): Change[] {
  const changes: Change[] = [];
  const matchedOld = new Set(lcs.keys());
  const matchedNew = new Set(lcs.values());

  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    while (oi < oldLines.length && !matchedOld.has(oi)) {
      changes.push({ type: 'delete', oldIdx: oi, newIdx: ni, line: oldLines[oi] });
      oi++;
    }
    while (ni < newLines.length && !matchedNew.has(ni)) {
      changes.push({ type: 'add', oldIdx: oi, newIdx: ni, line: newLines[ni] });
      ni++;
    }
    if (oi < oldLines.length && ni < newLines.length) {
      oi++;
      ni++;
    }
  }

  return changes;
}

/** 创建新 hunk，包含前置上下文行和首个变更行 */
function createHunk(
  firstChange: Change,
  oldLines: string[],
  newLines: string[],
  context: number,
): Hunk {
  const hunk: Hunk = {
    oldStart: Math.max(1, firstChange.oldIdx + 1 - context),
    newStart: Math.max(1, firstChange.newIdx + 1 - context),
    oldCount: 0,
    newCount: 0,
    lines: [],
  };

  addContextBefore(hunk, firstChange, oldLines, newLines, context);
  addChangeToHunk(hunk, firstChange);

  return hunk;
}

/** 将变更行追加到已有 hunk */
function extendHunk(
  hunk: Hunk,
  change: Change,
  _oldLines: string[],
  _newLines: string[],
  _context: number,
): void {
  addChangeToHunk(hunk, change);
}

/** 在变更行之前添加上下文行（以空格前缀标记） */
function addContextBefore(
  hunk: Hunk,
  change: Change,
  oldLines: string[],
  newLines: string[],
  context: number,
): void {
  const startOld = Math.max(0, change.oldIdx - context);
  const startNew = Math.max(0, change.newIdx - context);

  let oi = startOld;
  let ni = startNew;
  while (oi < change.oldIdx && ni < change.newIdx) {
    hunk.lines.push(' ' + oldLines[oi]);
    hunk.oldCount++;
    hunk.newCount++;
    oi++;
    ni++;
  }
}

/** 将变更行添加到 hunk，delete 用 '-' 前缀，add 用 '+' 前缀 */
function addChangeToHunk(hunk: Hunk, change: Change): void {
  if (change.type === 'delete') {
    hunk.lines.push('-' + change.line);
    hunk.oldCount++;
  } else {
    hunk.lines.push('+' + change.line);
    hunk.newCount++;
  }
}

/** 在 hunk 末尾添加后置上下文行 */
function finalizeHunk(hunk: Hunk, oldLines: string[], newLines: string[], context: number): void {
  const lastLine = hunk.lines[hunk.lines.length - 1];
  let lastOldIdx: number;
  let lastNewIdx: number;

  // 根据最后一行的类型推算当前在旧/新文件中的位置
  if (lastLine!.startsWith('-')) {
    const deleteChanges = hunk.lines.filter((l) => l!.startsWith('-'));
    lastOldIdx = hunk.oldStart - 1 + deleteChanges.length;
    const addChanges = hunk.lines.filter((l) => l!.startsWith('+'));
    lastNewIdx = hunk.newStart - 1 + addChanges.length;
  } else if (lastLine!.startsWith('+')) {
    const addChanges = hunk.lines.filter((l) => l!.startsWith('+'));
    lastNewIdx = hunk.newStart - 1 + addChanges.length;
    const deleteChanges = hunk.lines.filter((l) => l!.startsWith('-'));
    lastOldIdx = hunk.oldStart - 1 + deleteChanges.length;
  } else {
    const ctxLines = hunk.lines.filter((l) => !l!.startsWith('-') && !l!.startsWith('+'));
    lastOldIdx = hunk.oldStart - 1 + ctxLines.length;
    lastNewIdx = hunk.newStart - 1 + ctxLines.length;
  }

  const contextAfterOld = Math.min(context, oldLines.length - lastOldIdx - 1);
  const contextAfterNew = Math.min(context, newLines.length - lastNewIdx - 1);
  // 取两侧都能提供的上下文行数的较小值，保持对齐
  const contextAfter = Math.min(contextAfterOld, contextAfterNew);

  for (let i = 1; i <= contextAfter; i++) {
    const oi = lastOldIdx + i;
    const ni = lastNewIdx + i;
    if (oi < oldLines.length && ni < newLines.length) {
      hunk.lines.push(' ' + oldLines[oi]);
      hunk.oldCount++;
      hunk.newCount++;
    }
  }
}

/**
 * 原子写入文件。
 *
 * @security 先写入同目录下的临时文件，再通过 rename 原子操作替换目标文件。
 *           rename 在同一文件系统上是原子的，即使写入过程中崩溃也不会损坏原文件。
 *           finally 块确保临时文件被清理。
 *
 * @param filePath - 目标文件路径
 * @param content  - 要写入的内容
 */
export function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const suffix = crypto.randomBytes(4).toString('hex');
  const tmpPath = path.join(dir, `${base}${ext}.tmp.${suffix}`);

  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } finally {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (e) {
        logger.warn('Failed to clean up temp file %s: %s', tmpPath, e);
      }
    }
  }
}

/**
 * 执行文件编辑操作的主入口。
 *
 * 流程：校验 → 应用替换 → 确保父目录存在 → 原子写入 → 生成 diff
 *
 * @param request - 编辑请求参数
 * @returns 编辑成功或失败的结果
 */
export function executeEdit(request: EditRequest): EditResponse {
  const [editContext, error] = validateEdit(
    request.file_path,
    request.old_string,
    request.new_string,
    request.replace_all ?? false,
    request.memoryRoot,
  );

  if (error) {
    const matchCount = (editContext as Record<string, unknown>).match_count ?? 0;
    return {
      success: false,
      error_code: error,
      message: errorMessage(error, request.file_path, matchCount as number),
    } satisfies EditError;
  }

  const ctx = editContext as EditContext;
  const resolvedPath = ctx.resolvedPath;
  const fileContent = ctx.fileContent;

  const isMarkdown = /\.(md|mdx)$/i.test(resolvedPath);

  const newContent = applyEditToFile(
    fileContent,
    request.old_string,
    request.new_string,
    request.replace_all ?? false,
    isMarkdown,
  );

  const parentDir = path.dirname(resolvedPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  atomicWrite(resolvedPath, newContent);

  const diff = generateDiff(request.file_path, fileContent, newContent);

  let message: string;
  if (!request.old_string) {
    message = `已创建文件: ${request.file_path}`;
  } else if (!request.new_string) {
    message = `已删除内容: ${request.file_path}`;
  } else {
    message = `已编辑文件: ${request.file_path}`;
  }

  return {
    success: true,
    file_path: request.file_path,
    diff,
    message,
  } satisfies EditResult;
}

/**
 * 读取文件内容（供其他工具复用）。
 *
 * @param filePath - 文件路径
 * @returns 读取结果，包含文件内容或错误信息
 */
export function readFile(filePath: string): {
  success: boolean;
  content?: string;
  file_path?: string;
  message?: string;
} {
  const [resolvedPath, pathError] = validateEditPath(filePath);
  if (pathError) {
    return { success: false, message: `路径不安全: ${pathError}` };
  }
  if (!resolvedPath) {
    return { success: false, message: '路径无效' };
  }

  if (!fs.existsSync(resolvedPath)) {
    return { success: false, message: '文件不存在' };
  }

  // 文件大小检查：超过 10MB 拒绝读取，避免内存溢出
  const stats = fs.statSync(resolvedPath);
  if (stats.size > 10 * 1024 * 1024) {
    return { success: false, message: `文件过大（${(stats.size / 1024 / 1024).toFixed(1)}MB），超过 10MB 限制` };
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  return {
    success: true,
    content,
    file_path: filePath,
  };
}

/**
 * 列出目录内容（供其他工具复用）。
 *
 * @param relPath - 相对路径，空或 '.' 表示根目录
 * @returns 目录条目列表，按目录优先、名称排序
 */
export function listDirectory(relPath: string): {
  success: boolean;
  path?: string;
  entries?: Array<{ name: string; type: string }>;
  message?: string;
} {
  const dirPath = (relPath ?? '').trim();

  let targetDir: string;

  if (dirPath && dirPath !== '.') {
    const { physicalRoot, relativePath } = resolveVirtualPath(dirPath);
    const result = validateCommonPath(relativePath, physicalRoot);
    if (result.error || !result.resolvedPath) {
      return { success: false, message: `路径不安全: ${result.error ?? '路径无效'}` };
    }
    targetDir = result.resolvedPath;
  } else {
    const { physicalRoot } = resolveVirtualPath('');
    targetDir = path.resolve(physicalRoot);
  }

  if (!fs.existsSync(targetDir)) {
    return { success: false, message: '目录不存在' };
  }

  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) {
    return { success: false, message: '路径不是一个目录' };
  }

  try {
    const entries = fs
      .readdirSync(targetDir, { withFileTypes: true })
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }))
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    return {
      success: true,
      path: relPath ?? '',
      entries,
    };
  } catch {
    return { success: false, message: '没有权限访问该目录' };
  }
}

/**
 * 删除文件（供其他工具复用）。
 *
 * @security 路径经过 validateEditPath 验证，且不允许删除目录。
 *
 * @param filePath - 要删除的文件路径
 */
export function deleteFile(filePath: string): {
  success: boolean;
  file_path?: string;
  message?: string;
} {
  const [resolvedPath, pathError] = validateEditPath(filePath);
  if (pathError) {
    return { success: false, message: `路径不安全: ${pathError}` };
  }
  if (!resolvedPath) {
    return { success: false, message: '路径无效' };
  }

  if (!fs.existsSync(resolvedPath)) {
    return { success: false, message: '文件不存在' };
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    return { success: false, message: '无法删除目录，请使用目录删除工具' };
  }

  try {
    fs.unlinkSync(resolvedPath);
    return {
      success: true,
      file_path: filePath,
      message: `已删除文件: ${filePath}`,
    };
  } catch {
    return { success: false, message: '没有权限删除该文件' };
  }
}

/**
 * 根据错误代码生成人类可读的错误消息。
 *
 * @param errorCode - 错误代码常量
 * @param filePath  - 相关文件路径
 * @param matchCount - 匹配数量（仅 MULTIPLE_MATCHES 时使用）
 */
export function errorMessage(errorCode: string, filePath: string, matchCount: number = 0): string {
  const messages: Record<string, string> = {
    [SAME_STRING]: 'old_string 与 new_string 相同，无需替换',
    [PATH_UNSAFE]: `路径不安全: ${filePath}`,
    [PATH_OUTSIDE_ROOT]: `路径超出根目录范围: ${filePath}`,
    [FILE_NOT_FOUND]: `文件不存在: ${filePath}`,
    [FILE_EXISTS]: `文件已存在且非空，无法创建: ${filePath}`,
    [STRING_NOT_FOUND]: `未在文件中找到指定文本: ${filePath}`,
    [MULTIPLE_MATCHES]: `找到 ${matchCount} 处匹配，但 replace_all 未启用: ${filePath}`,
    [FILE_TOO_LARGE]: `文件超过大小限制: ${filePath}`,
  };
  return messages[errorCode] ?? `未知错误: ${errorCode}`;
}
