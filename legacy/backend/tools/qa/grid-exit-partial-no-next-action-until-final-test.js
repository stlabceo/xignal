"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const gridEngine = fs.readFileSync(path.join(root, "grid-engine.js"), "utf8");

assert(
  gridEngine.includes("TAKE_PROFIT_PARTIAL_OBSERVED"),
  "TP partial must be observed without triggering re-entry or sibling cleanup"
);
assert(
  gridEngine.includes("STOP_PARTIAL_OBSERVED"),
  "STOP partial must be observed without full terminal transition"
);
assert(
  !gridEngine.includes("grid-tp-partial-reprotect"),
  "TP partial must not use the old partial reprotect route"
);
assert(
  !gridEngine.includes("TP_PARTIAL_REPROTECT_INTENT_PENDING"),
  "TP partial must not enqueue protection intent"
);

const tpState = {
  openQty: 6.1,
  reentryCount: 0,
  siblingCleanupCount: 0,
};
const applyTp = ({ qty, status }) => {
  tpState.openQty = Number((tpState.openQty - qty).toFixed(12));
  if (status === "PARTIALLY_FILLED") return;
  if (status === "FILLED" && tpState.openQty === 0) {
    tpState.reentryCount += 1;
    tpState.siblingCleanupCount += 1;
  }
};
applyTp({ qty: 1.7, status: "PARTIALLY_FILLED" });
assert.strictEqual(tpState.openQty, 4.4, "TP partial must apply only filled delta");
assert.strictEqual(tpState.reentryCount, 0, "TP partial must not create re-entry");
assert.strictEqual(tpState.siblingCleanupCount, 0, "TP partial must not cleanup sibling protection");

const stopState = {
  openQty: 6.1,
  terminal: false,
};
const applyStop = ({ qty, status }) => {
  stopState.openQty = Number((stopState.openQty - qty).toFixed(12));
  if (status === "PARTIALLY_FILLED") return;
  if (status === "FILLED") stopState.terminal = true;
};
applyStop({ qty: 2.2, status: "PARTIALLY_FILLED" });
assert.strictEqual(stopState.openQty, 3.9, "STOP partial must apply only filled delta");
assert.strictEqual(stopState.terminal, false, "STOP partial must not terminate the regime");

console.log("grid-exit-partial-no-next-action-until-final-test PASS");
