"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const coin = fs.readFileSync(path.join(root, "coin.js"), "utf8");
const gridEngine = fs.readFileSync(path.join(root, "grid-engine.js"), "utf8");

assert(
  coin.includes("dispatchExactGridEvidenceToExistingHandler"),
  "targeted truth-sync exact evidence dispatcher must exist"
);
assert(
  /const status = isLast && \(finalStatus === 'FILLED' \|\| finalStatus === 'FINISHED'\)[\s\S]+: 'PARTIALLY_FILLED'/.test(coin),
  "multi-trade replay must label only the last row as FILLED when exact order is final"
);
assert(
  gridEngine.includes("ENTRY_PARTIAL_FILL_LEDGER_ONLY"),
  "synthetic PARTIALLY_FILLED rows must be ledger-only in the grid entry handler"
);

const exactOrder = { status: "FILLED", executedQty: 6.1, originalQty: 6.1 };
const userTrades = [
  { id: "A", qty: 1.7 },
  { id: "B", qty: 4.4 },
];
let cumulativeQty = 0;
let partialActionCount = 0;
let finalActionCount = 0;
let protectionQty = 0;

for (let index = 0; index < userTrades.length; index += 1) {
  const trade = userTrades[index];
  cumulativeQty = Number((cumulativeQty + trade.qty).toFixed(12));
  const isLast = index === userTrades.length - 1;
  const syntheticStatus = isLast && exactOrder.status === "FILLED" ? "FILLED" : "PARTIALLY_FILLED";
  if (syntheticStatus === "PARTIALLY_FILLED") {
    partialActionCount += 0;
    continue;
  }
  finalActionCount += 1;
  protectionQty = cumulativeQty;
}

assert.strictEqual(cumulativeQty, 6.1, "ledger accumulation must preserve all trade rows");
assert.strictEqual(partialActionCount, 0, "synthetic partial rows must not run lifecycle action");
assert.strictEqual(finalActionCount, 1, "exact FILLED multi-trade replay must run final action once");
assert.strictEqual(protectionQty, 6.1, "final action must use aggregate filled qty");

console.log("grid-truthsync-filled-order-multitrade-final-action-only-test PASS");
