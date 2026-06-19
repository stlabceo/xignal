"use strict";

const assert = require("assert");

const cancelVerificationPolicy = require("../../cancel-verification-policy");
const gridEngine = require("../../grid-engine");
const gridIntentHandlerGuards = require("../../grid-intent-handler-guards");
const orderIntentWorker = require("../../order-intent-worker");

let tests = 0;
const check = (name, fn) => {
  fn();
  tests += 1;
  console.log(`[PASS] ${name}`);
};

check("TP fill cleanup targets sibling STOP protection only", () => {
  const options = gridEngine.__qa.buildSiblingProtectionCancelOptions({
    leg: "SHORT",
    filledClientOrderId: "GTP_S_156_990223_11111111",
    activeReservations: [
      { reservationKind: "GRID_TP", clientOrderId: "GTP_S_156_990223_11111111", actualOrderId: "tp-order" },
      { reservationKind: "GRID_STOP", clientOrderId: "GSTOP_S_156_990223_22222222", actualOrderId: "stop-order" },
      { reservationKind: "GRID_ENTRY", clientOrderId: "GENTRY_S_156_990223_33333333", actualOrderId: "entry-order" },
    ],
  });

  assert.strictEqual(options.includeEntries, false);
  assert.strictEqual(options.includeExits, true);
  assert.strictEqual(options.targetType, "PROTECTION");
  assert.strictEqual(options.targetClientOrderId, "GSTOP_S_156_990223_22222222");
  assert.strictEqual(options.targetOrderId, "stop-order");
  assert.deepStrictEqual(
    options.protectionOrderRefs.map((ref) => ref.clientOrderId),
    ["GSTOP_S_156_990223_22222222"]
  );
});

check("STOP fill cleanup targets sibling TP protection only", () => {
  const options = gridEngine.__qa.buildSiblingProtectionCancelOptions({
    leg: "LONG",
    filledClientOrderId: "GSTOP_L_156_990223_11111111",
    activeReservations: [
      { reservationKind: "GRID_STOP", clientOrderId: "GSTOP_L_156_990223_11111111", actualOrderId: "stop-order" },
      { reservationKind: "GRID_TP", clientOrderId: "GTP_L_156_990223_22222222", actualOrderId: "tp-order" },
    ],
  });

  assert.strictEqual(options.targetClientOrderId, "GTP_L_156_990223_22222222");
  assert.deepStrictEqual(options.protectionOrderRefs.map((ref) => ref.kind), ["TP"]);
});

check("protection cancel verification ignores entry and manual orders", () => {
  const filtered = orderIntentWorker.__qa.filterGridCancelOpenOrdersByScope([
    { clientOrderId: "GENTRY_S_156_990223_11111111" },
    { clientOrderId: "GMANUAL_S_156_990223_22222222" },
    { clientOrderId: "GTP_S_156_990223_33333333" },
    { clientOrderId: "GSTOP_S_156_990223_44444444" },
  ], {
    includeEntries: false,
    includeExits: true,
    targetType: "PROTECTION",
  });

  assert.deepStrictEqual(
    filtered.map((order) => order.clientOrderId),
    ["GTP_S_156_990223_33333333", "GSTOP_S_156_990223_44444444"]
  );
});

check("protection-only cleanup does not project whole regime cancel state", () => {
  assert.strictEqual(
    orderIntentWorker.__qa.isGridProtectionOnlyCancelProjection({
      targetType: "PROTECTION",
      includeEntries: false,
      includeExits: true,
      reason: "GRID_TP_SIBLING_PROTECTION_CLEANUP",
    }),
    true
  );
  assert.strictEqual(
    orderIntentWorker.__qa.isGridProtectionOnlyCancelProjection({
      targetType: "ENTRY",
      includeEntries: true,
      includeExits: false,
    }),
    false
  );
});

check("sibling absent from exchange open list is verified gone", () => {
  const result = cancelVerificationPolicy.classifyCancelVerification({
    cancelResponse: { ok: true, canceledCount: 0 },
    readResult: {
      openOrders: [
        { clientOrderId: "GENTRY_S_156_990223_11111111", status: "NEW" },
        { clientOrderId: "GTP_S_156_990222_33333333", status: "NEW" },
      ],
    },
    target: { targetClientOrderId: "GSTOP_S_156_990223_22222222" },
  });

  assert.strictEqual(result.terminal, true);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "CANCEL_VERIFIED_GONE");
});

check("terminal gone cleanup with no local refs is a verified no-op", () => {
  const verification = cancelVerificationPolicy.classifyCancelVerification({
    cancelResponse: { ok: true, canceledCount: 0 },
    readResult: {
      openOrders: [],
    },
    target: {},
  });
  const diagnostic = gridIntentHandlerGuards.buildGridCancelScopeDiagnostic({
    payload: {
      targetType: "PROTECTION",
      includeEntries: false,
      includeExits: true,
      protectionOrderRefs: [],
    },
    target: {},
    cancelResponse: { ok: true, canceledCount: 0 },
    verification,
  });

  assert.strictEqual(verification.terminal, true);
  assert.strictEqual(verification.ok, true);
  assert.strictEqual(diagnostic.noopReason, "GRID_CANCEL_VERIFIED_GONE_NOOP");
  assert.strictEqual(diagnostic.coverageIssue, null);
});

check("stale cleanup read stays verify pending, not no-local-ref blocked", () => {
  const verification = cancelVerificationPolicy.classifyCancelVerification({
    cancelResponse: { ok: true, canceledCount: 0 },
    readResult: {
      stale: true,
    },
    target: {},
    staleRead: true,
  });
  const diagnostic = gridIntentHandlerGuards.buildGridCancelScopeDiagnostic({
    payload: {
      targetType: "PROTECTION",
      includeEntries: false,
      includeExits: true,
      protectionOrderRefs: [],
    },
    target: {},
    cancelResponse: { ok: true, canceledCount: 0 },
    verification,
  });
  const reason = verification.ok && verification.terminal
    ? (diagnostic.noopReason || verification.reason)
    : (verification.reason || diagnostic.noopReason);

  assert.strictEqual(verification.terminal, false);
  assert.strictEqual(verification.ok, false);
  assert.strictEqual(reason, "CANCEL_VERIFY_STALE_READ");
});

check("sibling still open remains blocked candidate", () => {
  const result = cancelVerificationPolicy.classifyCancelVerification({
    cancelResponse: { ok: true, canceledCount: 0 },
    readResult: {
      openOrders: [
        { clientOrderId: "GSTOP_S_156_990223_22222222", status: "NEW" },
      ],
    },
    target: { targetClientOrderId: "GSTOP_S_156_990223_22222222" },
  });

  assert.strictEqual(result.terminal, false);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "CANCEL_ACTIVE_ORDER_REMAINS");
});

check("worker projection patch preserves side trigger and box context", () => {
  const patch = orderIntentWorker.__qa.buildGridProjectionContextPatch({
    action: "GRID_REENTRY_CREATE",
    strategySignal: "NY_BOX_GRID_35_65",
    symbol: "AVAXUSDT.P",
    timeframe: "15MIN",
    supportPrice: 6.84,
    resistancePrice: 7.02,
    payloadTriggerPrice: 6.93,
    longTriggerPrice: 6.903,
    shortTriggerPrice: 6.957,
    triggerProfile: "35_65",
    gridRegimeKey: "GRIDREGIME|v1|NY_BOX_GRID_35_65|AVAXUSDT.P|15MIN|6.84|7.02|6.93|2026-06-17T00:00:00",
  });
  const restored = JSON.parse(patch.lastWebhookPayloadJson);

  assert.strictEqual(patch.supportPrice, 6.84);
  assert.strictEqual(patch.resistancePrice, 7.02);
  assert.strictEqual(patch.triggerPrice, 6.93);
  assert.strictEqual(restored.longTriggerPrice, 6.903);
  assert.strictEqual(restored.shortTriggerPrice, 6.957);
  assert.strictEqual(restored.triggerProfile, "35_65");
});

console.log(JSON.stringify({ ok: true, tests, dbMutation: 0, binanceWrite: 0 }, null, 2));
setTimeout(() => process.exit(0), 100);
