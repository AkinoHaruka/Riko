/**
 * 数据库路径配置
 *
 * 定义 SQLite 数据库文件的存储路径。默认放在 ./data/app.db，
 * 可通过 DB_PATH 环境变量覆盖以支持自定义存储位置。
 */
export interface DatabaseConfig {
  /** SQLite 数据库文件路径 */
  DB_PATH: string;
}

export const databaseConfig: DatabaseConfig = {
  /** 数据库文件路径，默认 ./data/app.db，可通过环境变量 DB_PATH 覆盖 */
  DB_PATH: process.env.DB_PATH || './data/app.db',
};
