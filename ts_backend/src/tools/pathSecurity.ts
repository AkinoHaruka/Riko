// 路径安全验证工具：限制文件操作只能在指定根目录范围内进行
import path from 'path';

export function validateSessionMemoryPath(
  filePath: string,
  _conversationId: string,
  memoryRoot: string,
): { valid: boolean; error?: string } {
  const resolvedRoot = path.resolve(memoryRoot);
  const resolvedPath = path.resolve(memoryRoot, filePath);
  if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
    return {
      valid: false,
      error: `路径安全限制：只能操作 ${memoryRoot} 目录下的文件`,
    };
  }
  return { valid: true };
}

export function sanitizeSearchPath(searchPath: string | undefined, memoryRoot: string): string {
  if (!searchPath) {
    return memoryRoot;
  }
  const resolved = path.resolve(memoryRoot, searchPath);
  if (!resolved.startsWith(path.resolve(memoryRoot))) {
    return memoryRoot;
  }
  return resolved;
}
