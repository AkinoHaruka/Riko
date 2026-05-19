/**
 * JWT 令牌生成与验证。使用 HS256 算法，过期时间从配置读取。
 */
import jwt from 'jsonwebtoken';
import { authConfig } from '../../config/index.js';
import type { AuthUser } from './types.js';

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
