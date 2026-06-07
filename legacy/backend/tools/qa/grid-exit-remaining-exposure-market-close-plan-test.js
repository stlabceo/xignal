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

const parent = (overrides = {}) => ({
  uid: 920021,
  pid: 930021,
  strategyCategory: "grid",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT",
  timeframe: "10MIN",
  positionSide: "LONG",
  gridRegimeKey: "REGIME_REMAINING_EXPOSURE_PLAN",
  enabled: "Y",
  status: "EXACT",
  ...overrides,
});

const ownerRows = (overrides = {}) => ([
  {
    uid: 920021,
    pid: 930021,
    symbol: "ADAUSDT",
    positionSide: "LONG",
    ownedQty: 10,
    reservedCloseQty: 0,
    status: "OPEN",
    ...overrides,
  },
]);

const snapshotRows = (overrides = {}) => ([
  {
    uid: 920021,
    pid: 930021,
    symbol: "ADAUSDT",
    positionSide: "LONG",
    openQty: 10,
    status: "OPEN",
    ...overrides,
  },
]);

const aggregateRows = (qty = 25) => ([
  {
    symbol: "ADAUSDT",
    positionSide: "LONG",
    qty,
  },
]);

const scan = (overrides = {}) =>
  queue.scanGridExitRemainingPidExposure({
    parentCandidate: parent(overrides.parentCandidate || {}),
    childCancelPlan: overrides.childCancelPlan || {},
    raceObservations: overrides.raceObservations || [],
    ownerSnapshot: Object.prototype.hasOwnProperty.call(overrides, "ownerSnapshot")
      ? overrides.ownerSnapshot
      : ownerRows(),
    positionSnapshot: Object.prototype.hasOwnProperty.call(overrides, "positionSnapshot")
      ? overrides.positionSnapshot
      : snapshotRows(),
    reservationSnapshot: Object.prototype.hasOwnProperty.call(overrides, "reservationSnapshot")
      ? overrides.reservationSnapshot
      : [],
    exchangeAggregateSnapshot: Object.prototype.hasOwnProperty.call(overrides, "exchangeAggregateSnapshot")
      ? overrides.exchangeAggregateSnapshot
      : aggregateRows(25),
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

    const basicScan = scan();
    check("scanner uses PID-owned qty, not aggregate qty", () => {
      assert.strictEqual(basicScan.pidOwnedOpenQty, 10);
      assert.strictEqual(basicScan.aggregateExchangeQty, 25);
      assert.strictEqual(basicScan.remainingPidOwnedQty, 10);
      assert.strictEqual(basicScan.aggregateUsedForClose, false);
    });
    check("same symbol/side other PID untouched", () => {
      const result = scan({
        ownerSnapshot: [
          ...ownerRows(),
          { uid: 920021, pid: 930022, symbol: "ADAUSDT", positionSide: "LONG", ownedQty: 15, status: "OPEN" },
        ],
      });
      assert.strictEqual(result.pidOwnedOpenQty, 10);
      assert.ok(result.audit.includes("SAME_SYMBOL_SIDE_OTHER_PID_UNTOUCHED"));
    });
    check("closeQty <= PID-owned remaining qty", () => {
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: basicScan, mode: "PLAN_ONLY" });
      assert.strictEqual(plan.marketCloseCandidates[0].closeQty, 10);
      assert.ok(plan.marketCloseCandidates[0].closeQty <= basicScan.remainingPidOwnedQty);
    });
    check("aggregate exposure not used for close qty", () => {
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: basicScan, mode: "PLAN_ONLY" });
      assert.notStrictEqual(plan.marketCloseCandidates[0].closeQty, basicScan.aggregateExchangeQty);
      assert.ok(plan.marketCloseCandidates[0].audit.includes("AGGREGATE_EXPOSURE_NOT_USED_FOR_CLOSE_QTY"));
    });
    check("owner/snapshot mismatch blocks plan", () => {
      const result = scan({ positionSnapshot: snapshotRows({ openQty: 9 }) });
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: result, mode: "PLAN_ONLY" });
      assert.ok(result.blockers.includes("GRID_EXIT_MARKET_CLOSE_BLOCKED_OWNER_SNAPSHOT_MISMATCH"));
      assert.strictEqual(plan.marketCloseCandidates[0].state, queue.GRID_EXIT_MARKET_CLOSE_PLAN_STATE.BLOCKED_EXPOSURE_MISMATCH);
    });
    check("active protection cancel unresolved waits", () => {
      const result = scan({
        reservationSnapshot: [{
          uid: 920021,
          pid: 930021,
          symbol: "ADAUSDT",
          positionSide: "LONG",
          remainingQty: 3,
          status: "ACTIVE",
        }],
      });
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: result, mode: "PLAN_ONLY" });
      assert.ok(result.blockers.includes("GRID_EXIT_MARKET_CLOSE_BLOCKED_PROTECTION_CANCEL_PENDING"));
      assert.strictEqual(plan.marketCloseCandidates[0].state, queue.GRID_EXIT_MARKET_CLOSE_PLAN_STATE.BLOCKED_PROTECTION_CANCEL_PENDING);
    });
    check("race fill reduces remaining qty in plan only", () => {
      const result = scan({
        raceObservations: [{
          uid: 920021,
          pid: 930021,
          symbol: "ADAUSDT",
          positionSide: "LONG",
          cancelRequested: true,
          orderStatus: "PARTIALLY_FILLED",
          executedQty: 2.5,
        }],
      });
      assert.strictEqual(result.raceAppliedQty, 2.5);
      assert.strictEqual(result.remainingPidOwnedQty, 7.5);
      assert.ok(result.userActionRequired.includes("GRID_EXIT_RACE_REST_RECOVERY_REQUIRED"));
    });
    check("race fill does not write ledger", () => {
      const result = scan({
        raceObservations: [{ pid: 930021, symbol: "ADAUSDT", positionSide: "LONG", executionType: "TRADE", qty: 1 }],
      });
      assert.ok(result.audit.includes("GRID_EXIT_RACE_FILL_REDUCED_REMAINING_QTY_PLAN_ONLY"));
    });
    check("remainingQty=0 creates no market close candidate", () => {
      const result = scan({ ownerSnapshot: ownerRows({ ownedQty: 0 }), positionSnapshot: snapshotRows({ openQty: 0 }), exchangeAggregateSnapshot: aggregateRows(0) });
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: result, mode: "PLAN_ONLY" });
      assert.strictEqual(plan.marketCloseCandidates.length, 0);
      assert.strictEqual(plan.state, queue.GRID_EXIT_MARKET_CLOSE_PLAN_STATE.NOT_REQUIRED_NO_REMAINING_EXPOSURE);
    });
    check("zero-qty residue creates audit, not close", () => {
      const result = scan({
        ownerSnapshot: ownerRows({ ownedQty: 0, reservedCloseQty: 0, status: "RESERVED" }),
        positionSnapshot: snapshotRows({ openQty: 0 }),
        exchangeAggregateSnapshot: aggregateRows(0),
      });
      assert.strictEqual(result.remainingPidOwnedQty, 0);
      assert.ok(result.audit.includes("GRID_EXIT_ZERO_QTY_NONTERMINAL_RESIDUE_AUDIT_ONLY"));
    });
    check("keyless regime blocks plan", () => {
      const result = scan({ parentCandidate: { gridRegimeKey: "" } });
      assert.ok(result.blockers.includes("GRID_EXIT_MARKET_CLOSE_BLOCKED_KEYLESS_REGIME"));
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: result, mode: "PLAN_ONLY" });
      assert.strictEqual(plan.marketCloseCandidates[0].state, queue.GRID_EXIT_MARKET_CLOSE_PLAN_STATE.BLOCKED_EXPOSURE_MISMATCH);
    });
    check("terminal/disabled target blocks plan", () => {
      const result = scan({ parentCandidate: { enabled: "N", status: "ENDED" } });
      assert.ok(result.blockers.includes("GRID_EXIT_MARKET_CLOSE_BLOCKED_TERMINAL_OR_DISABLED_TARGET"));
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: result, mode: "PLAN_ONLY" });
      assert.strictEqual(plan.marketCloseCandidates[0].state, queue.GRID_EXIT_MARKET_CLOSE_PLAN_STATE.BLOCKED_EXPOSURE_MISMATCH);
    });
    check("market close plan mode OFF creates no candidate", () => {
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: basicScan, mode: "OFF" });
      assert.strictEqual(plan.marketCloseCandidates.length, 0);
      assert.strictEqual(plan.previewCandidates.length, 0);
    });
    check("DRY_RUN creates preview only", () => {
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: basicScan, mode: "DRY_RUN" });
      assert.strictEqual(plan.marketCloseCandidates.length, 0);
      assert.strictEqual(plan.previewCandidates.length, 1);
      assert.strictEqual(plan.previewOnly, true);
    });
    check("PLAN_ONLY creates non-executable candidate", () => {
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: basicScan, mode: "PLAN_ONLY" });
      assert.strictEqual(plan.marketCloseCandidates.length, 1);
      assert.strictEqual(plan.marketCloseCandidates[0].executable, false);
      assert.strictEqual(plan.marketCloseCandidates[0].type, queue.GRID_EXIT_MARKET_CLOSE_PLAN_TYPE);
    });
    check("LIVE/BINANCE_WRITE/EXECUTE/MARKET_CLOSE rejected", () => {
      for (const mode of ["LIVE", "BINANCE_WRITE", "EXECUTE", "MARKET_CLOSE"]) {
        const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: basicScan, mode });
        assert.strictEqual(plan.rejected, true);
        assert.strictEqual(plan.forbidden.binanceWrite, false);
      }
    });
    check("no coin.closeGridLegMarketOrder call", () => {
      const helperStart = queueSource.indexOf("const GRID_EXIT_MARKET_CLOSE_PLAN_STATE");
      const helperEnd = queueSource.indexOf("const GRID_EXIT_ENQUEUE_ADAPTER_STATE", helperStart);
      assert.strictEqual(queueSource.slice(helperStart, helperEnd).includes("closeGridLegMarketOrder"), false);
    });
    check("no market close submit request", () => {
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: basicScan, mode: "PLAN_ONLY" });
      assert.strictEqual(plan.forbidden.marketCloseSubmit, false);
      assert.strictEqual(plan.marketCloseCandidates[0].executable, false);
    });
    check("no reduceOnly close request", () => {
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: basicScan, mode: "PLAN_ONLY" });
      assert.strictEqual(plan.forbidden.reduceOnlyClose, false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(plan.marketCloseCandidates[0], "reduceOnly"), false);
    });
    check("no order_intent_queue INSERT/UPDATE/DELETE", () => {
      const helperStart = queueSource.indexOf("const GRID_EXIT_MARKET_CLOSE_PLAN_STATE");
      const helperEnd = queueSource.indexOf("const GRID_EXIT_ENQUEUE_ADAPTER_STATE", helperStart);
      const helperSource = queueSource.slice(helperStart, helperEnd);
      assert.strictEqual(/INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i.test(helperSource), false);
    });
    check("no owner/snapshot/reservation/ledger write", () => {
      const helperStart = queueSource.indexOf("const GRID_EXIT_MARKET_CLOSE_PLAN_STATE");
      const helperEnd = queueSource.indexOf("const GRID_EXIT_ENQUEUE_ADAPTER_STATE", helperStart);
      const helperSource = queueSource.slice(helperStart, helperEnd);
      assert.strictEqual(/live_position_bucket_owner|live_pid_position_snapshot|live_pid_exit_reservation|live_pid_position_ledger/i.test(helperSource), false);
    });
    check("no Binance write path invoked", () => {
      const plan = queue.buildGridExitMarketClosePlan({ remainingExposureScan: basicScan, mode: "PLAN_ONLY" });
      assert.deepStrictEqual(plan.forbidden, {
        binanceWrite: false,
        marketCloseSubmit: false,
        aggregateClose: false,
        dbMutation: false,
        ledgerMutation: false,
        reduceOnlyClose: false,
      });
    });
    check("PID_CLOSE_QTY_GUARD audit present", () => assert.ok(basicScan.audit.includes("PID_CLOSE_QTY_GUARD")));
    check("AGGREGATE_EXPOSURE_NOT_USED_FOR_CLOSE_QTY audit present", () => assert.ok(basicScan.audit.includes("AGGREGATE_EXPOSURE_NOT_USED_FOR_CLOSE_QTY")));
    check("SAME_SYMBOL_SIDE_OTHER_PID_UNTOUCHED audit present", () => assert.ok(basicScan.audit.includes("SAME_SYMBOL_SIDE_OTHER_PID_UNTOUCHED")));

    const marketPlanWorkerStart = workerSource.indexOf("const processGridExitMarketClosePlanIntent");
    const marketPlanWorkerEnd = workerSource.indexOf("const processIntent", marketPlanWorkerStart);
    const marketPlanWorkerSource = workerSource.slice(marketPlanWorkerStart, marketPlanWorkerEnd);
    check("worker market close plan branch is blocked only", () => {
      assert.ok(marketPlanWorkerSource.includes("GRID_EXIT_MARKET_CLOSE_PLAN_QUEUE_STATE.BLOCKED_NOT_EXECUTABLE"));
      assert.strictEqual(/STATUS\.DONE|SUCCESS|GRID_EXIT_CONVERGED|CLOSE_CONVERGED/.test(marketPlanWorkerSource), false);
    });
    check("worker market close plan branch does not call close handler", () => {
      assert.strictEqual(/closeGridLegMarketOrder|cancelGridOrders|dispatchGridCloseIntent/.test(marketPlanWorkerSource), false);
    });

    const after = await readSafetyCounts(connection);
    check("app-path safety counts unchanged", () => assert.deepStrictEqual(after, before));

    console.log(JSON.stringify({
      ok: true,
      tests,
      currentUser: identity.currentUser,
      dbName: identity.dbName,
      passwordPrinted: false,
      sampleScan: basicScan,
      samplePlan: queue.buildGridExitMarketClosePlan({ remainingExposureScan: basicScan, mode: "PLAN_ONLY" }),
      rejectedModes: queue.GRID_EXIT_MARKET_CLOSE_PLAN_REJECTED_MODES,
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
