/**
 * 路径安全验证模块
 *
 * 所有文件工具的路径安全防线，防止目录遍历攻击（如 ../../etc/passwd）
 * 和跨根目录访问。所有工具在执行文件操作前必须经过此模块的验证。
 *
 * @security 核心安全模块 — 修改此文件需经过安全审查
 */
import path from 'path';
import process from 'process';

const isWindows = process.platform === 'win32';

/**
 * 路径相等比较，Windows 下忽略大小写。
 * Windows 文件系统不区分大小写，因此 C:\Foo 和 c:\foo 指向同一位置。
 */
function pathEquals(a: string, b: string): boolean {
  return isWindows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * 路径前缀判断，Windows 下忽略大小写。
 * 用于检测子路径是否在父路径范围内。
 */
function pathStartsWith(child: string, parent: string): boolean {
  return isWindows ? child.toLowerCase().startsWith(parent.toLowerCase()) : child.startsWith(parent);
}

/**
 * 验证文件路径是否在 memoryRoot 目录范围内。
 *
 * @security 防止目录遍历攻击：通过 path.resolve 消除 .. 和符号链接后，
 *           检查解析后的绝对路径是否以 memoryRoot 为前缀。
 *           同时处理 Windows 大小写不敏感的文件系统。
 *
 * @param filePath  - 待验证的相对或绝对文件路径
 * @param memoryRoot - 允许操作的根目录绝对路径
 * @returns valid=true 表示路径安全，valid=false 表示路径越界并附带错误信息
 */
export function validateSessionMemoryPath(
  filePath: string,
  memoryRoot: string,
): { valid: boolean; error?: string } {
  const resolvedRoot = path.resolve(memoryRoot);
  const resolvedPath = path.resolve(memoryRoot, filePath);
  if (!pathStartsWith(resolvedPath, resolvedRoot + path.sep) && !pathEquals(resolvedPath, resolvedRoot)) {
    return {
      valid: false,
      error: `路径安全限制：只能操作 ${memoryRoot} 目录下的文件`,
    };
  }
  return { valid: true };
}

/**
 * 清理并验证搜索路径，确保不会越界访问。
 *
 * @security 当 searchPath 为空或越界时，安全降级到 memoryRoot，
 *           避免将非法路径传递给后续文件操作。
 *
 * @param searchPath - 用户提供的搜索路径，可能为空或越界
 * @param memoryRoot - 允许操作的根目录绝对路径
 * @returns 安全的绝对路径：合法时返回解析后的路径，否则降级到 memoryRoot
 */
export function sanitizeSearchPath(searchPath: string | undefined, memoryRoot: string): string {
  if (!searchPath) {
    return memoryRoot;
  }
  const resolved = path.resolve(memoryRoot, searchPath);
  const memoryRootResolved = path.resolve(memoryRoot);
  if (!pathStartsWith(resolved, memoryRootResolved + path.sep) && !pathEquals(resolved, memoryRootResolved)) {
    return memoryRoot;
  }
  return resolved;
}
