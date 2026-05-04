"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const mysql = require("../../backend/node_modules/mysql2/promise");
const {
  assertSafeDbTarget,
  getBackendEnvPath,
  loadEnvFileIfPresent,
} = require("../../backend/database/db-fingerprint-guard");

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

const parseArgs = (argv = process.argv.slice(2)) => {
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };

  return {
    apply: argv.includes("--apply"),
    json: argv.includes("--json"),
    file: valueAfter("--file"),
  };
};

const getGitHead = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
};

const getRepoPath = () => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
};

const resolveMigrationFile = (fileName) => {
  if (!fileName || /[\\/]/.test(fileName)) {
    throw new Error("--file must be a migration filename, not a path");
  }

  const resolved = path.resolve(MIGRATIONS_DIR, fileName);
  if (!resolved.startsWith(MIGRATIONS_DIR + path.sep)) {
    throw new Error("Migration file must stay inside legacy/database/migrations");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Migration file not found: ${fileName}`);
  }
  return resolved;
};

const createConnection = async () => {
  loadEnvFileIfPresent(getBackendEnvPath());

  const target = {
    host: process.env.MYSQL_HOST,
    port: String(process.env.MYSQL_PORT || process.env.DB_PORT || "3306"),
    database: process.env.MYSQL_DB,
    user: process.env.QUANTU_MYSQL_MIGRATION_USER || process.env.MYSQL_USER,
  };
  assertSafeDbTarget(target, { context: "quantu-local-migration" });

  const password = process.env.QUANTU_MYSQL_MIGRATION_PASSWORD || process.env.MYSQL_PW;
  if (!password) {
    throw new Error("QUANTU local migration requires a local migration password");
  }

  return mysql.createConnection({
    host: target.host,
    port: Number(target.port),
    user: target.user,
    password,
    database: target.database,
    multipleStatements: true,
  });
};

const readFingerprint = async (connection) => {
  const [rows] = await connection.query(
    "SELECT @@hostname AS hostname, @@server_uuid AS serverUuid, @@port AS port, DATABASE() AS dbName, USER() AS userName, CURRENT_USER() AS currentUser"
  );
  return rows[0];
};

const toAffectedRows = (result) => {
  if (Array.isArray(result)) {
    return result.reduce((sum, item) => sum + toAffectedRows(item), 0);
  }
  return Number(result?.affectedRows || 0);
};

const insertAudit = async (connection, { runId, fingerprint, startedAt, migrationName, affectedRows, result, reason }) => {
  await connection.query(
    `INSERT INTO quantu_seed_migration_audit
      (runId, artifactType, seedName, migrationName, operatorName, machineName, repoPath, gitHead, dbHost, dbName, serverUuid, startedAt, finishedAt, affectedRows, result, reason)
     VALUES (?, 'migration', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      migrationName,
      process.env.USERNAME || process.env.USER || "UNKNOWN",
      os.hostname(),
      getRepoPath(),
      getGitHead(),
      process.env.MYSQL_HOST || "",
      process.env.MYSQL_DB || "",
      fingerprint.serverUuid || "",
      startedAt,
      new Date(),
      affectedRows,
      result,
      reason || "",
    ]
  );
};

const run = async () => {
  const options = parseArgs();
  const migrationPath = resolveMigrationFile(options.file);
  const migrationName = path.basename(migrationPath);
  const sql = fs.readFileSync(migrationPath, "utf8").trim();
  const connection = await createConnection();
  const startedAt = new Date();
  const runId = `quantu-local-migration-${startedAt.toISOString().replace(/[:.]/g, "-")}`;

  try {
    const fingerprint = await readFingerprint(connection);
    if (!options.apply) {
      const payload = {
        ok: true,
        dryRun: true,
        apply: false,
        migrationName,
        fingerprint,
        reason: "dry-run only; no SQL executed",
      };
      console.log(options.json ? JSON.stringify(payload, null, 2) : `DRY_RUN ${migrationName}`);
      return;
    }

    const [result] = await connection.query(sql);
    const affectedRows = toAffectedRows(result);
    await insertAudit(connection, {
      runId,
      fingerprint,
      startedAt,
      migrationName,
      affectedRows,
      result: "APPLIED",
      reason: "source-controlled QUANTU local migration",
    });

    const payload = {
      ok: true,
      apply: true,
      migrationName,
      affectedRows,
      runId,
      fingerprint,
    };
    console.log(options.json ? JSON.stringify(payload, null, 2) : `APPLIED ${migrationName}`);
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  const payload = {
    ok: false,
    code: error.code || "QUANTU_LOCAL_MIGRATION_FAILED",
    message: error.message,
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
