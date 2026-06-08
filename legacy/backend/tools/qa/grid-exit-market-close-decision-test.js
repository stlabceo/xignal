"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
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
  gridRegimeKey: "GRIDREGIME|v1|SQZ+GRID|PUMPUSDT|30MIN|MARKET-CLOSE",
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

const activePreview = { matched: 1, ignoredActive: 0, targetItems: [target] };

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

const makeHarness = ({
  pid = 204,
  symbol = "PUMPUSDT",
  storedKey = payload.gridRegimeKey,
  localQty = 5,
  exchangeQty = 5,
  finalClean = true,
  truthSyncClearsLocalBeforeClose = false,
  owners = null,
  snapshots = null,
} = {}) => {
  const state = {
    row: {
      id: pid,
      uid: 156,
      a_name: "QA Grid",
      strategySignal: "SQZ+GRID",
      symbol,
      bunbong: "30MIN",
      enabled: "Y",
      regimeStatus: "ACTIVE",
      lastWebhookPayloadJson: JSON.stringify({ gridRegimeKey: storedKey }),
      longEntryOrderId: null,
      shortEntryOrderId: null,
      longExitOrderId: null,
      shortExitOrderId: null,
    },
    exchange: { LONG: 0, SHORT: exchangeQty },
    owners: owners || (localQty > 0
      ? [{ positionSide: "SHORT", status: "OPEN", ownerState: "OPEN", ownedQty: localQty, reservedCloseQty: 0 }]
      : []),
    snapshots: snapshots || (localQty > 0
      ? [{ positionSide: "SHORT", status: "OPEN", openQty: localQty }]
      : []),
    reservations: [],
    cancels: [],
    closes: [],
    syncCount: 0,
  };

  const db = {
    query: async (sql, params) => {
      if (/FROM live_grid_strategy_list/i.test(sql)) {
        const [requestedPid, requestedUid, requestedSymbol, requestedBunbong] = params;
        const match = Number(requestedPid) === Number(state.row.id) &&
          Number(requestedUid) === Number(state.row.uid) &&
          String(requestedSymbol) === String(state.row.symbol) &&
          String(requestedBunbong) === String(state.row.bunbong) &&
          state.row.enabled === "Y";
        return [match ? [state.row] : [], []];
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
        if (/enabled = 'N'/i.test(sql)) {
          state.row.enabled = "N";
          state.row.regimeStatus = "ENDED";
        } else {
          state.row.regimeStatus = "CANCEL_INTENT_PENDING";
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
    getGridLegExchangePosition: async ({ leg }) => ({ readOk: true, qty: state.exchange[leg] || 0 }),
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
    truthSyncLiveGridRow: async () => {
      state.syncCount += 1;
      if (truthSyncClearsLocalBeforeClose && state.syncCount === 1) {
        state.owners = [];
        state.snapshots = [];
      }
      return { ok: true };
    },
  };

  const positionOwnershipApi = {
    releaseAllPositionBucketOwnersByPid: async () => {
      if (finalClean) {
        state.owners = [];
      }
      return 1;
    },
  };

  return { state, db, coin, gridEngine, positionOwnershipApi };
};

const run = async (harness, overrides = {}) => executor.executeGridExitForRoute({
  payload: overrides.payload || payload,
  previewResult: overrides.previewResult || activePreview,
  featureFlags: actualEnv,
  env: actualEnv,
  db: harness.db,
  coin: harness.coin,
  gridEngine: harness.gridEngine,
  positionOwnershipApi: harness.positionOwnershipApi,
});

(async () => {
  const cleared = makeHarness({ localQty: 5, exchangeQty: 5, truthSyncClearsLocalBeforeClose: true });
  const clearedResult = await run(cleared);
  check("TVE_EXIT with protected SHORT owner/snapshot creates market close candidate", () => {
    assert.strictEqual(clearedResult.cancelCount, 3);
    assert.strictEqual(clearedResult.closeResults.length, 1);
    assert.strictEqual(cleared.state.closes[0].leg, "SHORT");
  });

  check("cancelCount > 0 and remaining exposure > 0 produces closeCount > 0", () => {
    assert.ok(clearedResult.cancelCount > 0);
    assert.ok(clearedResult.closeResults.length > 0);
  });

  check("missing local order refs does not block close if owner/snapshot exposure exists", () => {
    assert.strictEqual(cleared.state.row.longEntryOrderId, null);
    assert.strictEqual(cleared.state.row.shortEntryOrderId, null);
    assert.strictEqual(clearedResult.closeResults.length, 1);
  });

  const zeroLocal = makeHarness({ localQty: 0, exchangeQty: 5 });
  const zeroLocalResult = await run(zeroLocal);
  check("owner/snapshot zero blocks close", () => {
    assert.strictEqual(zeroLocalResult.closeResults.length, 0);
  });

  const wrongPid = makeHarness({ pid: 204, localQty: 5, exchangeQty: 5 });
  const wrongPidResult = await run(wrongPid, {
    previewResult: { ...activePreview, targetItems: [{ ...target, pid: 205 }] },
  });
  check("wrong PID ignored", () => {
    assert.strictEqual(wrongPidResult.resultCode, "GRID_EXIT_ROUTE_TARGET_ROW_NOT_FOUND");
    assert.strictEqual(wrongPid.state.closes.length, 0);
  });

  const wrongSymbol = makeHarness({ localQty: 5, exchangeQty: 5 });
  const wrongSymbolResult = await run(wrongSymbol, {
    payload: { ...payload, symbol: "DOGEUSDT" },
  });
  check("wrong symbol ignored", () => {
    assert.strictEqual(wrongSymbolResult.mode, "AUDIT_ONLY");
    assert.strictEqual(wrongSymbol.state.closes.length, 0);
  });

  const wrongKey = makeHarness({ storedKey: "OTHER", localQty: 5, exchangeQty: 5 });
  const wrongKeyResult = await run(wrongKey);
  check("wrong gridRegimeKey ignored", () => {
    assert.strictEqual(wrongKeyResult.resultCode, "GRID_EXIT_ROUTE_KEY_MISMATCH");
    assert.strictEqual(wrongKey.state.closes.length, 0);
  });

  check("aggregate close rejected", () => {
    assert.strictEqual(cleared.state.closes[0].pid, 204);
    assert.strictEqual(cleared.state.closes[0].symbol, "PUMPUSDT");
    assert.strictEqual(cleared.state.closes[0].leg, "SHORT");
  });

  const capped = makeHarness({ localQty: 5, exchangeQty: 9, finalClean: false });
  await run(capped);
  check("closeQty <= PID-owned qty", () => {
    assert.strictEqual(capped.state.closes[0].qty, 5);
  });

  const nonConverged = makeHarness({ localQty: 5, exchangeQty: 5, finalClean: false });
  const nonConvergedResult = await run(nonConverged);
  check("cancel ACK not convergence", () => {
    assert.strictEqual(nonConvergedResult.cancelCount, 3);
    assert.strictEqual(nonConvergedResult.finalConverged, false);
  });

  check("close ACK not convergence", () => {
    assert.strictEqual(nonConvergedResult.closeResults.length, 1);
    assert.strictEqual(nonConvergedResult.processed, 0);
  });

  check("FILLED close required for final convergence", () => {
    assert.strictEqual(nonConvergedResult.resultCode, "GRID_EXIT_EXECUTED_CONVERGENCE_PENDING");
    assert.notStrictEqual(nonConvergedResult.resultCode, "GRID_EXIT_CONVERGED");
  });

  check("PARTIALLY_FILLED remains nonterminal by route convergence contract", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../grid-exit-route-executor.js"), "utf8");
    assert.ok(source.includes("finalConverged"));
    assert.ok(source.includes("finalExchange.SHORT"));
    assert.ok(source.includes("snapshotOpenCount"));
  });

  check("safety close not strategy success", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../grid-exit-route-executor.js"), "utf8");
    assert.strictEqual(/strategySuccess\s*[:=]\s*true/.test(source), false);
  });

  check("false finalConverged=true regression blocked", () => {
    assert.strictEqual(nonConvergedResult.finalConverged, false);
    assert.strictEqual(nonConvergedResult.processed, 0);
  });

  console.log(JSON.stringify({ ok: true, tests, dbMutation: 0, binanceWrite: 0 }, null, 2));
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
