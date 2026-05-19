/** 数据库路径配置 */
export interface DatabaseConfig {
  DB_PATH: string;
}

export const databaseConfig: DatabaseConfig = {
  DB_PATH: process.env.DB_PATH || './data/app.db',
};
