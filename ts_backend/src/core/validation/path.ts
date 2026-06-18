/**
 * 文件路径校验与虚拟路径解析。
 *
 * @security 安全性：
 * - 拒绝包含空字节 (\x00) 的路径（Null 字节注入攻击防护）
 * - 拒绝包含 .. 的路径（目录遍历攻击防护）
 * - 拒绝绝对路径（防止写入系统目录）
 * - 确保解析后的路径不超出允许的根目录
 *
 * 虚拟路径映射：
 * - system_prompts/ → 系统提示词目录（通过 setupVirtualPathMapping 注入）
 * - prompts/ → 提示词模板目录（通过 setupVirtualPathMapping 注入）
 * - 其余 → 记忆根目录或其子目录
 *
 * @module core/validation/path
 */
import path from 'path';
import fs from 'fs';
import process from 'process';

const isWindows = process.platform === 'win32';

/** 跨平台路径比较：Windows 下忽略大小写 */
function pathEquals(a: string, b: string): boolean {
  return isWindows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** 跨平台路径前缀判断：Windows 下忽略大小写 */
function pathStartsWith(child: string, parent: string): boolean {
  return isWindows ? child.toLowerCase().startsWith(parent.toLowerCase()) : child.startsWith(parent);
}

/** @security 路径不安全错误标识（含空字节、.. 或绝对路径） */
export const PATH_UNSAFE = 'PATH_UNSAFE';
/** @security 路径超出根目录错误标识 */
export const PATH_OUTSIDE_ROOT = 'PATH_OUTSIDE_ROOT';

/** 路径校验结果 */
export interface PathValidationResult {
  resolvedPath: string | null;
  error: string | null;
}

/**
 * @security 校验文件路径安全性并解析为绝对路径。
 * 依次检查：空字节 → .. 遍历 → 绝对路径 → 是否超出根目录。
 *
 * @param filePath - 待校验的相对文件路径
 * @param memoryRoot - 允许的根目录绝对路径
 * @returns 校验结果，resolvedPath 为解析后的绝对路径，error 为错误标识
 */
export function validateCommonPath(filePath: string, memoryRoot: string): PathValidationResult {
  if (filePath.includes('\x00')) {
    return { resolvedPath: null, error: PATH_UNSAFE };
  }

  filePath = filePath.trim();

  const parts = filePath.split(/[/\\]/);
  if (parts.includes('..')) {
    return { resolvedPath: null, error: PATH_UNSAFE };
  }

  // 跨平台绝对路径检查：Linux CI 上 path.isAbsolute('C:\\Windows') 会返回 false，
  // 因此额外识别 Windows 盘符路径，避免路径遍历绕过
  const windowsAbsolutePattern = /^[A-Za-z]:[\\/]/;
  if (
    filePath &&
    (path.isAbsolute(filePath) || filePath.startsWith('/') || windowsAbsolutePattern.test(filePath))
  ) {
    return { resolvedPath: null, error: PATH_UNSAFE };
  }

  const rootResolved = path.resolve(memoryRoot);

  let resolved: string;
  if (!filePath || filePath === '.') {
    resolved = rootResolved;
  } else {
    resolved = path.resolve(rootResolved, filePath);
  }

  // @security 使用 realpathSync 解析符号链接的真实路径，防止通过符号链接逃逸到根目录外
  try {
    const realResolved = fs.realpathSync(resolved);
    const realRoot = fs.realpathSync(rootResolved);
    if (!pathStartsWith(realResolved, realRoot + path.sep) && !pathEquals(realResolved, realRoot)) {
      return { resolvedPath: null, error: PATH_OUTSIDE_ROOT };
    }
  } catch {
    // 路径不存在时 realpathSync 会抛错，此时使用原始解析路径做前缀检查
    if (!pathStartsWith(resolved, rootResolved + path.sep) && !pathEquals(resolved, rootResolved)) {
      return { resolvedPath: null, error: PATH_OUTSIDE_ROOT };
    }
  }

  return { resolvedPath: resolved, error: null };
}

/** 虚拟路径解析结果 */
export interface VirtualPathResult {
  physicalRoot: string;
  relativePath: string;
}

/**
 * 虚拟路径映射配置。
 * 在应用启动时通过 setupVirtualPathMapping() 注入，
 * 解耦本模块对 config/ 和 prompts/ 的直接依赖。
 */
interface VirtualPathMapping {
  /** 记忆文件根目录 */
  memoryRootDir: string;
  /** 系统提示词目录 */
  systemPromptsDir: string;
  /** 提示词模板目录 */
  promptDir: string;
}

/** 启动时注入的虚拟路径映射配置 */
let virtualPathMapping: VirtualPathMapping | null = null;

/**
 * 在应用启动时配置虚拟路径映射。
 * 必须在使用 resolveVirtualPath 之前调用。
 */
export function setupVirtualPathMapping(mapping: VirtualPathMapping): void {
  virtualPathMapping = mapping;
}

/**
 * 获取虚拟路径映射配置。
 * 优先使用通过 setupVirtualPathMapping() 注入的配置，
 * 未注入时回退到环境变量默认值（兼容测试和未初始化场景）。
 */
function getMapping(): VirtualPathMapping {
  if (virtualPathMapping) {
    return virtualPathMapping;
  }
  // 回退：直接从环境变量读取默认值
  return {
    memoryRootDir: process.env.MEMORY_ROOT_DIR || './data/memories',
    systemPromptsDir: process.env.SYSTEM_PROMPTS_DIR || './data/prompts',
    promptDir: process.env.PROMPT_DIR || './data/prompts',
  };
}

/**
 * 将虚拟路径解析为物理根目录和相对路径。
 * 虚拟路径前缀决定映射到哪个物理目录：
 * - system_prompts/ → 系统提示词目录
 * - prompts/ → 提示词模板目录
 * - persistent_memory.md → 记忆根目录
 * - 其余 → 记忆根目录（自动剥离可能的前缀重复）
 *
 * @param filePath - 虚拟文件路径
 * @param memoryRoot - 可选的记忆根目录覆盖
 * @returns 物理根目录与相对路径
 */
export function resolveVirtualPath(filePath: string, memoryRoot?: string): VirtualPathResult {
  const mapping = getMapping();
  const normalized = filePath.replace(/\\/g, '/');

  if (normalized.startsWith('system_prompts/')) {
    const relative = normalized.slice('system_prompts/'.length) || '.';
    return {
      physicalRoot: path.resolve(mapping.systemPromptsDir),
      relativePath: relative,
    };
  }

  if (normalized.startsWith('prompts/')) {
    const relative = normalized.slice('prompts/'.length) || '.';
    return {
      physicalRoot: path.resolve(mapping.promptDir),
      relativePath: relative,
    };
  }

  // persistent_memory.md 始终路由到记忆根目录（而非 auto_dream 子目录）
  if (path.basename(normalized) === 'persistent_memory.md') {
    return {
      physicalRoot: path.resolve(mapping.memoryRootDir),
      relativePath: 'persistent_memory.md',
    };
  }

  const root = path.resolve(memoryRoot || mapping.memoryRootDir);
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

// ─── 路径安全增强（2026-06） ───

/**
 * @security 检测路径中是否包含 `..` 遍历组件。
 *
 * 与 validateCommonPath 的 `parts.includes('..')` 检查互补，
 * 此函数可独立使用，用于在路径拼接前预检查。
 *
 * @param filePath - 待检查的路径
 * @returns true 表示路径含 `..` 组件
 */
export function hasTraversalComponent(filePath: string): boolean {
  const parts = filePath.split(/[/\\]/);
  return parts.includes('..');
}

/**
 * @security 校验解析后的路径是否在指定根目录内。
 *
 * 使用 realpathSync 解析符号链接，防止通过符号链接逃逸到根目录外。
 * 路径不存在时回退到 path.resolve 的结果做前缀检查。
 *
 * @param resolvedPath - 已解析的绝对路径
 * @param rootDir - 允许的根目录绝对路径
 * @returns true 表示路径在根目录内
 */
export function validateWithinDir(resolvedPath: string, rootDir: string): boolean {
  const rootResolved = path.resolve(rootDir);

  try {
    // 优先使用 realpathSync 解析符号链接
    const realResolved = fs.realpathSync(resolvedPath);
    const realRoot = fs.realpathSync(rootResolved);
    return pathStartsWith(realResolved, realRoot + path.sep) || pathEquals(realResolved, realRoot);
  } catch {
    // 路径不存在时回退到前缀检查
    return pathStartsWith(resolvedPath, rootResolved + path.sep) || pathEquals(resolvedPath, rootResolved);
  }
}

/**
 * @security 增强的路径校验，综合检查多种安全威胁。
 *
 * 检查项：
 * 1. 空字节注入（\x00）
 * 2. 目录遍历（.. 组件）
 * 3. 绝对路径（防止写入系统目录）
 * 4. 符号链接逃逸（realpathSync 解析后是否在 root 内）
 *
 * 与 validateCommonPath 的区别：
 * - validateCommonPath 返回 PathValidationResult（含 resolvedPath 和 error）
 * - validatePathEnhanced 返回布尔值，适用于仅需判断是否安全的场景
 *
 * @param filePath - 待校验的相对文件路径
 * @param rootDir - 允许的根目录绝对路径
 * @returns true 表示路径安全
 */
export function validatePathEnhanced(filePath: string, rootDir: string): boolean {
  // 1. 空字节检查
  if (filePath.includes('\x00')) {
    return false;
  }

  // 2. 目录遍历检查
  if (hasTraversalComponent(filePath)) {
    return false;
  }

  // 3. 绝对路径检查
  const trimmed = filePath.trim();
  if (trimmed && (path.isAbsolute(trimmed) || trimmed.startsWith('/'))) {
    return false;
  }

  // 4. 解析后路径是否在 root 内
  const rootResolved = path.resolve(rootDir);
  let resolved: string;
  if (!trimmed || trimmed === '.') {
    resolved = rootResolved;
  } else {
    resolved = path.resolve(rootResolved, trimmed);
  }

  return validateWithinDir(resolved, rootResolved);
}
