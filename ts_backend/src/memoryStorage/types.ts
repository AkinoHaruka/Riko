/**
 * 记忆存储类型定义
 *
 * 定义记忆系统的核心常量和类型：
 * - 文件大小和行数限制
 * - 记忆类型枚举（traits_roles、interaction_rules、key_experiences、promises_goals、emotions）
 * - 记忆文件头结构（MemoryHeader）
 * - 不应保存的内容清单
 * - 索引文件截断工具
 */
export const ENTRYPOINT_NAME = 'INDEX.md';
/** 索引文件最大行数，超出时截断以控制 AI 上下文长度 */
export const MAX_ENTRYPOINT_LINES = 200;
/** 索引文件最大字节数，作为行数限制的补充约束 */
export const MAX_ENTRYPOINT_BYTES = 25_000;
/** 单次扫描最多处理的记忆文件数，防止记忆过多时拖慢系统 */
export const MAX_MEMORY_FILES = 200;
/** 解析 frontmatter 时最多读取的行数，避免大文件拖慢解析 */
export const FRONTMATTER_MAX_LINES = 30;

/**
 * 记忆类型枚举，按抽象层次从高到低排列：
 * - traits_roles：身份与角色定位
 * - interaction_rules：互动规则与边界
 * - key_experiences：关键经历与里程碑
 * - promises_goals：约定与长期目标
 * - emotions：情感与关系
 */
export const MEMORY_TYPES = [
  'traits_roles',
  'interaction_rules',
  'key_experiences',
  'promises_goals',
  'emotions',
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** 各记忆类型的中文说明，用于生成索引文件模板和 UI 展示 */
export const MEMORY_TYPES_INFO: Record<MemoryType, string> = {
  traits_roles: "特质与角色 — '你是谁，我是谁'：用户身份、AI 角色定位、性格偏好",
  interaction_rules: "互动规则 — '我们如何对待彼此'：沟通风格、行为边界、反馈偏好",
  key_experiences: "重要经历 — '经历了什么，有什么暗号'：关键事件、里程碑、共享暗号",
  promises_goals: "约定与目标 — '我们要走向哪里'：共同承诺、长期目标、待办约定",
  emotions: "情感与关系 — '你感觉怎样，我们怎样'：情感状态、关系阶段、情感触发词、情绪偏好",
};

/**
 * 不应保存到记忆中的内容清单。
 * 这些信息可以从当前项目状态或工具实时获取，写入记忆只会造成冗余和过时。
 */
export const WHAT_NOT_TO_SAVE: readonly string[] = [
  '代码模式、约定、架构、文件路径或项目结构 — 可从当前项目状态推导',
  'Git 历史、最近变更 — git log / git blame 是权威来源',
  '调试方案或修复配方 — 修复在代码中；提交消息有上下文',
  '已在 CLAUDE.md 文件中记录的内容',
  '临时任务细节：进行中的工作、临时状态、当前对话上下文',
];

/** 记忆文件头信息，从 frontmatter 解析而来 */
export interface MemoryHeader {
  /** 文件名（不含路径） */
  filename: string;
  /** 相对于记忆根目录的路径（正斜杠分隔） */
  filePath: string;
  /** 文件最后修改时间戳（毫秒） */
  mtimeMs: number;
  /** frontmatter 中的 name 字段 */
  name: string;
  /** frontmatter 中的 description 字段 */
  description: string | null;
  /** frontmatter 中的 type 字段，解析为 MemoryType；无法识别时为 null */
  type: MemoryType | null;
}

const _TRUNCATION_WARNING =
  '> WARNING: INDEX.md 超过限制，已被截断。请保持索引条目为一行且不超过约150字符；将详细内容移至主题文件。\n';

/** 将原始值解析为 MemoryType，不合法时返回 null */
export function parseMemoryType(raw: unknown): MemoryType | null {
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  if ((MEMORY_TYPES as readonly string[]).includes(value)) {
    return value as MemoryType;
  }
  return null;
}

/**
 * 截断索引文件内容，确保不超过行数和字节数限制。
 *
 * 先按行数截断，再按字节数截断（从末尾逐行删除），
 * 截断后追加警告提示，引导 AI 保持索引条目简洁。
 */
export function truncateEntrypointContent(content: string): string {
  const lines = content.split('\n');

  let truncated = false;
  if (lines.length > MAX_ENTRYPOINT_LINES) {
    lines.length = MAX_ENTRYPOINT_LINES;
    truncated = true;
  }

  let text = lines.join('\n');
  if (Buffer.byteLength(text, 'utf-8') > MAX_ENTRYPOINT_BYTES) {
    // 从末尾逐行删除直到字节数合规
    while (Buffer.byteLength(text, 'utf-8') > MAX_ENTRYPOINT_BYTES && text.includes('\n')) {
      const lastNl = text.lastIndexOf('\n');
      text = text.slice(0, lastNl);
      truncated = true;
    }
  }

  if (truncated) {
    text = text.replace(/\n+$/, '') + '\n\n' + _TRUNCATION_WARNING;
  }

  return text;
}
