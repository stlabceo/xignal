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

const RESET_TABLES = [
  "account_risk_snapshot",
  "admin_member",
  "alert_log",
  "alert_log2",
  "auth_email_verification_tokens",
  "backtest_stat_archive",
  "backtest_stat_current",
  "backtest_webhook_log",
  "binance_runtime_event_log",
  "event_log",
  "landing_strategy_rank_cache",
  "live_grid_strategy_list",
  "live_pid_exit_reservation",
  "live_pid_position_ledger",
  "live_pid_position_snapshot",
  "live_play_list",
  "live_play_log",
  "live_position_bucket_owner",
  "msg_list",
  "order_intent_queue",
  "play_list",
  "play_log",
  "policy_action_log",
  "policy_eval_log",
  "policy_runtime_state",
  "strategy_catalog",
  "strategy_stats_bestcase",
  "strategy_stats_metric",
  "strategy_stats_raw",
  "strategy_control_audit",
  "test_grid_strategy_list",
  "test_play_list",
  "test_play_log",
  "update_st",
  "webhook_event_log",
  "webhook_event_target_log",
];

const PRESERVE_TABLES = [
  "candle_list",
  "exchange_symbol_catalog",
  "policy_rule",
  "quantu_seed_migration_audit",
  "real_price",
  "stoch_list",
];

const XIGNAL_STRATEGY_NAMES = ["XignalCrypto", "XignalGap"];
const ALL_CLASSIFIED_TABLES = new Set([...RESET_TABLES, ...PRESERVE_TABLES]);
const ADMIN_MEMBER_COLUMNS = [
  "id",
  "mem_id",
  "mem_name",
  "mem_mobile",
  "password",
  "alarmST",
  "grade",
  "email",
  "email_verified",
  "auth_provider",
  "google_sub",
  "status",
  "price",
  "live_price",
  "created_at",
  "updated_at",
  "allExactST",
  "allStopST",
  "allExact",
  "allStop",
  "allStartST",
  "recom",
  "metaId",
  "appKey",
  "appSecret",
  "tradeAccessMode",
];

const parseArgs = (argv = process.argv.slice(2)) => {
  const args = new Set(argv);
  return {
    apply: args.has("--apply"),
    json: args.has("--json"),
    snapshotDir: (() => {
      const index = argv.indexOf("--snapshot-dir");
      return index >= 0 && argv[index + 1] ? path.resolve(argv[index + 1]) : path.resolve(process.cwd(), "legacy/database/reports");
    })(),
  };
};

const safeIdentifier = (name) => {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Unsafe table identifier: ${name}`);
  }
  return `\`${name}\``;
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

const nowForFile = () => new Date().toISOString().replace(/[:.]/g, "-");

const createConnection = async () => {
  loadEnvFileIfPresent(getBackendEnvPath());

  const target = {
    host: process.env.MYSQL_HOST,
    port: String(process.env.MYSQL_PORT || process.env.DB_PORT || "3306"),
    database: process.env.MYSQL_DB,
    user: process.env.QUANTU_MYSQL_MIGRATION_USER || "quantu_migration",
  };
  assertSafeDbTarget(target, { context: "quantu-fresh-reset" });

  const password = process.env.QUANTU_MYSQL_MIGRATION_PASSWORD || process.env.MYSQL_PW;
  if (!password) {
    throw new Error("QUANTU fresh reset requires a local migration password");
  }

  return mysql.createConnection({
    host: target.host,
    port: Number(target.port),
    user: target.user,
    password,
    database: target.database,
    multipleStatements: false,
  });
};

const readFingerprint = async (connection) => {
  const [rows] = await connection.query(
    "SELECT @@hostname AS hostname, @@server_uuid AS serverUuid, @@port AS port, DATABASE() AS dbName, USER() AS userName, CURRENT_USER() AS currentUser"
  );
  return rows[0];
};

const readTableNames = async (connection) => {
  const [rows] = await connection.query(
    "SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  return rows.map((row) => row.tableName);
};

const readCounts = async (connection, tableNames) => {
  const counts = {};
  for (const tableName of tableNames) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${safeIdentifier(tableName)}`);
    counts[tableName] = Number(rows[0].count || 0);
  }
  return counts;
};

const readXignalStrategyState = async (connection) => {
  const [rows] = await connection.query(
    `SELECT id, strategyCategory, strategyName, signalName, isActive
       FROM strategy_catalog
      WHERE strategyName IN (?, ?) OR signalName IN (?, ?) OR strategyCategory IN ('xignal_crypto', 'xignal_gap')
      ORDER BY id`,
    [...XIGNAL_STRATEGY_NAMES, ...XIGNAL_STRATEGY_NAMES]
  );
  const [[liveSignal]] = await connection.query(
    `SELECT COUNT(*) AS count FROM live_play_list
      WHERE a_name IN (?, ?) OR type IN ('xignal_crypto', 'xignal_gap') OR stoch_id IN (?, ?)`,
    [...XIGNAL_STRATEGY_NAMES, ...XIGNAL_STRATEGY_NAMES]
  );
  const [[testSignal]] = await connection.query(
    `SELECT COUNT(*) AS count FROM test_play_list
      WHERE a_name IN (?, ?) OR type IN ('xignal_crypto', 'xignal_gap') OR stoch_id IN (?, ?)`,
    [...XIGNAL_STRATEGY_NAMES, ...XIGNAL_STRATEGY_NAMES]
  );
  const [[liveGrid]] = await connection.query(
    `SELECT COUNT(*) AS count FROM live_grid_strategy_list
      WHERE a_name IN (?, ?) OR strategySignal IN (?, ?)`,
    [...XIGNAL_STRATEGY_NAMES, ...XIGNAL_STRATEGY_NAMES]
  );
  const [[testGrid]] = await connection.query(
    `SELECT COUNT(*) AS count FROM test_grid_strategy_list
      WHERE a_name IN (?, ?) OR strategySignal IN (?, ?)`,
    [...XIGNAL_STRATEGY_NAMES, ...XIGNAL_STRATEGY_NAMES]
  );
  return {
    rows,
    pidDependencyCount:
      Number(liveSignal.count || 0) +
      Number(testSignal.count || 0) +
      Number(liveGrid.count || 0) +
      Number(testGrid.count || 0),
  };
};

const readAdminMemberSeedCandidate = async (connection) => {
  const columnList = ADMIN_MEMBER_COLUMNS.map(safeIdentifier).join(", ");
  const [rows] = await connection.query(
    `SELECT ${columnList}
       FROM admin_member
      WHERE grade = 0
      ORDER BY
        CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(password, '') <> '' THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(appKey, '') = '' AND COALESCE(appSecret, '') = '' THEN 0 ELSE 1 END,
        id
      LIMIT 1`
  );
  const candidate = rows[0] || null;
  if (!candidate) {
    return {
      row: null,
      summary: {
        available: false,
        policy: "PRESERVE_ONE_GRADE_ZERO_ADMIN",
        credentialPolicy: "CLEAR_API_KEY_SECRET",
        reason: "NO_GRADE_ZERO_ADMIN_CANDIDATE",
      },
    };
  }

  const seedRow = { ...candidate };
  seedRow.grade = 0;
  seedRow.status = "ACTIVE";
  seedRow.email_verified = 1;
  seedRow.appKey = null;
  seedRow.appSecret = null;
  seedRow.tradeAccessMode = "DEMO_ONLY";
  seedRow.updated_at = new Date();

  return {
    row: seedRow,
    summary: {
      available: true,
      policy: "PRESERVE_ONE_GRADE_ZERO_ADMIN",
      credentialPolicy: "CLEAR_API_KEY_SECRET",
      selectedId: Number(candidate.id || 0),
      grade: Number(candidate.grade || 0),
      status: candidate.status || null,
      emailVerified: Number(candidate.email_verified || 0),
      hasPassword: Boolean(candidate.password),
      hadApiKey: Boolean(candidate.appKey),
      hadApiSecret: Boolean(candidate.appSecret),
      restoredTradeAccessMode: "DEMO_ONLY",
      secretPrinted: false,
    },
  };
};

const restoreAdminMemberSeed = async (connection, seedRow) => {
  if (!seedRow) {
    throw new Error("Admin member seed candidate missing; reset blocked");
  }

  const columns = ADMIN_MEMBER_COLUMNS;
  const columnSql = columns.map(safeIdentifier).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const values = columns.map((columnName) => seedRow[columnName] ?? null);
  const [result] = await connection.query(
    `INSERT INTO admin_member (${columnSql}) VALUES (${placeholders})`,
    values
  );
  return Number(result.affectedRows || 0);
};

const writeSnapshot = (snapshotDir, snapshot) => {
  fs.mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = path.join(snapshotDir, `quantu-fresh-reset-${nowForFile()}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
  return snapshotPath;
};

const insertAudit = async (connection, { runId, fingerprint, startedAt, result, reason, affectedRows }) => {
  await connection.query(
    `INSERT INTO quantu_seed_migration_audit
      (runId, artifactType, seedName, migrationName, operatorName, machineName, repoPath, gitHead, dbHost, dbName, serverUuid, startedAt, finishedAt, affectedRows, result, reason)
     VALUES (?, 'operational_reset', '', 'quantu-fresh-operational-reset', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      affectedRows,
      result,
      reason || "",
    ]
  );
};

const run = async () => {
  const options = parseArgs();
  const connection = await createConnection();
  const runId = `quantu-reset-${Date.now()}`;
  const startedAt = new Date();

  try {
    const fingerprint = await readFingerprint(connection);
    const tableNames = await readTableNames(connection);
    const unclassified = tableNames.filter((tableName) => !ALL_CLASSIFIED_TABLES.has(tableName));
    if (unclassified.length > 0) {
      throw new Error(`Unclassified tables block reset: ${unclassified.join(", ")}`);
    }

    const beforeCounts = await readCounts(connection, tableNames);
    const xignalBefore = await readXignalStrategyState(connection);
    const adminSeedBefore = await readAdminMemberSeedCandidate(connection);
    const snapshot = {
      runId,
      mode: options.apply ? "apply" : "dry-run",
      fingerprint: {
        hostname: fingerprint.hostname,
        serverUuid: fingerprint.serverUuid,
        port: fingerprint.port,
        dbName: fingerprint.dbName,
        userName: "[REDACTED]",
        currentUser: "[REDACTED]",
      },
      resetTables: RESET_TABLES,
      preserveTables: PRESERVE_TABLES,
      adminSeedBefore: adminSeedBefore.summary,
      beforeCounts,
      xignalStrategyBefore: {
        rowCount: xignalBefore.rows.length,
        pidDependencyCount: xignalBefore.pidDependencyCount,
        rows: xignalBefore.rows,
      },
    };
    snapshot.snapshotPath = writeSnapshot(options.snapshotDir, snapshot);

    if (!options.apply) {
      const result = {
        ok: true,
        applied: false,
        snapshotPath: snapshot.snapshotPath,
        runId,
        resetTables: RESET_TABLES.length,
        preserveTables: PRESERVE_TABLES.length,
        xignalStrategyRows: xignalBefore.rows.length,
        xignalStrategyPidDependencyCount: xignalBefore.pidDependencyCount,
        adminSeedPlan: adminSeedBefore.summary,
        beforeCounts,
      };
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (xignalBefore.rows.length > 0 && xignalBefore.pidDependencyCount > 0) {
      throw new Error("XignalCrypto/XignalGap have local PID dependencies; reset blocked");
    }
    if (!adminSeedBefore.summary.available || !adminSeedBefore.row) {
      throw new Error("Admin member seed candidate missing; reset blocked");
    }

    await connection.beginTransaction();
    let affectedRows = 0;
    let restoredAdminRows = 0;
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      for (const tableName of RESET_TABLES) {
        const [result] = await connection.query(`DELETE FROM ${safeIdentifier(tableName)}`);
        affectedRows += Number(result.affectedRows || 0);
      }
      restoredAdminRows = await restoreAdminMemberSeed(connection, adminSeedBefore.row);
      affectedRows += restoredAdminRows;
      if (xignalBefore.rows.length > 0) {
        const [deleteResult] = await connection.query(
          `DELETE FROM strategy_catalog
            WHERE strategyName IN (?, ?) OR signalName IN (?, ?) OR strategyCategory IN ('xignal_crypto', 'xignal_gap')`,
          [...XIGNAL_STRATEGY_NAMES, ...XIGNAL_STRATEGY_NAMES]
        );
        affectedRows += Number(deleteResult.affectedRows || 0);
      }
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      await insertAudit(connection, {
        runId,
        fingerprint,
        startedAt,
        result: "SUCCESS",
        reason: "fresh QUANTU operational reset",
        affectedRows,
      });
      await connection.commit();
    } catch (error) {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {});
      await connection.rollback();
      await insertAudit(connection, {
        runId,
        fingerprint,
        startedAt,
        result: "FAILED",
        reason: error.message,
        affectedRows,
      }).catch(() => {});
      throw error;
    }

    const afterCounts = await readCounts(connection, tableNames);
    const xignalAfter = await readXignalStrategyState(connection);
    const result = {
      ok: true,
      applied: true,
      snapshotPath: snapshot.snapshotPath,
      runId,
      affectedRows,
      beforeCounts,
      afterCounts,
      adminSeedAfter: {
        ...adminSeedBefore.summary,
        restoredRows: restoredAdminRows,
      },
      xignalStrategyAfter: {
        rowCount: xignalAfter.rows.length,
        pidDependencyCount: xignalAfter.pidDependencyCount,
      },
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
