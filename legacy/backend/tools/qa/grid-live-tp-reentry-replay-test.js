"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const policy = require("../../grid-reentry-sl-policy");

const gridEngineSource = fs.readFileSync(path.resolve(__dirname, "../../grid-engine.js"), "utf8");

const assertNoAmbiguousOpenOrderOnlyEvidence = () => {
  assert(
    gridEngineSource.includes("RECOVERED_EXIT_REENTRY_DECISION") &&
      gridEngineSource.includes("RECOVERED_TP_REENTRY_INTENT_PENDING"),
    "TP recovery must log the re-entry decision and enqueue result; openOrders-only evidence is not enough"
  );
};

const sideTriggerPrice = (row, leg) =>
  String(leg || "").toUpperCase() === "LONG"
    ? Number(row.longTriggerPrice || row.triggerPrice || 0)
    : Number(row.shortTriggerPrice || row.triggerPrice || 0);

const replayCases = [
  {
    name: "50/50 SHORT TP replay creates SHORT re-entry at shared trigger",
    row: { uid: 156, id: 990212, triggerPrice: 0.083, longTriggerPrice: 0.083, shortTriggerPrice: 0.083 },
    leg: "SHORT",
    recovered: { clientOrderId: "GTP_S_156_990212_74052968", orderId: 16443752995 },
    expectedKind: policy.GRID_EXIT_RECOVERY_KIND.TAKE_PROFIT,
    expectedPrice: 0.083,
    expectedPrefix: "GENTRY_S_156_990212_",
  },
  {
    name: "35/65 LONG TP replay creates LONG re-entry at long trigger",
    row: { uid: 156, id: 990213, triggerPrice: 0.083, longTriggerPrice: 0.0827, shortTriggerPrice: 0.0833 },
    leg: "LONG",
    recovered: { reservationKind: "GRID_TP", clientOrderId: "GTP_L_156_990213_TEST", orderId: 1 },
    expectedKind: policy.GRID_EXIT_RECOVERY_KIND.TAKE_PROFIT,
    expectedPrice: 0.0827,
    expectedPrefix: "GENTRY_L_156_990213_",
  },
  {
    name: "35/65 SHORT TP replay creates SHORT re-entry at short trigger",
    row: { uid: 156, id: 990213, triggerPrice: 0.083, longTriggerPrice: 0.0827, shortTriggerPrice: 0.0833 },
    leg: "SHORT",
    recovered: { recoveredReservationClientOrderIds: ["GTP_S_156_990213_TEST"], orderId: 2 },
    expectedKind: policy.GRID_EXIT_RECOVERY_KIND.TAKE_PROFIT,
    expectedPrice: 0.0833,
    expectedPrefix: "GENTRY_S_156_990213_",
  },
];

for (const item of replayCases) {
  assert.strictEqual(policy.classifyGridExitRecoveryKind(item.recovered), item.expectedKind, item.name);
  assert.strictEqual(sideTriggerPrice(item.row, item.leg), item.expectedPrice, item.name);
  assert(
    policy.buildGridReentryClientOrderId(item.row, item.leg, {
      takeProfitClientOrderId: item.recovered.clientOrderId || item.recovered.recoveredReservationClientOrderIds?.[0],
      orderId: item.recovered.orderId,
    }).startsWith(item.expectedPrefix),
    `${item.name}: re-entry clientOrderId prefix`
  );
}

const stopRecovery = { reservationKind: "GRID_STOP", clientOrderId: "GSTOP_L_156_990212_73992875" };
assert.strictEqual(
  policy.classifyGridExitRecoveryKind(stopRecovery),
  policy.GRID_EXIT_RECOVERY_KIND.STOP,
  "STOP fill replay must be classified as terminal stop"
);
assert.strictEqual(policy.isRecoveredTakeProfit(stopRecovery), false, "STOP fill must not trigger re-entry");
assert.strictEqual(policy.isRecoveredStop(stopRecovery), true, "STOP fill remains terminal");

assert(
  gridEngineSource.includes("const enqueueRecoveredTakeProfitReentryIfAllowed"),
  "grid-engine must have recovered TP re-entry branch"
);
assert(
  gridEngineSource.includes("enqueueLiveReentryIntentAfterTakeProfit("),
  "recovered TP branch must reuse live TP re-entry enqueue helper"
);
assert(
  gridEngineSource.includes("GRID_RECOVERED_TP_REENTRY_INTENT_PENDING"),
  "recovered TP branch must trace pending re-entry intent"
);

assertNoAmbiguousOpenOrderOnlyEvidence();

console.log("grid-live-tp-reentry-replay-test PASS");
