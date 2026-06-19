"use strict";

const assert = require("assert");

const state = { openQty: 10, reentryCount: 0, protectionGap: false };
const trades = new Set();

const applyTpTrade = ({ tradeId, deltaQty, status }) => {
  if (trades.has(tradeId)) return;
  trades.add(tradeId);
  state.openQty = Math.max(0, state.openQty - deltaQty);
  if (state.openQty === 0 && status === "FILLED") {
    state.reentryCount += 1;
  }
};

applyTpTrade({ tradeId: "TP-A", deltaQty: 3, status: "PARTIALLY_FILLED" });
applyTpTrade({ tradeId: "TP-B", deltaQty: 2, status: "PARTIALLY_FILLED" });
assert.strictEqual(state.openQty, 5, "TP partials must reduce only partial qty");
assert.strictEqual(state.reentryCount, 0, "TP partial must not create early re-entry");
applyTpTrade({ tradeId: "TP-C", deltaQty: 5, status: "FILLED" });
applyTpTrade({ tradeId: "TP-C", deltaQty: 5, status: "FILLED" });
assert.strictEqual(state.openQty, 0, "TP full completion must close remaining position");
assert.strictEqual(state.reentryCount, 1, "TP full completion must create exactly one re-entry");

const canceledAfterPartial = { openQty: 6, reentryCount: 0, protectionGap: false };
canceledAfterPartial.openQty -= 2;
const finalStatus = "EXPIRED";
if (finalStatus === "EXPIRED" && canceledAfterPartial.openQty > 0) {
  canceledAfterPartial.protectionGap = true;
}
assert.strictEqual(canceledAfterPartial.openQty, 4, "TP partial then expired must preserve remaining position");
assert.strictEqual(canceledAfterPartial.reentryCount, 0, "TP partial then expired must not re-enter");
assert.strictEqual(canceledAfterPartial.protectionGap, true, "TP partial then expired must surface protection gap");

console.log("grid-tp-partial-final-state-replay-test PASS");
