"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const protection = require("../../grid-protection-guarantee");

assert.strictEqual(
  protection.deriveProtectionClientOrderId({
    entryClientOrderId: "GENTRY_L_156_9_12345678",
    prefix: "GTP",
  }),
  "GTP_L_156_9_12345678",
  "TP clientOrderId is deterministic from entry clientOrderId"
);
assert.strictEqual(
  protection.deriveProtectionClientOrderId({
    entryClientOrderId: "GENTRY_S_156_9_12345678",
    prefix: "GSTOP",
  }),
  "GSTOP_S_156_9_12345678",
  "STOP clientOrderId is deterministic from entry clientOrderId"
);

assert.deepStrictEqual(
  protection.classifyProtectionOutcome({
    takeProfit: { clientOrderId: "GTP_L_156_9_12345678" },
    stop: { clientOrderId: "GSTOP_L_156_9_12345678" },
  }).state,
  protection.GRID_PROTECTION_STATE.FULL,
  "TP+SL ack means full protection"
);
assert.strictEqual(
  protection.classifyProtectionOutcome({
    takeProfit: { clientOrderId: "GTP_L_156_9_12345678" },
    stop: { errorCode: -2021, errorMessage: "Order would immediately trigger." },
  }).state,
  protection.GRID_PROTECTION_STATE.PARTIAL,
  "one protection reject is partial protection critical"
);
assert.strictEqual(
  protection.classifyProtectionOutcome({
    takeProfit: { errorCode: -2021, errorMessage: "Order would immediately trigger." },
    stop: { errorCode: -2021, errorMessage: "Order would immediately trigger." },
  }).state,
  protection.GRID_PROTECTION_STATE.NONE,
  "both rejects is unprotected critical"
);
assert.strictEqual(
  protection.classifyProtectionOutcome({
    takeProfit: { clientOrderId: "GTP_L_156_9_12345678" },
    stop: { clientOrderId: "GSTOP_L_156_9_12345678" },
    oneLegEmergency: true,
  }).state,
  protection.GRID_PROTECTION_STATE.ONE_LEG_PROTECTED,
  "one-leg emergency with TP+SL remains protected emergency, not normal ACTIVE"
);

assert.strictEqual(
  protection.getProtectionImmediateTriggerRisk({
    leg: "LONG",
    boundType: "GTP",
    triggerPrice: 100,
    price: { st: true, bestBid: 101, bestAsk: 101.1, quoteTime: Date.now() },
  }).blocked,
  true,
  "LONG TP at/below current bid would immediately trigger"
);
assert.strictEqual(
  protection.getProtectionImmediateTriggerRisk({
    leg: "SHORT",
    boundType: "GSTOP",
    triggerPrice: 100,
    price: { st: true, bestBid: 100.1, bestAsk: 100.2, quoteTime: Date.now() },
  }).blocked,
  true,
  "SHORT STOP at/below current ask would immediately trigger"
);
assert.strictEqual(
  protection.getProtectionImmediateTriggerRisk({
    leg: "LONG",
    boundType: "GSTOP",
    triggerPrice: 90,
    price: { st: false },
  }).code,
  protection.PROTECTION_REJECTION_CODE.PRICE_SOURCE_STALE,
  "stale price blocks protection placement instead of submitting blindly"
);
assert.strictEqual(
  protection.getProtectionImmediateTriggerRisk({
    leg: "LONG",
    boundType: "GTP",
    triggerPrice: 100,
    price: { st: true, bestBid: 99, bestAsk: 99.1, quoteTime: Date.now() - 60000 },
  }).code,
  protection.PROTECTION_REJECTION_CODE.PRICE_SOURCE_STALE,
  "stale quoteTime blocks protection placement even if bid/ask exists"
);
assert.deepStrictEqual(
  {
    blocked: protection.getProtectionImmediateTriggerRisk({
      leg: "LONG",
      boundType: "GTP",
      triggerPrice: 100,
      price: { st: true, bestBid: 99, bestAsk: 99.1, quoteTime: Date.now(), markPrice: 101, markTime: Date.now() },
    }).blocked,
    source: protection.getProtectionImmediateTriggerRisk({
      leg: "LONG",
      boundType: "GTP",
      triggerPrice: 100,
      price: { st: true, bestBid: 99, bestAsk: 99.1, quoteTime: Date.now(), markPrice: 101, markTime: Date.now() },
    }).source,
  },
  { blocked: true, source: "MARK_PRICE" },
  "MARK_PRICE workingType precheck uses fresh mark price when present"
);

const gridEngineSource = fs.readFileSync(path.resolve(__dirname, "../../grid-engine.js"), "utf8");
const coinSource = fs.readFileSync(path.resolve(__dirname, "../../coin.js"), "utf8");
const canonicalSource = fs.readFileSync(path.resolve(__dirname, "../../canonical-runtime-state.js"), "utf8");
const orderIntentQueueSource = fs.readFileSync(path.resolve(__dirname, "../../order-intent-queue.js"), "utf8");

assert(
  orderIntentQueueSource.includes("const protectionUnitIdentity = normalized.entryOrderId") &&
    orderIntentQueueSource.indexOf("normalized.entryOrderId") <
      orderIntentQueueSource.indexOf("normalized.sourceOrderId", orderIntentQueueSource.indexOf("const protectionUnitIdentity")),
  "GRID_PROTECTION_CREATE intent key must prioritize entryOrderId over source trade/order evidence"
);

for (const snippet of [
  "protectGridOpenLegOrClose",
  "markGridProtectionCriticalState",
  "PAIR_ONE_LEG_PROTECTION_MISSING_CLOSED",
  "PROTECTION_PARTIAL_CRITICAL",
  "PROTECTION_UNPROTECTED_CRITICAL",
  "gridProtectionGuarantee.getProtectionImmediateTriggerRisk",
  "gridPriceSource.requireFreshGridQuote(price)",
  "gridProtectionGuarantee.isProtectionCriticalState(row)",
]) {
  assert.ok(gridEngineSource.includes(snippet), `grid-engine.js should include ${snippet}`);
}

assert.ok(
  coinSource.includes("clientOrderId = null") &&
    coinSource.includes("requestedClientOrderId") &&
    coinSource.includes("immediateTrigger"),
  "coin.js should preserve deterministic protection id and expose -2021 immediate trigger"
);
assert.ok(
  coinSource.includes("GRID_RESERVATION_EXIT_RECOVERY_SKIPPED_OPEN_ALGO_ACTIVE") &&
    coinSource.includes("isReservationOpenAlgoActive") &&
    coinSource.indexOf("isReservationOpenAlgoActive(reservation)") <
      coinSource.indexOf(
        "loadGridExitOrderByReservation",
        coinSource.indexOf("isReservationOpenAlgoActive(reservation)")
      ),
  "active openAlgo protection must skip direct order lookup recovery"
);
const reservationRecoverySource = coinSource.slice(
  coinSource.indexOf("const loadGridReservationOwnedExitExecutionsFromExchange"),
  coinSource.indexOf("exports.recoverGridExitFillFromExchange")
);
assert.ok(
  reservationRecoverySource.indexOf("const recoveryReservations") <
    reservationRecoverySource.indexOf("futuresAllOrders"),
  "active openAlgo protection must be filtered before allOrders/userTrades recovery reads"
);
const truthSyncLoaderSource = coinSource.slice(
  coinSource.indexOf("const loadLiveGridTruthSyncRows"),
  coinSource.indexOf("const canRunGridTruthSync")
);
assert.ok(
  !truthSyncLoaderSource.includes("OR regimeStatus <> 'WAITING_WEBHOOK'"),
  "grid truth-sync candidates must not include disabled terminal rows by regimeStatus alone"
);
assert.ok(
  canonicalSource.includes("GRID_PARTIAL_PROTECTION") &&
    canonicalSource.includes("GRID_UNPROTECTED") &&
    canonicalSource.includes("PAIR_ONE_LEG_PROTECTED") &&
    canonicalSource.includes("gridProtectionCritical"),
  "projection source should keep protection critical states visible"
);

console.log("grid-protection-guarantee-static-test PASS");
