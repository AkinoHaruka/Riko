/**
 * 认证领域模块入口。
 * 统一导出认证相关的类型定义、JWT 工具函数和注册/登录服务，
 * 供 API 路由层和中间件层使用。
 */
export type { RegisterRequest, LoginRequest, AuthUser, AuthResponse } from './types.js';
export { generateToken, verifyToken } from './jwt.js';
export { register, login } from './service.js';
