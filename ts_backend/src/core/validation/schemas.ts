/**
 * Zod 校验模式定义。
 * 包含所有 API 端点的请求体校验规则、消息/对话/设置/记忆/工具调用等。
 * 所有模式在 routes 层通过 validate 中间件应用。
 */
import { z } from 'zod';

// ---- Messages ----
export const createMessageSchema = z.object({
  conversation_id: z.number().int().positive(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  reasoning_content: z.string().optional(),
  sequence_number: z.number().int().nonnegative().optional(),
});

export const createMessagesSchema = z.object({
  messages: z.array(createMessageSchema).min(1).max(500),
});

export const updateMessageSchema = z.object({
  content: z.string().optional(),
  reasoning_content: z.string().optional(),
  tool_calls: z.array(z.unknown()).optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
});

export const deleteMessagesSchema = z.object({
  ids: z
    .array(z.union([z.number(), z.string()]))
    .min(1)
    .max(1000),
});

// ---- Chat ----
export const chatCompletionSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: z.union([z.string(), z.null()]),
        tool_calls: z.array(z.unknown()).optional(),
        tool_call_id: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional().default(true),
  thinking: z.object({}).passthrough().optional(),
  reasoning_effort: z.string().optional(),
  response_format: z.object({}).passthrough().optional(),
  stop: z.array(z.string()).optional(),
  system_prompt: z.string().optional(),
  conversation_id: z.string().optional(),
});

// ---- Conversations ----
export const createConversationSchema = z.object({
  title: z.string().min(1).max(200),
});

export const renameConversationSchema = z.object({
  title: z.string().min(1).max(200),
});

export const toggleArchiveSchema = z.object({
  is_archived: z.boolean(),
});

// ---- Auth ----
export const loginSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(6).max(128),
});

export const registerSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(6).max(128),
});

// ---- Settings ----
export const settingRequestSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string(),
  is_encrypted: z.boolean().optional().default(false),
});

// ---- Memories ----
export const memoryCreateSchema = z.object({
  key: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
  source: z.string().max(500).optional(),
  type: z
    .enum(['fact', 'preference', 'pattern_transition', 'context_restart'])
    .optional()
    .default('fact'),
});

export const memoriesQuerySchema = z.object({
  query: z.string().min(1).max(500).optional(),
});

// ---- Compact ----
export const compactSchema = z.object({
  conversation_id: z.string(),
  custom_instructions: z.string().max(2000).optional(),
  model: z.string().optional(),
});

// ---- Tools ----
export const editFileSchema = z.object({
  file_path: z.string().min(1),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional().default(false),
});

export const writeFileSchema = z.object({
  file_path: z.string().min(1),
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
  file_path: z.string().min(1),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

export const fileStatSchema = z.object({
  file_path: z.string().min(1),
});

export const wcSchema = z.object({
  file_path: z.string().min(1),
});

export const headTailSchema = z.object({
  file_path: z.string().min(1),
  lines: z.number().int().positive().max(500).optional().default(10),
});

// ---- API Error Response ----
export const errorResponse = (code: string, message: string) => ({
  success: false,
  error_code: code,
  message,
});

// ---- Export all ----
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
