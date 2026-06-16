/**
 * JWT 令牌生成与验证。
 * 使用 HS256 算法签名，过期时间从 authConfig 读取（默认天数）。
 * 该模块是认证体系的核心，所有需要身份校验的请求都依赖 verifyToken。
 */
import jwt from 'jsonwebtoken';
import { authConfig } from '../../config/index.js';
import type { AuthUser } from '../../core/types/auth.js';

/**
 * 生成 JWT 令牌。
 * @param userId - 用户唯一标识
 * @param username - 用户名，写入 payload 便于后续解析
 * @returns 签名后的 JWT 字符串
 */
export function generateToken(userId: string, username: string): string {
  const payload = {
    userId,
    username,
  };

  return jwt.sign(payload, authConfig.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: `${authConfig.jwtExpiresDays}d`,
  });
}

/**
 * 验证 JWT 令牌的合法性并解码。
 * @security 令牌验证失败时返回 null，不抛出异常，避免泄露错误细节。
 * @param token - 待验证的 JWT 字符串
 * @returns 解码后的用户信息，验证失败返回 null
 */
export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret, {
      algorithms: ['HS256'],
    }) as AuthUser;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * 刷新过期的 JWT 令牌（验证签名但忽略过期时间）。
 *
 * @security 仅允许签名有效且过期不超过 30 天的令牌进行刷新，
 *           防止长期不活跃的令牌被无限续期。
 * @param token - 已过期的 JWT 字符串
 * @returns 新的 JWT 字符串，刷新失败返回 null
 */
export function refreshToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret, {
      algorithms: ['HS256'],
      ignoreExpiration: true,
    }) as AuthUser & { exp?: number };

    // 检查令牌是否过期超过 30 天
    if (decoded.exp) {
      const expiredDaysAgo = (Date.now() / 1000 - decoded.exp) / 86400;
      if (expiredDaysAgo > 30) {
        return null;
      }
    }

    return generateToken(decoded.userId, decoded.username);
  } catch {
    return null;
  }
}
