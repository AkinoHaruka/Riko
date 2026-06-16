/**
 * 请求日志中间件。
 *
 * 记录每个请求的方法、URL（敏感参数脱敏）、状态码、耗时。
 * 根据状态码自动选择日志级别：5xx → error，4xx → warn，其余 → info。
 *
 * @module core/middleware/requestLog
 */
import type { FastifyInstance } from 'fastify';
import { createLogger } from '../logger/index.js';

const logger = createLogger('RequestLog');

/**
 * @security 对 URL 中的敏感查询参数进行脱敏处理。
 * 将 token=xxx、api_key=xxx、access_token=xxx 替换为 [REDACTED]，
 * 防止敏感信息泄露到日志中。
 *
 * TODO: 对路径中的资源 ID（如 /conversations/abc123/messages）进行哈希脱敏，
 *   避免日志中暴露可枚举的资源标识符。可使用正则匹配 UUID/数字 ID 段
 *   并替换为 [ID_HASH:前8位] 格式。
 */
function redactUrl(url: string): string {
  return url.replace(/([?&])(token|api_key|access_token)=([^&]*)/gi, '$1$2=[REDACTED]');
}

/**
 * 根据状态码选择合适的日志级别
 */
function getLogLevel(statusCode: number): 'error' | 'warn' | 'info' {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

/**
 * 注册请求日志中间件。
 * 在 onResponse 钩子中记录每个请求的完成信息。
 *
 * @param app - Fastify 应用实例
 */
export async function registerRequestLog(app: FastifyInstance): Promise<void> {
  app.addHook('onResponse', (request, reply, done) => {
    const elapsedMs = reply.elapsedTime;
    const safeUrl = redactUrl(request.url);
    const logLevel = getLogLevel(reply.statusCode);
    const message = `[请求] ${request.method} ${safeUrl} - ${reply.statusCode} - ${Math.round(elapsedMs)}ms`;
    logger[logLevel](message);
    done();
  });
}
