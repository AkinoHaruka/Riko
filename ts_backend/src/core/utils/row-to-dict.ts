/** SQLite 时间戳转 ISO-8601 格式：将空格分隔的 datetime 末尾补充 'Z' */
export function rowToDict<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const d = { ...row } as Record<string, unknown>;
  for (const key of ['created_at', 'updated_at'] as const) {
    const val = d[key];
    if (typeof val === 'string' && val && !val.endsWith('Z')) {
      d[key] = val.replace(' ', 'T') + 'Z';
    }
  }
  return d as unknown as T;
}
