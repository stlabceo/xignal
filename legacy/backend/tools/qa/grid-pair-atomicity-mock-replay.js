"use strict";

const assert = require("assert");
const pair = require("../../grid-pair-atomicity");

const baseRow = {
  uid: 156,
  id: 10,
  symbol: "PUMPUSDT",
  bunbong: "30MIN",
  regimeReceivedAt: "2026-05-06 08:54:00",
  supportPrice: "0.00400000",
  resistancePrice: "0.00500000",
  triggerPrice: "0.00460000",
};

const clientId = (leg) => pair.buildGridPairClientOrderId(baseRow, leg);

const classify = (longPlacement, shortPlacement) =>
  pair.classifyGridPairArmOutcome({
    LONG: longPlacement,
    SHORT: shortPlacement,
  });

const longSuccess = { ok: true, clientOrderId: clientId("LONG"), exchangeOrder: { status: "NEW", executedQty: "0" } };
const shortSuccess = { ok: true, clientOrderId: clientId("SHORT"), exchangeOrder: { status: "NEW", executedQty: "0" } };

const scenarios = [
  {
    name: "both LONG/SHORT submit success",
    actual: classify(longSuccess, shortSuccess),
    expected: "PAIR_ARMED",
  },
  {
    name: "LONG success, SHORT fails non-time error",
    actual: classify(longSuccess, { ok: false, errorCode: -2019 }),
    expected: pair.GRID_PAIR_STATE.ROLLBACK_PENDING,
  },
  {
    name: "SHORT success, LONG fails non-time error",
    actual: classify({ ok: false, errorCode: -2019 }, shortSuccess),
    expected: pair.GRID_PAIR_STATE.ROLLBACK_PENDING,
  },
  {
    name: "LONG success then timeout on SHORT verified by read-after-write",
    actual: classify(longSuccess, {
      ok: pair.shouldVerifyAfterWriteResult({ requestedClientOrderId: clientId("SHORT"), errorMessage: "dispatch timeout" }),
      clientOrderId: clientId("SHORT"),
      exchangeOrder: { status: "NEW", executedQty: "0" },
    }),
    expected: "PAIR_ARMED",
  },
  {
    name: "one success then sibling -1021 retry success",
    actual: classify(longSuccess, {
      ok: true,
      clientOrderId: clientId("SHORT"),
      exchangeOrder: { status: "NEW", executedQty: "0" },
    }),
    expected: "PAIR_ARMED",
  },
  {
    name: "one success then sibling -1021 retry fail",
    actual: classify(longSuccess, { ok: false, errorCode: -1021 }),
    expected: pair.GRID_PAIR_STATE.ROLLBACK_PENDING,
  },
  {
    name: "successful leg fills before sibling failure resolved",
    actual: classify({
      ok: true,
      clientOrderId: clientId("LONG"),
      exchangeOrder: { status: "FILLED", executedQty: "1200" },
    }, { ok: false, errorCode: -1007 }),
    expected: pair.GRID_PAIR_STATE.ONE_LEG_FILLED,
  },
  {
    name: "both failed",
    actual: classify({ ok: false, errorCode: -2019 }, { ok: false, errorCode: -2019 }),
    expected: pair.GRID_PAIR_STATE.FAILED,
  },
];

for (const scenario of scenarios) {
  assert.strictEqual(scenario.actual, scenario.expected, scenario.name);
}

const retryClientIds = [
  clientId("LONG"),
  pair.buildGridPairClientOrderId(baseRow, "LONG"),
  pair.buildGridPairClientOrderId(baseRow, "LONG"),
];
assert.strictEqual(new Set(retryClientIds).size, 1, "duplicate retry uses the same clientOrderId");
assert.strictEqual(
  pair.hasAnyGridEntryOrderRef({ longEntryOrderId: clientId("LONG"), regimeStatus: "ENDED" }),
  true,
  "local reset must be blocked while an exchange entry order reference exists"
);

console.log("grid-pair-atomicity-mock-replay PASS");
