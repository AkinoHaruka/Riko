/**
 * JWT 认证配置
 *
 * 提供令牌签名密钥和过期策略。启动时强制校验密钥的存在性和长度，
 * 不满足条件则直接抛出异常阻止服务器启动，防止使用弱密钥运行。
 */

/** JWT 签名密钥，必须在环境变量中设置 */
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET 环境变量未设置，服务器无法启动');
}
// 16 字符是最低安全边界，防止密钥过短被暴力破解
if (jwtSecret.length < 16) {
  throw new Error('JWT_SECRET 长度不能少于 16 个字符，当前长度过短存在安全隐患');
}

export const authConfig = {
  /** JWT 签名密钥 */
  jwtSecret,
  /** 令牌有效期（天），默认 7 天 */
  jwtExpiresDays: 7,
} as const;
