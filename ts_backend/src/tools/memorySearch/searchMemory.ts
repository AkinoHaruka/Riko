/**
 * 长期记忆搜索工具核心实现
 *
 * 在 auto_dream 目录下的 .md 文件中按关键词搜索内容，
 * 支持按记忆类型过滤，返回匹配行及其上下文。
 *
 * 安全机制：
 * - type 参数经过严格验证，防止路径遍历（拒绝包含 ..、/、\ 的值）
 * - type 必须是预定义的合法记忆类型之一
 * - 单文件大小限制为 512KB，避免读取过大文件
 * - 搜索关键词转义为字面量正则，防止注入
 */
import fs from 'fs';
import path from 'path';
import { getAutoDreamRoot } from '../../memoryStorage/paths.js';
import { MEMORY_TYPES } from '../../memoryStorage/types.js';

/** 搜索记忆请求 */
export interface SearchMemoryRequest {
  /** 搜索关键词 */
  query: string;
  /** 可选的记忆类型过滤 */
  type?: string;
}

/** 搜索记忆结果 */
export interface SearchMemoryResult {
  success: boolean;
  matches?: Array<{ file: string; line: string }>;
  message?: string;
}

const MAX_FILE_BYTES = 512 * 1024;
const MAX_MATCHES = 100;
const CONTEXT_LINES = 1;

/** 递归遍历目录，生成所有 .md 文件路径 */
function* walkMdFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMdFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield fullPath;
    }
  }
}

/**
 * 执行长期记忆搜索。
 *
 * 流程：获取 auto_dream 根目录 → 验证 type 参数 →
 * 转义搜索关键词为字面量正则 → 遍历 .md 文件搜索 →
 * 收集匹配行及上下文 → 返回结果
 *
 * @security type 参数验证防止路径遍历，搜索关键词转义防止正则注入
 *
 * @param req - 搜索请求
 * @returns 搜索结果，包含匹配的文件和行内容
 */
export function executeSearchMemory(req: SearchMemoryRequest): SearchMemoryResult {
  const memoryRoot = getAutoDreamRoot();

  if (!fs.existsSync(memoryRoot)) {
    return { success: true, matches: [], message: '长期记忆目录尚不存在' };
  }

  // 验证 req.type：防止路径遍历，限制为合法记忆类型
  if (req.type) {
    if (req.type.includes('..') || req.type.includes('/') || req.type.includes('\\')) {
      return { success: false, message: '非法的记忆类型参数' };
    }
    if (!(MEMORY_TYPES as readonly string[]).includes(req.type)) {
      return { success: false, message: `无效的记忆类型: ${req.type}，合法类型: ${(MEMORY_TYPES as readonly string[]).join(', ')}` };
    }
  }

  const searchPath = req.type ? path.join(memoryRoot, req.type) : memoryRoot;

  if (req.type && !fs.existsSync(searchPath)) {
    return { success: true, matches: [], message: `记忆类型目录不存在: ${req.type}` };
  }

  const query = req.query.trim();
  if (!query) {
    return { success: false, message: '搜索关键词不能为空' };
  }

  // 将搜索关键词转义为字面量正则，防止正则注入攻击
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let compiled: RegExp;
  try {
    compiled = new RegExp(escapedQuery, 'i');
  } catch {
    return { success: false, message: `无效的搜索关键词: ${query}` };
  }

  const matches: Array<{ file: string; line: string }> = [];

  for (const filePath of walkMdFiles(searchPath)) {
    if (matches.length >= MAX_MATCHES) break;

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_BYTES) continue;
    } catch {
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const relPath = path.relative(searchPath, filePath);
    const matchedIndices = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
      if (compiled.test(lines[i])) {
        matchedIndices.add(i);
      }
    }

    if (matchedIndices.size === 0) continue;

    // 收集匹配行及其上下文行
    const displayIndices = new Set<number>();
    for (const idx of matchedIndices) {
      for (
        let ci = Math.max(0, idx - CONTEXT_LINES);
        ci <= Math.min(lines.length - 1, idx + CONTEXT_LINES);
        ci++
      ) {
        displayIndices.add(ci);
      }
    }

    const sorted = Array.from(displayIndices).sort((a, b) => a - b);
    for (const idx of sorted) {
      if (matches.length >= MAX_MATCHES) break;
      // 截断过长的行，避免返回过多数据
      matches.push({ file: relPath, line: lines[idx].slice(0, 200) });
    }
  }

  return { success: true, matches };
}
