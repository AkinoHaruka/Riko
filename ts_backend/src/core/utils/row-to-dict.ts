/**
 * SQLite 行数据转换工具。
 * 将 SQLite 返回的时间戳字段从空格分隔格式（如 "2024-01-01 12:00:00"）
 * 转换为 ISO-8601 格式（如 "2024-01-01T12:00:00Z"），确保前端能正确解析。
 *
 * @module core/utils/row-to-dict
 */

/**
 * 将数据库行对象中的时间戳字段转换为 ISO-8601 格式。
 * 仅处理 created_at 和 updated_at 字段，已包含时区标识的跳过。
 *
 * @param row - 数据库查询返回的行对象
 * @returns 时间戳字段已转换的新对象（浅拷贝）
 */
export function rowToDict<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const d = { ...row } as Record<string, unknown>;
  for (const key of ['created_at', 'updated_at'] as const) {
    const val = d[key];
    if (typeof val === 'string' && val) {
      // 已包含时区标识（Z 或 +HH:MM / -HH:MM）则跳过
      if (/[Zz]$/.test(val) || /[+-]\d{2}:\d{2}$/.test(val) || /[+-]\d{4}$/.test(val)) continue;
      d[key] = val.replace(' ', 'T') + 'Z';
    }
  }
  return d as unknown as T;
}
