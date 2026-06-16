/**
 * HTTP 业务异常类。
 * 携带 HTTP 状态码，可被 Fastify 全局错误处理器统一捕获并返回对应状态码的响应。
 * 用于在业务逻辑中抛出可预期的错误（如 404、403），而非依赖 throw new Error。
 *
 * @module core/utils/http-error
 */
import { createLogger } from '../logger/index.js';

const logger = createLogger('HttpError');

/**
 * 含 HTTP 状态码的业务异常。
 * 使用方式：throw new HttpError(404, '对话不存在')
 */
export class HttpError extends Error {
  readonly statusCode: number;

  /**
   * @param statusCode - HTTP 状态码（如 404、403、400）
   * @param message - 错误描述信息
   */
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'HttpError';
  }
}

/**
 * 构造安全的错误响应，不泄露内部实现细节。
 * 详细的错误信息仅记录在服务端日志中，返回给客户端的是通用提示。
 *
 * @param err - 原始错误对象
 * @param userMessage - 返回给用户的通用错误提示，默认为 '服务器内部错误'
 * @returns 不含内部细节的错误响应对象
 */
export function safeErrorResponse(err: unknown, userMessage: string = '服务器内部错误'): { error: string } {
  // 仅在服务端日志中记录详细错误
  logger.error('%s: %s', userMessage, err instanceof Error ? err.message : String(err));
  return { error: userMessage };
}
