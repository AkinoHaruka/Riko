/**
 * Wc (wordCount) 工具模块导出
 *
 * 统一导出字数统计的核心函数、文件大小格式化工具和 OpenAI function schema 定义。
 */
export { executeWc, countFileStats } from './wordCount.js';
export { formatFileSize } from '../shared/formatFileSize.js';
export { buildWcToolDefinition } from './definition.js';
