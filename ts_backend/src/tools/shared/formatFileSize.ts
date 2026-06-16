/**
 * 文件大小人类可读格式化工具
 *
 * 将字节数转换为 B / KB / MB / GB 的人类可读格式，
 * 供 fileStats、wordCount 等工具复用。
 *
 * @param sizeBytes - 文件大小（字节）
 * @returns 格式化后的字符串，如 "1.5MB"
 */
export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes}B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)}KB`;
  }
  if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
