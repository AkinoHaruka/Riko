/**
 * 带行号格式化文本行工具
 *
 * 将文本行数组添加右对齐的行号前缀（行号 + → 分隔符），
 * 供 readHead、readTail 等工具复用。
 *
 * @param lines     - 待格式化的文本行数组
 * @param startLine - 起始行号（从 1 开始）
 * @returns [格式化后的内容文本, 结束行号]
 */
export function formatLinesWithNumbers(
  lines: string[],
  startLine: number,
): [content: string, endLine: number] {
  const endLine = startLine + lines.length - 1;
  const width = String(endLine).length;

  const formattedLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNum = startLine + i;
    formattedLines.push(`${String(lineNum).padStart(width)}\u2192${lines[i]}`);
  }

  return [formattedLines.join('\n'), endLine];
}
