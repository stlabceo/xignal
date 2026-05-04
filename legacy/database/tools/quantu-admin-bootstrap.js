"use strict";

const os = require("os");
const { execFileSync } = require("child_process");

const mysql = require("../../backend/node_modules/mysql2/promise");
const {
  assertSafeDbTarget,
  getBackendEnvPath,
  loadEnvFileIfPresent,
} = require("../../backend/database/db-fingerprint-guard");

const APPROVAL_PHRASE = "APPROVE_QUANTU_LOCAL_ADMIN_BOOTSTRAP";

const parseArgs = (argv = process.argv.slice(2)) => {
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };

  return {
    apply: argv.includes("--apply"),
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
    json: argv.includes("--json"),
    passwordStdin: argv.includes("--password-stdin"),
    adminId: valueAfter("--admin-id"),
    name: valueAfter("--name"),
    email: valueAfter("--email"),
    mobile: valueAfter("--mobile") || "01000000000",
    confirm: valueAfter("--confirm"),
  };
};

const readStdin = () =>
  new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });

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

const validatePayload = ({ adminId, name, email, password }) => {
  if (!adminId || !/^[A-Za-z0-9_.-]{4,50}$/.test(adminId)) {
    throw new Error("Admin id must be 4-50 safe characters");
  }
  if (!name || name.length > 50) {
    throw new Error("Admin name is required and must be <= 50 chars");
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Valid admin email is required");
  }
  if (!password || password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[\W_]/.test(password)) {
    throw new Error("Admin password must be at least 8 chars and include letter, digit, and special char");
  }
};

const createConnection = async () => {
  loadEnvFileIfPresent(getBackendEnvPath());

  const target = {
    host: process.env.MYSQL_HOST,
    port: String(process.env.MYSQL_PORT || process.env.DB_PORT || "3306"),
    database: process.env.MYSQL_DB,
    user: process.env.QUANTU_MYSQL_MIGRATION_USER || process.env.MYSQL_USER,
  };
  assertSafeDbTarget(target, { context: "quantu-admin-bootstrap" });

  const password = process.env.QUANTU_MYSQL_MIGRATION_PASSWORD || process.env.MYSQL_PW;
  if (!password) {
    throw new Error("QUANTU admin bootstrap requires a local migration password");
  }

  return mysql.createConnection({
    host: target.host,
    port: Number(target.port),
    user: target.user,
    password,
    database: target.database,
  });
};

const readFingerprint = async (connection) => {
  const [rows] = await connection.query(
    "SELECT @@hostname AS hostname, @@server_uuid AS serverUuid, @@port AS port, DATABASE() AS dbName, USER() AS userName, CURRENT_USER() AS currentUser"
  );
  return rows[0];
};

const readAdminCount = async (connection) => {
  const [[row]] = await connection.query("SELECT COUNT(*) AS count FROM admin_member");
  return Number(row.count || 0);
};

const insertAudit = async (connection, { runId, fingerprint, startedAt, result, reason }) => {
  await connection.query(
    `INSERT INTO quantu_seed_migration_audit
      (runId, artifactType, seedName, migrationName, operatorName, machineName, repoPath, gitHead, dbHost, dbName, serverUuid, startedAt, finishedAt, affectedRows, result, reason)
     VALUES (?, 'admin_bootstrap', '', 'quantu-admin-bootstrap', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      process.env.USERNAME || process.env.USER || "UNKNOWN",
      os.hostname(),
      getRepoPath(),
      getGitHead(),
      process.env.MYSQL_HOST || "",
      process.env.MYSQL_DB || "",
      fingerprint.serverUuid || "",
      startedAt,
      new Date(),
      result === "APPLIED" ? 1 : 0,
      result,
      reason || "",
    ]
  );
};

const run = async () => {
  const options = parseArgs();
  const password = options.passwordStdin ? await readStdin() : "";
  validatePayload({
    adminId: options.adminId,
    name: options.name,
    email: options.email,
    password,
  });

  if (options.apply && options.confirm !== APPROVAL_PHRASE) {
    throw new Error("Apply requires explicit QUANTU admin bootstrap approval phrase");
  }

  const connection = await createConnection();
  const startedAt = new Date();
  const runId = `quantu-admin-bootstrap-${startedAt.toISOString().replace(/[:.]/g, "-")}`;

  try {
    const fingerprint = await readFingerprint(connection);
    const beforeAdminCount = await readAdminCount(connection);
    if (options.apply && beforeAdminCount !== 0) {
      throw new Error("Admin bootstrap apply is only allowed when admin_member is empty");
    }

    await connection.beginTransaction();
    const [rows] = await connection.query("CALL SP_U_USER_ADD(?,?,?,?,?,?)", [
      options.adminId,
      options.name,
      options.mobile,
      password,
      options.email,
      null,
    ]);
    const firstRow = Array.isArray(rows?.[0]) ? rows[0][0] : rows?.[0];
    const createdId = Number(firstRow?.userID || firstRow?.id || 0);
    if (!createdId) {
      throw new Error("Admin bootstrap did not return a created id");
    }

    if (options.apply) {
      await insertAudit(connection, {
        runId,
        fingerprint,
        startedAt,
        result: "APPLIED",
        reason: "user-approved local QUANTU admin bootstrap",
      });
      await connection.commit();
    } else {
      await connection.rollback();
    }

    const finalAdminCount = options.apply ? await readAdminCount(connection) : beforeAdminCount;
    const payload = {
      ok: true,
      apply: Boolean(options.apply),
      dryRun: !options.apply,
      rolledBack: !options.apply,
      localOnly: true,
      adminId: options.apply ? createdId : null,
      beforeAdminCount,
      finalAdminCount,
      rawPasswordReturned: false,
      fingerprint,
      approvalPhraseRequiredForApply: APPROVAL_PHRASE,
    };
    console.log(options.json ? JSON.stringify(payload, null, 2) : `OK admin bootstrap ${options.apply ? "applied" : "dry-run"}`);
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failure so the original error remains visible.
    }
    throw error;
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  const payload = {
    ok: false,
    code: error.code || "QUANTU_ADMIN_BOOTSTRAP_FAILED",
    message: error.message,
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
