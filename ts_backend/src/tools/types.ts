/**
 * 共享类型定义与错误常量
 *
 * 定义所有工具共用的错误代码、请求/响应类型和全局限制常量。
 * ToolContext / ToolHandler / ToolRegistry / ToolCallResult 已迁移至
 * core/types/tools.ts 作为 domain 和 tools 的共享契约，
 * 此处重新导出以保持向后兼容。
 */

// 从核心层重新导出共享类型（domain 层应直接从 core/types/tools 导入）
export type { ToolContext, ToolHandler, ToolRegistry, ToolCallResult } from '../core/types/tools.js';

// ─── 错误代码常量 ───

/** old_string 与 new_string 完全相同，无需替换 */
export const SAME_STRING = 'SAME_STRING';
/** 路径包含不安全字符或模式 */
export const PATH_UNSAFE = 'PATH_UNSAFE';
/** 路径解析后超出允许的根目录范围 */
export const PATH_OUTSIDE_ROOT = 'PATH_OUTSIDE_ROOT';
/** 指定的文件不存在 */
export const FILE_NOT_FOUND = 'FILE_NOT_FOUND';
/** 文件已存在且非空，无法创建新文件 */
export const FILE_EXISTS = 'FILE_EXISTS';
/** 在文件中未找到指定的搜索文本 */
export const STRING_NOT_FOUND = 'STRING_NOT_FOUND';
/** 找到多处匹配但未启用 replace_all */
export const MULTIPLE_MATCHES = 'MULTIPLE_MATCHES';
/** 文件体积超过允许的最大值 */
export const FILE_TOO_LARGE = 'FILE_TOO_LARGE';
/** 写入内容体积超过允许的最大值 */
export const CONTENT_TOO_LARGE = 'CONTENT_TOO_LARGE';
/** 目标路径是目录而非文件 */
export const IS_DIRECTORY = 'IS_DIRECTORY';
/** 路径不存在（目录级别） */
export const PATH_NOT_FOUND = 'PATH_NOT_FOUND';
/** glob/正则模式语法无效 */
export const INVALID_PATTERN = 'INVALID_PATTERN';
/** 输出模式参数无效 */
export const INVALID_MODE = 'INVALID_MODE';
/** 搜索模式为空字符串 */
export const EMPTY_PATTERN = 'EMPTY_PATTERN';
/** 未指定文件路径或目录路径 */
export const NO_PATH_SPECIFIED = 'NO_PATH_SPECIFIED';
/** 目标路径不是目录 */
export const NOT_A_DIRECTORY = 'NOT_A_DIRECTORY';
/** 行数参数为负数 */
export const INVALID_LINES = 'INVALID_LINES';

// ─── 全局限制常量 ───

/** 单文件最大体积：10MB */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** 写入内容最大体积：10MB */
export const MAX_CONTENT_SIZE = 10 * 1024 * 1024;
/** 单行最大显示列数，超长行截断 */
export const MAX_COLUMNS = 500;
/** 版本控制目录名称列表，文件遍历时跳过 */
export const VCS_DIRECTORIES: readonly string[] = ['.git', '.svn', '.hg', '.bzr'];
/** 记忆文件列表最大返回数量 */
export const MAX_MEMORY_FILES = 200;
/** 解析 frontmatter 时读取的头部行数 */
export const FRONTMATTER_READ_LINES = 30;

// ─── Edit 工具类型 ───

/** 文件编辑请求 */
export interface EditRequest {
  /** 目标文件的相对或绝对路径 */
  file_path: string;
  /** 待替换的原始文本 */
  old_string: string;
  /** 替换后的新文本 */
  new_string: string;
  /** 是否替换所有匹配项，默认 false */
  replace_all?: boolean;
  /** 允许操作的根目录（由上下文注入） */
  memoryRoot?: string;
}

/** 文件编辑成功结果 */
export interface EditResult {
  success: true;
  /** 被编辑的文件路径 */
  file_path: string;
  /** unified diff 格式的变更差异 */
  diff: string;
  /** 人类可读的操作描述 */
  message: string;
}

/** 文件编辑失败结果 */
export interface EditError {
  success: false;
  /** 错误代码，对应上方常量 */
  error_code: string;
  /** 人类可读的错误描述 */
  message: string;
}

export type EditResponse = EditResult | EditError;

// ─── Write 工具类型 ───

/** 文件写入请求 */
export interface WriteRequest {
  /** 目标文件路径 */
  file_path: string;
  /** 要写入的完整内容 */
  content: string;
  /** 允许操作的根目录（由上下文注入） */
  memoryRoot?: string;
}

/** 文件写入成功结果 */
export interface WriteResult {
  success: true;
  /** 操作类型：create（新建）或 update（覆盖） */
  type: 'create' | 'update';
  /** 写入的文件路径 */
  file_path: string;
  /** unified diff 格式的变更差异 */
  diff: string;
  /** 写入的行数 */
  lines_written: number;
  /** 人类可读的操作描述 */
  message: string;
}

/** 文件写入失败结果 */
export interface WriteError {
  success: false;
  error_code: string;
  message: string;
}

export type WriteResponse = WriteResult | WriteError;

// ─── Grep 工具类型 ───

/** 文件内容搜索请求 */
export interface GrepRequest {
  /** 正则表达式搜索模式 */
  pattern: string;
  /** 搜索范围路径 */
  path?: string;
  /** 输出模式：content / files_with_matches / count */
  output_mode?: string;
  /** 是否忽略大小写 */
  case_insensitive?: boolean;
  /** 文件名 glob 过滤模式 */
  glob?: string;
  /** 返回结果数量限制 */
  head_limit?: number;
  /** 分页偏移量 */
  offset?: number;
  /** 上下文行数（同时设置前后） */
  context?: number;
  /** 匹配行前显示的行数 */
  before_context?: number;
  /** 匹配行后显示的行数 */
  after_context?: number;
  /** 允许操作的根目录 */
  memoryRoot?: string;
}

/** Grep 搜索成功结果 */
export interface GrepResult {
  success: true;
  /** 使用的输出模式 */
  mode: string;
  /** 匹配的文件数量 */
  num_files: number;
  /** 匹配的文件名列表（files_with_matches 模式） */
  filenames?: string[];
  /** 匹配的内容文本（content/count 模式） */
  content?: string;
  /** 匹配的行数（content 模式） */
  num_lines?: number;
  /** 匹配的总次数（count 模式） */
  num_matches?: number;
  /** 实际应用的 limit，未截断时为 null */
  applied_limit?: number | null;
  /** 实际应用的 offset，未偏移时为 null */
  applied_offset?: number | null;
}

/** Grep 搜索失败结果 */
export interface GrepError {
  success: false;
  error_code: string;
  message: string;
}

export type GrepResponse = GrepResult | GrepError;

// ─── Find 工具类型 ───

/** 文件查找请求 */
export interface FindRequest {
  /** glob 匹配模式 */
  pattern: string;
  /** 搜索范围路径 */
  path?: string;
  /** 返回结果数量限制 */
  limit?: number;
  /** 分页偏移量 */
  offset?: number;
}

/** 文件查找成功结果 */
export interface FindResult {
  success: true;
  /** 匹配的文件相对路径列表 */
  filenames: string[];
  /** 匹配的文件总数 */
  num_files: number;
  /** 结果是否被截断 */
  truncated: boolean;
  applied_limit?: number | null;
  applied_offset?: number | null;
}

/** 文件查找失败结果 */
export interface FindError {
  success: false;
  error_code: string;
  message: string;
}

export type FindResponse = FindResult | FindError;

// ─── Memory 类型 ───

/** 记忆文件头部摘要信息 */
export interface MemoryHeader {
  /** 相对于根目录的文件路径 */
  filename: string;
  /** 最后修改时间（毫秒时间戳） */
  mtime_ms: number;
  /** frontmatter 中的描述字段 */
  description?: string | null;
  /** frontmatter 中的记忆类型字段 */
  memory_type?: string | null;
}

// ─── Ls (listFiles) 工具类型 ───

/** 记忆文件列表请求 */
export interface LsRequest {
  /** 要列出的目录路径 */
  path?: string;
}

/** 记忆文件列表成功结果 */
export interface LsResult {
  success: true;
  /** 文件头部摘要列表 */
  files: MemoryHeader[];
  /** 人类可读的文件清单文本 */
  manifest: string;
  /** 文件总数 */
  total: number;
}

/** 记忆文件列表失败结果 */
export interface LsError {
  success: false;
  error_code: string;
  message: string;
}

export type LsResponse = LsResult | LsError;

// ─── Cat (readFile) 工具类型 ───

/** 文件读取请求 */
export interface CatRequest {
  /** 目标文件路径 */
  file_path: string;
  /** 起始行号（从 1 开始） */
  offset?: number;
  /** 读取的最大行数，0 表示读取到文件末尾 */
  limit?: number;
  /** 允许操作的根目录 */
  memoryRoot?: string;
}

/** 文件读取成功结果 */
export interface CatResult {
  success: true;
  /** 读取的文件路径 */
  file_path: string;
  /** 带行号的文件内容 */
  content: string;
  /** 文件总行数 */
  total_lines: number;
  /** 读取的起始行号 */
  start_line: number;
  /** 读取的结束行号 */
  end_line: number;
  /** 文件大小（字节） */
  file_size: number;
  /** 最后修改时间（毫秒时间戳） */
  mtime_ms: number;
  /** 解析后的 frontmatter 键值对 */
  frontmatter: Record<string, unknown>;
  /** 记忆新鲜度提示，空字符串表示刚更新 */
  freshness_note: string;
}

/** 文件读取失败结果 */
export interface CatError {
  success: false;
  error_code: string;
  message: string;
}

export type CatResponse = CatResult | CatError;

// ─── Stat (fileStats) 工具类型 ───

/** 文件元数据查询请求 */
export interface StatRequest {
  /** 目标文件或目录路径 */
  file_path: string;
}

/** 文件元数据查询成功结果 */
export interface StatResult {
  success: true;
  /** 查询的文件路径 */
  file_path: string;
  /** 文件大小（字节） */
  size_bytes: number;
  /** 人类可读的文件大小 */
  size_human: string;
  /** 最后修改时间（ISO 格式） */
  mtime: string;
  /** 最后访问时间（ISO 格式） */
  atime: string;
  /** 创建/状态变更时间（ISO 格式） */
  ctime: string;
  /** 文件权限（八进制字符串） */
  mode: string;
  /** 文件类型：file / directory / symlink */
  file_type: string;
  /** 文件大小是否在允许范围内 */
  within_size_limit: boolean;
  /** 允许的最大文件大小（字节） */
  max_size_bytes: number;
}

/** 文件元数据查询失败结果 */
export interface StatError {
  success: false;
  error_code: string;
  message: string;
}

export type StatResponse = StatResult | StatError;

// ─── Wc (wordCount) 工具类型 ───

/** 字数统计请求 */
export interface WcRequest {
  /** 单文件路径（单文件模式） */
  file_path?: string;
  /** 目录路径（批量模式） */
  path?: string;
  /** 文件名 glob 过滤模式 */
  glob?: string;
}

/** 单文件的统计结果 */
export interface WcFileResult {
  /** 文件路径 */
  file_path: string;
  /** 行数 */
  lines: number;
  /** 字数 */
  words: number;
  /** 字节数 */
  bytes_count: number;
  /** 人类可读的文件大小 */
  size_human: string;
  /** 文件大小是否在允许范围内 */
  within_size_limit: boolean;
}

/** 字数统计成功结果 */
export interface WcResult {
  success: true;
  /** 统计模式：single（单文件）或 batch（批量） */
  mode: string;
  /** 各文件的统计结果列表 */
  files: WcFileResult[];
  /** 总行数 */
  total_lines: number;
  /** 总字数 */
  total_words: number;
  /** 总字节数 */
  total_bytes: number;
  /** 统计的文件数量 */
  num_files: number;
}

/** 字数统计失败结果 */
export interface WcError {
  success: false;
  error_code: string;
  message: string;
}

export type WcResponse = WcResult | WcError;

// ─── Head 工具类型 ───

/** 文件头部读取请求 */
export interface HeadRequest {
  /** 目标文件路径 */
  file_path: string;
  /** 读取的行数，0 表示全部，默认 10 */
  lines?: number;
}

/** 文件头部读取成功结果 */
export interface HeadResult {
  success: true;
  file_path: string;
  /** 带行号的文件内容 */
  content: string;
  /** 文件总行数 */
  total_lines: number;
  /** 读取的起始行号（始终为 1） */
  start_line: number;
  /** 读取的结束行号 */
  end_line: number;
  /** 文件大小（字节） */
  file_size: number;
}

/** 文件头部读取失败结果 */
export interface HeadError {
  success: false;
  error_code: string;
  message: string;
}

export type HeadResponse = HeadResult | HeadError;

// ─── Tail 工具类型 ───

/** 文件尾部读取请求 */
export interface TailRequest {
  /** 目标文件路径 */
  file_path: string;
  /** 读取的行数，0 表示全部，默认 10 */
  lines?: number;
}

/** 文件尾部读取成功结果 */
export interface TailResult {
  success: true;
  file_path: string;
  /** 带行号的文件内容 */
  content: string;
  /** 文件总行数 */
  total_lines: number;
  /** 读取的起始行号 */
  start_line: number;
  /** 读取的结束行号 */
  end_line: number;
  /** 文件大小（字节） */
  file_size: number;
}

/** 文件尾部读取失败结果 */
export interface TailError {
  success: false;
  error_code: string;
  message: string;
}

export type TailResponse = TailResult | TailError;

// ─── 通用工具类型（已迁移至 core/types/tools.ts，此处仅重导出） ───
// ToolCallResult, ToolContext, ToolHandler, ToolRegistry 在文件头部重导出
