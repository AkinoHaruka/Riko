/**
 * pino 日志实例。
 *
 * - 开发环境（默认）：pino-pretty 彩色输出 + 日志文件（logs/app.log）
 * - 生产环境（NODE_ENV=production）：仅 stdout，适用于 Android 嵌入式环境
 * - redact 配置自动过滤 apiKey / token / password 等敏感字段
 */
import pino from 'pino';
import path from 'path';
import fs from 'fs';

const isProduction = process.env.NODE_ENV === 'production';
const level = (
  process.env.LOG_LEVEL || (isProduction ? 'INFO' : 'DEBUG')
).toLowerCase() as pino.Level;

let streams: pino.StreamEntry[];

if (isProduction) {
  // Android/production: simple console-only logging (no pino-pretty transport, no file)
  streams = [{ level, stream: pino.destination(1) }]; // stdout
} else {
  // Desktop/development: pretty print + file
  const LOG_DIR = path.join(process.cwd(), 'logs');
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const LOG_FILE = path.join(LOG_DIR, 'app.log');

  streams = [
    {
      level,
      stream: pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }),
    },
    { level, stream: pino.destination({ dest: LOG_FILE, sync: false }) },
  ];
}

export const logger = pino(
  {
    level,
    redact: ['apiKey', 'authorization', 'token', 'secret', 'password', '*.apiKey', '*.token'],
  },
  pino.multistream(streams),
);

/** 创建一个带模块标签的子日志，便于在大量输出中定位来源 */
export function createLogger(module: string): pino.Logger {
  return logger.child({ module });
}
