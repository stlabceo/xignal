import "dotenv/config";
import { createApp, createApplicationServices } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createMysqlPool } from "./infrastructure/db/mysql-pool.js";

const env = loadEnv();
const pool = createMysqlPool({
  host: env.dbHost,
  port: env.dbPort,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName
});
const services = createApplicationServices(pool);
const app = createApp(services);

app.listen(env.port, () => {
  console.log(`[backend] listening on port ${env.port}`);
});
