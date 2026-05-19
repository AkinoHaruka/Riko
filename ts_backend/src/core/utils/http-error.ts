/** 含 HTTP 状态码的业务异常，可被 Fastify 错误处理器统一捕获 */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'HttpError';
  }
}
