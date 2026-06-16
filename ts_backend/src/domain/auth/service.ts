/**
 * 用户注册与登录服务。
 * 密码使用 bcrypt 加盐哈希存储，登录验证采用恒定时间比较防止时序攻击。
 * 该模块是用户身份管理的核心业务逻辑层。
 */
import bcrypt from 'bcryptjs';
import { getDb } from '../../core/database/connection.js';
import { createLogger } from '../../core/logger/index.js';
import { HttpError } from '../../core/utils/index.js';
import { generateToken } from './jwt.js';
import { generateId } from '../../core/utils/id.js';
import type { AuthResponse } from './types.js';

const logger = createLogger('auth');

/**
 * 注册新用户。
 * @security 用户名长度 3-30，密码长度 ≥6，防止弱凭证。
 * @security 先查重再插入，避免用户名冲突。
 * @param username - 用户名，3-30 个字符
 * @param password - 密码，至少 6 个字符
 * @returns 包含 JWT 令牌和用户信息的认证响应
 * @throws {HttpError} 400 参数校验失败 / 409 用户名已存在
 */
export async function register(username: string, password: string): Promise<AuthResponse> {
  if (!username || typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 30) {
    throw new HttpError(400, '用户名长度须为 3-30 个字符');
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new HttpError(400, '密码长度不能少于 6 个字符');
  }

  const db = getDb();

  // bcrypt 盐轮数 10 是安全与性能的平衡点
  const passwordHash = await bcrypt.hash(password, 10);
  const userId = generateId('users');

  // 使用 INSERT OR IGNORE 原子性地处理用户名唯一约束，避免 SELECT-then-INSERT 竞态
  const result = db.prepare('INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(userId, username, passwordHash);

  if (result.changes === 0) {
    throw new HttpError(409, '用户名已被注册');
  }

  const token = generateToken(userId, username);

  logger.info('[审计] 用户 %s 执行了 注册 操作', username);

  return { token, user: { id: userId, username } };
}

/**
 * 用户登录。
 * @security 无论用户名不存在还是密码错误，均返回统一的 401 错误信息，
 *          避免攻击者通过不同错误消息枚举有效用户名。
 * @security 输入验证在查询数据库之前执行，防止空值导致异常查询。
 * @param username - 用户名
 * @param password - 密码
 * @returns 包含 JWT 令牌和用户信息的认证响应
 * @throws {HttpError} 400 参数为空 / 401 用户名或密码错误
 */
export async function login(username: string, password: string): Promise<AuthResponse> {
  if (!username || typeof username !== 'string' || !username.trim()) {
    throw new HttpError(400, '用户名不能为空');
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new HttpError(400, '密码长度不能少于 6 个字符');
  }

  const db = getDb();

  const user = db
    .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .get(username) as { id: string; username: string; password_hash: string } | undefined;

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, '用户名或密码错误');
  }

  const token = generateToken(user.id, user.username);

  logger.info('[审计] 用户 %s 执行了 登录 操作', user.username);

  return { token, user: { id: user.id, username: user.username } };
}
