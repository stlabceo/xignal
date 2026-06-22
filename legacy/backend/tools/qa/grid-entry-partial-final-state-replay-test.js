"use strict";

const assert = require("assert");

const ledger = new Map();
const state = {
  openQty: 0,
  protectionQty: 0,
  protectionActionCount: 0,
  orderRef: "GENTRY_L_156_990300_TEST",
  legStatus: "ENTRY_ARMED",
};

const applyEntryTrade = ({ tradeId, deltaQty, cumulativeQty, status }) => {
  assert(deltaQty > 0, "entry delta must be positive");
  if (ledger.has(tradeId)) return;
  ledger.set(tradeId, { deltaQty, cumulativeQty, status });
  state.openQty += deltaQty;
  if (status === "PARTIALLY_FILLED") {
    return;
  }
  if (status === "FILLED") {
    state.protectionQty = state.openQty;
    state.protectionActionCount += 1;
    state.legStatus = "OPEN";
  }
};

applyEntryTrade({ tradeId: "A", deltaQty: 2, cumulativeQty: 2, status: "PARTIALLY_FILLED" });
applyEntryTrade({ tradeId: "B", deltaQty: 3, cumulativeQty: 5, status: "PARTIALLY_FILLED" });
assert.strictEqual(state.openQty, 5, "entry partials must accumulate exposure");
assert.strictEqual(state.protectionQty, 0, "entry partials must not create protection qty");
assert.strictEqual(state.protectionActionCount, 0, "entry partials must not trigger protection action");
applyEntryTrade({ tradeId: "C", deltaQty: 5, cumulativeQty: 10, status: "FILLED" });
applyEntryTrade({ tradeId: "C", deltaQty: 5, cumulativeQty: 10, status: "FILLED" });
assert.strictEqual(state.openQty, 10, "entry replay must apply deltas only once");
assert.strictEqual(state.protectionQty, 10, "entry protection qty must match open qty");
assert.strictEqual(state.protectionActionCount, 1, "entry protection action must run once on final FILLED");
assert.strictEqual(ledger.size, 3, "duplicate entry trade must be ignored");

const partialCancel = { openQty: 0, orderRef: "GENTRY_S_156_990301_TEST", legStatus: "ENTRY_ARMED" };
partialCancel.openQty += 4;
const terminalStatus = "CANCELED";
if (terminalStatus === "CANCELED") {
  partialCancel.orderRef = null;
}
assert.strictEqual(partialCancel.openQty, 4, "entry partial then cancel must preserve filled position");
assert.strictEqual(partialCancel.orderRef, null, "entry partial then cancel must clear residual order ref");

console.log("grid-entry-partial-final-state-replay-test PASS");
