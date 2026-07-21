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
 * @security 对 URL 中的敏感信息进行脱敏处理。
 *
 * 两层脱敏：
 * 1. 查询参数脱敏：将 token=xxx、api_key=xxx、access_token=xxx 替换为 [REDACTED]
 * 2. 路径资源 ID 脱敏：匹配 generateId() 生成的 ID 格式 `前缀_17位时间戳[_N]`，
 *    替换为 `[ID:前缀]`，保留前缀信息便于日志阅读，同时避免暴露可枚举的时间戳。
 *
 * 已知 ID 前缀（来自 core/utils/id.ts 的 PREFIXES）：
 *   usr（用户）、conv（会话）、msg（消息）、mem（记忆）、set（设置）、
 *   sns（会话笔记状态）、saa（子代理活动）、amr（API 监控记录）
 *
 * 脱敏示例：
 *   /conversations/conv_20260718150012345/messages → /conversations/[ID:conv]/messages
 *   /memories/mem_20260718150012345_1              → /memories/[ID:mem]
 */
function redactUrl(url: string): string {
  // 1. 查询参数脱敏：token/api_key/access_token
  let redacted = url.replace(/([?&])(token|api_key|access_token)=([^&]*)/gi, '$1$2=[REDACTED]');
  // 2. 路径资源 ID 脱敏：匹配 /前缀_17位数字 后跟可选 _N 序号，后接路径分隔符或末尾
  //    保留前缀（usr/conv/msg/mem/set/sns/saa/amr）便于日志识别资源类型
  redacted = redacted.replace(
    /\/([a-z]+)_\d{17,}(?:_\d+)?(?=\/|$|\?|#)/g,
    '/[ID:$1]',
  );
  return redacted;
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
