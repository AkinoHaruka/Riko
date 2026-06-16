/**
 * Head 工具模块导出
 *
 * 统一导出文件头部读取的核心函数、行号格式化工具和 OpenAI function schema 定义。
 */
export { executeHead, readFileHead } from './readHead.js';
export { formatLinesWithNumbers } from '../shared/formatLines.js';
export { buildHeadToolDefinition } from './definition.js';
