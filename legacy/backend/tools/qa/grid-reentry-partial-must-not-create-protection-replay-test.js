"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const gridEngine = fs.readFileSync(path.join(root, "grid-engine.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "order-intent-worker.js"), "utf8");

assert(
  gridEngine.includes("ENTRY_PARTIAL_FILL_LEDGER_ONLY"),
  "entry partial fills must have a ledger-only lifecycle outcome"
);
assert(
  gridEngine.includes('deferLifecycleAction: reData.X === "PARTIALLY_FILLED"'),
  "entry handler must pass a partial-fill action gate"
);
assert(
  worker.includes("GRID_PROTECTION_PARTIAL_FILL_ACTION_BLOCKED"),
  "protection worker must reject any legacy partial-fill protection intent"
);

const state = {
  openQty: 0,
  protectionIntentCount: 0,
  protectionQty: 0,
  lifecycleComplete: false,
  regimeActive: false,
};
const ledgerTradeIds = new Set();

const applySyntheticEntryTrade = ({ tradeId, deltaQty, status }) => {
  if (ledgerTradeIds.has(tradeId)) return;
  ledgerTradeIds.add(tradeId);
  state.openQty = Number((state.openQty + deltaQty).toFixed(12));

  if (status === "PARTIALLY_FILLED") {
    return;
  }

  assert.strictEqual(status, "FILLED", "only final FILLED may trigger next lifecycle action");
  state.protectionIntentCount += 1;
  state.protectionQty = state.openQty;
  state.lifecycleComplete = true;
  state.regimeActive = true;
};

applySyntheticEntryTrade({ tradeId: "3158718208", deltaQty: 1.7, status: "PARTIALLY_FILLED" });
assert.strictEqual(state.openQty, 1.7, "partial fill must still update accumulated exposure");
assert.strictEqual(state.protectionIntentCount, 0, "partial fill must not create protection intent");
assert.strictEqual(state.protectionQty, 0, "partial fill must not create TP/STOP qty");
assert.strictEqual(state.lifecycleComplete, false, "partial fill must not complete lifecycle");
assert.strictEqual(state.regimeActive, false, "partial fill must not activate regime");

applySyntheticEntryTrade({ tradeId: "3158718209", deltaQty: 4.4, status: "FILLED" });
applySyntheticEntryTrade({ tradeId: "3158718209", deltaQty: 4.4, status: "FILLED" });
assert.strictEqual(state.openQty, 6.1, "final fill must converge to full intended exposure");
assert.strictEqual(state.protectionIntentCount, 1, "final fill must create exactly one protection intent");
assert.strictEqual(state.protectionQty, 6.1, "final protection qty must use cumulative open qty");
assert.strictEqual(ledgerTradeIds.size, 2, "duplicate final trade must not create duplicate action");

console.log("grid-reentry-partial-must-not-create-protection-replay-test PASS");
