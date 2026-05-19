/**
 * 请求日志中间件。
 * 记录每个请求的方法、URL（敏感参数脱敏）、状态码、耗时。
 * 根据状态码自动选择日志级别：5xx → error，4xx → warn，其余 → info。
 */
import type { FastifyInstance } from 'fastify';
import { createLogger } from '../logger/index.js';

const logger = createLogger('RequestLog');

/**
 * 对 URL 中的敏感查询参数进行脱敏处理
 * 将 token=xxx、api_key=xxx、access_token=xxx 替换为 [REDACTED]
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
