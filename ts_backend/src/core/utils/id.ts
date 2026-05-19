/**
 * 基于时间戳 + 表名前缀的 ID 生成器。
 *
 * 设计原因：
 * - 相比自增 INTEGER ID，TEXT ID 避免跨表迁移时 ID 冲突。
 * - 时间戳前缀使 ID 天然有序，方便调试时按创建时间排序。
 * - 同一毫秒内生成的 ID 自动加 _1、_2 后缀，保证唯一。
 */
const PREFIXES = {
  users: 'usr',
  conversations: 'conv',
  messages: 'msg',
  memories: 'mem',
  settings: 'set',
  session_notes_state: 'sns',
  sub_agent_activities: 'saa',
  api_monitor_records: 'amr',
} as const;

type TableName = keyof typeof PREFIXES;

let lastMs = '';
let seq = 0;

function pad(n: number, len: number): string {
  return n.toString().padStart(len, '0');
}

/** 生成全局唯一 ID，格式：前缀_年月日时分秒毫秒，同一毫秒内递增后缀 */
export function generateId(table: TableName): string {
  const now = new Date();
  const ms =
    `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}` +
    `${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}` +
    `${pad(now.getMilliseconds(), 3)}`;

  if (ms === lastMs) {
    seq++;
  } else {
    lastMs = ms;
    seq = 0;
  }

  const suffix = seq > 0 ? `_${seq}` : '';
  return `${PREFIXES[table]}_${ms}${suffix}`;
}

export { type TableName, PREFIXES };
