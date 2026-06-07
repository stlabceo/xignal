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

const basePayload = (intentType, overrides = {}) => ({
  action: intentType,
  uid: 920011,
  pid: 930011,
  strategyCategory: "grid",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT",
  timeframe: "10MIN",
  gridRegimeKey: "REGIME_RUNTIME_DISABLED_CANCEL",
  positionSide: "LONG",
  orderRole: "ENTRY",
  clientOrderId: "ENTRY_LONG_RUNTIME_DISABLED",
  orderId: "30001",
  childNaturalKey: `${intentType}:v1:920011:930011:LONG:ENTRY:30001`,
  source: "BATCH_2_GRID_EXIT_RUNTIME_DISABLED_CANCEL_INTEGRATION",
  ...overrides,
});

const makeChildIntent = (intentType, overrides = {}) => ({
  id: 1,
  uid: Object.prototype.hasOwnProperty.call(overrides, "uid") ? Number(overrides.uid || 0) : 920011,
  pid: Object.prototype.hasOwnProperty.call(overrides, "pid") ? Number(overrides.pid || 0) : 930011,
  strategyCategory: "grid",
  intentType,
  intentKey: Object.prototype.hasOwnProperty.call(overrides, "childNaturalKey")
    ? overrides.childNaturalKey
    : `${intentType}:runtime-disabled-key`,
  fifoKey: "grid:exit:runtime-disabled",
  payload: basePayload(intentType, overrides),
});

const makeAdapter = (mode, mockCancelClient = null) =>
  queue.createGridExitRuntimeDisabledCancelAdapter({
    mode,
    mockCancelClient,
    now: new Date("2026-06-07T02:30:00Z"),
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

    check("adapter supports OFF / DRY_RUN / RUNTIME_DISABLED", () => {
      assert.deepStrictEqual(queue.GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_ALLOWED_MODES, ["OFF", "DRY_RUN", "RUNTIME_DISABLED"]);
    });
    check("LIVE / BINANCE_WRITE / EXECUTE rejected", () => {
      for (const mode of ["LIVE", "BINANCE_WRITE", "EXECUTE"]) {
        const adapter = makeAdapter(mode);
        const result = adapter.cancel({ childIntent: makeChildIntent(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL) });
        assert.strictEqual(result.rejected, true);
        assert.strictEqual(result.actualBinanceWrite, false);
        assert.strictEqual(result.terminal, false);
      }
    });

    const off = makeAdapter("OFF").cancel({ childIntent: makeChildIntent(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL) });
    check("OFF creates no request", () => {
      assert.strictEqual(off.result, queue.GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_STATE.DISABLED);
      assert.strictEqual(off.cancelEvent, null);
    });

    const dryRun = makeAdapter("DRY_RUN").cancel({ childIntent: makeChildIntent(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL) });
    check("DRY_RUN validates only", () => {
      assert.strictEqual(dryRun.result, queue.GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_STATE.DRY_RUN_ONLY);
      assert.ok(dryRun.cancelRequestPreview);
      assert.strictEqual(dryRun.cancelEvent, null);
      assert.strictEqual(dryRun.actualBinanceWrite, false);
    });

    const mockCancelClient = { events: [] };
    const runtimeDisabled = makeAdapter("RUNTIME_DISABLED", mockCancelClient).cancel({
      childIntent: makeChildIntent(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL),
    });
    check("RUNTIME_DISABLED records mock request", () => {
      assert.strictEqual(runtimeDisabled.result, queue.GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_STATE.RECORDED);
      assert.strictEqual(mockCancelClient.events.length, 1);
      assert.deepStrictEqual(mockCancelClient.events[0], runtimeDisabled.cancelEvent);
    });

    const protection = makeAdapter("RUNTIME_DISABLED", { events: [] }).cancel({
      childIntent: makeChildIntent(queue.INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL, {
        orderRole: "STOP",
        reservationId: "RES_STOP_RUNTIME_DISABLED",
        clientOrderId: "STOP_CLIENT_RUNTIME_DISABLED",
        orderId: "",
        childNaturalKey: "GRID_EXIT_PROTECTION_CANCEL:v1:920011:930011:LONG:STOP:RES_STOP_RUNTIME_DISABLED",
      }),
    });

    const event = runtimeDisabled.cancelEvent;
    check("event includes uid/pid/symbol/side/role", () => {
      assert.strictEqual(event.uid, 920011);
      assert.strictEqual(event.pid, 930011);
      assert.strictEqual(event.symbol, "ADAUSDT");
      assert.strictEqual(event.positionSide, "LONG");
      assert.strictEqual(event.orderRole, "ENTRY");
    });
    check("event includes clientOrderId/orderId/reservationId when present", () => {
      assert.strictEqual(event.clientOrderId, "ENTRY_LONG_RUNTIME_DISABLED");
      assert.strictEqual(event.orderId, "30001");
      assert.strictEqual(protection.cancelEvent.reservationId, "RES_STOP_RUNTIME_DISABLED");
    });
    check("event includes gridRegimeKey/strategySignal/childNaturalKey", () => {
      assert.strictEqual(event.gridRegimeKey, "REGIME_RUNTIME_DISABLED_CANCEL");
      assert.strictEqual(event.strategySignal, "Mean Revert Grid");
      assert.ok(event.sourceChildNaturalKey.includes("GRID_EXIT_ENTRY_CANCEL"));
    });
    check("event has actualBinanceWrite=false", () => assert.strictEqual(event.actualBinanceWrite, false));
    check("event terminal=false", () => assert.strictEqual(event.terminal, false));
    check("no cancel-all-symbol request", () => assert.strictEqual(event.cancelAllBySymbol, false));
    check("no cancel-all-openOrders request", () => {
      assert.strictEqual(event.cancelAllOpenOrders, false);
      assert.strictEqual(event.cancelAllOpenAlgoOrders, false);
    });
    check("no market close request", () => {
      assert.strictEqual(event.marketClose, false);
      assert.strictEqual(event.reduceOnlyClose, false);
    });

    const childGuardStart = workerSource.indexOf("const processGridExitChildCancelIntent");
    const childGuardEnd = workerSource.indexOf("const processIntent", childGuardStart);
    const childGuard = workerSource.slice(childGuardStart, childGuardEnd);
    check("worker GRID_EXIT_ENTRY_CANCEL calls runtime-disabled adapter only", () => {
      assert.ok(childGuard.includes("createGridExitRuntimeDisabledCancelAdapter"));
      assert.ok(childGuard.includes("runtimeCancelAdapter.cancel"));
    });
    check("worker GRID_EXIT_PROTECTION_CANCEL calls runtime-disabled adapter only", () => {
      assert.ok(workerSource.includes("GRID_EXIT_PROTECTION_CANCEL"));
      assert.ok(childGuard.includes("runtimeDisabledCancelEvent"));
    });
    check("worker does not call coin.cancelGridOrders", () => assert.strictEqual(childGuard.includes("cancelGridOrders"), false));
    check("worker does not call coin.closeGridLegMarketOrder", () => assert.strictEqual(childGuard.includes("closeGridLegMarketOrder"), false));
    check("worker does not return DONE/SUCCESS/CONVERGED", () => {
      assert.strictEqual(/STATUS\.DONE|SUCCESS|GRID_EXIT_CONVERGED|CLOSE_CONVERGED/.test(childGuard), false);
    });

    check("cancel ACK not terminal policy preserved", () => {
      const observed = queue.classifyGridExitCancelExecutorObservation({ orderStatus: "CANCELED" });
      assert.strictEqual(observed.terminalSuccess, false);
      assert.strictEqual(observed.closeConverged, false);
    });
    check("PARTIALLY_FILLED not terminal policy preserved", () => {
      const observed = queue.classifyGridExitCancelExecutorObservation({ cancelRequested: true, orderStatus: "PARTIALLY_FILLED" });
      assert.strictEqual(observed.terminalSuccess, false);
      assert.strictEqual(observed.partiallyFilledTerminal, false);
    });
    check("fill during cancel remains race candidate", () => {
      const observed = queue.classifyGridExitCancelExecutorObservation({ cancelRequested: true, executionType: "TRADE" });
      assert.strictEqual(observed.raceCandidate, true);
      assert.strictEqual(observed.terminalSuccess, false);
    });
    check("STOP fill during cancel remains emergency/race candidate", () => {
      const observed = queue.classifyGridExitCancelExecutorObservation({
        cancelRequested: true,
        executionType: "TRADE",
        orderRole: "STOP",
        orderStatus: "FILLED",
      });
      assert.strictEqual(observed.raceCandidate, true);
      assert.strictEqual(observed.terminalSuccess, false);
    });

    check("helper source has no live write path", () => {
      const helperStart = queueSource.indexOf("const createGridExitRuntimeDisabledCancelAdapter");
      const helperEnd = queueSource.indexOf("const GRID_EXIT_ENQUEUE_ADAPTER_STATE", helperStart);
      const helperSource = queueSource.slice(helperStart, helperEnd);
      assert.strictEqual(/cancelGridOrders|closeGridLegMarketOrder|futures|DELETE FROM|INSERT INTO|UPDATE /.test(helperSource), false);
    });

    const after = await readSafetyCounts(connection);
    check("no order_intent_queue INSERT/UPDATE/DELETE", () => assert.deepStrictEqual(after, before));
    check("no owner/snapshot/reservation/ledger write", () => {
      assert.strictEqual(after.openSnapshots, before.openSnapshots);
      assert.strictEqual(after.activeReservations, before.activeReservations);
    });
    check("no Binance write path invoked", () => {
      assert.strictEqual(runtimeDisabled.actualBinanceWrite, false);
      assert.strictEqual(protection.actualBinanceWrite, false);
    });

    console.log(JSON.stringify({
      ok: true,
      tests,
      currentUser: identity.currentUser,
      dbName: identity.dbName,
      passwordPrinted: false,
      supportedModes: queue.GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_ALLOWED_MODES,
      rejectedModes: queue.GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_REJECTED_MODES,
      sampleEvents: {
        entry: runtimeDisabled.cancelEvent,
        protection: protection.cancelEvent,
      },
      workerIntegration: {
        usesRuntimeDisabledAdapter: childGuard.includes("createGridExitRuntimeDisabledCancelAdapter"),
        childGuardHasCancelGridOrders: childGuard.includes("cancelGridOrders"),
        childGuardHasCloseGridLegMarketOrder: childGuard.includes("closeGridLegMarketOrder"),
        terminalSuccess: /STATUS\.DONE|SUCCESS|GRID_EXIT_CONVERGED|CLOSE_CONVERGED/.test(childGuard),
      },
      before,
      after,
      dbMutation: 0,
      binanceWrite: 0,
    }, null, 2));
  } finally {
    connection.release();
    if (typeof db.end === "function") {
      await db.end().catch(() => {});
    }
  }
})().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
