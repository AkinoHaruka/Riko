/**
 * 认证相关的共享类型定义。
 *
 * AuthUser 代表当前请求的已认证用户上下文，
 * 是基础设施层（中间件、路由）和领域层（auth 服务）共享的数据结构。
 *
 * TokenVerifier 是 Token 验证的抽象接口，
 * 允许中间件在不直接依赖 domain/auth 的情况下校验令牌。
 *
 * @module core/types/auth
 */

/** 当前请求的已认证用户身份信息 */
export interface AuthUser {
  userId: string;
  username: string;
}

/** Token 验证函数接口，由 domain/auth/jwt 实现，通过 setupAuth 注入中间件 */
export type TokenVerifier = (token: string) => AuthUser | null;
