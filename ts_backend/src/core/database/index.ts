/**
 * 数据库模块入口。
 * 导出初始化、连接管理函数及数据库类型，供 domain 层和 api 层使用。
 *
 * @module core/database
 */
export { initDb, waitForDb, closeDb, getDb } from './connection.js';
export type { Database } from './connection.js';
