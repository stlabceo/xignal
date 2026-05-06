"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const priceSource = require("../../grid-price-source");
const policy = require("../../grid-reentry-sl-policy");

const row = {
  uid: 156,
  id: 6,
  symbol: "XRPUSDT",
  bunbong: "1H",
  regimeReceivedAt: "2026-05-06 08:51:00",
  triggerPrice: "2.21000000",
};
const source = {
  takeProfitClientOrderId: "GTP_L_156_6_11112222",
  orderId: "987654321",
  tradeId: "123456789",
  tradeTime: "1778034660000",
};

const firstReentryId = policy.buildGridReentryClientOrderId(row, "LONG", source);
assert.match(firstReentryId, /^GENTRY_L_156_6_\d{8}$/);
assert.strictEqual(
  policy.buildGridReentryClientOrderId(row, "LONG", source),
  firstReentryId,
  "same TP fill reuses deterministic re-entry clientOrderId"
);
assert.notStrictEqual(
  policy.buildGridReentryClientOrderId(row, "LONG", { ...source, tradeId: "123456790" }),
  firstReentryId,
  "new TP fill receives a different deterministic re-entry clientOrderId"
);

const now = Date.now();
assert.strictEqual(
  priceSource.requireFreshGridQuote({
    st: true,
    bestBid: 2.2,
    bestAsk: 2.201,
    quoteTime: now,
  }, { nowMs: now }).usable,
  true,
  "fresh bid/ask quote is usable for strategy decisions"
);
assert.strictEqual(
  priceSource.requireFreshGridQuote({
    st: true,
    bestBid: 2.2,
    bestAsk: 2.201,
    quoteTime: now - 60000,
  }, { nowMs: now }).reason,
  "QUOTE_STALE",
  "stale quote blocks strategy decisions"
);
assert.strictEqual(
  priceSource.requireFreshGridQuote({
    st: true,
    bestBid: 0,
    bestAsk: 2.201,
    quoteTime: now,
  }, { nowMs: now }).usable,
  false,
  "missing bid/ask blocks strategy decisions"
);
assert.strictEqual(
  priceSource.getMarkFreshness({
    st: true,
    markPrice: 2.205,
    markTime: now,
  }, { nowMs: now }).usable,
  true,
  "fresh mark price is available for Binance MARK_PRICE conditional prechecks"
);

assert.strictEqual(policy.isReentryCriticalState({ regimeStatus: "GRID_REENTRY_FAILED" }), true);
assert.strictEqual(policy.isSlCriticalState({ regimeStatus: "GRID_SL_CLEANUP_PENDING" }), true);

const gridEngineSource = fs.readFileSync(path.resolve(__dirname, "../../grid-engine.js"), "utf8");
const canonicalSource = fs.readFileSync(path.resolve(__dirname, "../../canonical-runtime-state.js"), "utf8");
const protectionSource = fs.readFileSync(path.resolve(__dirname, "../../grid-protection-guarantee.js"), "utf8");
const policySource = fs.readFileSync(path.resolve(__dirname, "../../grid-reentry-sl-policy.js"), "utf8");
const coinSource = fs.readFileSync(path.resolve(__dirname, "../../coin.js"), "utf8");

for (const snippet of [
  "armLiveReentryAfterTakeProfit",
  "gridReentrySlPolicy.getReentryPriceDecision",
  "gridReentrySlPolicy.buildGridReentryClientOrderId",
  "loadFreshGridDecisionPrice(row.symbol",
  "gridReentrySlPolicy.GRID_REENTRY_REASON.PRICE_STALE",
  "gridReentrySlPolicy.GRID_REENTRY_REASON.SUBMIT_FAILED",
  "terminateLiveGridRegimeAfterStopFill",
  "SL_OPPOSITE_LEG_CLOSE_REQUIRED",
  "gridReentrySlPolicy.GRID_SL_STATE.CLEANUP_PENDING",
  "gridPriceSource.requireFreshGridQuote(price)",
]) {
  assert.ok(gridEngineSource.includes(snippet), `grid-engine.js should include ${snippet}`);
}

assert.ok(
  canonicalSource.includes("GRID_REENTRY_STALE") &&
    canonicalSource.includes("GRID_REENTRY_FAILED") &&
    canonicalSource.includes("GRID_SL_CLEANUP_PENDING") &&
    canonicalSource.includes("GRID_SL_OPPOSITE_CRITICAL"),
  "projection source should keep re-entry and SL critical states visible"
);
assert.ok(
  protectionSource.includes("gridPriceSource.requireFreshGridQuote(price)"),
  "protection immediate-trigger checks must also use fresh quote source"
);
assert.ok(
  coinSource.includes("/fapi/v1/premiumIndex") &&
    coinSource.includes("hydratePriceSlotFromMarkPrice") &&
    coinSource.includes("includeMark"),
  "public market price hydrator should support fresh MARK_PRICE data without user private API"
);
assert.ok(
  policySource.includes("GRID_TP_REENTRY_PRICE_STALE") &&
    policySource.includes("GRID_TP_REENTRY_FAILED") &&
    policySource.includes("GRID_SL_REGIME_TERMINATED"),
  "policy source should define re-entry and SL reason strings"
);

console.log("grid-reentry-sl-price-static-test PASS");
