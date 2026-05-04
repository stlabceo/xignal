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
  "backtest_stat_archive",
  "backtest_stat_current",
  "backtest_webhook_log",
  "binance_runtime_event_log",
  "event_log",
  "live_grid_strategy_list",
  "live_pid_exit_reservation",
  "live_pid_position_ledger",
  "live_pid_position_snapshot",
  "live_play_list",
  "live_play_log",
  "live_position_bucket_owner",
  "msg_list",
  "play_list",
  "play_log",
  "policy_action_log",
  "policy_eval_log",
  "policy_runtime_state",
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
  "landing_strategy_rank_cache",
  "policy_rule",
  "quantu_seed_migration_audit",
  "real_price",
  "stoch_list",
  "strategy_catalog",
  "strategy_stats_bestcase",
  "strategy_stats_metric",
  "strategy_stats_raw",
];

const XIGNAL_STRATEGY_NAMES = ["XignalCrypto", "XignalGap"];
const ALL_CLASSIFIED_TABLES = new Set([...RESET_TABLES, ...PRESERVE_TABLES]);

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
        beforeCounts,
      };
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (xignalBefore.rows.length > 0 && xignalBefore.pidDependencyCount > 0) {
      throw new Error("XignalCrypto/XignalGap have local PID dependencies; reset blocked");
    }

    await connection.beginTransaction();
    let affectedRows = 0;
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      for (const tableName of RESET_TABLES) {
        const [result] = await connection.query(`DELETE FROM ${safeIdentifier(tableName)}`);
        affectedRows += Number(result.affectedRows || 0);
      }
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
