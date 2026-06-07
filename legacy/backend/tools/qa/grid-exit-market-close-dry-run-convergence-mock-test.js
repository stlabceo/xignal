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

const parentCandidate = {
  uid: 920031,
  pid: 930031,
  strategyCategory: "grid",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT",
  timeframe: "10MIN",
  positionSide: "LONG",
  gridRegimeKey: "REGIME_MARKET_CLOSE_MOCK",
  enabled: "Y",
  status: "EXACT",
};

const buildPlan = (overrides = {}) => {
  const scan = queue.scanGridExitRemainingPidExposure({
    parentCandidate: { ...parentCandidate, ...(overrides.parentCandidate || {}) },
    ownerSnapshot: [{
      uid: 920031,
      pid: 930031,
      symbol: "ADAUSDT",
      positionSide: "LONG",
      ownedQty: 10,
      reservedCloseQty: 0,
      status: "OPEN",
      ...(overrides.owner || {}),
    }],
    positionSnapshot: [{
      uid: 920031,
      pid: 930031,
      symbol: "ADAUSDT",
      positionSide: "LONG",
      openQty: 10,
      status: "OPEN",
      ...(overrides.snapshot || {}),
    }],
    reservationSnapshot: overrides.reservationSnapshot || [],
    exchangeAggregateSnapshot: [{ symbol: "ADAUSDT", positionSide: "LONG", qty: 25 }],
    raceObservations: overrides.raceObservations || [],
  });
  return queue.buildGridExitMarketClosePlan({
    remainingExposureScan: scan,
    mode: overrides.mode || "PLAN_ONLY",
  });
};

const baseEvent = (overrides = {}) => ({
  uid: 920031,
  pid: 930031,
  symbol: "ADAUSDT",
  positionSide: "LONG",
  orderStatus: "ACK",
  executedQty: 0,
  orderId: "MKT_CLOSE_1",
  clientOrderId: "GRID_EXIT_MARKET_CLOSE_DRY_RUN_1",
  ...overrides,
});

const initialState = (overrides = {}) => ({
  uid: 920031,
  pid: 930031,
  symbol: "ADAUSDT",
  positionSide: "LONG",
  ownerOpenQty: 10,
  snapshotOpenQty: 10,
  activeReservationQty: 0,
  ledgerRows: [],
  reservations: [],
  ...overrides,
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

    const plan = buildPlan();
    const off = queue.buildGridExitMarketCloseDryRun({ marketClosePlan: plan, mode: "OFF" });
    check("OFF mode creates no close request", () => {
      assert.strictEqual(off.result, queue.GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.DISABLED);
      assert.strictEqual(off.closeRequest, null);
    });

    const dryRun = queue.buildGridExitMarketCloseDryRun({ marketClosePlan: plan, mode: "DRY_RUN" });
    check("DRY_RUN creates preview only", () => {
      assert.strictEqual(dryRun.result, queue.GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.DRY_RUN_READY);
      assert.ok(dryRun.closeRequest);
      assert.strictEqual(dryRun.closeRequest.actualBinanceWrite, false);
    });

    const mockCloseClient = { marketCloseRequests: [] };
    const mock = queue.buildGridExitMarketCloseDryRun({
      marketClosePlan: plan,
      mode: "MOCK_BINANCE_ONLY",
      mockCloseClient,
    });
    check("MOCK_BINANCE_ONLY records mock market close request only", () => {
      assert.strictEqual(mock.result, queue.GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.MOCK_REQUEST_RECORDED);
      assert.strictEqual(mockCloseClient.marketCloseRequests.length, 1);
      assert.deepStrictEqual(mockCloseClient.marketCloseRequests[0], mock.closeRequest);
    });

    check("LIVE/BINANCE_WRITE/EXECUTE/MARKET_CLOSE rejected", () => {
      for (const mode of ["LIVE", "BINANCE_WRITE", "EXECUTE", "MARKET_CLOSE"]) {
        const result = queue.buildGridExitMarketCloseDryRun({ marketClosePlan: plan, mode });
        assert.strictEqual(result.rejected, true);
        assert.strictEqual(result.result, queue.GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.MODE_REJECTED);
      }
    });

    check("market close request includes uid/pid/symbol/side", () => {
      assert.strictEqual(dryRun.closeRequest.uid, 920031);
      assert.strictEqual(dryRun.closeRequest.pid, 930031);
      assert.strictEqual(dryRun.closeRequest.symbol, "ADAUSDT");
      assert.strictEqual(dryRun.closeRequest.positionSide, "LONG");
    });
    check("market close request includes gridRegimeKey/strategySignal", () => {
      assert.strictEqual(dryRun.closeRequest.gridRegimeKey, "REGIME_MARKET_CLOSE_MOCK");
      assert.strictEqual(dryRun.closeRequest.strategySignal, "Mean Revert Grid");
    });
    check("closeQty <= remainingPidOwnedQty", () => {
      assert.ok(dryRun.closeRequest.closeQty <= plan.remainingExposureScan.remainingPidOwnedQty);
    });
    check("closeQty <= maxAllowedQty", () => {
      assert.ok(dryRun.closeRequest.closeQty <= dryRun.closeRequest.maxAllowedQty);
    });
    check("aggregate qty not used", () => {
      assert.strictEqual(plan.remainingExposureScan.aggregateExchangeQty, 25);
      assert.notStrictEqual(dryRun.closeRequest.closeQty, plan.remainingExposureScan.aggregateExchangeQty);
    });
    check("same symbol/side other PID untouched", () => {
      assert.ok(plan.remainingExposureScan.audit.includes("SAME_SYMBOL_SIDE_OTHER_PID_UNTOUCHED"));
    });
    check("no close-all-symbol request", () => {
      assert.strictEqual(dryRun.closeRequest.closeAllBySymbol, false);
      assert.strictEqual(dryRun.closeRequest.closeAllPositionSide, false);
    });
    check("no unscoped close request", () => {
      assert.strictEqual(dryRun.closeRequest.unscopedClose, false);
      assert.ok(dryRun.closeRequest.pid);
      assert.ok(dryRun.closeRequest.gridRegimeKey);
    });
    check("no coin.closeGridLegMarketOrder call", () => {
      const helperStart = queueSource.indexOf("const GRID_EXIT_MARKET_CLOSE_EXECUTOR_ALLOWED_MODES");
      const helperEnd = queueSource.indexOf("const GRID_EXIT_ENQUEUE_ADAPTER_STATE", helperStart);
      assert.strictEqual(queueSource.slice(helperStart, helperEnd).includes("closeGridLegMarketOrder"), false);
    });

    check("close ACK only not terminal", () => {
      const result = queue.classifyGridExitMarketCloseObservation({ marketClosePlan: plan, observedEvent: baseEvent({ orderStatus: "NEW" }) });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.ACK_ONLY_NOT_TERMINAL);
      assert.strictEqual(result.terminal, false);
    });
    check("PARTIALLY_FILLED not terminal", () => {
      const result = queue.classifyGridExitMarketCloseObservation({ marketClosePlan: plan, observedEvent: baseEvent({ orderStatus: "PARTIALLY_FILLED", executedQty: 4 }) });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.PARTIAL_FILL_NOT_TERMINAL);
      assert.strictEqual(result.terminal, false);
    });
    check("FILLED final observation classified", () => {
      const result = queue.classifyGridExitMarketCloseObservation({ marketClosePlan: plan, observedEvent: baseEvent({ orderStatus: "FILLED", executedQty: 10 }) });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.FILLED_FINAL_OBSERVED);
      assert.strictEqual(result.finalObserved, true);
      assert.strictEqual(result.terminal, false);
    });
    check("socket missing REST recovery required classified", () => {
      const result = queue.classifyGridExitMarketCloseObservation({ marketClosePlan: plan, observedEvent: baseEvent({ socketMissing: true, orderStatus: "" }) });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.SOCKET_MISSING_REST_RECOVERY_REQUIRED);
      assert.strictEqual(result.recoveryRequired, true);
    });
    check("canceled with executedQty > 0 requires recovery", () => {
      const result = queue.classifyGridExitMarketCloseObservation({ marketClosePlan: plan, observedEvent: baseEvent({ orderStatus: "CANCELED", executedQty: 3 }) });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.CANCELED_WITH_EXECUTED_QTY_REQUIRES_RECOVERY);
      assert.strictEqual(result.recoveryRequired, true);
    });
    check("canceled with executedQty = 0 blocked/failed", () => {
      const result = queue.classifyGridExitMarketCloseObservation({ marketClosePlan: plan, observedEvent: baseEvent({ orderStatus: "CANCELED", executedQty: 0 }) });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.CANCELED_WITH_ZERO_EXECUTED_QTY_FAILED_OR_BLOCKED);
    });
    check("duplicate sourceTradeId ignored", () => {
      const result = queue.classifyGridExitMarketCloseObservation({
        marketClosePlan: plan,
        observedEvent: baseEvent({ orderStatus: "FILLED", executedQty: 5, sourceTradeId: "T-1", seenSourceTradeIds: ["T-1"] }),
      });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.DUPLICATE_SOURCE_TRADE_ID_IGNORED);
    });
    check("new sourceTradeId apply required", () => {
      const result = queue.classifyGridExitMarketCloseObservation({
        marketClosePlan: plan,
        observedEvent: baseEvent({ orderStatus: "FILLED", executedQty: 5, sourceTradeId: "T-2" }),
      });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.NEW_SOURCE_TRADE_ID_APPLY_REQUIRED);
    });
    check("sourceTradeId preserved", () => {
      const result = queue.classifyGridExitMarketCloseObservation({
        marketClosePlan: plan,
        observedEvent: baseEvent({ orderStatus: "FILLED", executedQty: 5, sourceTradeId: "T-3" }),
      });
      assert.strictEqual(result.sourceTradeId, "T-3");
    });
    check("orderId alone does not collapse different sourceTradeIds", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [
          baseEvent({ orderStatus: "PARTIALLY_FILLED", executedQty: 4, sourceTradeId: "TRADE-A", orderId: "SAME_ORDER" }),
          baseEvent({ orderStatus: "PARTIALLY_FILLED", executedQty: 4, sourceTradeId: "TRADE-B", orderId: "SAME_ORDER" }),
        ],
      });
      assert.strictEqual(result.mockLedgerRows.length, 2);
      assert.strictEqual(result.remainingQty, 2);
    });

    check("mock full close produces mock ledger/owner/snapshot/reservation closed shape", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState({ activeReservationQty: 2 }),
        closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 10, sourceTradeId: "FULL-1", price: 1.23 })],
      });
      assert.strictEqual(result.convergenceState, queue.GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.FULL_READY);
      assert.strictEqual(result.mockLedgerRows.length, 1);
      assert.strictEqual(result.mockOwnerState.ownedQty, 0);
      assert.strictEqual(result.mockSnapshotState.openQty, 0);
      assert.strictEqual(result.mockReservationState.activeReservationQty, 0);
      assert.strictEqual(result.terminal, false);
    });
    check("mock partial close leaves remaining qty", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ orderStatus: "PARTIALLY_FILLED", executedQty: 4, sourceTradeId: "PARTIAL-1" })],
      });
      assert.strictEqual(result.convergenceState, queue.GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.PARTIAL_REMAINING);
      assert.strictEqual(result.remainingQty, 6);
    });
    check("partial close emits protection adjustment required audit", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState({ activeReservationQty: 3 }),
        closeFillObservations: [baseEvent({ orderStatus: "PARTIALLY_FILLED", executedQty: 4, sourceTradeId: "PARTIAL-2" })],
      });
      assert.ok(result.audit.includes("GRID_EXIT_CLOSE_MOCK_PROTECTION_ADJUSTMENT_REQUIRED"));
    });
    check("no fill creates no mock ledger row", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [],
      });
      assert.strictEqual(result.mockLedgerRows.length, 0);
      assert.strictEqual(result.remainingQty, 10);
    });
    check("over-close blocked", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 11, sourceTradeId: "OVER-1" })],
      });
      assert.strictEqual(result.convergenceState, queue.GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.BLOCKED_OVER_CLOSE);
    });
    check("wrong PID attribution ignored/blocked", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ pid: 930032, orderStatus: "FILLED", executedQty: 10, sourceTradeId: "WRONG-1" })],
      });
      assert.strictEqual(result.convergenceState, queue.GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.BLOCKED_ATTRIBUTION);
      assert.strictEqual(result.mockLedgerRows.length, 0);
    });
    check("mock convergence never returns GRID_EXIT_CONVERGED", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 10, sourceTradeId: "FULL-2" })],
      });
      assert.strictEqual(/GRID_EXIT_CONVERGED|CLOSE_CONVERGED|DONE|SUCCESS/.test(JSON.stringify(result)), false);
    });
    check("parent reducer never returns DONE/SUCCESS/CONVERGED", () => {
      const convergenceResult = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 10, sourceTradeId: "FULL-3" })],
      });
      const reducer = queue.reduceGridExitParentMarketCloseMockState({ convergenceResult });
      assert.strictEqual(reducer.result, queue.GRID_EXIT_PARENT_MARKET_CLOSE_MOCK_STATE.READY);
      assert.strictEqual(reducer.terminalSuccess, false);
      assert.strictEqual(/DONE|SUCCESS|CONVERGED/.test(JSON.stringify(reducer)), false);
    });
    check("no actual ledger write", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 10, sourceTradeId: "FULL-4" })],
      });
      assert.strictEqual(result.mockLedgerRows[0].actualLedgerWrite, false);
    });
    check("no actual owner/snapshot/reservation write", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 10, sourceTradeId: "FULL-5" })],
      });
      assert.strictEqual(result.mockOwnerState.actualOwnerWrite, false);
      assert.strictEqual(result.mockSnapshotState.actualSnapshotWrite, false);
      assert.strictEqual(result.mockReservationState.actualReservationWrite, false);
    });
    check("no order_intent_queue INSERT/UPDATE/DELETE", () => {
      const helperStart = queueSource.indexOf("const GRID_EXIT_MARKET_CLOSE_EXECUTOR_ALLOWED_MODES");
      const helperEnd = queueSource.indexOf("const GRID_EXIT_ENQUEUE_ADAPTER_STATE", helperStart);
      assert.strictEqual(/INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i.test(queueSource.slice(helperStart, helperEnd)), false);
    });
    check("no Binance write path invoked", () => {
      assert.strictEqual(mock.forbidden.binanceWrite, false);
      assert.strictEqual(mock.closeRequest.actualBinanceWrite, false);
    });

    const marketPlanWorkerStart = workerSource.indexOf("const processGridExitMarketClosePlanIntent");
    const marketPlanWorkerEnd = workerSource.indexOf("const processIntent", marketPlanWorkerStart);
    const marketPlanWorkerSource = workerSource.slice(marketPlanWorkerStart, marketPlanWorkerEnd);
    check("worker market close plan remains non-executable", () => {
      assert.ok(marketPlanWorkerSource.includes("marketCloseSubmit: false"));
      assert.ok(marketPlanWorkerSource.includes("binanceWrite: false"));
      assert.strictEqual(/STATUS\.DONE|SUCCESS|GRID_EXIT_CONVERGED|CLOSE_CONVERGED|closeGridLegMarketOrder/.test(marketPlanWorkerSource), false);
    });

    const after = await readSafetyCounts(connection);
    check("app-path safety counts unchanged", () => assert.deepStrictEqual(after, before));

    console.log(JSON.stringify({
      ok: true,
      tests,
      currentUser: identity.currentUser,
      dbName: identity.dbName,
      passwordPrinted: false,
      supportedModes: queue.GRID_EXIT_MARKET_CLOSE_EXECUTOR_ALLOWED_MODES,
      rejectedModes: queue.GRID_EXIT_MARKET_CLOSE_EXECUTOR_REJECTED_MODES,
      sampleRequest: dryRun.closeRequest,
      sampleConvergence: queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 10, sourceTradeId: "REPORT-FULL" })],
      }),
      before,
      after,
      dbMutation: 0,
      binanceWrite: 0,
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
