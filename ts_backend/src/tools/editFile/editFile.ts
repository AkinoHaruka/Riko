// 文件编辑工具：实现精确字符串替换、差异对比生成、原子写入
// 支持：替换/创建/清空文件内容，生成 unified diff 格式差异
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

type ValidatePathResult = [string | null, string | null];

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

  const fileExists = fs.existsSync(resolvedPath!);

  if (fileExists) {
    const stat = fs.statSync(resolvedPath!);
    if (stat.size > MAX_FILE_SIZE) {
      return [{}, FILE_TOO_LARGE];
    }
  }

  let fileContent = '';
  if (fileExists) {
    fileContent = fs.readFileSync(resolvedPath!, 'utf-8');
  }

  if (oldString && !fileExists) {
    return [{}, FILE_NOT_FOUND];
  }

  if (!oldString && fileExists && fileContent.trim() !== '') {
    return [{}, FILE_EXISTS];
  }

  if (oldString && !fileContent.includes(oldString)) {
    return [{}, STRING_NOT_FOUND];
  }

  if (oldString && !replaceAll) {
    const count = fileContent.split(oldString).length - 1;
    if (count > 1) {
      return [{ match_count: count }, MULTIPLE_MATCHES];
    }
  }

  return [
    {
      resolvedPath: resolvedPath!,
      fileContent,
      fileExists,
    },
    null,
  ];
}

function stripTrailingWhitespace(text: string, isMarkdown: boolean): string {
  if (isMarkdown) {
    return text;
  }

  const lines = text.split('\n');
  const stripped = lines.map((line) => line.replace(/\s+$/, ''));
  return stripped.join('\n');
}

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

    if (!processedNew) {
      if (!oldString.endsWith('\n') && content.includes(oldString + '\n')) {
        return replaceFn(content, oldString + '\n', processedNew);
      }
    }

    return replaceFn(content, oldString, processedNew);
  }

  return processedNew;
}

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

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

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

interface Change {
  type: 'add' | 'delete';
  oldIdx: number;
  newIdx: number;
  line: string;
}

function computeLCS(oldLines: string[], newLines: string[]): Map<number, number> {
  const m = oldLines.length;
  const n = newLines.length;

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

function extendHunk(
  hunk: Hunk,
  change: Change,
  _oldLines: string[],
  _newLines: string[],
  _context: number,
): void {
  addChangeToHunk(hunk, change);
}

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

function addChangeToHunk(hunk: Hunk, change: Change): void {
  if (change.type === 'delete') {
    hunk.lines.push('-' + change.line);
    hunk.oldCount++;
  } else {
    hunk.lines.push('+' + change.line);
    hunk.newCount++;
  }
}

function finalizeHunk(hunk: Hunk, oldLines: string[], newLines: string[], context: number): void {
  const lastLine = hunk.lines[hunk.lines.length - 1];
  let lastOldIdx: number;
  let lastNewIdx: number;

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
      } catch {
        // 清理失败不影响主流程
      }
    }
  }
}

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

  if (!fs.existsSync(resolvedPath!)) {
    return { success: false, message: '文件不存在' };
  }

  const content = fs.readFileSync(resolvedPath!, 'utf-8');
  return {
    success: true,
    content,
    file_path: filePath,
  };
}

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
    if (result.error) {
      return { success: false, message: `路径不安全: ${result.error}` };
    }
    targetDir = result.resolvedPath!;
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

export function deleteFile(filePath: string): {
  success: boolean;
  file_path?: string;
  message?: string;
} {
  const [resolvedPath, pathError] = validateEditPath(filePath);
  if (pathError) {
    return { success: false, message: `路径不安全: ${pathError}` };
  }

  if (!fs.existsSync(resolvedPath!)) {
    return { success: false, message: '文件不存在' };
  }

  const stat = fs.statSync(resolvedPath!);
  if (stat.isDirectory()) {
    return { success: false, message: '无法删除目录，请使用目录删除工具' };
  }

  try {
    fs.unlinkSync(resolvedPath!);
    return {
      success: true,
      file_path: filePath,
      message: `已删除文件: ${filePath}`,
    };
  } catch {
    return { success: false, message: '没有权限删除该文件' };
  }
}

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
