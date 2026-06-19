"use strict";

const assert = require("assert");
const classifier = require("../../grid-binance-status-classifier");

const expectedOrderStatuses = [
  "NEW",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
  "EXPIRED_IN_MATCH",
];

const expectedExecutionTypes = [
  "NEW",
  "CANCELED",
  "CALCULATED",
  "EXPIRED",
  "TRADE",
  "AMENDMENT",
];

const expectedAlgoStatuses = [
  "NEW",
  "CANCELED",
  "TRIGGERING",
  "TRIGGERED",
  "FINISHED",
  "REJECTED",
  "EXPIRED",
];

assert.deepStrictEqual(classifier.ORDER_STATUSES, expectedOrderStatuses);
assert.deepStrictEqual(classifier.ORDER_TRADE_EXECUTION_TYPES, expectedExecutionTypes);
assert.deepStrictEqual(classifier.ALGO_ORDER_STATUSES, expectedAlgoStatuses);

let result = classifier.classifyOrderTradeUpdate({
  e: "ORDER_TRADE_UPDATE",
  o: { x: "TRADE", X: "PARTIALLY_FILLED", l: "3.4", z: "3.4", q: "6.8" },
});
assert.strictEqual(result.canonicalAction, "APPLY_PARTIAL_FILL");
assert.strictEqual(result.hasFillEvidence, true);
assert.strictEqual(result.isPartial, true);

result = classifier.classifyOrderTradeUpdate({
  e: "ORDER_TRADE_UPDATE",
  o: { x: "TRADE", X: "FILLED", l: "6.8", z: "6.8", q: "6.8" },
});
assert.strictEqual(result.canonicalAction, "APPLY_FULL_FILL");
assert.strictEqual(result.hasFillEvidence, true);

for (const status of ["CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"]) {
  result = classifier.classifyOrderTradeUpdate({
    e: "ORDER_TRADE_UPDATE",
    o: { x: status === "CANCELED" ? "CANCELED" : "EXPIRED", X: status, l: "0", z: "0", q: "6.8" },
  });
  assert.strictEqual(result.canonicalAction, "TERMINALIZE_NO_FILL", `${status} without fill must not apply ledger fill`);
  assert.strictEqual(result.hasFillEvidence, false, `${status} without fill must not imply fill evidence`);
}

result = classifier.classifyOrderTradeUpdate({
  e: "ORDER_TRADE_UPDATE",
  o: { x: "CANCELED", X: "CANCELED", l: "0", z: "3.4", q: "6.8" },
});
assert.strictEqual(result.canonicalAction, "APPLY_FILL_THEN_TERMINALIZE_REMAINDER");
assert.strictEqual(result.isPartialTerminal, true);

result = classifier.classifyAlgoUpdate({
  e: "ALGO_UPDATE",
  o: { X: "TRIGGERING", aq: "0.00000" },
});
assert.strictEqual(result.canonicalAction, "OBSERVE_TRIGGER_PROGRESS");
assert.strictEqual(result.fillEvidence, false);

result = classifier.classifyAlgoUpdate({
  e: "ALGO_UPDATE",
  o: { X: "TRIGGERED", aq: "0.00000" },
});
assert.strictEqual(result.canonicalAction, "OBSERVE_TRIGGER_PROGRESS");
assert.strictEqual(result.fillEvidence, false);

result = classifier.classifyAlgoUpdate({
  e: "ALGO_UPDATE",
  o: { X: "FINISHED", aq: "6.8" },
});
assert.strictEqual(result.canonicalAction, "VERIFY_MATCHING_ENGINE_RESULT");
assert.strictEqual(result.fillEvidence, false);
assert.strictEqual(result.requiresOrderTradeUpdateOrRestEvidence, true);

for (const status of ["CANCELED", "REJECTED", "EXPIRED"]) {
  result = classifier.classifyAlgoUpdate({
    e: "ALGO_UPDATE",
    o: { X: status, aq: "0.00000" },
  });
  assert.strictEqual(result.canonicalAction, "TERMINALIZE_RESERVATION_NO_FILL", `${status} must be reservation terminal without fill evidence`);
  assert.strictEqual(result.fillEvidence, false);
}

result = classifier.classifyConditionalOrderTriggerReject({
  e: "CONDITIONAL_ORDER_TRIGGER_REJECT",
});
assert.strictEqual(result.canonicalAction, "TERMINALIZE_REJECTED_PROTECTION_ORDER");
assert.strictEqual(result.fillEvidence, false);
assert.strictEqual(result.strategyTerminal, false);
assert.strictEqual(result.reservationTerminal, true);

console.log("grid-binance-status-classifier-static-test PASS");
setTimeout(() => process.exit(0), 100);
