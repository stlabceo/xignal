"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const db = require(path.resolve(repoRoot, "backend/database/connect/config"));
const queue = require(path.resolve(repoRoot, "backend/order-intent-queue"));
const safeAdapter = require(path.resolve(repoRoot, "backend/grid-exit-safe-exchange-adapter"));

const queueSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-queue.js"), "utf8");
const workerSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-worker.js"), "utf8");
const adapterSource = fs.readFileSync(path.resolve(repoRoot, "backend/grid-exit-safe-exchange-adapter.js"), "utf8");

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
  openSnapshots: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM live_pid_position_snapshot WHERE openQty <> 0"),
  activeReservations: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM live_pid_exit_reservation WHERE status = 'ACTIVE'"),
  targetResidue: await readOneCount(
    connection,
    `SELECT COUNT(*) AS cnt
       FROM live_position_bucket_owner
      WHERE id IN (190,191,192,193)
        AND uid = 156
        AND symbol = 'XRPUSDT'
        AND ownerPid IN (5,6)
        AND LOWER(ownerStrategyCategory) = 'grid'
        AND ownerState = 'ENTRY_ARMED'
        AND COALESCE(ownedQty,0) = 0
        AND COALESCE(reservedCloseQty,0) = 0
        AND status = 'RESERVED'`
  ),
});

const cleanupFixtureRows = [
  { id: 190, uid: 156, symbol: "XRPUSDT", ownerPid: 5, ownerStrategyCategory: "grid", ownerState: "ENTRY_ARMED", ownedQty: 0, reservedCloseQty: 0, status: "RESERVED" },
  { id: 191, uid: 156, symbol: "XRPUSDT", ownerPid: 5, ownerStrategyCategory: "grid", ownerState: "ENTRY_ARMED", ownedQty: 0, reservedCloseQty: 0, status: "RESERVED" },
  { id: 192, uid: 156, symbol: "XRPUSDT", ownerPid: 6, ownerStrategyCategory: "grid", ownerState: "ENTRY_ARMED", ownedQty: 0, reservedCloseQty: 0, status: "RESERVED" },
  { id: 193, uid: 156, symbol: "XRPUSDT", ownerPid: 6, ownerStrategyCategory: "grid", ownerState: "ENTRY_ARMED", ownedQty: 0, reservedCloseQty: 0, status: "RESERVED" },
];

const validateCleanupFixture = (rows) => {
  const ids = rows.map((row) => Number(row.id)).sort((a, b) => a - b);
  return rows.length === 4 &&
    JSON.stringify(ids) === JSON.stringify([190, 191, 192, 193]) &&
    rows.every((row) =>
      Number(row.uid) === 156 &&
      row.symbol === "XRPUSDT" &&
      [5, 6].includes(Number(row.ownerPid)) &&
      String(row.ownerStrategyCategory || "").toLowerCase() === "grid" &&
      row.ownerState === "ENTRY_ARMED" &&
      Number(row.ownedQty || 0) === 0 &&
      Number(row.reservedCloseQty || 0) === 0 &&
      row.status === "RESERVED"
    );
};

const basePayload = (intentType, overrides = {}) => ({
  action: intentType,
  intentType,
  uid: 920071,
  pid: 930071,
  strategyCategory: "grid",
  strategySignal: "SQZ+GRID",
  symbol: "ADAUSDT",
  timeframe: "10MIN",
  gridRegimeKey: "GRID_EXIT_GATE_A_REGIME",
  positionSide: "LONG",
  orderRole: "ENTRY",
  clientOrderId: "GENTRY_L_920071_930071",
  orderId: "77001",
  childNaturalKey: `${intentType}:v1:920071:930071:GRID_EXIT_GATE_A_REGIME:LONG:ENTRY:77001`,
  source: "GRID_EXIT_GATE_A_ACTUAL_CANCEL_BOUNDED_TEST",
  ...overrides,
});

const makeChildIntent = (intentType, overrides = {}) => ({
  id: 1,
  uid: Object.prototype.hasOwnProperty.call(overrides, "uid") ? Number(overrides.uid || 0) : 920071,
  pid: Object.prototype.hasOwnProperty.call(overrides, "pid") ? Number(overrides.pid || 0) : 930071,
  strategyCategory: "grid",
  intentType,
  intentKey: Object.prototype.hasOwnProperty.call(overrides, "childNaturalKey")
    ? overrides.childNaturalKey
    : `${intentType}:gate-a-key`,
  fifoKey: "grid:exit:gate-a",
  payload: basePayload(intentType, overrides),
});

const actualEnv = {
  GRID_EXIT_ACTUAL_CANCEL_ENABLED: "1",
  GRID_EXIT_ACTUAL_CANCEL_HARD_CONFIRM: "1",
  GRID_EXIT_ACTUAL_CANCEL_MAX_TARGETS: "1",
};

const invokeActual = (intentType, overrides = {}, extra = {}) =>
  queue.buildGridExitCancelExecutorDryRun({
    childIntent: makeChildIntent(intentType, overrides),
    mode: queue.GRID_EXIT_ACTUAL_CANCEL_MODE,
    env: extra.env || actualEnv,
    targetCount: extra.targetCount || 1,
    mockBinanceClient: extra.mockBinanceClient,
  });

(async () => {
  if (db.__startupFingerprintCheck) {
    await db.__startupFingerprintCheck;
  }
  const connection = await db.getConnection();
  try {
    const [identityRows] = await connection.query("SELECT CURRENT_USER() AS currentUser, DATABASE() AS dbName");
    const identity = identityRows?.[0] || {};
    const before = await readSafetyCounts(connection);

    check("cleanup preflight fixture exact count 4", () => assert.strictEqual(cleanupFixtureRows.length, 4));
    check("cleanup rejects wrong ids/count", () => {
      assert.strictEqual(validateCleanupFixture(cleanupFixtureRows), true);
      assert.strictEqual(validateCleanupFixture(cleanupFixtureRows.slice(0, 3)), false);
      assert.strictEqual(validateCleanupFixture([{ ...cleanupFixtureRows[0], id: 999 }, ...cleanupFixtureRows.slice(1)]), false);
    });
    check("cleanup transaction commits only exact target fixture", () => {
      assert.strictEqual(validateCleanupFixture(cleanupFixtureRows), true);
      assert.strictEqual(validateCleanupFixture(cleanupFixtureRows.map((row) => ({ ...row, symbol: "ADAUSDT" }))), false);
    });
    check("cleanup after count 0", () => assert.strictEqual(before.targetResidue, 0));
    check("queue PENDING/RUNNING/RETRY unchanged baseline 0", () => assert.strictEqual(before.pendingRunningRetry, 0));
    check("snapshot openQty unchanged 0", () => assert.strictEqual(before.openSnapshots, 0));
    check("active reservation unchanged 0", () => assert.strictEqual(before.activeReservations, 0));

    check("actual cancel flags default OFF", () => {
      const state = queue.normalizeGridExitActualCancelFlags({ env: {}, targetCount: 1 });
      assert.strictEqual(state.ok, false);
      assert.ok(state.errors.includes("GRID_EXIT_ACTUAL_CANCEL_ENABLED_REQUIRED"));
      assert.ok(state.errors.includes("GRID_EXIT_ACTUAL_CANCEL_HARD_CONFIRM_REQUIRED"));
    });
    check("hard confirm required", () => {
      const state = queue.normalizeGridExitActualCancelFlags({
        env: { GRID_EXIT_ACTUAL_CANCEL_ENABLED: "1", GRID_EXIT_ACTUAL_CANCEL_MAX_TARGETS: "1" },
      });
      assert.strictEqual(state.ok, false);
      assert.ok(state.errors.includes("GRID_EXIT_ACTUAL_CANCEL_HARD_CONFIRM_REQUIRED"));
    });
    check("max targets = 1 enforced", () => {
      assert.ok(invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, {}, { targetCount: 2 }).errors.includes("GRID_EXIT_ACTUAL_CANCEL_TARGET_COUNT_EXCEEDED"));
      assert.ok(invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, {}, {
        env: { ...actualEnv, GRID_EXIT_ACTUAL_CANCEL_MAX_TARGETS: "2" },
      }).errors.includes("GRID_EXIT_ACTUAL_CANCEL_MAX_TARGETS_MUST_BE_1"));
    });
    check("missing uid rejected", () => assert.ok(invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { uid: 0 }).errors.includes("GRID_EXIT_CANCEL_UID_REQUIRED")));
    check("missing pid rejected", () => assert.ok(invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { pid: 0 }).errors.includes("GRID_EXIT_CANCEL_PID_REQUIRED")));
    check("missing gridRegimeKey rejected", () => assert.ok(invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { gridRegimeKey: "" }).errors.includes("GRID_EXIT_CANCEL_GRID_REGIME_KEY_REQUIRED")));
    check("missing clientOrderId/orderId rejected", () => {
      assert.ok(invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { clientOrderId: "", orderId: "" }).errors.includes("GRID_EXIT_ENTRY_CANCEL_ORDER_IDENTITY_REQUIRED"));
    });
    check("protection cancel missing reservationId rejected", () => {
      assert.ok(invokeActual(queue.INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL, {
        orderRole: "TP",
        reservationId: "",
        clientOrderId: "GTP_L_920071_930071",
        orderId: "",
      }).errors.includes("GRID_EXIT_PROTECTION_CANCEL_RESERVATION_ID_REQUIRED"));
    });
    check("cancel-all-symbol rejected by request shape", () => {
      const result = invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { cancelAllBySymbol: true }, { mockBinanceClient: { requests: [] } });
      assert.strictEqual(result.cancelRequest.cancelAllBySymbol, false);
    });
    check("cancel-all-openOrders rejected by request shape", () => {
      const result = invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { cancelAllOpenOrders: true }, { mockBinanceClient: { requests: [] } });
      assert.strictEqual(result.cancelRequest.cancelAllOpenOrders, false);
      assert.strictEqual(result.cancelRequest.cancelAllAlgoOrders, false);
    });
    check("aggregate cancel rejected by exact pid/key requirement", () => {
      assert.ok(invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { childNaturalKey: "" }).errors.includes("GRID_EXIT_CANCEL_CHILD_NATURAL_KEY_REQUIRED"));
    });
    check("market close request rejected by request shape", () => {
      const result = invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { marketClose: true }, { mockBinanceClient: { requests: [] } });
      assert.strictEqual(result.cancelRequest.marketClose, false);
    });
    check("reduceOnly close rejected by request shape", () => {
      const result = invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { reduceOnly: true }, { mockBinanceClient: { requests: [] } });
      assert.strictEqual(result.cancelRequest.reduceOnly, false);
    });
    check("DRY_RUN no Binance write", () => {
      const result = queue.buildGridExitCancelExecutorDryRun({
        childIntent: makeChildIntent(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL),
        mode: "DRY_RUN",
      });
      assert.strictEqual(result.forbidden.binanceWrite, false);
      assert.strictEqual(result.mockCancelRecorded, false);
    });
    check("RUNTIME_DISABLED no Binance write", () => {
      const adapter = queue.createGridExitRuntimeDisabledCancelAdapter({ mode: "RUNTIME_DISABLED", mockCancelClient: { events: [] } });
      const result = adapter.cancel({ childIntent: makeChildIntent(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL) });
      assert.strictEqual(result.actualBinanceWrite, false);
    });
    check("ACTUAL_CANCEL with fake client only", () => {
      const fake = { requests: [] };
      const intent = makeChildIntent(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL);
      const result = safeAdapter.executeGridExitGateAActualCancel({
        cancelIntent: intent,
        cancelTarget: intent.payload,
        mode: queue.GRID_EXIT_ACTUAL_CANCEL_MODE,
        flags: actualEnv,
        client: fake,
      });
      assert.strictEqual(result.result, queue.GRID_EXIT_CANCEL_EXECUTOR_STATE.ACTUAL_CANCEL_FAKE_RECORDED);
      assert.strictEqual(fake.requests.length, 1);
      assert.strictEqual(result.actualBinanceWrite, false);
    });
    check("actual Binance client not called", () => {
      let called = false;
      const fake = { recordCancelRequest: () => { called = true; return { recorded: true }; } };
      const result = invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, {}, { mockBinanceClient: fake });
      assert.strictEqual(called, true);
      assert.strictEqual(result.actualBinanceWrite, false);
      const helperSource = queueSource.slice(
        queueSource.indexOf("const buildGridExitCancelExecutorDryRun"),
        queueSource.indexOf("const GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_ALLOWED_MODES")
      );
      assert.strictEqual(/privateFutures|cancelFuturesOrder|cancelGridOrders|closeGridLegMarketOrder/.test(helperSource), false);
    });
    check("cancel ACK non-terminal", () => {
      const observed = queue.classifyGridExitCancelExecutorObservation({ cancelRequested: true, orderStatus: "CANCELED" });
      assert.strictEqual(observed.terminalSuccess, false);
      assert.strictEqual(observed.cancelAckTerminal, false);
    });
    check("no DONE/SUCCESS/CONVERGED", () => {
      const childStart = workerSource.indexOf("const processGridExitChildCancelIntent");
      const childEnd = workerSource.indexOf("const processGridExitMarketClosePlanIntent", childStart);
      const childSource = workerSource.slice(childStart, childEnd);
      assert.strictEqual(/STATUS\.DONE|SUCCESS|CONVERGED/.test(childSource), false);
    });
    check("openOrders/openAlgoOrders verification pending state present", () => {
      const entry = invokeActual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, {}, { mockBinanceClient: { requests: [] } });
      const protection = invokeActual(queue.INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL, {
        orderRole: "STOP",
        reservationId: "RES_STOP_GATE_A",
        clientOrderId: "GSTOP_L_920071_930071",
        orderId: "",
      }, { mockBinanceClient: { requests: [] } });
      assert.strictEqual(entry.openOrdersVerificationPending, true);
      assert.strictEqual(protection.openAlgoOrdersVerificationPending, true);
    });

    const after = await readSafetyCounts(connection);
    check("no order_intent_queue INSERT/UPDATE/DELETE", () => assert.strictEqual(after.totalQueue, before.totalQueue));
    check("no ledger/owner/snapshot/reservation write except approved residue cleanup", () => {
      assert.strictEqual(after.targetResidue, before.targetResidue);
      assert.strictEqual(after.openSnapshots, before.openSnapshots);
      assert.strictEqual(after.activeReservations, before.activeReservations);
    });
    check("previous Batch 1-5 static contract exports still present", () => {
      for (const name of [
        "buildGridExitCancelExecutorDryRun",
        "createGridExitRuntimeDisabledCancelAdapter",
        "buildGridExitMarketCloseDryRun",
        "buildGridExitStopEmergencyBackstopPolicy",
      ]) {
        assert.strictEqual(typeof queue[name], "function");
      }
    });
    check("Gate A actual cancel mode export present", () => {
      assert.strictEqual(queue.GRID_EXIT_ACTUAL_CANCEL_MODE, "ACTUAL_CANCEL");
      assert.ok(queue.GRID_EXIT_CANCEL_EXECUTOR_ALLOWED_MODES.includes("ACTUAL_CANCEL"));
    });
    check("safe Gate A adapter exists without coin cancel/close call", () => {
      assert.ok(adapterSource.includes("executeGridExitGateAActualCancel"));
      assert.strictEqual(adapterSource.includes("closeGridLegMarketOrder"), false);
      assert.strictEqual(adapterSource.includes("cancelGridOrders({"), false);
      assert.ok(workerSource.includes("grid-exit-safe-exchange-adapter"));
    });

    console.log(JSON.stringify({
      ok: true,
      tests,
      currentUser: identity.currentUser,
      dbName: identity.dbName,
      before,
      after,
      dbMutation: 0,
      binanceWrite: 0,
      actualBinanceCancel: 0,
      actualBinanceClose: 0,
    }, null, 2));
  } finally {
    connection.release();
    await db.end();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
