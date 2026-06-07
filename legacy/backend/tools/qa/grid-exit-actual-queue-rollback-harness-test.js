"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const db = require(path.resolve(repoRoot, "backend/database/connect/config"));
const queue = require(path.resolve(repoRoot, "backend/order-intent-queue"));

process.env.GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_HARNESS = "1";

const queueSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-queue.js"), "utf8");
const workerSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-worker.js"), "utf8");
const routeSource = fs.readFileSync(path.resolve(repoRoot, "backend/routes/users.js"), "utf8");

const readOneCount = async (connection, sql) => {
  const [rows] = await connection.query(sql);
  return Number(rows?.[0]?.cnt || 0);
};

const readSafetyCounts = async (connection) => ({
  totalQueue: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM order_intent_queue"),
  pendingRunningRetry: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM order_intent_queue WHERE status IN ('PENDING','RUNNING','RETRY')"),
  openSnapshots: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM live_pid_position_snapshot WHERE openQty <> 0"),
  activeReservations: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM live_pid_exit_reservation WHERE status = 'ACTIVE'"),
  zeroQtyResidue: await readOneCount(
    connection,
    "SELECT COUNT(*) AS cnt FROM live_position_bucket_owner WHERE symbol = 'XRPUSDT' AND ownedQty = 0 AND reservedCloseQty = 0 AND status IN ('RESERVED','ENTRY_ARMED')"
  ),
});

const readAutoIncrement = async (connection) => {
  const [rows] = await connection.query(
    `SELECT AUTO_INCREMENT
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'quantu_local'
        AND TABLE_NAME = 'order_intent_queue'`
  );
  return rows?.[0]?.AUTO_INCREMENT == null ? null : Number(rows[0].AUTO_INCREMENT);
};

const makeParentAndPlan = (pid = 2601, regimeKey = "REGIME_ACTUAL_ROLLBACK_A") => {
  const payload = {
    eventType: "GRID_EXIT",
    strategySignal: "Mean Revert Grid",
    symbol: "ADAUSDT.P",
    timeframe: "10min",
    gridRegimeKey: regimeKey,
    signalTime: "2026-06-05T12:10:00",
  };
  const parentCandidate = queue.buildGridExitParentIntentCandidates({
    payload,
    previewResult: {
      targetItems: [
        {
          uid: 156,
          pid,
          strategyCategory: "grid",
          strategyMode: "live",
          strategySignal: "Mean Revert Grid",
          symbol: "ADAUSDT",
          bunbong: "10MIN",
          resultCode: "GRID_EXIT_ALERT_PREVIEW",
        },
      ],
    },
  }).candidates[0];
  const childCancelPlan = queue.buildGridExitChildCancelPlan(parentCandidate, {
    uid: 156,
    pid,
    gridRegimeKey: regimeKey,
    strategySignal: "Mean Revert Grid",
    symbol: "ADAUSDT",
    timeframe: "10MIN",
    enabled: true,
    terminal: false,
    legs: [
      {
        positionSide: "LONG",
        ownerOpenQty: 10,
        protectionReservations: [
          { reservationId: `TP_L_${pid}`, clientOrderId: `TP_L_CID_${pid}`, type: "TP", status: "ACTIVE" },
          { reservationId: `STOP_L_${pid}`, clientOrderId: `STOP_L_CID_${pid}`, type: "STOP", status: "ACTIVE" },
        ],
      },
      {
        positionSide: "SHORT",
        entryOrders: [{ clientOrderId: `ENTRY_S_${pid}`, orderId: `2002_${pid}`, status: "NEW", role: "ENTRY", open: true }],
      },
    ],
  });
  return {
    parentCandidate,
    childCancelPlan,
    queueJoinPlan: queue.buildGridExitQueueJoinPlan({
      parentCandidate,
      childCancelPlan,
      existingIntentRows: [],
      mode: "DRY_RUN",
    }),
  };
};

const getRollbackWrites = () => {
  const { queueJoinPlan } = makeParentAndPlan();
  const plan = queue.buildGridExitEnqueueAdapterPlan({
    queueJoinPlan,
    mode: queue.GRID_EXIT_ENQUEUE_ADAPTER_ACTUAL_QUEUE_ROLLBACK_MODE,
    now: new Date("2026-06-05T12:30:00Z"),
  });
  assert.strictEqual(plan.result, "GRID_EXIT_ENQUEUE_ACTUAL_QUEUE_ROLLBACK_VERIFIED", "actual rollback adapter plan result");
  assert.ok(plan.writesPlanned.length >= 2, "actual rollback has parent and child writes planned");
  return { queueJoinPlan, writes: plan.writesPlanned };
};

const assertRejectsInTransaction = async (connection, row, expectedMessage) => {
  const repository = queue.createGridExitActualQueueRollbackRepository({
    connection,
    tableName: "order_intent_queue",
    harnessEnabled: true,
  });
  await repository.begin();
  try {
    await assert.rejects(() => repository.insertIntentRow(row), expectedMessage);
  } finally {
    await repository.rollback();
  }
};

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
    assert.strictEqual(process.env.GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_HARNESS, "1", "harness flag enabled");

    const before = await readSafetyCounts(connection);
    const autoIncrementBefore = await readAutoIncrement(connection);
    const { queueJoinPlan, writes } = getRollbackWrites();
    const sampleRow = writes[0];

    assert.throws(
      () => queue.createGridExitActualQueueRollbackRepository({ connection, tableName: "order_intent_queue", harnessEnabled: false }),
      /harness flag is required/,
      "repository rejects when harness disabled"
    );
    assert.throws(
      () => queue.createGridExitActualQueueRollbackRepository({ connection, tableName: "tmp_order_intent_queue", harnessEnabled: true }),
      /rejects table/,
      "repository rejects non-actual table name"
    );
    assert.strictEqual(queue.normalizeGridExitEnqueueAdapterMode("ACTUAL_QUEUE_ROLLBACK_ONLY").ok, true, "actual rollback mode accepted");
    for (const rejected of ["ENQUEUE", "LIVE", "DB_WRITE", "PERSISTENT"]) {
      assert.strictEqual(queue.normalizeGridExitEnqueueAdapterMode(rejected).ok, false, `${rejected} rejected`);
    }

    const noBeginRepo = queue.createGridExitActualQueueRollbackRepository({
      connection,
      tableName: "order_intent_queue",
      harnessEnabled: true,
    });
    await assert.rejects(() => noBeginRepo.insertIntentRow(sampleRow), /outside transaction/, "begin required before insert");

    const commitGuardRepo = queue.createGridExitActualQueueRollbackRepository({
      connection,
      tableName: "order_intent_queue",
      harnessEnabled: true,
    });
    await commitGuardRepo.begin();
    try {
      await assert.rejects(() => commitGuardRepo.commit(), /never commits/, "commit rejected");
    } finally {
      await commitGuardRepo.rollback();
    }

    await assertRejectsInTransaction(
      connection,
      { ...sampleRow, status: "PENDING" },
      /only allows BLOCKED/,
    );
    await assertRejectsInTransaction(
      connection,
      {
        ...sampleRow,
        payloadJson: JSON.stringify({ noQaMarker: true }),
        resultJson: JSON.stringify({ noQaMarker: true }),
      },
      /missing QA marker/,
    );
    await assertRejectsInTransaction(
      connection,
      { ...sampleRow, intentType: "GRID_LIVE_ARM" },
      /rejects intentType/,
    );

    const repository = queue.createGridExitActualQueueRollbackRepository({
      connection,
      tableName: "order_intent_queue",
      harnessEnabled: true,
    });
    const rollbackResult = await queue.enqueueGridExitPlanWithRepository({
      queueJoinPlan,
      repository,
      mode: queue.GRID_EXIT_ENQUEUE_ADAPTER_ACTUAL_QUEUE_ROLLBACK_MODE,
      now: new Date("2026-06-05T12:30:00Z"),
    });
    assert.strictEqual(rollbackResult.result, "GRID_EXIT_ENQUEUE_ACTUAL_QUEUE_ROLLBACK_VERIFIED", "actual rollback verified");
    assert.strictEqual(rollbackResult.committed, false, "not committed");
    assert.strictEqual(rollbackResult.rolledBack, true, "rolled back");
    assert.strictEqual(rollbackResult.persistentMutation, false, "no persistent mutation");
    assert.strictEqual(
      rollbackResult.insertedVisibleInTransaction,
      before.totalQueue + rollbackResult.writes.length,
      "inserted rows visible inside same transaction before rollback"
    );
    assert.ok(rollbackResult.writes.length >= 2, "parent and children were inserted in transaction");
    for (const row of rollbackResult.writes) {
      assert.strictEqual(row.status, queue.STATUS.BLOCKED, "rollback row status BLOCKED");
      assert.ok(!["PENDING", "RUNNING", "RETRY", "DONE", "SUCCESS"].includes(row.status), "rollback row not claimable/success");
      assert.ok(queue.GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_ALLOWED_INTENT_TYPES == null, "internal allowlist not exported");
      assert.ok(
        [
          queue.INTENT_TYPE.GRID_EXIT_REQUEST,
          queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL,
          queue.INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL,
        ].includes(row.intentType),
        "allowed Grid exit intent type"
      );
      const payload = JSON.parse(row.payloadJson);
      const result = JSON.parse(row.resultJson);
      assert.strictEqual(payload.qaHarness, queue.GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_HARNESS, "payload QA marker");
      assert.strictEqual(result.qaHarness, queue.GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_HARNESS, "result QA marker");
      assert.strictEqual(result.canonicalState, "GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_BLOCKED_NOT_EXECUTABLE", "blocked canonical state");
      assert.strictEqual(result.reason, "GRID_EXIT_ORCHESTRATOR_NOT_IMPLEMENTED", "not implemented reason");
      assert.ok(!/GRID_EXIT_CONVERGED|CLOSE_CONVERGED|SUCCESS/.test(row.resultJson), "no converged/success resultJson");
    }

    const audit = rollbackResult.repositoryEvents || [];
    const ops = audit.map((item) => item.op);
    assert.ok(ops.includes("START_TRANSACTION"), "START TRANSACTION observed");
    assert.ok(ops.includes("ROLLBACK"), "ROLLBACK observed");
    assert.strictEqual(ops.includes("COMMIT"), false, "COMMIT not observed");
    assert.strictEqual(ops.includes("COMMIT_REJECTED"), false, "adapter did not call commit");
    assert.strictEqual(audit.filter((item) => item.op === "INSERT").length, rollbackResult.writes.length, "INSERT audit count");
    assert.deepStrictEqual(
      [...new Set(audit.filter((item) => item.op === "INSERT").map((item) => item.tableName))],
      ["order_intent_queue"],
      "actual INSERT target is order_intent_queue"
    );
    assert.deepStrictEqual(
      [...new Set(audit.filter((item) => item.op === "INSERT").map((item) => item.status))],
      [queue.STATUS.BLOCKED],
      "only BLOCKED rows inserted"
    );
    assert.strictEqual(audit.some((item) => item.op === "UPDATE"), false, "no UPDATE audit");
    assert.strictEqual(audit.some((item) => item.op === "DELETE"), false, "no DELETE audit");

    const after = await readSafetyCounts(connection);
    const autoIncrementAfter = await readAutoIncrement(connection);
    assert.deepStrictEqual(after, before, "actual app-path counts unchanged after rollback");

    assert.ok(routeSource.includes("GRID_EXIT_ENQUEUE_ADAPTER_MODE"), "route has adapter flag");
    assert.ok(routeSource.includes("enqueueAdapter"), "route exposes dry-run adapter summary");
    assert.ok(routeSource.includes("enqueueEnabled: false"), "route enqueue disabled");
    assert.ok(routeSource.includes("mockOnlyAllowedInRoute: false"), "route mock-only disabled");
    assert.strictEqual(routeSource.includes("ACTUAL_QUEUE_ROLLBACK_ONLY"), false, "route does not expose actual rollback mode");
    assert.ok(!/enqueueGridExit/i.test(routeSource), "route has no live GRID_EXIT enqueue function call");

    const parentGuardStart = workerSource.indexOf("const processGridExitRequestIntent");
    const parentGuardEnd = workerSource.indexOf("const processGridExitChildCancelIntent", parentGuardStart);
    const childGuardStart = workerSource.indexOf("const processGridExitChildCancelIntent");
    const childGuardEnd = workerSource.indexOf("const processIntent", childGuardStart);
    assert.ok(parentGuardStart > 0 && parentGuardEnd > parentGuardStart, "worker parent guard present");
    assert.ok(childGuardStart > 0 && childGuardEnd > childGuardStart, "worker child guard present");
    const guards = workerSource.slice(parentGuardStart, parentGuardEnd) + workerSource.slice(childGuardStart, childGuardEnd);
    assert.ok(guards.includes("status: orderIntentQueue.STATUS.BLOCKED"), "worker guards block");
    assert.ok(!/cancelGridOrders|closeGridLegMarketOrder|STATUS\.DONE|GRID_EXIT_CONVERGED|CLOSE_CONVERGED|require\(["']\.\/coin["']\)/.test(guards),
      "worker does not call cancel/close/success");

    assert.ok(queueSource.includes("createGridExitActualQueueRollbackRepository"), "actual rollback repository source exists");
    assert.ok(queueSource.includes("actual queue rollback repository never commits"), "commit is explicitly rejected");

    console.log(JSON.stringify({
      ok: true,
      tests: 44,
      currentUser: identity.currentUser,
      dbName: identity.dbName,
      passwordPrinted: false,
      harnessFlag: process.env.GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_HARNESS,
      rollbackResult: {
        result: rollbackResult.result,
        writes: rollbackResult.writes.length,
        insertedVisibleInTransaction: rollbackResult.insertedVisibleInTransaction,
        committed: rollbackResult.committed,
        rolledBack: rollbackResult.rolledBack,
        persistentMutation: rollbackResult.persistentMutation,
      },
      sqlAudit: {
        startTransactionObserved: ops.includes("START_TRANSACTION"),
        insertTargets: audit.filter((item) => item.op === "INSERT").map((item) => item.tableName),
        insertedStatuses: audit.filter((item) => item.op === "INSERT").map((item) => item.status),
        qaMarker: queue.GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_QA_MARKER,
        commitObserved: ops.includes("COMMIT"),
        rollbackObserved: ops.includes("ROLLBACK"),
        updateTargets: audit.filter((item) => item.op === "UPDATE").map((item) => item.tableName),
        deleteTargets: audit.filter((item) => item.op === "DELETE").map((item) => item.tableName),
      },
      before,
      after,
      autoIncrementBefore,
      autoIncrementAfter,
      autoIncrementClassification: autoIncrementBefore === autoIncrementAfter
        ? "NO_AUTOINCREMENT_SIDE_EFFECT"
        : "ROLLBACK_HARNESS_AUTOINCREMENT_SIDE_EFFECT",
      dbMutationPersistent: 0,
      binanceWrite: 0,
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
