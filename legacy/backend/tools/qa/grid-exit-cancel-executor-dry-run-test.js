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
  openSnapshots: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM live_pid_position_snapshot WHERE openQty <> 0"),
  activeReservations: await readOneCount(connection, "SELECT COUNT(*) AS cnt FROM live_pid_exit_reservation WHERE status = 'ACTIVE'"),
  zeroQtyResidue: await readOneCount(
    connection,
    "SELECT COUNT(*) AS cnt FROM live_position_bucket_owner WHERE symbol = 'XRPUSDT' AND ownedQty = 0 AND reservedCloseQty = 0 AND status IN ('RESERVED','ENTRY_ARMED')"
  ),
});

const baseChildPayload = (overrides = {}) => ({
  uid: 920001,
  pid: 930001,
  strategyCategory: "grid",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT",
  timeframe: "10MIN",
  gridRegimeKey: "REGIME_CANCEL_EXECUTOR_DRY_RUN",
  positionSide: "LONG",
  orderRole: "ENTRY",
  clientOrderId: "ENTRY_LONG_CANCEL_DRY_RUN",
  orderId: "10001",
  childNaturalKey: "GRID_EXIT_ENTRY_CANCEL:v1:920001:930001:LONG:ENTRY:10001",
  source: "PHASE_3A_GRID_EXIT_CANCEL_EXECUTOR_DRY_RUN",
  ...overrides,
});

const makeChildIntent = (intentType, overrides = {}) => ({
  id: 1,
  uid: Object.prototype.hasOwnProperty.call(overrides, "uid") ? Number(overrides.uid || 0) : 920001,
  pid: Object.prototype.hasOwnProperty.call(overrides, "pid") ? Number(overrides.pid || 0) : 930001,
  strategyCategory: "grid",
  intentType,
  intentKey: Object.prototype.hasOwnProperty.call(overrides, "childNaturalKey")
    ? overrides.childNaturalKey
    : `${intentType}:key`,
  fifoKey: "grid:exit:cancel:dry-run",
  payload: baseChildPayload({ action: intentType, ...overrides }),
});

const invoke = (intentType, overrides = {}, mode = "DRY_RUN", mockBinanceClient = null) =>
  queue.buildGridExitCancelExecutorDryRun({
    childIntent: makeChildIntent(intentType, overrides),
    mode,
    mockBinanceClient,
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

    const off = invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, {}, "OFF");
    check("OFF mode does not create cancel request", () => {
      assert.strictEqual(off.result, queue.GRID_EXIT_CANCEL_EXECUTOR_STATE.DISABLED);
      assert.strictEqual(off.cancelRequest, null);
    });

    const dryRun = invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, {}, "DRY_RUN");
    check("DRY_RUN mode creates preview only", () => {
      assert.strictEqual(dryRun.result, queue.GRID_EXIT_CANCEL_EXECUTOR_STATE.DRY_RUN_READY);
      assert.ok(dryRun.cancelRequest);
      assert.strictEqual(dryRun.mockCancelRecorded, false);
    });

    const mockClient = { requests: [] };
    const mock = invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, {}, "MOCK_BINANCE_ONLY", mockClient);
    check("MOCK_BINANCE_ONLY records mock cancel request only", () => {
      assert.strictEqual(mock.result, queue.GRID_EXIT_CANCEL_EXECUTOR_STATE.MOCK_REQUEST_RECORDED);
      assert.strictEqual(mockClient.requests.length, 1);
      assert.deepStrictEqual(mockClient.requests[0], mock.cancelRequest);
    });

    check("LIVE/BINANCE_WRITE/EXECUTE modes rejected", () => {
      for (const mode of ["LIVE", "BINANCE_WRITE", "EXECUTE"]) {
        const result = invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, {}, mode);
        assert.strictEqual(result.rejected, true);
        assert.strictEqual(result.result, queue.GRID_EXIT_CANCEL_EXECUTOR_STATE.MODE_REJECTED);
      }
    });

    check("entry cancel requires uid/pid/clientOrderId or orderId", () => {
      assert.ok(invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { uid: 0 }, "DRY_RUN").errors.includes("GRID_EXIT_CANCEL_UID_REQUIRED"));
      assert.ok(invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { pid: 0 }, "DRY_RUN").errors.includes("GRID_EXIT_CANCEL_PID_REQUIRED"));
      assert.ok(invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { clientOrderId: "", orderId: "" }, "DRY_RUN").errors.includes("GRID_EXIT_ENTRY_CANCEL_ORDER_IDENTITY_REQUIRED"));
    });

    check("protection cancel requires reservationId plus clientOrderId or orderId", () => {
      const valid = invoke(queue.INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL, {
        orderRole: "TP",
        reservationId: "RES_TP_1",
        clientOrderId: "TP_CLIENT_1",
        orderId: "",
      }, "DRY_RUN");
      assert.strictEqual(valid.ok, true);
      assert.ok(invoke(queue.INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL, {
        orderRole: "TP",
        reservationId: "",
        clientOrderId: "TP_CLIENT_1",
      }, "DRY_RUN").errors.includes("GRID_EXIT_PROTECTION_CANCEL_RESERVATION_ID_REQUIRED"));
      assert.ok(invoke(queue.INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL, {
        orderRole: "STOP",
        reservationId: "RES_STOP_1",
        clientOrderId: "",
        orderId: "",
      }, "DRY_RUN").errors.includes("GRID_EXIT_PROTECTION_CANCEL_ORDER_IDENTITY_REQUIRED"));
    });

    check("missing pid rejected", () =>
      assert.ok(invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { pid: "" }, "DRY_RUN").errors.includes("GRID_EXIT_CANCEL_PID_REQUIRED")));
    check("missing uid rejected", () =>
      assert.ok(invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { uid: "" }, "DRY_RUN").errors.includes("GRID_EXIT_CANCEL_UID_REQUIRED")));
    check("missing attribution rejected", () =>
      assert.ok(invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { childNaturalKey: "" }, "DRY_RUN").errors.includes("GRID_EXIT_CANCEL_CHILD_NATURAL_KEY_REQUIRED")));
    check("keyless regime rejected", () =>
      assert.ok(invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { gridRegimeKey: "" }, "DRY_RUN").errors.includes("GRID_EXIT_CANCEL_GRID_REGIME_KEY_REQUIRED")));
    check("candle close legacy rejected", () =>
      assert.ok(invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { source: "CANDLE_CLOSE_LEGACY" }, "DRY_RUN").errors.includes("GRID_EXIT_CANCEL_CANDLE_CLOSE_LEGACY_REJECTED")));

    check("same symbol/side different PID untouched", () => {
      const a = invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { pid: 930001 }, "DRY_RUN").cancelRequest;
      const b = invoke(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, { pid: 930002 }, "DRY_RUN").cancelRequest;
      assert.strictEqual(a.symbol, b.symbol);
      assert.strictEqual(a.positionSide, b.positionSide);
      assert.notStrictEqual(a.pid, b.pid);
    });

    check("cancel request includes childNaturalKey", () => assert.ok(dryRun.cancelRequest.sourceChildNaturalKey));
    check("cancel request includes gridRegimeKey", () => assert.ok(dryRun.cancelRequest.gridRegimeKey));
    check("cancel request includes strategySignal", () => assert.ok(dryRun.cancelRequest.strategySignal));
    check("cancel request includes orderRole", () => assert.strictEqual(dryRun.cancelRequest.orderRole, "ENTRY"));
    check("cancel request never creates market close", () => assert.strictEqual(dryRun.cancelRequest.marketClose, false));
    check("cancel request never uses cancel-all-symbol", () => {
      assert.strictEqual(dryRun.cancelRequest.cancelAllBySymbol, false);
      assert.strictEqual(dryRun.cancelRequest.cancelAllOpenOrders, false);
      assert.strictEqual(dryRun.cancelRequest.cancelAllAlgoOrders, false);
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
    check("fill-during-cancel classified as race candidate, not success", () => {
      const observed = queue.classifyGridExitCancelExecutorObservation({ cancelRequested: true, executionType: "TRADE", orderStatus: "FILLED" });
      assert.strictEqual(observed.raceCandidate, true);
      assert.strictEqual(observed.terminalSuccess, false);
    });

    const childGuardStart = workerSource.indexOf("const processGridExitChildCancelIntent");
    const childGuardEnd = workerSource.indexOf("const processIntent", childGuardStart);
    const childGuard = workerSource.slice(childGuardStart, childGuardEnd);
    check("worker GRID_EXIT_ENTRY_CANCEL does not call coin.cancelGridOrders", () => assert.strictEqual(childGuard.includes("cancelGridOrders"), false));
    check("worker GRID_EXIT_PROTECTION_CANCEL does not call coin.cancelGridOrders", () => assert.strictEqual(childGuard.includes("cancelGridOrders"), false));
    check("worker does not call coin.closeGridLegMarketOrder", () => assert.strictEqual(childGuard.includes("closeGridLegMarketOrder"), false));
    check("worker does not return DONE/SUCCESS/CONVERGED", () => {
      assert.strictEqual(/STATUS\.DONE|SUCCESS|GRID_EXIT_CONVERGED|CLOSE_CONVERGED/.test(childGuard), false);
    });

    check("helper source has no live Binance path", () => {
      const helperStart = queueSource.indexOf("const buildGridExitCancelExecutorDryRun");
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
    check("no Binance write path invoked", () => assert.strictEqual(mock.forbidden.binanceWrite, false));

    console.log(JSON.stringify({
      ok: true,
      tests,
      currentUser: identity.currentUser,
      dbName: identity.dbName,
      passwordPrinted: false,
      supportedModes: queue.GRID_EXIT_CANCEL_EXECUTOR_ALLOWED_MODES,
      rejectedModes: queue.GRID_EXIT_CANCEL_EXECUTOR_REJECTED_MODES,
      sampleRequests: {
        dryRun: dryRun.cancelRequest,
        mock: mock.cancelRequest,
      },
      workerGuard: {
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
