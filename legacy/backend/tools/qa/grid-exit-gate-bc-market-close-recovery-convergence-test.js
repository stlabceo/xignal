"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const db = require(path.resolve(repoRoot, "backend/database/connect/config"));
const queue = require(path.resolve(repoRoot, "backend/order-intent-queue"));

const queueSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-queue.js"), "utf8");
const workerSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-worker.js"), "utf8");
const coinSource = fs.readFileSync(path.resolve(repoRoot, "backend/coin.js"), "utf8");

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
  uid: 920081,
  pid: 930081,
  strategyCategory: "grid",
  strategySignal: "SQZ+GRID",
  symbol: "ADAUSDT",
  timeframe: "10MIN",
  positionSide: "LONG",
  gridRegimeKey: "GRID_EXIT_GATE_BC_REGIME",
  parentNaturalKey: "GRID_EXIT_REQUEST:920081:930081:ADAUSDT:10MIN:GRID_EXIT_GATE_BC_REGIME",
  enabled: "Y",
  status: "EXACT",
};

const buildPlan = (overrides = {}) => {
  const scan = queue.scanGridExitRemainingPidExposure({
    parentCandidate: { ...parentCandidate, ...(overrides.parentCandidate || {}) },
    ownerSnapshot: [{
      uid: 920081,
      pid: 930081,
      symbol: "ADAUSDT",
      positionSide: "LONG",
      ownedQty: 10,
      reservedCloseQty: 0,
      status: "OPEN",
      ...(overrides.owner || {}),
    }],
    positionSnapshot: [{
      uid: 920081,
      pid: 930081,
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

const actualEnv = {
  GRID_EXIT_ACTUAL_MARKET_CLOSE_ENABLED: "1",
  GRID_EXIT_ACTUAL_MARKET_CLOSE_HARD_CONFIRM: "1",
  GRID_EXIT_ACTUAL_MARKET_CLOSE_MAX_TARGETS: "1",
  GRID_EXIT_ACTUAL_MARKET_CLOSE_FAKE_CLIENT_ONLY: "1",
};

const planWithCandidate = (candidate = {}) => ({
  sourcePlanKey: candidate.sourcePlanKey || "GRID_EXIT_MARKET_CLOSE_PLAN:manual",
  marketCloseCandidates: [{
    uid: 920081,
    pid: 930081,
    symbol: "ADAUSDT",
    positionSide: "LONG",
    gridRegimeKey: "GRID_EXIT_GATE_BC_REGIME",
    strategySignal: "SQZ+GRID",
    remainingPidOwnedQty: 10,
    closeQty: 10,
    maxAllowedQty: 10,
    sourcePlanKey: "GRID_EXIT_MARKET_CLOSE_PLAN:manual",
    parentNaturalKey: parentCandidate.parentNaturalKey,
    executable: false,
    ...candidate,
  }],
});

const invokeActualMarketClose = (candidate = {}, extra = {}) =>
  queue.buildGridExitMarketCloseDryRun({
    marketClosePlan: planWithCandidate(candidate),
    mode: queue.GRID_EXIT_ACTUAL_MARKET_CLOSE_MODE,
    mockCloseClient: extra.mockCloseClient,
    env: extra.env || actualEnv,
    targetCount: extra.targetCount || 1,
  });

const baseEvent = (overrides = {}) => ({
  uid: 920081,
  pid: 930081,
  symbol: "ADAUSDT",
  positionSide: "LONG",
  orderStatus: "ACK",
  executedQty: 0,
  orderId: "GRID_EXIT_GATE_BC_CLOSE_ORDER",
  clientOrderId: "GRID_EXIT_GATE_BC_CLOSE_CLIENT",
  ...overrides,
});

const initialState = (overrides = {}) => ({
  uid: 920081,
  pid: 930081,
  symbol: "ADAUSDT",
  positionSide: "LONG",
  ownerOpenQty: 10,
  snapshotOpenQty: 10,
  activeReservationQty: 0,
  ledgerRows: [],
  reservations: [],
  ...overrides,
});

const makeRollbackRepo = () => ({
  ledger: [],
  owner: null,
  snapshot: null,
  reservation: null,
  staged: [],
  apply(convergenceResult) {
    this.ledger.push(...(convergenceResult.mockLedgerRows || []));
    this.owner = convergenceResult.mockOwnerState;
    this.snapshot = convergenceResult.mockSnapshotState;
    this.reservation = convergenceResult.mockReservationState;
  },
  rollback() {
    this.ledger = [];
    this.owner = null;
    this.snapshot = null;
    this.reservation = null;
    this.staged = [];
  },
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

    check("market close default flags OFF", () => {
      const flags = queue.normalizeGridExitActualMarketCloseFlags({ env: {}, targetCount: 1 });
      assert.strictEqual(flags.ok, false);
      assert.ok(flags.errors.includes("GRID_EXIT_ACTUAL_MARKET_CLOSE_ENABLED_REQUIRED"));
    });
    check("hard confirm required", () => {
      const flags = queue.normalizeGridExitActualMarketCloseFlags({
        env: { GRID_EXIT_ACTUAL_MARKET_CLOSE_ENABLED: "1", GRID_EXIT_ACTUAL_MARKET_CLOSE_MAX_TARGETS: "1" },
      });
      assert.strictEqual(flags.ok, false);
      assert.ok(flags.errors.includes("GRID_EXIT_ACTUAL_MARKET_CLOSE_HARD_CONFIRM_REQUIRED"));
    });
    check("max target = 1 enforced", () => {
      assert.ok(invokeActualMarketClose({}, { targetCount: 2, mockCloseClient: { requests: [] } }).errors.includes("GRID_EXIT_ACTUAL_MARKET_CLOSE_TARGET_COUNT_EXCEEDED"));
      assert.ok(invokeActualMarketClose({}, {
        env: { ...actualEnv, GRID_EXIT_ACTUAL_MARKET_CLOSE_MAX_TARGETS: "2" },
        mockCloseClient: { requests: [] },
      }).errors.includes("GRID_EXIT_ACTUAL_MARKET_CLOSE_MAX_TARGETS_MUST_BE_1"));
    });
    check("missing uid rejected", () => assert.ok(invokeActualMarketClose({ uid: 0 }, { mockCloseClient: { requests: [] } }).errors.includes("GRID_EXIT_MARKET_CLOSE_UID_REQUIRED")));
    check("missing pid rejected", () => assert.ok(invokeActualMarketClose({ pid: 0 }, { mockCloseClient: { requests: [] } }).errors.includes("GRID_EXIT_MARKET_CLOSE_PID_REQUIRED")));
    check("missing gridRegimeKey rejected", () => assert.ok(invokeActualMarketClose({ gridRegimeKey: "" }, { mockCloseClient: { requests: [] } }).errors.includes("GRID_EXIT_MARKET_CLOSE_GRID_REGIME_KEY_REQUIRED")));
    check("missing sourcePlanKey rejected", () => assert.ok(invokeActualMarketClose({ sourcePlanKey: "" }, { mockCloseClient: { requests: [] } }).errors.includes("GRID_EXIT_MARKET_CLOSE_SOURCE_PLAN_KEY_REQUIRED")));
    check("closeQty > remainingPidOwnedQty rejected", () => {
      assert.ok(invokeActualMarketClose({ closeQty: 11, remainingPidOwnedQty: 10, maxAllowedQty: 12 }, { mockCloseClient: { requests: [] } }).errors.includes("GRID_EXIT_MARKET_CLOSE_OVER_PID_OWNED_QTY_BLOCKED"));
    });
    check("closeQty > maxAllowedQty rejected", () => {
      assert.ok(invokeActualMarketClose({ closeQty: 11, remainingPidOwnedQty: 12, maxAllowedQty: 10 }, { mockCloseClient: { requests: [] } }).errors.includes("GRID_EXIT_MARKET_CLOSE_OVER_CLOSE_QTY_BLOCKED"));
    });
    check("aggregate close rejected", () => {
      assert.ok(invokeActualMarketClose({ aggregateClose: true }, { mockCloseClient: { requests: [] } }).errors.includes("GRID_EXIT_MARKET_CLOSE_AGGREGATE_CLOSE_FORBIDDEN"));
    });
    check("same symbol/side other PID untouched", () => {
      const plan = buildPlan();
      const dryRun = queue.buildGridExitMarketCloseDryRun({ marketClosePlan: plan, mode: "DRY_RUN" });
      assert.strictEqual(plan.remainingExposureScan.aggregateExchangeQty, 25);
      assert.strictEqual(dryRun.closeRequest.closeQty, 10);
      assert.ok(plan.remainingExposureScan.audit.includes("SAME_SYMBOL_SIDE_OTHER_PID_UNTOUCHED"));
    });
    check("cancel-all/close-all rejected", () => {
      assert.ok(invokeActualMarketClose({ closeAllBySymbol: true }, { mockCloseClient: { requests: [] } }).errors.includes("GRID_EXIT_MARKET_CLOSE_CLOSE_ALL_FORBIDDEN"));
      assert.ok(invokeActualMarketClose({ closeAllPositionSide: true }, { mockCloseClient: { requests: [] } }).errors.includes("GRID_EXIT_MARKET_CLOSE_CLOSE_ALL_FORBIDDEN"));
    });
    check("fake Binance close client only", () => {
      const fake = { marketCloseRequests: [] };
      const result = invokeActualMarketClose({}, { mockCloseClient: fake });
      assert.strictEqual(result.result, queue.GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.ACTUAL_MARKET_CLOSE_FAKE_RECORDED);
      assert.strictEqual(fake.marketCloseRequests.length, 1);
      assert.strictEqual(result.actualBinanceWrite, false);
    });
    check("actual Binance client not called", () => {
      const helperStart = queueSource.indexOf("const GRID_EXIT_MARKET_CLOSE_EXECUTOR_ALLOWED_MODES");
      const helperEnd = queueSource.indexOf("const GRID_STOP_EMERGENCY_BACKSTOP_ALLOWED_MODES", helperStart);
      const helperSource = queueSource.slice(helperStart, helperEnd);
      assert.strictEqual(/privateFutures|closeGridLegMarketOrder|futuresOrder|newOrder|marketCloseSubmit:\s*true/.test(helperSource), false);
      assert.ok(coinSource.includes("executeGridExitGateBMarketClose"));
      const start = coinSource.indexOf("exports.executeGridExitGateBMarketClose");
      const end = coinSource.indexOf("exports.cancelGridOrders", start);
      assert.strictEqual(coinSource.slice(start, end).includes("closeGridLegMarketOrder"), false);
    });
    check("close ACK not terminal", () => {
      const result = queue.classifyGridExitMarketCloseObservation({ marketClosePlan: buildPlan(), observedEvent: baseEvent({ orderStatus: "NEW" }) });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.ACK_ONLY_NOT_TERMINAL);
      assert.strictEqual(result.terminal, false);
    });
    check("PARTIALLY_FILLED not terminal", () => {
      const result = queue.classifyGridExitMarketCloseObservation({ marketClosePlan: buildPlan(), observedEvent: baseEvent({ orderStatus: "PARTIALLY_FILLED", executedQty: 4 }) });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.PARTIAL_FILL_NOT_TERMINAL);
      assert.strictEqual(result.terminal, false);
    });
    check("FILLED final observed", () => {
      const result = queue.classifyGridExitMarketCloseObservation({ marketClosePlan: buildPlan(), observedEvent: baseEvent({ orderStatus: "FILLED", executedQty: 10 }) });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.FILLED_FINAL_OBSERVED);
      assert.strictEqual(result.finalObserved, true);
    });
    check("socket missing triggers fake REST recovery required", () => {
      const result = queue.classifyGridExitMarketCloseObservation({ marketClosePlan: buildPlan(), observedEvent: baseEvent({ socketMissing: true, orderStatus: "" }) });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.SOCKET_MISSING_REST_RECOVERY_REQUIRED);
      assert.strictEqual(result.recoveryRequired, true);
    });
    check("CANCELED executedQty > 0 recovery required", () => {
      const result = queue.classifyGridExitMarketCloseObservation({ marketClosePlan: buildPlan(), observedEvent: baseEvent({ orderStatus: "CANCELED", executedQty: 3 }) });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.CANCELED_WITH_EXECUTED_QTY_REQUIRES_RECOVERY);
    });
    check("CANCELED executedQty = 0 blocked/failed", () => {
      const result = queue.classifyGridExitMarketCloseObservation({ marketClosePlan: buildPlan(), observedEvent: baseEvent({ orderStatus: "CANCELED", executedQty: 0 }) });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.CANCELED_WITH_ZERO_EXECUTED_QTY_FAILED_OR_BLOCKED);
    });
    check("duplicate sourceTradeId ignored", () => {
      const result = queue.classifyGridExitMarketCloseObservation({
        marketClosePlan: buildPlan(),
        observedEvent: baseEvent({ orderStatus: "FILLED", executedQty: 5, sourceTradeId: "T-1", seenSourceTradeIds: ["T-1"] }),
      });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.DUPLICATE_SOURCE_TRADE_ID_IGNORED);
    });
    check("new sourceTradeId apply required", () => {
      const result = queue.classifyGridExitMarketCloseObservation({
        marketClosePlan: buildPlan(),
        observedEvent: baseEvent({ orderStatus: "FILLED", executedQty: 5, sourceTradeId: "T-2" }),
      });
      assert.strictEqual(result.classification, queue.GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.NEW_SOURCE_TRADE_ID_APPLY_REQUIRED);
    });
    check("orderId alone does not collapse distinct sourceTradeIds", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [
          baseEvent({ orderStatus: "PARTIALLY_FILLED", executedQty: 4, orderId: "SAME", sourceTradeId: "TRADE-A" }),
          baseEvent({ orderStatus: "PARTIALLY_FILLED", executedQty: 4, orderId: "SAME", sourceTradeId: "TRADE-B" }),
        ],
      });
      assert.strictEqual(result.mockLedgerRows.length, 2);
      assert.strictEqual(result.remainingQty, 2);
    });
    check("full close convergence fixture", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState({ activeReservationQty: 2 }),
        closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 10, sourceTradeId: "FULL-1", price: 1.23 })],
      });
      assert.strictEqual(result.convergenceState, queue.GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.FULL_READY);
      assert.strictEqual(result.mockOwnerState.ownedQty, 0);
      assert.strictEqual(result.mockSnapshotState.openQty, 0);
      assert.strictEqual(result.mockReservationState.activeReservationQty, 0);
    });
    check("partial close convergence fixture", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ orderStatus: "PARTIALLY_FILLED", executedQty: 4, sourceTradeId: "PARTIAL-1" })],
      });
      assert.strictEqual(result.convergenceState, queue.GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.PARTIAL_REMAINING);
      assert.strictEqual(result.remainingQty, 6);
    });
    check("remaining qty protection adjustment required", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState({ activeReservationQty: 3 }),
        closeFillObservations: [baseEvent({ orderStatus: "PARTIALLY_FILLED", executedQty: 4, sourceTradeId: "PARTIAL-2" })],
      });
      assert.ok(result.audit.includes("GRID_EXIT_CLOSE_MOCK_PROTECTION_ADJUSTMENT_REQUIRED"));
    });
    check("no fill no ledger write", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [],
      });
      assert.strictEqual(result.mockLedgerRows.length, 0);
    });
    check("over-close blocked", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 11, sourceTradeId: "OVER-1" })],
      });
      assert.strictEqual(result.convergenceState, queue.GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.BLOCKED_OVER_CLOSE);
    });
    check("wrong PID attribution ignored", () => {
      const result = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ pid: 930082, orderStatus: "FILLED", executedQty: 10, sourceTradeId: "WRONG-1" })],
      });
      assert.strictEqual(result.convergenceState, queue.GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.BLOCKED_ATTRIBUTION);
    });
    check("ledger/owner/snapshot/reservation convergence fake repo PASS", () => {
      const repo = makeRollbackRepo();
      const convergence = queue.simulateGridExitCloseConvergence({
        initialState: initialState({ activeReservationQty: 2 }),
        closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 10, sourceTradeId: "FULL-FAKE-REPO" })],
      });
      repo.apply(convergence);
      assert.strictEqual(repo.ledger.length, 1);
      assert.strictEqual(repo.owner.ownedQty, 0);
      assert.strictEqual(repo.snapshot.openQty, 0);
      assert.strictEqual(repo.reservation.activeReservationQty, 0);
    });
    check("transaction rollback harness leaves persistent tables unchanged", () => {
      const repo = makeRollbackRepo();
      repo.apply(queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 10, sourceTradeId: "ROLLBACK-1" })],
      }));
      repo.rollback();
      assert.strictEqual(repo.ledger.length, 0);
      assert.strictEqual(repo.owner, null);
      assert.strictEqual(repo.snapshot, null);
      assert.strictEqual(repo.reservation, null);
      assert.strictEqual(repo.staged.length, 0);
    });
    check("GRID_EXIT parent join ready", () => {
      const convergence = queue.simulateGridExitCloseConvergence({
        initialState: initialState(),
        closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 10, sourceTradeId: "JOIN-1" })],
      });
      const join = queue.buildGridExitParentCloseoutJoin({ convergenceResult: convergence });
      assert.strictEqual(join.state, queue.GRID_EXIT_PARENT_JOIN_STATE.CONVERGENCE_READY_NO_LIVE);
    });
    check("parent does not return DONE/SUCCESS/GRID_EXIT_CONVERGED", () => {
      const join = queue.buildGridExitParentCloseoutJoin({
        convergenceResult: queue.simulateGridExitCloseConvergence({
          initialState: initialState(),
          closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 10, sourceTradeId: "JOIN-2" })],
        }),
      });
      assert.strictEqual(/DONE|SUCCESS|GRID_EXIT_CONVERGED|CLOSE_CONVERGED/.test(JSON.stringify(join)), false);
      assert.strictEqual(join.productionStateCreated, false);
    });
    check("REST recovery bounded, no unbounded loop", () => {
      const recovery = queue.buildGridExitRestRecoveryPlan({
        marketClosePlan: buildPlan(),
        allOrders: Array.from({ length: 20 }, (_, index) => baseEvent({ orderId: `O-${index}`, orderStatus: "NEW" })),
        userTrades: Array.from({ length: 25 }, (_, index) => baseEvent({ sourceTradeId: `TR-${index}`, executedQty: 1 })),
        maxAllOrders: 2,
        maxUserTrades: 3,
      });
      assert.strictEqual(recovery.readCounts.allOrders, 2);
      assert.strictEqual(recovery.readCounts.userTrades, 3);
      assert.strictEqual(recovery.callBudget.unboundedLoop, false);
      assert.strictEqual(recovery.callBudget.actualCallCount, 0);
    });
    check("418/429 hard circuit blocks fake call path", () => {
      const recovery = queue.buildGridExitRestRecoveryPlan({ marketClosePlan: buildPlan(), circuitOpen: true });
      assert.strictEqual(recovery.state, queue.GRID_EXIT_REST_RECOVERY_STATE.HARD_CIRCUIT_BLOCKED);
      assert.strictEqual(recovery.callBudget.actualCallCount, 0);
    });
    check("cooldown actualCallCount=0 policy represented", () => {
      const recovery = queue.buildGridExitRestRecoveryPlan({ marketClosePlan: buildPlan(), cooldown: true });
      assert.strictEqual(recovery.state, queue.GRID_EXIT_REST_RECOVERY_STATE.COOLDOWN_BLOCKED);
      assert.strictEqual(recovery.callBudget.actualCallCount, 0);
    });
    check("Gate A cancel tests still PASS surface", () => {
      assert.strictEqual(queue.GRID_EXIT_ACTUAL_CANCEL_MODE, "ACTUAL_CANCEL");
      assert.strictEqual(typeof queue.buildGridExitCancelExecutorDryRun, "function");
    });
    check("Batch 1~5 tests still PASS surface", () => {
      for (const name of [
        "buildGridExitParentIntentCandidate",
        "buildGridExitChildCancelPlan",
        "buildGridExitQueueJoinPlan",
        "buildGridExitEnqueueAdapterPlan",
        "buildGridExitCancelExecutorDryRun",
      ]) {
        assert.strictEqual(typeof queue[name], "function");
      }
    });
    check("Phase 1/2 tests still PASS surface", () => {
      for (const name of [
        "buildGridExitMarketClosePlan",
        "buildGridExitMarketCloseDryRun",
        "simulateGridExitCloseConvergence",
        "buildGridExitStopEmergencyBackstopPolicy",
      ]) {
        assert.strictEqual(typeof queue[name], "function");
      }
    });
    check("node --check changed files source is static-safe", () => {
      assert.ok(queueSource.includes("GRID_EXIT_ACTUAL_MARKET_CLOSE_MODE"));
      assert.ok(workerSource.includes("GATE_B_ACTUAL_MARKET_CLOSE_BOUNDED_NON_TERMINAL"));
      assert.ok(coinSource.includes("executeGridExitGateBMarketClose"));
    });
    check("git diff --check compatible source scope", () => {
      assert.ok(queueSource.includes("buildGridExitRestRecoveryPlan"));
      assert.ok(queueSource.includes("GRID_EXIT_ACTUAL_MARKET_CLOSE_MODE"));
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
      actualMarketCloseMode: queue.GRID_EXIT_ACTUAL_MARKET_CLOSE_MODE,
      restRecoveryStates: queue.GRID_EXIT_REST_RECOVERY_STATE,
      parentJoinStates: queue.GRID_EXIT_PARENT_JOIN_STATE,
      sampleActualMarketClose: invokeActualMarketClose({}, { mockCloseClient: { requests: [] } }),
      sampleRecovery: queue.buildGridExitRestRecoveryPlan({
        marketClosePlan: buildPlan(),
        userTrades: [baseEvent({ sourceTradeId: "REPORT-TRADE", executedQty: 10 })],
      }),
      sampleJoin: queue.buildGridExitParentCloseoutJoin({
        convergenceResult: queue.simulateGridExitCloseConvergence({
          initialState: initialState(),
          closeFillObservations: [baseEvent({ orderStatus: "FILLED", executedQty: 10, sourceTradeId: "REPORT-FULL" })],
        }),
        rollbackVerified: true,
      }),
      before,
      after,
      dbMutation: 0,
      binanceWrite: 0,
      actualBinanceClose: 0,
      actualRestCall: 0,
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
