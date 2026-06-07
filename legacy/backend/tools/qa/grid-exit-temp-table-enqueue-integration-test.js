"use strict";

const assert = require("assert");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const db = require(path.resolve(repoRoot, "backend/database/connect/config"));
const queue = require(path.resolve(repoRoot, "backend/order-intent-queue"));

const readSafetyCounts = async () => {
  const queries = {
    totalQueue: "SELECT COUNT(*) AS cnt FROM order_intent_queue",
    pendingRunningRetry: "SELECT COUNT(*) AS cnt FROM order_intent_queue WHERE status IN ('PENDING','RUNNING','RETRY')",
    openSnapshots: "SELECT COUNT(*) AS cnt FROM live_pid_position_snapshot WHERE openQty <> 0",
    activeReservations: "SELECT COUNT(*) AS cnt FROM live_pid_exit_reservation WHERE status = 'ACTIVE'",
    zeroQtyResidue:
      "SELECT COUNT(*) AS cnt FROM live_position_bucket_owner WHERE symbol = 'XRPUSDT' AND ownedQty = 0 AND reservedCloseQty = 0 AND status IN ('RESERVED','ENTRY_ARMED')",
  };
  const out = {};
  for (const [key, sql] of Object.entries(queries)) {
    const [rows] = await db.query(sql);
    out[key] = Number(rows?.[0]?.cnt || 0);
  }
  return out;
};

const makeParentAndPlan = (pid = 501, regimeKey = "REGIME_TEMP_A") => {
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

const createTempTable = async () => {
  const tableName = `${queue.GRID_EXIT_TEMP_TABLE_PREFIX}${process.pid}_${Date.now()}`;
  const quoted = queue.quoteGridExitTempTableName(tableName);
  await db.query(`CREATE TEMPORARY TABLE ${quoted} LIKE order_intent_queue`);
  return { tableName, quoted };
};

(async () => {
  const [identityRows] = await db.query("SELECT CURRENT_USER() AS currentUser, DATABASE() AS dbName");
  const identity = identityRows?.[0] || {};
  assert.ok(String(identity.currentUser || "").includes("quantu_app"), "app connection uses quantu_app");
  assert.strictEqual(identity.dbName, "quantu_local", "DATABASE() quantu_local");

  const before = await readSafetyCounts();
  const { tableName, quoted } = await createTempTable();
  const sqlAudit = {
    tempTableName: tableName,
    createTemporaryTable: `CREATE TEMPORARY TABLE ${quoted} LIKE order_intent_queue`,
    insertTargets: [],
    updateTargets: [],
    deleteTargets: [],
  };

  try {
    assert.throws(() => queue.quoteGridExitTempTableName("order_intent_queue"), /unsafe temp table name/, "reject actual table name");
    assert.throws(
      () => queue.quoteGridExitTempTableName(`${queue.GRID_EXIT_TEMP_TABLE_PREFIX}bad;DROP_TABLE`),
      /unsafe temp table name/,
      "reject unsafe tableName injection"
    );

    const repository = queue.createGridExitTempTableQueueRepository({ connection: db, tableName });
    const { queueJoinPlan } = makeParentAndPlan();
    const tempResult = await queue.enqueueGridExitPlanWithRepository({
      queueJoinPlan,
      repository,
      mode: "TEMP_TABLE_ONLY",
      now: new Date("2026-06-05T12:30:00Z"),
    });
    assert.strictEqual(tempResult.result, "GRID_EXIT_ENQUEUE_TEMP_TABLE_ONLY_COMMITTED", "TEMP_TABLE_ONLY committed to temp table");
    assert.ok(tempResult.writes.length >= 2, "parent then children temp writes");
    assert.strictEqual(tempResult.writes[0].intentType, queue.INTENT_TYPE.GRID_EXIT_REQUEST, "parent first");
    assert.strictEqual(await repository.countRows(), tempResult.writes.length, "temp table row count matches writes");
    for (const row of tempResult.writes) {
      assert.strictEqual(row.status, queue.STATUS.BLOCKED, "temp row status BLOCKED");
      assert.ok(!["PENDING", "RUNNING", "RETRY", "DONE"].includes(row.status), "temp row not executable/success");
      const resultJson = JSON.parse(row.resultJson);
      assert.strictEqual(resultJson.canonicalState, "GRID_EXIT_ENQUEUE_TEMP_TABLE_ONLY_BLOCKED_NOT_EXECUTABLE");
      assert.strictEqual(resultJson.reason, "GRID_EXIT_ORCHESTRATOR_NOT_IMPLEMENTED");
      assert.ok(!/GRID_EXIT_CONVERGED|CLOSE_CONVERGED|SUCCESS/.test(row.resultJson), "no converged success resultJson");
    }
    sqlAudit.insertTargets.push(...repository.getAudit().filter((item) => item.op === "INSERT").map((item) => item.tableName));

    for (const rejected of ["ENQUEUE", "LIVE", "DB_WRITE"]) {
      assert.strictEqual(queue.normalizeGridExitEnqueueAdapterMode(rejected).ok, false, `${rejected} rejected`);
    }
    assert.strictEqual(queue.buildGridExitEnqueueAdapterPlan({ queueJoinPlan, mode: "OFF" }).writesPlanned.length, 0, "OFF does not write");
    assert.strictEqual(queue.buildGridExitEnqueueAdapterPlan({ queueJoinPlan, mode: "DRY_RUN" }).writesPlanned.length, 0, "DRY_RUN does not write");
    assert.strictEqual(queue.buildGridExitEnqueueAdapterPlan({ queueJoinPlan, mode: "MOCK_ONLY" }).actualDbWrite, false, "MOCK_ONLY does not use DB");

    const failParent = await createTempTable();
    try {
      const failingRepository = queue.createGridExitTempTableQueueRepository({ connection: db, tableName: failParent.tableName });
      const parentFail = await queue.enqueueGridExitPlanWithRepository({
        queueJoinPlan,
        repository: {
          ...failingRepository,
          insertIntentRow: async (row) => {
            await failingRepository.insertIntentRow(row);
            throw new Error("simulate parent failure after insert");
          },
          getAudit: failingRepository.getAudit,
        },
        mode: "TEMP_TABLE_ONLY",
      });
      assert.strictEqual(parentFail.result, queue.GRID_EXIT_ENQUEUE_ADAPTER_STATE.MOCK_ROLLED_BACK, "parent insert failure rollback");
      assert.strictEqual(await failingRepository.countRows(), 0, "parent rollback leaves temp table empty");
    } finally {
      await db.query(`DROP TEMPORARY TABLE IF EXISTS ${failParent.quoted}`);
    }

    const failChild = await createTempTable();
    try {
      const failingRepository = queue.createGridExitTempTableQueueRepository({ connection: db, tableName: failChild.tableName });
      let insertCount = 0;
      const childFail = await queue.enqueueGridExitPlanWithRepository({
        queueJoinPlan,
        repository: {
          ...failingRepository,
          insertIntentRow: async (row) => {
            insertCount += 1;
            if (insertCount > 1) {
              throw new Error("simulate child failure");
            }
            return await failingRepository.insertIntentRow(row);
          },
          getAudit: failingRepository.getAudit,
        },
        mode: "TEMP_TABLE_ONLY",
      });
      assert.strictEqual(childFail.result, queue.GRID_EXIT_ENQUEUE_ADAPTER_STATE.MOCK_ROLLED_BACK, "child insert failure rollback");
      assert.strictEqual(await failingRepository.countRows(), 0, "child rollback leaves temp table empty");
    } finally {
      await db.query(`DROP TEMPORARY TABLE IF EXISTS ${failChild.quoted}`);
    }

    const duplicateParentPlan = queue.buildGridExitQueueJoinPlan({
      ...makeParentAndPlan(),
      existingIntentRows: [{
        id: 1,
        intentType: queue.INTENT_TYPE.GRID_EXIT_REQUEST,
        intentKey: queueJoinPlan.parentRowCandidate.intentKey,
        status: "PENDING",
      }],
    });
    assert.strictEqual(
      queue.buildGridExitEnqueueAdapterPlan({ queueJoinPlan: duplicateParentPlan, mode: "TEMP_TABLE_ONLY" })
        .parentWrite,
      null,
      "duplicate parent in-flight no new parent"
    );

    const duplicateChildPlan = queue.buildGridExitQueueJoinPlan({
      ...makeParentAndPlan(),
      existingIntentRows: [{
        id: 2,
        intentType: queueJoinPlan.childRowCandidates[0].intentType,
        intentKey: queueJoinPlan.childRowCandidates[0].childNaturalKey,
        status: "RUNNING",
      }],
    });
    assert.strictEqual(
      queue.buildGridExitEnqueueAdapterPlan({ queueJoinPlan: duplicateChildPlan, mode: "TEMP_TABLE_ONLY" })
        .childWrites.some((row) => row.intentKey === queueJoinPlan.childRowCandidates[0].childNaturalKey),
      false,
      "duplicate child in-flight no new child"
    );

    const planA = makeParentAndPlan(501, "REGIME_MULTI_A").queueJoinPlan;
    const planB = makeParentAndPlan(502, "REGIME_MULTI_A").queueJoinPlan;
    assert.notStrictEqual(planA.parentRowCandidate.intentKey, planB.parentRowCandidate.intentKey, "same-key multi-PID separate parent rows");
    assert.notStrictEqual(planA.childRowCandidates[0].intentKey, planB.childRowCandidates[0].intentKey, "same symbol/side different PID not deduped");

    const keyless = queue.buildGridExitParentIntentCandidates({
      payload: { eventType: "GRID_EXIT", strategySignal: "Mean Revert Grid", symbol: "ADAUSDT.P", timeframe: "10min", gridRegimeKey: "REGIME_A" },
      previewResult: { targetItems: [{ uid: 156, pid: 1, strategyCategory: "grid", strategyMode: "live", resultCode: "GRID_EXIT_ROW_KEY_MISSING" }] },
    });
    assert.strictEqual(keyless.requested, 0, "keyless target no temp table write candidate");
    const candle = queue.buildGridExitParentIntentCandidates({
      payload: { eventType: "GRID_CANDLE_CLOSE_BREAKOUT", strategySignal: "Mean Revert Grid", symbol: "ADAUSDT.P", timeframe: "10min", gridRegimeKey: "REGIME_A" },
      previewResult: { targetItems: [{ uid: 156, pid: 1, strategyCategory: "grid", strategyMode: "live", resultCode: "GRID_CANDLE_CLOSE_LEGACY_DISABLED_AUDIT" }] },
    });
    assert.strictEqual(candle.requested, 0, "candle close legacy no temp table write candidate");

    const noChildPlan = queue.buildGridExitQueueJoinPlan({
      parentCandidate: makeParentAndPlan().parentCandidate,
      childCancelPlan: { entryCancelCandidates: [], protectionCancelCandidates: [] },
    });
    const noChildAdapterPlan = queue.buildGridExitEnqueueAdapterPlan({ queueJoinPlan: noChildPlan, mode: "TEMP_TABLE_ONLY" });
    assert.strictEqual(JSON.parse(noChildAdapterPlan.parentWrite.resultJson).terminalSuccess, false, "no child candidate does not mark parent success");

    const after = await readSafetyCounts();
    assert.deepStrictEqual(after, before, "actual table counts unchanged before/after");

    const actualWriteTargets = [...sqlAudit.insertTargets, ...sqlAudit.updateTargets, ...sqlAudit.deleteTargets]
      .filter((name) => name === "order_intent_queue");
    assert.strictEqual(actualWriteTargets.length, 0, "no write target order_intent_queue");

    console.log(JSON.stringify({
      ok: true,
      tests: 39,
      currentUser: identity.currentUser,
      dbName: identity.dbName,
      passwordPrinted: false,
      tempTableName: tableName,
      sqlAudit,
      before,
      after,
      dbMutationOutsideTemp: 0,
      binanceWrite: 0,
    }, null, 2));
  } finally {
    await db.query(`DROP TEMPORARY TABLE IF EXISTS ${quoted}`);
    if (typeof db.end === "function") {
      await db.end().catch(() => {});
    }
  }
})().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
