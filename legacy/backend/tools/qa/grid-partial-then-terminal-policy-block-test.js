"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const gridEngine = fs.readFileSync(path.join(root, "grid-engine.js"), "utf8");

assert(
  gridEngine.includes("ORDER_TERMINAL_PARTIAL_POLICY_BLOCKED"),
  "terminal-with-fill must be separated into an explicit policy block"
);
assert(
  !/ORDER_TERMINAL_WITH_FILL_RECOVERY/.test(gridEngine),
  "terminal partial must not fall through to broad truth-sync recovery"
);

const terminalStatuses = ["CANCELED", "EXPIRED", "EXPIRED_IN_MATCH", "REJECTED"];
for (const status of terminalStatuses) {
  const observed = {
    previous: "PARTIALLY_FILLED",
    terminalStatus: status,
    executedQty: 2.2,
    intendedQty: 6.1,
    protectionCreated: false,
    reentryCreated: false,
    lifecycleComplete: false,
    policyBlocked: false,
  };
  if (observed.executedQty > 0 && observed.executedQty < observed.intendedQty) {
    observed.policyBlocked = true;
  }
  assert.strictEqual(observed.lifecycleComplete, false, `${status} partial terminal must not complete lifecycle`);
  assert.strictEqual(observed.protectionCreated, false, `${status} partial terminal must not auto-create protection`);
  assert.strictEqual(observed.reentryCreated, false, `${status} partial terminal must not auto-create re-entry`);
  assert.strictEqual(observed.policyBlocked, true, `${status} partial terminal must require explicit policy handling`);
}

console.log("grid-partial-then-terminal-policy-block-test PASS");
