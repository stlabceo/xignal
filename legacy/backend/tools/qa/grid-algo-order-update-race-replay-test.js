"use strict";

const assert = require("assert");

const state = { reservation: "ACTIVE", fillCount: 0, ledgerQty: 0, strategyTerminal: false, protectionGap: false };
const seenTrades = new Set();

const onAlgoUpdate = (status) => {
  if (status === "TRIGGERING" || status === "TRIGGERED" || status === "FINISHED") {
    return "OBSERVE_ONLY";
  }
  if (status === "CANCELED" || status === "EXPIRED" || status === "REJECTED") {
    state.reservation = status;
    return "TERMINAL_NO_FILL";
  }
  return "NOOP";
};

assert.strictEqual(onAlgoUpdate("TRIGGERING"), "OBSERVE_ONLY");
assert.strictEqual(onAlgoUpdate("TRIGGERED"), "OBSERVE_ONLY");
assert.strictEqual(onAlgoUpdate("FINISHED"), "OBSERVE_ONLY");
assert.strictEqual(state.fillCount, 0, "ALGO FINISHED alone must not write fill ledger");

const onOrderTradeUpdate = ({ tradeId, status, qty }) => {
  if (seenTrades.has(tradeId)) return;
  seenTrades.add(tradeId);
  if (status === "FILLED" || status === "PARTIALLY_FILLED") {
    state.fillCount += 1;
    state.ledgerQty += qty;
    state.reservation = status === "FILLED" ? "FILLED" : "PARTIAL";
  } else if (status === "CANCELED") {
    state.reservation = "CANCELED";
  }
};

onOrderTradeUpdate({ tradeId: "TRADE-1", status: "FILLED", qty: 10 });
onOrderTradeUpdate({ tradeId: "TRADE-1", status: "FILLED", qty: 10 });
assert.strictEqual(state.fillCount, 1, "late ORDER_TRADE_UPDATE must apply fill once");
assert.strictEqual(state.ledgerQty, 10, "ledger qty must not duplicate after ALGO FINISHED");

const rejectState = { reservation: "ACTIVE", ledgerQty: 0, strategyTerminal: false, protectionGap: false };
const onConditionalReject = (positionOpen) => {
  rejectState.reservation = "REJECTED";
  if (positionOpen) {
    rejectState.protectionGap = true;
  }
};
onConditionalReject(true);
assert.strictEqual(rejectState.ledgerQty, 0, "CONDITIONAL_ORDER_TRIGGER_REJECT must not write fill ledger");
assert.strictEqual(rejectState.strategyTerminal, false, "CONDITIONAL_ORDER_TRIGGER_REJECT must not end strategy");
assert.strictEqual(rejectState.protectionGap, true, "open position after reject must surface protection gap");

console.log("grid-algo-order-update-race-replay-test PASS");
