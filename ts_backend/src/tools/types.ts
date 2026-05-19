// 共享类型定义与错误常量：所有工具的错误代码、请求/响应类型、工具处理器接口
export const SAME_STRING = 'SAME_STRING';
export const PATH_UNSAFE = 'PATH_UNSAFE';
export const PATH_OUTSIDE_ROOT = 'PATH_OUTSIDE_ROOT';
export const FILE_NOT_FOUND = 'FILE_NOT_FOUND';
export const FILE_EXISTS = 'FILE_EXISTS';
export const STRING_NOT_FOUND = 'STRING_NOT_FOUND';
export const MULTIPLE_MATCHES = 'MULTIPLE_MATCHES';
export const FILE_TOO_LARGE = 'FILE_TOO_LARGE';
export const CONTENT_TOO_LARGE = 'CONTENT_TOO_LARGE';
export const IS_DIRECTORY = 'IS_DIRECTORY';
export const PATH_NOT_FOUND = 'PATH_NOT_FOUND';
export const INVALID_PATTERN = 'INVALID_PATTERN';
export const INVALID_MODE = 'INVALID_MODE';
export const EMPTY_PATTERN = 'EMPTY_PATTERN';
export const NO_PATH_SPECIFIED = 'NO_PATH_SPECIFIED';
export const NOT_A_DIRECTORY = 'NOT_A_DIRECTORY';
export const INVALID_LINES = 'INVALID_LINES';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_CONTENT_SIZE = 10 * 1024 * 1024;
export const MAX_COLUMNS = 500;
export const VCS_DIRECTORIES: readonly string[] = ['.git', '.svn', '.hg', '.bzr'];
export const MAX_MEMORY_FILES = 200;
export const FRONTMATTER_READ_LINES = 30;

export interface EditRequest {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
  memoryRoot?: string;
}

export interface EditResult {
  success: true;
  file_path: string;
  diff: string;
  message: string;
}

export interface EditError {
  success: false;
  error_code: string;
  message: string;
}

export type EditResponse = EditResult | EditError;

export interface WriteRequest {
  file_path: string;
  content: string;
  memoryRoot?: string;
}

export interface WriteResult {
  success: true;
  type: 'create' | 'update';
  file_path: string;
  diff: string;
  old_content: string | null;
  lines_written: number;
  message: string;
}

export interface WriteError {
  success: false;
  error_code: string;
  message: string;
}

export type WriteResponse = WriteResult | WriteError;

export interface GrepRequest {
  pattern: string;
  path?: string;
  output_mode?: string;
  case_insensitive?: boolean;
  glob?: string;
  head_limit?: number;
  offset?: number;
  context?: number;
  before_context?: number;
  after_context?: number;
  memoryRoot?: string;
}

export interface GrepResult {
  success: true;
  mode: string;
  num_files: number;
  filenames?: string[];
  content?: string;
  num_lines?: number;
  num_matches?: number;
  applied_limit?: number | null;
  applied_offset?: number | null;
}

export interface GrepError {
  success: false;
  error_code: string;
  message: string;
}

export type GrepResponse = GrepResult | GrepError;

export interface FindRequest {
  pattern: string;
  path?: string;
  limit?: number;
  offset?: number;
}

export interface FindResult {
  success: true;
  filenames: string[];
  num_files: number;
  truncated: boolean;
  applied_limit?: number | null;
  applied_offset?: number | null;
}

export interface FindError {
  success: false;
  error_code: string;
  message: string;
}

export type FindResponse = FindResult | FindError;

export interface MemoryHeader {
  filename: string;
  mtime_ms: number;
  description?: string | null;
  memory_type?: string | null;
}

export interface LsRequest {
  path?: string;
}

export interface LsResult {
  success: true;
  files: MemoryHeader[];
  manifest: string;
  total: number;
}

export interface LsError {
  success: false;
  error_code: string;
  message: string;
}

export type LsResponse = LsResult | LsError;

export interface CatRequest {
  file_path: string;
  offset?: number;
  limit?: number;
  memoryRoot?: string;
}

export interface CatResult {
  success: true;
  file_path: string;
  content: string;
  total_lines: number;
  start_line: number;
  end_line: number;
  file_size: number;
  mtime_ms: number;
  frontmatter: Record<string, unknown>;
  freshness_note: string;
}

export interface CatError {
  success: false;
  error_code: string;
  message: string;
}

export type CatResponse = CatResult | CatError;

export interface StatRequest {
  file_path: string;
}

export interface StatResult {
  success: true;
  file_path: string;
  size_bytes: number;
  size_human: string;
  mtime: string;
  atime: string;
  ctime: string;
  mode: string;
  file_type: string;
  within_size_limit: boolean;
  max_size_bytes: number;
}

export interface StatError {
  success: false;
  error_code: string;
  message: string;
}

export type StatResponse = StatResult | StatError;

export interface WcRequest {
  file_path?: string;
  path?: string;
  glob?: string;
}

export interface WcFileResult {
  file_path: string;
  lines: number;
  words: number;
  bytes_count: number;
  size_human: string;
  within_size_limit: boolean;
}

export interface WcResult {
  success: true;
  mode: string;
  files: WcFileResult[];
  total_lines: number;
  total_words: number;
  total_bytes: number;
  num_files: number;
}

export interface WcError {
  success: false;
  error_code: string;
  message: string;
}

export type WcResponse = WcResult | WcError;

export interface HeadRequest {
  file_path: string;
  lines?: number;
}

export interface HeadResult {
  success: true;
  file_path: string;
  content: string;
  total_lines: number;
  start_line: number;
  end_line: number;
  file_size: number;
}

export interface HeadError {
  success: false;
  error_code: string;
  message: string;
}

export type HeadResponse = HeadResult | HeadError;

export interface TailRequest {
  file_path: string;
  lines?: number;
}

export interface TailResult {
  success: true;
  file_path: string;
  content: string;
  total_lines: number;
  start_line: number;
  end_line: number;
  file_size: number;
}

export interface TailError {
  success: false;
  error_code: string;
  message: string;
}

export type TailResponse = TailResult | TailError;

export interface ToolCallResult {
  success: boolean;
  [key: string]: unknown;
}

export interface ToolContext {
  conversationId: string;
  memoryRoot: string;
}

export interface ToolHandler {
  name: string;
  validate?(
    args: Record<string, unknown>,
    context: ToolContext,
  ): { valid: boolean; error?: string };
  execute(args: Record<string, unknown>, context: ToolContext): ToolCallResult;
}

export interface ToolRegistry {
  register(handler: ToolHandler): void;
  get(name: string): ToolHandler | undefined;
  has(name: string): boolean;
  listNames(): string[];
}
