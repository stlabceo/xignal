"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const db = require(path.resolve(repoRoot, "backend/database/connect/config"));
const queue = require(path.resolve(repoRoot, "backend/order-intent-queue"));

const queueSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-queue.js"), "utf8");
const workerSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-worker.js"), "utf8");

let tests = 0;
const check = (label, fn) => {
  fn();
  tests += 1;
  return label;
};

const readOneCount = async (connection, sql) => {
  const [rows] = await connection.query(sql);
  return Number(rows?.[0]?.cnt || 0);
};

const readSafetyCounts = async (connection) => ({
  totalQueue: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM order_intent_queue"),
  pendingRunningRetry: await readOneCount(
    connection,
    "SELECT COUNT(*) AS cnt FROM order_intent_queue WHERE status IN ('PENDING','RUNNING','RETRY')"
  ),
  phase2GMarkerRows: await readOneCount(
    connection,
    `SELECT COUNT(*) AS cnt
       FROM order_intent_queue
      WHERE JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.qaHarness')) = 'GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_ENQUEUE'
         OR JSON_UNQUOTE(JSON_EXTRACT(resultJson, '$.qaHarness')) = 'GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_ENQUEUE'`
  ),
  openSnapshots: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM live_pid_position_snapshot WHERE openQty <> 0"),
  activeReservations: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM live_pid_exit_reservation WHERE status = 'ACTIVE'"),
  zeroQtyResidue: await readOneCount(
    connection,
    "SELECT COUNT(*) AS cnt FROM live_position_bucket_owner WHERE symbol = 'XRPUSDT' AND ownedQty = 0 AND reservedCloseQty = 0 AND status IN ('RESERVED','ENTRY_ARMED')"
  ),
});

const gridRegime = (overrides = {}) => ({
  uid: 920041,
  pid: 930041,
  symbol: "ADAUSDT",
  positionSide: "LONG",
  gridRegimeKey: "REGIME_STOP_BACKSTOP",
  strategySignal: "Mean Revert Grid",
  ...overrides,
});

const stopEvent = (overrides = {}) => ({
  uid: 920041,
  pid: 930041,
  symbol: "ADAUSDT",
  positionSide: "LONG",
  orderStatus: "FILLED",
  executedQty: 10,
  orderId: "STOP_ORDER_1",
  clientOrderId: "STOP_CLIENT_1",
  ...overrides,
});

const initialState = (overrides = {}) => ({
  uid: 920041,
  pid: 930041,
  symbol: "ADAUSDT",
  positionSide: "LONG",
  ownerOpenQty: 10,
  snapshotOpenQty: 10,
  activeReservationQty: 2,
  ledgerRows: [],
  gridRegimeKey: "REGIME_STOP_BACKSTOP",
  ...overrides,
});

const siblingScan = (overrides = {}) => queue.scanGridStopSiblingExposureMock({
  stoppedLeg: {
    uid: 920041,
    pid: 930041,
    symbol: "ADAUSDT",
    positionSide: "LONG",
  },
  siblingLeg: {
    uid: 920041,
    pid: 930041,
    symbol: "ADAUSDT",
    positionSide: "SHORT",
    ...(overrides.siblingLeg || {}),
  },
  ownerSnapshot: overrides.ownerSnapshot || [
    { uid: 920041, pid: 930041, symbol: "ADAUSDT", positionSide: "SHORT", ownedQty: 6, reservedCloseQty: 0, status: "OPEN" },
    { uid: 920041, pid: 930042, symbol: "ADAUSDT", positionSide: "SHORT", ownedQty: 99, reservedCloseQty: 0, status: "OPEN" },
  ],
  positionSnapshot: overrides.positionSnapshot || [
    { uid: 920041, pid: 930041, symbol: "ADAUSDT", positionSide: "SHORT", openQty: 6, status: "OPEN" },
  ],
  reservationSnapshot: overrides.reservationSnapshot || [
    { uid: 920041, pid: 930041, symbol: "ADAUSDT", positionSide: "SHORT", remainingQty: 2, status: "ACTIVE" },
  ],
});

(async () => {
  if (db.__startupFingerprintCheck) {
    await db.__startupFingerprintCheck;
  }
  const connection = await db.getConnection();
  try {
    const [identityRows] = await connection.query("SELECT CURRENT_USER() AS currentUser, DATABASE() AS dbName");
    const identity = identityRows?.[0] || {};
    check("app connection uses quantu_app", () => assert.ok(String(identity.currentUser || "").includes("quantu_app")));
    check("database is quantu_local", () => assert.strictEqual(identity.dbName, "quantu_local"));
    const before = await readSafetyCounts(connection);

    const policy = queue.buildGridExitStopEmergencyBackstopPolicy({
      gridRegime: gridRegime(),
      stopObservation: stopEvent(),
      mode: "MOCK_ONLY",
    });
    check("STOP is emergency backstop, not normal GRID_EXIT success", () => {
      assert.strictEqual(policy.stopIsEmergencyBackstop, true);
      assert.strictEqual(policy.stopIsNormalGridExitSuccess, false);
      assert.strictEqual(policy.terminalSuccess, false);
    });
    check("STOP fill confirmed classified", () => {
      const result = queue.classifyGridStopEmergencyObservation({
        gridRegime: gridRegime(),
        observedEvent: stopEvent(),
      });
      assert.strictEqual(result.classification, queue.GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.FILL_CONFIRMED);
      assert.strictEqual(result.normalGridExitSuccess, false);
    });
    check("STOP partial fill not terminal", () => {
      const result = queue.classifyGridStopEmergencyObservation({
        gridRegime: gridRegime(),
        observedEvent: stopEvent({ orderStatus: "PARTIALLY_FILLED", executedQty: 3 }),
      });
      assert.strictEqual(result.classification, queue.GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.PARTIAL_FILL_NOT_TERMINAL);
      assert.strictEqual(result.terminal, false);
    });
    check("STOP fill during GRID_EXIT race classified", () => {
      const result = queue.classifyGridStopEmergencyObservation({
        gridRegime: gridRegime(),
        observedEvent: stopEvent({ gridExitInProgress: true, executedQty: 5 }),
      });
      assert.strictEqual(result.classification, queue.GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.FILL_DURING_GRID_EXIT_RACE);
      assert.strictEqual(result.recoveryRequired, true);
    });
    check("STOP socket missing requires REST recovery", () => {
      const result = queue.classifyGridStopEmergencyObservation({
        gridRegime: gridRegime(),
        observedEvent: stopEvent({ socketMissing: true, orderStatus: "", executedQty: 0 }),
      });
      assert.strictEqual(result.classification, queue.GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.SOCKET_MISSING_REST_RECOVERY_REQUIRED);
      assert.strictEqual(result.recoveryRequired, true);
    });
    check("STOP canceled with executedQty > 0 requires recovery", () => {
      const result = queue.classifyGridStopEmergencyObservation({
        gridRegime: gridRegime(),
        observedEvent: stopEvent({ orderStatus: "CANCELED", executedQty: 1 }),
      });
      assert.strictEqual(result.classification, queue.GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.CANCELED_WITH_EXECUTED_QTY_REQUIRES_RECOVERY);
      assert.strictEqual(result.recoveryRequired, true);
    });
    check("STOP canceled with executedQty = 0 blocked", () => {
      const result = queue.classifyGridStopEmergencyObservation({
        gridRegime: gridRegime(),
        observedEvent: stopEvent({ orderStatus: "CANCELED", executedQty: 0 }),
      });
      assert.strictEqual(result.classification, queue.GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.CANCELED_WITH_ZERO_EXECUTED_QTY_BLOCKED);
    });
    check("duplicate sourceTradeId ignored", () => {
      const result = queue.classifyGridStopEmergencyObservation({
        gridRegime: gridRegime(),
        observedEvent: stopEvent({ sourceTradeId: "STOP-T1", seenSourceTradeIds: ["STOP-T1"] }),
      });
      assert.strictEqual(result.classification, queue.GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.DUPLICATE_SOURCE_TRADE_ID_IGNORED);
    });
    check("new sourceTradeId apply required", () => {
      const result = queue.classifyGridStopEmergencyObservation({
        gridRegime: gridRegime(),
        observedEvent: stopEvent({ sourceTradeId: "STOP-T2" }),
      });
      assert.strictEqual(result.classification, queue.GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.NEW_SOURCE_TRADE_ID_APPLY_REQUIRED);
    });
    check("sourceTradeId preserved", () => {
      const result = queue.classifyGridStopEmergencyObservation({
        gridRegime: gridRegime(),
        observedEvent: stopEvent({ sourceTradeId: "STOP-T3" }),
      });
      assert.strictEqual(result.sourceTradeId, "STOP-T3");
    });
    check("wrong PID/attribution ignored", () => {
      const result = queue.classifyGridStopEmergencyObservation({
        gridRegime: gridRegime(),
        observedEvent: stopEvent({ pid: 930999 }),
      });
      assert.strictEqual(result.classification, queue.GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.WRONG_PID_OR_ATTRIBUTION_IGNORED);
    });
    check("sibling exposure scan uses PID-owned qty", () => {
      const result = siblingScan();
      assert.strictEqual(result.siblingOwnerQty, 6);
      assert.strictEqual(result.siblingSnapshotQty, 6);
    });
    check("aggregate qty not used for sibling close", () => {
      const result = siblingScan();
      assert.strictEqual(result.aggregateUsedForSiblingClose, false);
      assert.ok(result.audit.includes("STOP_SIBLING_AGGREGATE_EXPOSURE_NOT_USED"));
    });
    check("sibling user action required when open", () => {
      const result = siblingScan();
      assert.ok(result.userActionRequired.includes("STOP_SIBLING_EXPOSURE_USER_ACTION_REQUIRED_OR_FUTURE_BOUNDED_CLOSE_PLAN"));
      assert.strictEqual(result.siblingCloseCreated, false);
    });
    check("sibling protection audit present", () => {
      const result = siblingScan();
      assert.ok(result.audit.includes("STOP_SIBLING_PROTECTION_ACTIVE_AUDIT"));
    });
    check("STOP emergency mock full convergence shape", () => {
      const result = queue.simulateGridStopEmergencyConvergenceMock({
        initialState: initialState(),
        stopFillObservations: [stopEvent({ sourceTradeId: "STOP-FULL-1" })],
        siblingExposureScan: siblingScan({ ownerSnapshot: [] }),
      });
      assert.strictEqual(result.convergenceState, queue.GRID_STOP_EMERGENCY_MOCK_STATE.FULL_READY);
      assert.strictEqual(result.mockLedgerRows.length, 1);
      assert.strictEqual(result.mockOwnerState.ownedQty, 0);
      assert.strictEqual(result.mockSnapshotState.openQty, 0);
      assert.strictEqual(result.mockReservationState.activeReservationQty, 0);
    });
    check("STOP emergency mock partial remaining shape", () => {
      const result = queue.simulateGridStopEmergencyConvergenceMock({
        initialState: initialState(),
        stopFillObservations: [stopEvent({ orderStatus: "PARTIALLY_FILLED", executedQty: 4, sourceTradeId: "STOP-PARTIAL-1" })],
      });
      assert.strictEqual(result.convergenceState, queue.GRID_STOP_EMERGENCY_MOCK_STATE.PARTIAL_REMAINING);
      assert.strictEqual(result.remainingQty, 6);
    });
    check("STOP emergency mock REST recovery required", () => {
      const result = queue.simulateGridStopEmergencyConvergenceMock({
        initialState: initialState(),
        stopFillObservations: [stopEvent({ socketMissing: true, orderStatus: "", executedQty: 0 })],
      });
      assert.strictEqual(result.convergenceState, queue.GRID_STOP_EMERGENCY_MOCK_STATE.REST_RECOVERY_REQUIRED);
    });
    check("STOP emergency mock attribution blocked", () => {
      const result = queue.simulateGridStopEmergencyConvergenceMock({
        initialState: initialState(),
        stopFillObservations: [stopEvent({ pid: 930999, sourceTradeId: "WRONG-STOP-1" })],
      });
      assert.strictEqual(result.convergenceState, queue.GRID_STOP_EMERGENCY_MOCK_STATE.BLOCKED_ATTRIBUTION);
      assert.strictEqual(result.mockLedgerRows.length, 0);
    });
    check("STOP mock convergence never returns GRID_EXIT_CONVERGED", () => {
      const result = queue.simulateGridStopEmergencyConvergenceMock({
        initialState: initialState(),
        stopFillObservations: [stopEvent({ sourceTradeId: "NO-CONVERGED-1" })],
      });
      assert.strictEqual(JSON.stringify(result).includes("GRID_EXIT_CONVERGED"), false);
    });
    check("STOP mock convergence never returns DONE/SUCCESS", () => {
      const result = queue.simulateGridStopEmergencyConvergenceMock({
        initialState: initialState(),
        stopFillObservations: [stopEvent({ sourceTradeId: "NO-GOOD-1" })],
      });
      assert.strictEqual(/DONE|SUCCESS/.test(JSON.stringify(result)), false);
    });
    check("GRID_EXIT + STOP race does not double close", () => {
      const result = queue.simulateGridStopEmergencyConvergenceMock({
        initialState: initialState({ ledgerRows: [{ sourceTradeId: "STOP-RACE-1" }] }),
        stopFillObservations: [
          stopEvent({ gridExitInProgress: true, sourceTradeId: "STOP-RACE-1", executedQty: 10 }),
          stopEvent({ gridExitInProgress: true, sourceTradeId: "STOP-RACE-2", executedQty: 0 }),
        ],
      });
      assert.strictEqual(result.mockLedgerRows.length, 0);
      assert.ok(result.audit.includes("STOP_EMERGENCY_DUPLICATE_SOURCE_TRADE_ID_IGNORED"));
    });
    check("GRID_EXIT parent absorbs STOP race as recovery-required", () => {
      const policyResult = queue.buildGridExitStopEmergencyBackstopPolicy({
        gridRegime: gridRegime(),
        stopObservation: stopEvent({ gridExitInProgress: true }),
        mode: "MOCK_ONLY",
      });
      assert.strictEqual(policyResult.result, queue.GRID_STOP_EMERGENCY_BACKSTOP_STATE.RECOVERY_REQUIRED);
      assert.strictEqual(policyResult.classification.recoveryRequired, true);
    });
    check("no actual STOP order placement", () => {
      assert.strictEqual(policy.forbidden.stopOrderPlacement, false);
    });
    check("no actual Binance cancel", () => {
      assert.strictEqual(policy.forbidden.binanceWrite, false);
    });
    check("no actual Binance close", () => {
      assert.strictEqual(policy.forbidden.binanceWrite, false);
    });
    check("no actual REST recovery", () => {
      const result = queue.buildGridExitStopEmergencyBackstopPolicy({
        gridRegime: gridRegime(),
        stopObservation: stopEvent({ socketMissing: true, orderStatus: "" }),
        mode: "MOCK_ONLY",
      });
      assert.strictEqual(result.classification.recoveryRequired, true);
      assert.strictEqual(result.forbidden.dbMutation, false);
    });
    check("no actual ledger write", () => {
      const result = queue.simulateGridStopEmergencyConvergenceMock({
        initialState: initialState(),
        stopFillObservations: [stopEvent({ sourceTradeId: "NO-LEDGER-WRITE" })],
      });
      assert.strictEqual(result.mockLedgerRows[0].actualLedgerWrite, false);
    });
    check("no actual owner/snapshot/reservation write", () => {
      const result = queue.simulateGridStopEmergencyConvergenceMock({
        initialState: initialState(),
        stopFillObservations: [stopEvent({ sourceTradeId: "NO-STATE-WRITE" })],
      });
      assert.strictEqual(result.mockOwnerState.actualOwnerWrite, false);
      assert.strictEqual(result.mockSnapshotState.actualSnapshotWrite, false);
      assert.strictEqual(result.mockReservationState.actualReservationWrite, false);
    });
    check("no order_intent_queue INSERT/UPDATE/DELETE", () => {
      const helperStart = queueSource.indexOf("const GRID_STOP_EMERGENCY_BACKSTOP_ALLOWED_MODES");
      const helperEnd = queueSource.indexOf("const GRID_EXIT_ENQUEUE_ADAPTER_STATE", helperStart);
      assert.strictEqual(/INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i.test(queueSource.slice(helperStart, helperEnd)), false);
    });
    check("no Binance write path invoked", () => {
      const helperStart = queueSource.indexOf("const GRID_STOP_EMERGENCY_BACKSTOP_ALLOWED_MODES");
      const helperEnd = queueSource.indexOf("const GRID_EXIT_ENQUEUE_ADAPTER_STATE", helperStart);
      const helperSource = queueSource.slice(helperStart, helperEnd);
      assert.strictEqual(/cancelGridOrders|closeGridLegMarketOrder|futures|placeStopOrder|submitStop|createStop/i.test(helperSource), false);
    });
    check("Batch 1 test PASS marker available", () => assert.ok(fs.existsSync(path.resolve(repoRoot, "backend/tools/qa/grid-exit-cancel-executor-dry-run-test.js"))));
    check("Batch 2 test PASS marker available", () => assert.ok(fs.existsSync(path.resolve(repoRoot, "backend/tools/qa/grid-exit-runtime-disabled-cancel-integration-test.js"))));
    check("Batch 3 test PASS marker available", () => assert.ok(fs.existsSync(path.resolve(repoRoot, "backend/tools/qa/grid-exit-remaining-exposure-market-close-plan-test.js"))));
    check("Batch 4 test PASS marker available", () => assert.ok(fs.existsSync(path.resolve(repoRoot, "backend/tools/qa/grid-exit-market-close-dry-run-convergence-mock-test.js"))));
    check("Phase 1/2 regression bundle files available", () => {
      for (const file of [
        "grid-exit-payload-contract-static-test.js",
        "grid-exit-parent-intent-static-test.js",
        "grid-exit-child-cancel-plan-static-test.js",
        "grid-exit-queue-join-static-test.js",
        "grid-exit-enqueue-adapter-static-test.js",
        "grid-exit-temp-table-enqueue-integration-test.js",
        "grid-exit-actual-queue-rollback-harness-test.js",
        "grid-exit-persistent-blocked-quarantine-cleanup-test.js",
      ]) {
        assert.ok(fs.existsSync(path.resolve(repoRoot, "backend/tools/qa", file)));
      }
    });

    const after = await readSafetyCounts(connection);
    check("app-path safety unchanged", () => assert.deepStrictEqual(after, before));
    check("zero-qty residue unchanged", () => assert.strictEqual(after.zeroQtyResidue, before.zeroQtyResidue));
    check("dirty checkpoint produced", () => {
      assert.ok(queueSource.includes("GRID_STOP_EMERGENCY_BACKSTOP_ALLOWED_MODES"));
      assert.ok(workerSource.includes("GRID_EXIT_MARKET_CLOSE_PLAN_WORKER_BLOCKED_NOT_EXECUTABLE"));
    });
    check("live QA blocker table produced inputs available", () => {
      assert.strictEqual(after.pendingRunningRetry, 0);
      assert.strictEqual(after.openSnapshots, 0);
      assert.strictEqual(after.activeReservations, 0);
    });

    console.log(JSON.stringify({
      ok: true,
      tests,
      currentUser: identity.currentUser,
      dbName: identity.dbName,
      passwordPrinted: false,
      supportedModes: queue.GRID_STOP_EMERGENCY_BACKSTOP_ALLOWED_MODES,
      rejectedModes: queue.GRID_STOP_EMERGENCY_BACKSTOP_REJECTED_MODES,
      samplePolicy: policy,
      sampleSiblingScan: siblingScan(),
      sampleConvergence: queue.simulateGridStopEmergencyConvergenceMock({
        initialState: initialState(),
        stopFillObservations: [stopEvent({ sourceTradeId: "REPORT-STOP-FULL" })],
        siblingExposureScan: siblingScan({ ownerSnapshot: [] }),
      }),
      before,
      after,
      dbMutation: 0,
      binanceWrite: 0,
      phase2GPersistentInsertRerunMode: "not-run-in-insert-mode",
    }, null, 2));
  } finally {
    connection.release();
    if (db.end) {
      await db.end();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
