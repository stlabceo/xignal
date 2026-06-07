"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const db = require(path.resolve(repoRoot, "backend/database/connect/config"));
const queue = require(path.resolve(repoRoot, "backend/order-intent-queue"));

process.env.GRID_EXIT_QA_QUARANTINE_CLEANUP_HARNESS = "1";
process.env.GRID_EXIT_ALLOW_QA_QUARANTINE_CLEANUP = "1";
process.env.GRID_EXIT_QA_CLEANUP_RUN_ID =
  process.env.GRID_EXIT_QA_CLEANUP_RUN_ID || "PHASE_2G_9236_1780828432018";

const queueSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-queue.js"), "utf8");
const workerSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-worker.js"), "utf8");
const routeSource = fs.readFileSync(path.resolve(repoRoot, "backend/routes/users.js"), "utf8");

const marker = queue.GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_HARNESS;
const runId = process.env.GRID_EXIT_QA_CLEANUP_RUN_ID;
const expectedIds = [261889, 261890, 261891, 261892];

const readOneCount = async (connection, sql, params = []) => {
  const [rows] = await connection.query(sql, params);
  return Number(rows?.[0]?.cnt || 0);
};

const readSafetyCounts = async (connection) => ({
  totalQueue: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM order_intent_queue"),
  pendingRunningRetry: await readOneCount(
    connection,
    "SELECT COUNT(*) AS cnt FROM order_intent_queue WHERE status IN ('PENDING','RUNNING','RETRY')"
  ),
  targetIdRows: await readOneCount(
    connection,
    `SELECT COUNT(*) AS cnt FROM order_intent_queue WHERE id IN (${expectedIds.map(() => "?").join(",")})`,
    expectedIds
  ),
  qaMarkerRows: await readOneCount(
    connection,
    `SELECT COUNT(*) AS cnt
       FROM order_intent_queue
      WHERE (
          JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.qaHarness')) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(resultJson, '$.qaHarness')) = ?
        )
        AND (
          JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.runId')) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(resultJson, '$.runId')) = ?
        )`,
    [marker, marker, runId, runId]
  ),
  openSnapshots: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM live_pid_position_snapshot WHERE openQty <> 0"),
  activeReservations: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM live_pid_exit_reservation WHERE status = 'ACTIVE'"),
  zeroQtyResidue: await readOneCount(
    connection,
    "SELECT COUNT(*) AS cnt FROM live_position_bucket_owner WHERE symbol = 'XRPUSDT' AND ownedQty = 0 AND reservedCloseQty = 0 AND status IN ('RESERVED','ENTRY_ARMED')"
  ),
});

const summarizeRows = (rows = []) => rows.map((row) => {
  const payload = typeof row.payloadJson === "string" ? JSON.parse(row.payloadJson) : row.payloadJson;
  const result = typeof row.resultJson === "string" ? JSON.parse(row.resultJson) : row.resultJson;
  return {
    id: row.id,
    uid: row.uid,
    pid: row.pid,
    intentType: row.intentType,
    status: row.status,
    qaHarness: payload.qaHarness || result.qaHarness,
    runId: payload.runId || result.runId,
    executable: result.executable,
    workerClaimable: result.workerClaimable,
    cleanupRequiresPmApproval: result.cleanupRequiresPmApproval,
  };
});

(async () => {
  if (db.__startupFingerprintCheck) {
    await db.__startupFingerprintCheck;
  }
  const connection = await db.getConnection();
  try {
    const [identityRows] = await connection.query("SELECT CURRENT_USER() AS currentUser, DATABASE() AS dbName");
    const identity = identityRows?.[0] || {};
    assert.ok(String(identity.currentUser || "").includes("quantu_app"), "app connection uses quantu_app");
    assert.strictEqual(identity.dbName, "quantu_local", "DATABASE() quantu_local");
    assert.strictEqual(process.env.GRID_EXIT_QA_QUARANTINE_CLEANUP_HARNESS, "1", "cleanup harness flag enabled");
    assert.strictEqual(process.env.GRID_EXIT_ALLOW_QA_QUARANTINE_CLEANUP, "1", "cleanup approval flag enabled");
    assert.strictEqual(runId, "PHASE_2G_9236_1780828432018", "cleanup runId exact");

    assert.throws(
      () => queue.createGridExitPersistentBlockedQuarantineCleanupRepository({
        connection,
        tableName: "order_intent_queue",
        harnessEnabled: false,
        allowCleanup: true,
        runId,
        expectedIds,
      }),
      /cleanup harness flag is required/,
      "repository rejects when harness disabled"
    );
    assert.throws(
      () => queue.createGridExitPersistentBlockedQuarantineCleanupRepository({
        connection,
        tableName: "order_intent_queue",
        harnessEnabled: true,
        allowCleanup: false,
        runId,
        expectedIds,
      }),
      /cleanup approval flag is required/,
      "repository rejects without cleanup approval"
    );
    assert.throws(
      () => queue.createGridExitPersistentBlockedQuarantineCleanupRepository({
        connection,
        tableName: "order_intent_queue",
        harnessEnabled: true,
        allowCleanup: true,
        runId: "",
        expectedIds,
      }),
      /cleanup runId is required/,
      "repository rejects missing runId"
    );
    assert.throws(
      () => queue.createGridExitPersistentBlockedQuarantineCleanupRepository({
        connection,
        tableName: "tmp_order_intent_queue",
        harnessEnabled: true,
        allowCleanup: true,
        runId,
        expectedIds,
      }),
      /cleanup repository rejects table/,
      "repository rejects non-actual table"
    );

    const repository = queue.createGridExitPersistentBlockedQuarantineCleanupRepository({
      connection,
      tableName: "order_intent_queue",
      harnessEnabled: true,
      allowCleanup: true,
      runId,
      expectedIds,
      expectedCount: 4,
    });
    assert.strictEqual(typeof repository.insertIntentRow, "undefined", "no INSERT helper");
    assert.strictEqual(typeof repository.updateIntentRow, "undefined", "no UPDATE helper");

    const before = await readSafetyCounts(connection);
    const targetRows = await repository.selectTargetRows();
    if (before.targetIdRows > 0 || before.qaMarkerRows > 0) {
      assert.strictEqual(targetRows.length, 4, "target count must equal 4");
      assert.deepStrictEqual(targetRows.map((row) => Number(row.id)), expectedIds, "target ids match expected ids");
      repository.validateCleanupTargetRows(targetRows);
      assert.throws(
        () => repository.validateCleanupTargetRows(targetRows.map((row, idx) => idx === 0 ? { ...row, status: "PENDING" } : row)),
        /rejects status/,
        "PENDING target rejected"
      );
      assert.throws(
        () => repository.validateCleanupTargetRows(targetRows.map((row, idx) => idx === 0 ? { ...row, status: "DONE" } : row)),
        /rejects status/,
        "DONE target rejected"
      );
      assert.throws(
        () => repository.validateCleanupTargetRows(targetRows.slice(0, 3)),
        /BLOCKED_PARTIAL_QA_QUARANTINE_ROWS/,
        "partial target rejected"
      );
    }

    const cleanupResult = await repository.cleanupExpectedRows();
    const after = await readSafetyCounts(connection);
    const audit = repository.getAudit();
    const alreadyCleaned = cleanupResult.result === "GRID_EXIT_QA_QUARANTINE_ALREADY_CLEANED";

    if (alreadyCleaned) {
      assert.strictEqual(before.targetIdRows, 0, "already cleaned target ids absent before");
      assert.strictEqual(before.qaMarkerRows, 0, "already cleaned marker absent before");
      assert.strictEqual(cleanupResult.deletedCount, 0, "already cleaned deletes zero");
      assert.strictEqual(after.totalQueue, before.totalQueue, "already cleaned total unchanged");
    } else {
      assert.strictEqual(cleanupResult.result, "GRID_EXIT_QA_QUARANTINE_CLEANED", "cleanup result");
      assert.strictEqual(cleanupResult.deletedCount, 4, "deleted count is 4");
      assert.strictEqual(cleanupResult.committed, true, "cleanup transaction committed");
      assert.strictEqual(before.totalQueue, after.totalQueue + 4, "queue total decreases by 4");
      assert.strictEqual(before.targetIdRows, 4, "target ids existed before");
      assert.strictEqual(after.targetIdRows, 0, "target ids absent after");
      assert.strictEqual(before.qaMarkerRows, 4, "marker rows existed before");
      assert.strictEqual(after.qaMarkerRows, 0, "marker rows absent after");
      assert.ok(audit.some((item) => item.op === "START_TRANSACTION"), "START TRANSACTION observed");
      assert.ok(audit.some((item) => item.op === "DELETE" && item.tableName === "order_intent_queue" && item.count === 4), "DELETE target table observed");
      assert.ok(audit.some((item) => item.op === "COMMIT"), "COMMIT observed");
    }
    assert.strictEqual(after.pendingRunningRetry, before.pendingRunningRetry, "PENDING/RUNNING/RETRY unchanged");
    assert.strictEqual(after.openSnapshots, before.openSnapshots, "snapshot open count unchanged");
    assert.strictEqual(after.activeReservations, before.activeReservations, "active reservation count unchanged");
    assert.strictEqual(after.zeroQtyResidue, before.zeroQtyResidue, "zero-qty residue unchanged");
    assert.strictEqual(audit.some((item) => item.op === "INSERT"), false, "no INSERT audit");
    assert.strictEqual(audit.some((item) => item.op === "UPDATE"), false, "no UPDATE audit");

    assert.ok(queueSource.includes("WHERE q.status = 'PENDING'"), "worker claim query targets PENDING");
    assert.ok(queueSource.includes("AND status = 'PENDING'"), "worker claim update requires PENDING");
    assert.strictEqual(queueSource.includes("WHERE q.status = 'BLOCKED'"), false, "worker does not claim BLOCKED");
    assert.strictEqual(routeSource.includes("PERSISTENT_BLOCKED_QA_ONLY"), false, "route does not expose persistent QA mode");
    const parentGuardStart = workerSource.indexOf("const processGridExitRequestIntent");
    const parentGuardEnd = workerSource.indexOf("const processGridExitChildCancelIntent", parentGuardStart);
    const childGuardStart = workerSource.indexOf("const processGridExitChildCancelIntent");
    const childGuardEnd = workerSource.indexOf("const processIntent", childGuardStart);
    const guards = workerSource.slice(parentGuardStart, parentGuardEnd) + workerSource.slice(childGuardStart, childGuardEnd);
    assert.ok(guards.includes("status: orderIntentQueue.STATUS.BLOCKED"), "worker Grid exit guards still block");
    assert.ok(!/cancelGridOrders|closeGridLegMarketOrder|STATUS\.DONE|GRID_EXIT_CONVERGED|CLOSE_CONVERGED|require\(["']\.\/coin["']\)/.test(guards),
      "worker does not call cancel/close/success");

    console.log(JSON.stringify({
      ok: true,
      tests: 40,
      currentUser: identity.currentUser,
      dbName: identity.dbName,
      passwordPrinted: false,
      hardFlags: {
        GRID_EXIT_QA_QUARANTINE_CLEANUP_HARNESS: process.env.GRID_EXIT_QA_QUARANTINE_CLEANUP_HARNESS,
        GRID_EXIT_ALLOW_QA_QUARANTINE_CLEANUP: process.env.GRID_EXIT_ALLOW_QA_QUARANTINE_CLEANUP,
        GRID_EXIT_QA_CLEANUP_RUN_ID: runId,
      },
      targetPreflight: {
        expectedIds,
        targetRows: summarizeRows(targetRows),
        targetCount: targetRows.length,
      },
      cleanupResult: {
        result: cleanupResult.result,
        deletedCount: cleanupResult.deletedCount,
        committed: cleanupResult.committed,
        alreadyCleaned,
      },
      sqlAudit: {
        startTransactionObserved: audit.some((item) => item.op === "START_TRANSACTION"),
        deleteTargets: audit.filter((item) => item.op === "DELETE").map((item) => item.tableName),
        deletedCount: audit.filter((item) => item.op === "DELETE").reduce((sum, item) => sum + Number(item.count || 0), 0),
        commitObserved: audit.some((item) => item.op === "COMMIT"),
        insertTargets: audit.filter((item) => item.op === "INSERT").map((item) => item.tableName),
        updateTargets: audit.filter((item) => item.op === "UPDATE").map((item) => item.tableName),
      },
      before,
      after,
      binanceWrite: 0,
      phase2GPersistentInsertRerunMode: "not-run-in-insert-mode",
    }, null, 2));
  } finally {
    connection.release();
    if (typeof db.end === "function") {
      await db.end().catch(() => {});
    }
  }
})().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
