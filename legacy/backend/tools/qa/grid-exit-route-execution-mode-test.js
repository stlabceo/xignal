"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const gridRuntime = require("../../grid-runtime");
const executor = require("../../grid-exit-route-executor");

let tests = 0;
const check = (name, fn) => {
  tests += 1;
  fn();
  console.log(`PASS ${name}`);
};

const payload = {
  explicitGridExit: true,
  strategySignal: "SQZ+GRID",
  symbol: "PUMPUSDT",
  bunbong: "30MIN",
  gridRegimeKey: "GRIDREGIME|v1|SQZ+GRID|PUMPUSDT|30MIN|A",
};

const target = {
  uid: 156,
  pid: 204,
  strategyCategory: "grid",
  strategyMode: "live",
  strategySignal: "SQZ+GRID",
  symbol: "PUMPUSDT",
  bunbong: "30MIN",
  resultCode: "GRID_EXIT_ALERT_PREVIEW",
};

const activePreview = {
  matched: 1,
  ignoredActive: 0,
  ignoredConflict: 0,
  ignoredSignal: 0,
  targetItems: [target],
};

const actualEnv = {
  GRID_EXIT_ROUTE_EXECUTION_MODE: "ACTUAL",
  GRID_EXIT_ORCHESTRATOR_ENABLED: "1",
  GRID_EXIT_CONTRACT_MODE: "ENFORCE",
  GRID_EXIT_ACTUAL_CANCEL_ENABLED: "1",
  GRID_EXIT_ACTUAL_CANCEL_HARD_CONFIRM: "1",
  GRID_EXIT_ACTUAL_CANCEL_MAX_TARGETS: "1",
  GRID_EXIT_ACTUAL_MARKET_CLOSE_ENABLED: "1",
  GRID_EXIT_ACTUAL_MARKET_CLOSE_HARD_CONFIRM: "1",
  GRID_EXIT_ACTUAL_MARKET_CLOSE_MAX_TARGETS: "1",
  GRID_EXIT_ROUTE_EXECUTION_MAX_TARGETS: "1",
};

const makeHarness = ({ storedKey = payload.gridRegimeKey, openQty = 5, finalClean = true } = {}) => {
  const state = {
    row: {
      id: 204,
      uid: 156,
      a_name: "QA Grid",
      strategySignal: "SQZ+GRID",
      symbol: "PUMPUSDT",
      bunbong: "30MIN",
      enabled: "Y",
      regimeStatus: "ACTIVE",
      lastWebhookPayloadJson: JSON.stringify({ gridRegimeKey: storedKey }),
    },
    exchange: { LONG: 0, SHORT: openQty },
    owners: openQty > 0
      ? [{ positionSide: "SHORT", status: "OPEN", ownerState: "OPEN", ownedQty: openQty, reservedCloseQty: 0 }]
      : [],
    snapshots: openQty > 0
      ? [{ positionSide: "SHORT", status: "OPEN", openQty }]
      : [],
    reservations: [],
    updates: [],
    cancels: [],
    closes: [],
  };

  const db = {
    query: async (sql, params) => {
      if (/FROM live_grid_strategy_list/i.test(sql)) {
        return [[state.row], []];
      }
      if (/FROM live_position_bucket_owner/i.test(sql)) {
        return [state.owners, []];
      }
      if (/FROM live_pid_position_snapshot/i.test(sql)) {
        return [state.snapshots, []];
      }
      if (/FROM live_pid_exit_reservation/i.test(sql)) {
        return [state.reservations, []];
      }
      if (/UPDATE live_grid_strategy_list/i.test(sql)) {
        state.updates.push({ sql, params });
        if (/enabled = 'N'/i.test(sql)) {
          state.row.enabled = "N";
          state.row.regimeStatus = "ENDED";
          state.row.regimeEndReason = "EXPLICIT_GRID_EXIT";
        } else {
          state.row.regimeStatus = "CANCEL_INTENT_PENDING";
          state.row.regimeEndReason = "EXPLICIT_GRID_EXIT";
        }
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };

  const coin = {
    cancelGridOrders: async (request) => {
      state.cancels.push(request);
      return 3;
    },
    getGridLegExchangePosition: async ({ leg }) => ({
      readOk: true,
      qty: state.exchange[leg] || 0,
    }),
    closeGridLegMarketOrder: async (request) => {
      state.closes.push(request);
      if (finalClean) {
        state.exchange[request.leg] = 0;
        state.owners = [];
        state.snapshots = [];
      }
      return { orderId: 1, clientOrderId: "GMANUAL_S_156_204_ROUTE" };
    },
  };

  const gridEngine = {
    truthSyncLiveGridRow: async () => ({ repairs: [] }),
  };

  return { state, db, coin, gridEngine };
};

(async () => {
  check("GRID_EXIT missing key rejected by target collector", () => {
    const result = executor.collectEligibleExitTargets({ previewResult: activePreview, payload: { ...payload, gridRegimeKey: "" } });
    assert.strictEqual(result.blocked, true);
    assert.ok(result.blockers.includes("GRID_EXIT_ROUTE_GRID_REGIME_KEY_REQUIRED"));
  });

  check("GRID_EXIT matching active PID creates route target", () => {
    const result = executor.collectEligibleExitTargets({ previewResult: activePreview, payload });
    assert.strictEqual(result.blocked, false);
    assert.strictEqual(result.eligibleCount, 1);
  });

  check("AUDIT_ONLY mode remains audit-only when route flag is off", () => {
    const gate = executor.isGridExitRouteExecutionEnabled({ env: { ...actualEnv, GRID_EXIT_ROUTE_EXECUTION_MODE: "OFF" }, featureFlags: actualEnv });
    assert.strictEqual(gate.enabled, false);
    assert.ok(gate.blockers.includes("GRID_EXIT_ROUTE_EXECUTION_MODE_NOT_ACTUAL"));
  });

  check("live QA execution mode is enabled with all hard-confirm flags", () => {
    const gate = executor.isGridExitRouteExecutionEnabled({ env: actualEnv, featureFlags: actualEnv });
    assert.strictEqual(gate.enabled, true);
  });

  check("normalized GRID_EXIT payload remains explicit across preview reuse", () => {
    const validation = gridRuntime.validateGridExitWebhookPayload(
      {
        eventType: "GRID_EXIT",
        strategySignal: payload.strategySignal,
        symbol: "PUMPUSDT.P",
        timeframe: payload.bunbong,
        gridRegimeKey: payload.gridRegimeKey,
        signalTime: "2026-06-08T00:00:00Z",
      },
      { env: { GRID_EXIT_CONTRACT_MODE: "ENFORCE", GRID_CANDLE_CLOSE_LEGACY_MODE: "REJECT" } }
    );
    assert.strictEqual(validation.ok, true);
    const reused = gridRuntime.normalizeGridExitWebhookPayload(validation.payload);
    assert.strictEqual(reused.explicitGridExit, true);
    assert.strictEqual(reused.exitAction, "GRID_EXIT");
  });

  check("terminal row ignored because target is not alert preview", () => {
    const preview = { ...activePreview, targetItems: [{ ...target, resultCode: "GRID_EXIT_NO_ACTIVE_REGIME" }] };
    const result = executor.collectEligibleExitTargets({ previewResult: preview, payload });
    assert.strictEqual(result.blocked, true);
    assert.strictEqual(result.eligibleCount, 0);
  });

  check("disabled unrelated row ignored because preview has no eligible target", () => {
    const preview = { ...activePreview, targetItems: [{ ...target, resultCode: "GRID_EXIT_SIGNAL_MISMATCH" }] };
    const result = executor.collectEligibleExitTargets({ previewResult: preview, payload });
    assert.strictEqual(result.blocked, true);
  });

  check("same-key multi-PID behavior remains bounded", () => {
    const result = executor.collectEligibleExitTargets({
      previewResult: { ...activePreview, targetItems: [target, { ...target, pid: 205 }] },
      payload,
      maxTargets: 1,
    });
    assert.strictEqual(result.blocked, true);
    assert.ok(result.blockers.includes("GRID_EXIT_ROUTE_TARGET_COUNT_EXCEEDED"));
  });

  check("no broad fallback when no active target", () => {
    const result = executor.collectEligibleExitTargets({ previewResult: { ...activePreview, targetItems: [] }, payload });
    assert.strictEqual(result.blocked, true);
    assert.ok(result.blockers.includes("GRID_EXIT_ROUTE_NO_ELIGIBLE_ACTIVE_TARGET"));
  });

  const harness = makeHarness();
  const liveResult = await executor.executeGridExitForRoute({
    payload,
    previewResult: activePreview,
    featureFlags: actualEnv,
    env: actualEnv,
    db: harness.db,
    coin: harness.coin,
    gridEngine: harness.gridEngine,
  });

  check("live QA execution mode does not return AUDIT_ONLY", () => {
    assert.strictEqual(liveResult.mode, "ACTUAL");
    assert.notStrictEqual(liveResult.resultCode, "GRID_EXIT_ALERT_AUDIT_ONLY");
  });

  check("ignoredActive is 0 for eligible active PID", () => {
    assert.strictEqual(liveResult.ignoredActive, 0);
  });

  check("parent request links to cancel/protection/close execution summary", () => {
    assert.strictEqual(liveResult.requested, 1);
    assert.strictEqual(liveResult.cancelCount, 3);
    assert.strictEqual(liveResult.closeResults.length, 1);
  });

  check("cancel call is exact-scoped, not broad", () => {
    assert.deepStrictEqual(harness.state.cancels[0], {
      uid: 156,
      symbol: "PUMPUSDT",
      pid: 204,
      leg: null,
      includeEntries: true,
      includeExits: true,
    });
  });

  check("market close call is explicit Grid Exit metadata and non-safety-success", () => {
    assert.strictEqual(harness.state.closes[0].gridRegimeKey, payload.gridRegimeKey);
    assert.strictEqual(harness.state.closes[0].closeReason, "EXPLICIT_GRID_EXIT");
    assert.strictEqual(harness.state.closes[0].reservationKind, "GRID_EXIT_MARKET_CLOSE");
  });

  check("final convergence requires fill evidence/local-exchange clean", () => {
    assert.strictEqual(liveResult.finalConverged, true);
    assert.strictEqual(liveResult.processed, 1);
    assert.strictEqual(liveResult.terminalize.terminalized, true);
  });

  const mismatch = makeHarness({ storedKey: "OTHER" });
  const mismatchResult = await executor.executeGridExitForRoute({
    payload,
    previewResult: activePreview,
    featureFlags: actualEnv,
    env: actualEnv,
    db: mismatch.db,
    coin: mismatch.coin,
    gridEngine: mismatch.gridEngine,
  });
  check("GRID_EXIT wrong key rejected", () => {
    assert.strictEqual(mismatchResult.requested, 0);
    assert.strictEqual(mismatchResult.resultCode, "GRID_EXIT_ROUTE_KEY_MISMATCH");
  });

  const notClean = makeHarness({ finalClean: false });
  const pendingResult = await executor.executeGridExitForRoute({
    payload,
    previewResult: activePreview,
    featureFlags: actualEnv,
    env: actualEnv,
    db: notClean.db,
    coin: notClean.coin,
    gridEngine: notClean.gridEngine,
  });
  check("close ACK non-terminal and final convergence required", () => {
    assert.strictEqual(pendingResult.finalConverged, false);
    assert.strictEqual(pendingResult.processed, 0);
    assert.strictEqual(pendingResult.resultCode, "GRID_EXIT_EXECUTED_CONVERGENCE_PENDING");
  });

  check("safety close not strategy success by route source contract", () => {
    assert.strictEqual(/strategySuccess\s*[:=]\s*true/.test(JSON.stringify(liveResult)), false);
  });

  check("route source includes actual execution hook and keeps audit-only fallback", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../routes/users.js"), "utf8");
    assert.ok(source.includes("gridExitRouteExecutor.executeGridExitForRoute"));
    assert.ok(source.includes("phase1-grid-exit-contract-audit-only"));
    assert.ok(source.includes("GRID_EXIT_ROUTE_EXECUTION_DIRECT_EXACT_SCOPE"));
  });

  console.log(JSON.stringify({ ok: true, tests, dbMutation: 0, binanceWrite: 0 }, null, 2));
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
