"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const coin = require("../../coin");

const coinSourcePath = path.join(__dirname, "../../coin.js");
const workerSourcePath = path.join(__dirname, "../../order-intent-worker.js");
const coinSource = fs.readFileSync(coinSourcePath, "utf8");
const workerSource = fs.readFileSync(workerSourcePath, "utf8");

assert.strictEqual(
  typeof coin.confirmSignalMarketEntryAfterAccepted,
  "function",
  "coin.confirmSignalMarketEntryAfterAccepted must be exported for SIGNAL_MARKET_ENTRY convergence"
);
assert.strictEqual(
  typeof coin.dispatchSignalProtectionOrdersFromIntent,
  "function",
  "coin.dispatchSignalProtectionOrdersFromIntent must be exported for SIGNAL_PROTECTION_CREATE dispatch"
);

assert(
  workerSource.includes("coin.confirmSignalMarketEntryAfterAccepted"),
  "order-intent-worker must call the Signal entry convergence handler"
);
assert(
  workerSource.includes("coin.dispatchSignalProtectionOrdersFromIntent"),
  "order-intent-worker must call the Signal protection dispatch handler"
);
assert(
  coinSource.includes("entryIntentId") && coinSource.includes("ownerRowId"),
  "Signal protection intent payload must carry parent entryIntentId and ownerRowId"
);
assert(
  coinSource.includes("sendData.orderId") && coinSource.includes("sendData.clientOrderId"),
  "coin.sendEnter must return accepted order identity to the worker"
);
assert(
  coinSource.includes("placeBoundExitOrder"),
  "Signal protection handler must reuse the canonical bound exit order creator"
);

console.log("signal-live-handler-availability-static-test PASS");
process.exit(0);
