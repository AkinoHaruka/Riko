/**
 * 文件路径校验与虚拟路径解析。
 *
 * 安全性：
 * - 拒绝包含空字节 (\x00) 的路径（Null 字节注入攻击防护）
 * - 拒绝包含 .. 的路径（目录遍历攻击防护）
 * - 拒绝绝对路径（防止写入系统目录）
 * - 确保解析后的路径不超出允许的根目录
 *
 * 虚拟路径映射：
 * - system_prompts/ → autoDreamConfig.systemPromptsDir
 * - prompts/ → PROMPT_DIR
 * - 其余 → memoryRootDir 或其子目录
 */
import path from 'path';
import { autoDreamConfig } from '../../config/index.js';
import { PROMPT_DIR } from '../../prompts/paths.js';

export const PATH_UNSAFE = 'PATH_UNSAFE';
export const PATH_OUTSIDE_ROOT = 'PATH_OUTSIDE_ROOT';

export interface PathValidationResult {
  resolvedPath: string | null;
  error: string | null;
}

export function validateCommonPath(filePath: string, memoryRoot: string): PathValidationResult {
  if (filePath.includes('\x00')) {
    return { resolvedPath: null, error: PATH_UNSAFE };
  }

  filePath = filePath.trim();

  const parts = filePath.split(/[/\\]/);
  if (parts.includes('..')) {
    return { resolvedPath: null, error: PATH_UNSAFE };
  }

  if (filePath && (path.isAbsolute(filePath) || filePath.startsWith('/'))) {
    return { resolvedPath: null, error: PATH_UNSAFE };
  }

  const rootResolved = path.resolve(memoryRoot);

  let resolved: string;
  if (!filePath || filePath === '.') {
    resolved = rootResolved;
  } else {
    resolved = path.resolve(rootResolved, filePath);
  }

  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    return { resolvedPath: null, error: PATH_OUTSIDE_ROOT };
  }

  return { resolvedPath: resolved, error: null };
}

export interface VirtualPathResult {
  physicalRoot: string;
  relativePath: string;
}

export function resolveVirtualPath(filePath: string, memoryRoot?: string): VirtualPathResult {
  const normalized = filePath.replace(/\\/g, '/');

  if (normalized.startsWith('system_prompts/')) {
    const relative = normalized.slice('system_prompts/'.length) || '.';
    return {
      physicalRoot: path.resolve(autoDreamConfig.systemPromptsDir),
      relativePath: relative,
    };
  }

  if (normalized.startsWith('prompts/')) {
    const relative = normalized.slice('prompts/'.length) || '.';
    return {
      physicalRoot: path.resolve(PROMPT_DIR),
      relativePath: relative,
    };
  }

  // persistent_memory.md 始终路由到记忆根目录（而非 auto_dream 子目录）
  if (path.basename(normalized) === 'persistent_memory.md') {
    return {
      physicalRoot: path.resolve(autoDreamConfig.memoryRootDir),
      relativePath: 'persistent_memory.md',
    };
  }

  const root = path.resolve(memoryRoot || autoDreamConfig.memoryRootDir);
  let relative = filePath;

  // 如果 AI 误传了包含 memoryRoot 前缀的路径（如 data/memories/auto_dream/traits_roles/foo.md），
  // 自动剥离前缀，避免路径双重嵌套
  const rootRelativeToCwd = path.relative(process.cwd(), root).replace(/\\/g, '/');
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (rootRelativeToCwd && normalizedPath.startsWith(rootRelativeToCwd + '/')) {
    relative = normalizedPath.slice(rootRelativeToCwd.length + 1);
  }

  return {
    physicalRoot: root,
    relativePath: relative,
  };
}
