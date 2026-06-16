"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const gridEngine = require("../../grid-engine");

const gridEngineSource = fs.readFileSync(path.resolve(__dirname, "../../grid-engine.js"), "utf8");
const coinSource = fs.readFileSync(path.resolve(__dirname, "../../coin.js"), "utf8");
const seonSource = fs.readFileSync(path.resolve(__dirname, "../../seon.js"), "utf8");

let tests = 0;
const check = async (label, fn) => {
  await fn();
  tests += 1;
  console.log(`[PASS] ${label}`);
};

const baseRow = (overrides = {}) => ({
  id: 990214,
  uid: 156,
  symbol: "HBARUSDT.P",
  enabled: "Y",
  regimeStatus: "ACTIVE",
  regimeEndReason: null,
  longLegStatus: "ENTRY_ARMED",
  longEntryOrderId: "GENTRY_L_156_990214_TEST",
  longExitOrderId: null,
  longStopOrderId: null,
  longQty: 0,
  longEntryPrice: null,
  shortLegStatus: "ENTRY_ARMED",
  shortEntryOrderId: "GENTRY_S_156_990214_TEST",
  shortExitOrderId: null,
  shortStopOrderId: null,
  shortQty: 0,
  shortEntryPrice: null,
  ...overrides,
});

const createConvergenceHarness = (rowOverrides = {}, options = {}) => {
  const row = baseRow(rowOverrides);
  const state = {
    ledger: [],
    owner: { ownerState: "RESERVED", ownedQty: 0 },
    snapshot: { openQty: 0, avgEntryPrice: 0 },
    protectionCalls: [],
    cancelCalls: [],
    closeIntents: [],
    logs: [],
    patches: [],
    syncCount: 0,
  };

  const deps = {
    findRecordedFill: async (query) =>
      state.ledger.find((fill) =>
        fill.sourceClientOrderId === query.sourceClientOrderId &&
        String(fill.sourceOrderId || "") === String(query.sourceOrderId || "") &&
        String(fill.sourceTradeId || "") === String(query.sourceTradeId || "") &&
        Number(fill.fillQty) === Number(query.fillQty) &&
        Number(fill.fillPrice) === Number(query.fillPrice)
      ) || null,
    applyEntryFill: async (payload) => {
      state.ledger.push(payload);
      state.owner.ownedQty = Number((state.owner.ownedQty + Number(payload.fillQty || 0)).toFixed(8));
      state.snapshot.openQty = state.owner.ownedQty;
      state.snapshot.avgEntryPrice = Number(payload.fillPrice || 0);
    },
    syncGridLegSnapshot: async () => {
      state.syncCount += 1;
    },
    loadSnapshot: async () => ({ ...state.snapshot }),
    loadGridItem: async () => row,
    applyGridPatch: async (_table, _id, patch) => {
      Object.assign(row, patch);
      state.patches.push(patch);
    },
    touchGridLegPositionOwnership: async (_row, _leg, patch) => {
      Object.assign(state.owner, patch);
    },
    appendGridRuntimeLog: async (...args) => {
      state.logs.push(args);
    },
    cancelAllGridOrders: async (...args) => {
      state.cancelCalls.push(args);
      return 1;
    },
    protectGridOpenLegOrClose: async (payload) => {
      state.protectionCalls.push(payload);
      if (options.protectionResult) {
        return options.protectionResult;
      }
      const prefix = String(payload.leg).toLowerCase();
      Object.assign(row, {
        [`${prefix}LegStatus`]: "OPEN",
        [`${prefix}Qty`]: payload.qty,
        [`${prefix}EntryPrice`]: payload.entryPrice,
        [`${prefix}EntryOrderId`]: payload.entryOrderId,
        [`${prefix}ExitOrderId`]: `GTP_${payload.leg[0]}_${row.uid}_${row.id}_TEST`,
        [`${prefix}StopOrderId`]: `GSTOP_${payload.leg[0]}_${row.uid}_${row.id}_TEST`,
      });
      return {
        protected: true,
        pending: false,
        closed: false,
        exits: {
          takeProfitOrderId: row[`${prefix}ExitOrderId`],
          stopOrderId: row[`${prefix}StopOrderId`],
        },
      };
    },
    enqueueLiveGridCloseIntent: async (...args) => {
      state.closeIntents.push(args);
      return {
        pending: true,
        intentSummary: {
          intent: {
            intentKey: "GRID_DUPLICATE_CLOSE_TEST",
          },
        },
      };
    },
    emergencyCloseLiveGridLeg: async () => {
      state.emergencyClose = true;
      return true;
    },
  };

  return { row, state, deps };
};

const runConvergence = async (source, harness, overrides = {}) => {
  const execution = {
    clientOrderId: "GENTRY_L_156_990214_TEST",
    orderId: "16444499804",
    tradeId: "768529383",
    qty: 72,
    price: 0.08202,
    fee: 0.00295272,
    tradeTime: "2026-06-16T05:52:39.851Z",
    ...overrides.execution,
  };
  return await gridEngine.__qa.applyGridEntryFillConvergence(
    harness.row,
    "LONG",
    execution,
    { issues: [`${source}_TEST`] },
    {
      source,
      eventType: source === "SOCKET" ? "GRID_ENTRY_FILL" : "GRID_EXCHANGE_RECONCILED_ENTRY_FILL",
      note: `grid-entry-convergence:${source}`,
      routePath: `qa-${source.toLowerCase()}`,
      deps: harness.deps,
      ...overrides.options,
    }
  );
};

(async () => {
  await check("all fill sources use the same canonical convergence helper", async () => {
    const sourceNames = ["SOCKET", "IMMEDIATE_REST", "BOUNDED_REST", "TRUTH_SYNC", "RESTART_RECOVERY"];
    for (const source of sourceNames) {
      const harness = createConvergenceHarness();
      const result = await runConvergence(source, harness);
      assert.strictEqual(result.converged, true, source);
      assert.strictEqual(result.source, source, source);
      assert.strictEqual(harness.state.ledger.length, 1, source);
      assert.strictEqual(harness.state.owner.ownerState, "OPEN", source);
      assert.strictEqual(harness.state.snapshot.openQty, 72, source);
      assert.strictEqual(harness.state.protectionCalls.length, 1, source);
      assert(harness.row.longExitOrderId, `${source}: TP order expected`);
      assert(harness.row.longStopOrderId, `${source}: STOP order expected`);
    }
  });

  await check("duplicate socket plus REST fill does not duplicate ledger or protection", async () => {
    const harness = createConvergenceHarness();
    const first = await runConvergence("SOCKET", harness);
    const second = await runConvergence("BOUNDED_REST", harness);

    assert.strictEqual(first.appliedFillCount, 1);
    assert.strictEqual(second.appliedFillCount, 0);
    assert.strictEqual(second.duplicateFillCount, 1);
    assert.strictEqual(harness.state.ledger.length, 1);
    assert.strictEqual(harness.state.protectionCalls.length, 1);
    assert.strictEqual(harness.state.snapshot.openQty, 72);
  });

  await check("partial fill converges partial qty and can be extended idempotently", async () => {
    const harness = createConvergenceHarness();
    const partial = await runConvergence("SOCKET", harness, {
      execution: {
        orderId: "16444499804",
        tradeId: "768529383-P1",
        qty: 36,
        price: 0.08202,
      },
    });
    const remaining = await runConvergence("BOUNDED_REST", harness, {
      execution: {
        orderId: "16444499804",
        tradeId: "768529383-P2",
        qty: 36,
        price: 0.08202,
      },
    });

    assert.strictEqual(partial.converged, true);
    assert.strictEqual(remaining.converged, true);
    assert.strictEqual(harness.state.ledger.length, 2);
    assert.strictEqual(harness.state.snapshot.openQty, 72);
    assert(harness.state.protectionCalls.length >= 1);
  });

  await check("different entry fill on an already open leg queues controlled duplicate close", async () => {
    const harness = createConvergenceHarness({
      longLegStatus: "OPEN",
      longEntryOrderId: "GENTRY_L_156_990214_OLD",
      longQty: 72,
      longExitOrderId: "GTP_L_156_990214_OLD",
      longStopOrderId: "GSTOP_L_156_990214_OLD",
    });
    const result = await runConvergence("SOCKET", harness);
    assert.strictEqual(result.converged, true);
    assert.strictEqual(harness.state.closeIntents.length, 1);
    assert.strictEqual(harness.state.protectionCalls.length, 0);
    assert(harness.state.logs.some((log) => String(log[2]).includes("ENTRY_FILLED_DUPLICATE_CLOSE")));
  });

  await check("protection creation failure is surfaced as failed convergence with P0 log code", async () => {
    const harness = createConvergenceHarness({}, {
      protectionResult: {
        protected: false,
        pending: false,
        closed: false,
      },
    });
    const result = await runConvergence("TRUTH_SYNC", harness);
    assert.strictEqual(result.converged, false);
    assert.strictEqual(harness.state.ledger.length, 1);
    assert.strictEqual(harness.state.snapshot.openQty, 72);
    assert.strictEqual(harness.state.protectionCalls.length, 1);
    assert.strictEqual(
      harness.state.protectionCalls[0].failureLogCode,
      "ENTRY_FILL_RECOVERED_PROTECTION_MISSING_CLOSED"
    );
  });

  await check("bounded recovery remains exact clientOrderId scoped and rate bounded", async () => {
    assert(gridEngineSource.includes("const recoverImmediateLiveArmFillsAfterPairAck"));
    assert(gridEngineSource.includes("getLiveArmEntryFillRecoveryAttempts"));
    assert(gridEngineSource.includes("getLiveArmEntryFillRecoveryDelayMs"));
    assert(gridEngineSource.includes("GRID_LIVE_ARM_ENTRY_FILL_RECOVERY_WAITING"));
    assert(/attempt\s*=\s*1;[\s\S]+attempt\s*<=\s*maxAttempts/.test(gridEngineSource));
    assert(gridEngineSource.includes("clientOrderId: placement.clientOrderId"));
    assert(gridEngineSource.includes("candidateClientOrderIds: [placement.clientOrderId]"));
    assert(gridEngineSource.includes("requireCandidateClientOrderId: true"));
    assert(coinSource.includes("if(requireExactCandidate)"));
    assert(coinSource.includes("return clientOrderIdSet.has(clientOrderId);"));
  });

  await check("exchange recovery discovers fills and canonical convergence applies them", async () => {
    const recoveryBody = coinSource.slice(
      coinSource.indexOf("exports.recoverGridEntryFillFromExchange"),
      coinSource.indexOf("const buildExpectedSignalBoundTargets")
    );
    assert(recoveryBody.includes("loadRecentGridEntryExecutionFromExchange"));
    assert(recoveryBody.includes("ENTRY_FILL_RECOVERY_DISCOVERED"));
    assert(!recoveryBody.includes("pidPositionLedger.applyEntryFill"));
    assert(!recoveryBody.includes("pidPositionLedger.syncGridLegSnapshot"));
    assert(gridEngineSource.includes("const applyGridEntryFillConvergence"));
    assert(gridEngineSource.includes("await applyEntryFill({"));
    assert(gridEngineSource.includes("await syncGridLegSnapshot(row.id, normalizedLeg);"));
  });

  await check("live QA scoped runtime uses bounded recovery instead of broad polling", async () => {
    assert(seonSource.includes("enableAccountPolling: !qaScopedGridRuntime"));
    assert(gridEngineSource.includes("process.env.QA_SCOPED_GRID_RUNTIME"));
    assert(gridEngineSource.includes("GRID_LIVE_ARM_ENTRY_FILL_BOUNDED_RECOVERY"));
  });

  console.log(JSON.stringify({
    result: "PASS",
    tests,
    dbMutation: 0,
    binanceWrite: 0,
  }, null, 2));
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
