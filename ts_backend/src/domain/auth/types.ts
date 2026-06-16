/**
 * 认证领域类型定义。
 * 定义注册、登录请求体结构，JWT payload 用户信息，以及认证响应格式。
 *
 * AuthUser 和 TokenVerifier 已迁移至 core/types/auth.ts 作为共享类型，
 * 此处重新导出以保持向后兼容。
 */
export type { AuthUser, TokenVerifier } from '../../core/types/auth.js';

/** 注册请求参数 */
export interface RegisterRequest {
  username: string;
  password: string;
}

/** 登录请求参数 */
export interface LoginRequest {
  username: string;
  password: string;
}

/** 认证成功响应，包含令牌和用户基本信息 */
export interface AuthResponse {
  token: string;
  user: {
    id: string;
    username: string;
  };
}
