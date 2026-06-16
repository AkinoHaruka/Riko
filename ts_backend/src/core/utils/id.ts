/**
 * 基于时间戳 + 表名前缀的 ID 生成器。
 *
 * 设计原因：
 * - 相比自增 INTEGER ID，TEXT ID 避免跨表迁移时 ID 冲突。
 * - 时间戳前缀使 ID 天然有序，方便调试时按创建时间排序。
 * - 同一毫秒内生成的 ID 自动加 _1、_2 后缀，保证唯一。
 *
 * @module core/utils/id
 */
/** 各表名对应的 ID 前缀，便于从 ID 直观判断所属表 */
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

/** 表名联合类型，限定 generateId 只接受已注册前缀的表名 */
type TableName = keyof typeof PREFIXES;

/** 上一次生成 ID 的时间戳毫秒部分，用于检测同一毫秒内的重复调用 */
let lastMs = '';
/** 同一毫秒内的序列号，保证唯一性 */
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
  } else if (ms < lastMs) {
    // 时钟回拨：保持 lastMs 不变，递增 seq 以保证唯一性
    seq++;
  } else {
    lastMs = ms;
    seq = 0;
  }

  const suffix = seq > 0 ? `_${seq}` : '';
  return `${PREFIXES[table]}_${ms}${suffix}`;
}

export { type TableName, PREFIXES };
