// 记忆存储类型定义：记忆类型枚举、分类说明、文件头结构、条目截断工具
export const ENTRYPOINT_NAME = 'INDEX.md';
export const MAX_ENTRYPOINT_LINES = 200;
export const MAX_ENTRYPOINT_BYTES = 25_000;
export const MAX_MEMORY_FILES = 200;
export const FRONTMATTER_MAX_LINES = 30;

export const MEMORY_TYPES = [
  'traits_roles',
  'interaction_rules',
  'key_experiences',
  'promises_goals',
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_TYPES_INFO: Record<MemoryType, string> = {
  traits_roles: "特质与角色 — '你是谁，我是谁'：用户身份、AI 角色定位、性格偏好",
  interaction_rules: "互动规则 — '我们如何对待彼此'：沟通风格、行为边界、反馈偏好",
  key_experiences: "重要经历 — '经历了什么，有什么暗号'：关键事件、里程碑、共享暗号",
  promises_goals: "约定与目标 — '我们要走向哪里'：共同承诺、长期目标、待办约定",
};

export const WHAT_NOT_TO_SAVE: readonly string[] = [
  '代码模式、约定、架构、文件路径或项目结构 — 可从当前项目状态推导',
  'Git 历史、最近变更 — git log / git blame 是权威来源',
  '调试方案或修复配方 — 修复在代码中；提交消息有上下文',
  '已在 CLAUDE.md 文件中记录的内容',
  '临时任务细节：进行中的工作、临时状态、当前对话上下文',
];

export interface MemoryHeader {
  filename: string;
  filePath: string;
  mtimeMs: number;
  name: string;
  description: string | null;
  type: MemoryType | null;
}

const _TRUNCATION_WARNING =
  '> WARNING: INDEX.md 超过限制，已被截断。请保持索引条目为一行且不超过约150字符；将详细内容移至主题文件。\n';

export function parseMemoryType(raw: unknown): MemoryType | null {
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  if ((MEMORY_TYPES as readonly string[]).includes(value)) {
    return value as MemoryType;
  }
  return null;
}

export function truncateEntrypointContent(content: string): string {
  const lines = content.split('\n');

  let truncated = false;
  if (lines.length > MAX_ENTRYPOINT_LINES) {
    lines.length = MAX_ENTRYPOINT_LINES;
    truncated = true;
  }

  let text = lines.join('\n');
  if (Buffer.byteLength(text, 'utf-8') > MAX_ENTRYPOINT_BYTES) {
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
