/** JWT 认证配置：启动时检查 JWT_SECRET 环境变量是否存在 */
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET 环境变量未设置，服务器无法启动');
}

export const authConfig = {
  jwtSecret,
  jwtExpiresDays: 7,
} as const;
