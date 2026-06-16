/**
 * Zod 校验模式定义。
 *
 * 包含所有 API 端点的请求体校验规则，涵盖消息、对话、设置、记忆、工具调用等。
 * 所有模式在 routes 层通过 validate 中间件应用，确保入参符合预期格式。
 *
 * @module core/validation/schemas
 */
import { z } from 'zod';

// ---- 消息相关 ----

/** 创建单条消息的校验模式 */
export const createMessageSchema = z.object({
  conversation_id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  reasoning_content: z.string().optional(),
  sequence_number: z.number().int().nonnegative().optional(),
});

/** 批量创建消息的校验模式（1~500 条） */
export const createMessagesSchema = z.object({
  messages: z.array(createMessageSchema).min(1).max(500),
});

/** 更新消息的校验模式（所有字段可选） */
export const updateMessageSchema = z.object({
  content: z.string().optional(),
  reasoning_content: z.string().optional(),
  tool_calls: z.array(z.unknown()).optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
});

/** 批量删除消息的校验模式（1~1000 个 ID） */
export const deleteMessagesSchema = z.object({
  ids: z
    .array(z.union([z.number(), z.string()]))
    .min(1)
    .max(1000),
});

// ---- 聊天补全相关 ----

/** AI 聊天补全请求的校验模式 */
export const chatCompletionSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system', 'tool']),
        content: z.union([z.string().max(200000), z.null()]),
        tool_calls: z.array(z.unknown()).optional(),
        tool_call_id: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .min(1)
    .max(500),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional().default(true),
  thinking: z.object({}).passthrough().optional(),
  reasoning_effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  response_format: z.object({}).passthrough().optional(),
  stop: z.array(z.string()).optional(),
  conversation_id: z.string().optional(),
});

// ---- 对话相关 ----

/** 创建对话的校验模式 */
export const createConversationSchema = z.object({
  title: z.string().min(1).max(200),
});

/** 重命名对话的校验模式 */
export const renameConversationSchema = z.object({
  title: z.string().min(1).max(200),
});

/** 切换对话归档状态的校验模式 */
export const toggleArchiveSchema = z.object({
  is_archived: z.boolean(),
});

/** 更新对话的校验模式（所有字段可选） */
export const updateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional().nullable(),
  is_archived: z.number().int().optional().nullable(),
  background: z.string().optional().nullable(),
});

// ---- 认证相关 ----

/** 登录请求的校验模式 */
export const loginSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(6).max(128),
});

/** 注册请求的校验模式 */
export const registerSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(6).max(128),
});

// ---- 设置相关 ----

/** 设置项请求的校验模式 */
export const settingRequestSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string(),
  is_encrypted: z.boolean().optional().default(false),
});

/** 批量设置保存请求的校验模式 */
export const batchSettingSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1, 'key 必须为非空字符串'),
        value: z.string({ message: 'value 不能为空' }),
      }),
    )
    .min(1, 'items 必须为非空数组'),
});

/** 参数批量更新请求的校验模式 */
export const batchUpdateParamsSchema = z.object({
  params: z
    .array(
      z.object({
        key: z.string().min(1, 'key 必须为非空字符串'),
        value: z.number({ message: 'value 必须为数字' }),
      }),
    )
    .min(1, 'params 必须为非空数组'),
});

/** API Key 保存请求的校验模式（空字符串表示清除） */
export const apiKeyRequestSchema = z.object({
  api_key: z.string(),
});

// ---- 记忆相关 ----

/** 创建记忆条目的校验模式 */
export const memoryCreateSchema = z.object({
  key: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
  source: z.string().max(500).optional(),
  type: z
    .enum(['fact', 'preference', 'pattern_transition', 'context_restart'])
    .optional()
    .default('fact'),
});

/** 记忆搜索查询的校验模式 */
export const memoriesQuerySchema = z.object({
  query: z.string().min(1).max(500).optional(),
});

// ---- 上下文压缩相关 ----

/** 压缩请求的校验模式 */
export const compactSchema = z.object({
  conversation_id: z.string(),
  custom_instructions: z.string().max(2000).optional(),
  model: z.string().optional(),
});

// ---- 工具调用相关 ----

/** @security 文件路径校验：拒绝 ".." 目录遍历、null 字节注入和绝对路径 */
const filePathSchema = z.string().min(1).refine(
  (p) => {
    // 拒绝 null 字节（可截断路径绕过检查）
    if (p.includes('\0')) return false;
    // 拒绝绝对路径（含盘符 C:\ 或 POSIX /）
    if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/')) return false;
    // 拒绝 ".." 段
    if (p.split(/[/\\]/).includes('..')) return false;
    return true;
  },
  { message: '路径不合法：禁止 ".." 遍历、null 字节或绝对路径' },
);

export const editFileSchema = z.object({
  file_path: filePathSchema,
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional().default(false),
});

export const writeFileSchema = z.object({
  file_path: filePathSchema,
  content: z.string(),
});

export const grepSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  glob: z.string().optional(),
});

export const findFilesSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
});

export const listFilesSchema = z.object({
  path: z.string().optional(),
});

export const readFileSchema = z.object({
  file_path: filePathSchema,
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

export const fileStatSchema = z.object({
  file_path: filePathSchema,
});

export const wcSchema = z.object({
  file_path: filePathSchema,
});

export const headTailSchema = z.object({
  file_path: filePathSchema,
  lines: z.number().int().positive().max(500).optional().default(10),
});

// ---- API 错误响应 ----

/** 记忆搜索请求的校验模式 */
export const memorySearchSchema = z.object({
  query: z.string().min(1),
  type: z.string().optional().refine(
    (t) => t === undefined || (!t.includes('..') && !/[\\/]/.test(t)),
    { message: 'type 包含非法字符' },
  ),
});

/** 构造标准错误响应对象 */
export const errorResponse = (code: string, message: string) => ({
  success: false,
  error_code: code,
  message,
});

// ---- 类型导出：从 Zod 模式自动推断 TypeScript 类型 ----
export type CreateMessageRequest = z.infer<typeof createMessageSchema>;
export type CreateMessagesRequest = z.infer<typeof createMessagesSchema>;
export type UpdateMessageRequest = z.infer<typeof updateMessageSchema>;
export type DeleteMessagesRequest = z.infer<typeof deleteMessagesSchema>;
export type ChatCompletionRequest = z.infer<typeof chatCompletionSchema>;
export type CreateConversationRequest = z.infer<typeof createConversationSchema>;
export type RenameConversationRequest = z.infer<typeof renameConversationSchema>;
export type ToggleArchiveRequest = z.infer<typeof toggleArchiveSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;
export type RegisterRequest = z.infer<typeof registerSchema>;
export type SettingRequest = z.infer<typeof settingRequestSchema>;
export type MemoryCreateRequest = z.infer<typeof memoryCreateSchema>;
export type MemoriesQuery = z.infer<typeof memoriesQuerySchema>;
export type CompactRequest = z.infer<typeof compactSchema>;
export type EditFileRequest = z.infer<typeof editFileSchema>;
export type WriteFileRequest = z.infer<typeof writeFileSchema>;
export type GrepRequest = z.infer<typeof grepSchema>;
export type FindFilesRequest = z.infer<typeof findFilesSchema>;
export type ListFilesRequest = z.infer<typeof listFilesSchema>;
export type ReadFileRequest = z.infer<typeof readFileSchema>;
export type FileStatRequest = z.infer<typeof fileStatSchema>;
export type WcRequest = z.infer<typeof wcSchema>;
export type HeadTailRequest = z.infer<typeof headTailSchema>;
export type MemorySearchRequest = z.infer<typeof memorySearchSchema>;
