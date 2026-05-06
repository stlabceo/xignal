"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const pair = require("../../grid-pair-atomicity");

const row = {
  uid: 156,
  id: 9,
  symbol: "PUMPUSDT",
  bunbong: "1H",
  regimeReceivedAt: "2026-05-06 08:51:00",
  supportPrice: "0.00410000",
  resistancePrice: "0.00490000",
  triggerPrice: "0.00450000",
};

const longId = pair.buildGridPairClientOrderId(row, "LONG");
const shortId = pair.buildGridPairClientOrderId(row, "SHORT");
assert.match(longId, /^GENTRY_L_156_9_\d{8}$/);
assert.match(shortId, /^GENTRY_S_156_9_\d{8}$/);
assert.strictEqual(
  longId.split("_").pop(),
  shortId.split("_").pop(),
  "LONG/SHORT share one deterministic pair intent suffix"
);
assert.strictEqual(
  pair.buildGridPairClientOrderId(row, "LONG"),
  longId,
  "same pair intent reuses the same LONG clientOrderId"
);
assert.notStrictEqual(
  pair.buildGridPairClientOrderId({ ...row, regimeReceivedAt: "2026-05-06 08:52:00" }, "LONG"),
  longId,
  "new pair intent receives a different suffix"
);

assert.strictEqual(pair.isAmbiguousWriteResult({ errorCode: -1021 }), true, "-1021 requires read-after-write verification");
assert.strictEqual(pair.isAmbiguousWriteResult({ errorMessage: "dispatch timeout" }), true, "timeout requires read-after-write verification");
assert.strictEqual(pair.isDuplicateOrderResult({ errorMessage: "Duplicate order sent." }), true, "duplicate response maps to existing clientOrderId");
assert.strictEqual(pair.shouldVerifyAfterWriteResult({ requestedClientOrderId: longId, errorCode: -1021 }), true);
assert.strictEqual(pair.isOrderActivePending({ status: "NEW", executedQty: "0" }), true);
assert.strictEqual(pair.isOrderFilledOrPartiallyFilled({ status: "PARTIALLY_FILLED", executedQty: "1" }), true);
assert.strictEqual(pair.isOrderTerminalCanceled({ status: "CANCELED" }), true);
assert.strictEqual(pair.hasAnyGridEntryOrderRef({ longEntryOrderId: longId }), true);
assert.strictEqual(pair.isPairArmDefectState({ regimeStatus: "PAIR_ROLLBACK_PENDING" }), true);

assert.strictEqual(
  pair.classifyGridPairArmOutcome({
    LONG: { ok: true },
    SHORT: { ok: true },
  }),
  "PAIR_ARMED",
  "both acked means pair armed"
);
assert.strictEqual(
  pair.classifyGridPairArmOutcome({
    LONG: { ok: true, exchangeOrder: { status: "NEW", executedQty: "0" } },
    SHORT: { ok: false, errorCode: -2019 },
  }),
  pair.GRID_PAIR_STATE.ROLLBACK_PENDING,
  "one success and one non-time failure requires rollback, not normal ACTIVE"
);
assert.strictEqual(
  pair.classifyGridPairArmOutcome({
    LONG: { ok: true, exchangeOrder: { status: "FILLED", executedQty: "5" } },
    SHORT: { ok: false, errorCode: -1021 },
  }),
  pair.GRID_PAIR_STATE.ONE_LEG_FILLED,
  "successful leg filled before sibling failure becomes emergency state"
);
assert.strictEqual(
  pair.classifyGridPairArmOutcome({
    LONG: { ok: false },
    SHORT: { ok: false },
  }),
  pair.GRID_PAIR_STATE.FAILED,
  "both failed is pair arm failed"
);

const gridEngineSource = fs.readFileSync(path.resolve(__dirname, "../../grid-engine.js"), "utf8");
const coinSource = fs.readFileSync(path.resolve(__dirname, "../../coin.js"), "utf8");
const canonicalSource = fs.readFileSync(path.resolve(__dirname, "../../canonical-runtime-state.js"), "utf8");

for (const snippet of [
  "armInitialLiveEntryPair",
  "handleGridPairArmFailure",
  "rollbackGridPairSuccessfulLeg",
  "gridPairAtomicity.buildGridPairClientOrderId(current, leg)",
  "resolveGridPairPlacementResult",
  "findGridEntryOrderForLeg",
  "PAIR_ARM_FAILED",
  "PAIR_ROLLBACK_PENDING",
  "PAIR_ONE_LEG_FILLED",
  "cancelAllGridOrders(\"LIVE\", rowWithOrder",
  "gridPairAtomicity.hasAnyGridEntryOrderRef(refreshed)",
  "gridPairAtomicity.isPairArmDefectState(row)",
]) {
  assert.ok(gridEngineSource.includes(snippet), `grid-engine.js should include ${snippet}`);
}

assert.ok(
  coinSource.includes("clientOrderId = null") &&
    coinSource.includes("requestedClientOrderId") &&
    coinSource.includes("exports.findGridEntryOrder"),
  "coin.js should expose deterministic entry clientOrderId and read-after-write lookup"
);
assert.ok(
  canonicalSource.includes("PAIR_ARM_FAILED") &&
    canonicalSource.includes("PAIR_ROLLBACK_PENDING") &&
    canonicalSource.includes("PAIR_ONE_LEG_FILLED"),
  "canonical runtime state should keep pair defect states visible"
);

console.log("grid-pair-atomicity-static-test PASS");
