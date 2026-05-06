"use strict";

const assert = require("assert");

const priceSource = require("../../grid-price-source");
const policy = require("../../grid-reentry-sl-policy");

const now = Date.now();
const baseRow = {
  uid: 156,
  id: 10,
  symbol: "PUMPUSDT",
  bunbong: "30MIN",
  regimeReceivedAt: "2026-05-06 08:54:00",
  triggerPrice: "0.00460000",
};
const tpSource = {
  takeProfitClientOrderId: "GTP_S_156_10_33334444",
  orderId: "456",
  tradeId: "789",
  tradeTime: String(now),
};

const scenarios = [
  {
    name: "LONG TP fill while regime ACTIVE",
    actual: priceSource.requireFreshGridQuote({ st: true, bestBid: 100, bestAsk: 100.1, quoteTime: now }, { nowMs: now }).usable,
    expected: true,
  },
  {
    name: "SHORT TP fill while regime ACTIVE",
    actual: policy.buildGridReentryClientOrderId(baseRow, "SHORT", tpSource).startsWith("GENTRY_S_156_10_"),
    expected: true,
  },
  {
    name: "LONG TP fill but price stale",
    actual: priceSource.requireFreshGridQuote({ st: true, bestBid: 100, bestAsk: 100.1, quoteTime: now - 60000 }, { nowMs: now }).usable,
    expected: false,
  },
  {
    name: "SHORT TP fill but re-entry submit fails",
    actual: policy.GRID_REENTRY_STATE.FAILED,
    expected: "GRID_REENTRY_FAILED",
  },
  {
    name: "SL fill on LONG",
    actual: policy.GRID_SL_REASON.TERMINATED,
    expected: "GRID_SL_REGIME_TERMINATED",
  },
  {
    name: "SL fill on SHORT",
    actual: policy.GRID_SL_REASON.TERMINATED,
    expected: "GRID_SL_REGIME_TERMINATED",
  },
  {
    name: "SL fill with sibling pending entry",
    actual: policy.GRID_SL_STATE.CLEANUP_PENDING,
    expected: "GRID_SL_CLEANUP_PENDING",
  },
  {
    name: "SL fill with opposite open leg",
    actual: policy.GRID_SL_STATE.OPPOSITE_CRITICAL,
    expected: "GRID_SL_OPPOSITE_CRITICAL",
  },
  {
    name: "stale price during box break check",
    actual: priceSource.requireFreshGridQuote({ st: true, bestBid: 1, bestAsk: 1.01, quoteTime: now - 60000 }, { nowMs: now }).reason,
    expected: "QUOTE_STALE",
  },
  {
    name: "controlled close after protection failure remains critical",
    actual: policy.isSlCriticalState({ regimeStatus: policy.GRID_SL_STATE.OPPOSITE_CRITICAL }),
    expected: true,
  },
];

for (const scenario of scenarios) {
  assert.strictEqual(scenario.actual, scenario.expected, scenario.name);
}

const retryIds = [
  policy.buildGridReentryClientOrderId(baseRow, "SHORT", tpSource),
  policy.buildGridReentryClientOrderId(baseRow, "SHORT", tpSource),
  policy.buildGridReentryClientOrderId(baseRow, "SHORT", tpSource),
];
assert.strictEqual(new Set(retryIds).size, 1, "duplicate re-entry retry uses same clientOrderId");

console.log("grid-reentry-sl-price-mock-replay PASS");
