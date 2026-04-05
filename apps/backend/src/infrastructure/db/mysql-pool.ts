import mysql from "mysql2/promise";

import type { DatabasePool } from "./db.types.js";

type MysqlPoolConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
};

export function createMysqlPool(config: MysqlPoolConfig): DatabasePool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit ?? 10,
    waitForConnections: true,
    queueLimit: 0,
    decimalNumbers: true,
    namedPlaceholders: false,
    timezone: "Z"
  });
}

// TODO:
// 1. Load config from env validation once backend config module is expanded.
// 2. Add pool health check and startup connectivity probe.
// 3. Decide whether read/write pools are needed after worker split.
