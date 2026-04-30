"use strict";

const assert = require("assert");
const displayState = require("../../order-display-state");

const scenarios = [];

const runScenario = (name, fn) => {
  try {
    fn();
    scenarios.push({ name, status: "PASS" });
  } catch (error) {
    scenarios.push({ name, status: "FAIL", error: error?.message || String(error) });
  }
};

runScenario("expected ignore classification", () => {
  const state = displayState.deriveOrderTerminalDisplayState({
    eventCode: "NO_MATCHING_STRATEGY",
    severity: "low",
  });
  assert.strictEqual(state.lifecycleResult, "EXPECTED");
  assert.strictEqual(state.expectedOrAbnormal, "EXPECTED");
  assert.strictEqual(state.isExpectedIgnore, true);
  assert.strictEqual(state.requiresUserAction, false);
});

runScenario("critical missing row classification", () => {
  const state = displayState.classifyStrategyControlEvent({
    actionCode: "PHYSICAL_ROW_ABSENT_NO_DELETE_AUDIT",
    note: "missing production row without user delete audit",
  });
  assert.strictEqual(state.lifecycleResult, "CRITICAL");
  assert.strictEqual(state.expectedOrAbnormal, "ABNORMAL");
  assert.strictEqual(state.restoreStatus, "RESTORE_REQUIRED");
  assert.strictEqual(state.systemAction, "CONTROLLED_RESTORE_REQUIRED");
});

runScenario("restored row classification", () => {
  const state = displayState.classifyRestoreState({
    restoreStatus: "RESTORED",
    note: "controlled restore completed",
  });
  assert.strictEqual(state.lifecycleResult, "INFO");
  assert.strictEqual(state.expectedOrAbnormal, "EXPECTED");
  assert.strictEqual(state.restoreStatus, "RESTORED");
  assert.strictEqual(state.systemAction, "RESTORED");
});

runScenario("terminal no-fill rejected is review not abnormal", () => {
  const state = displayState.deriveOrderTerminalDisplayState({
    orderStatus: "REJECTED",
    quantity: 10,
    executedQty: 0,
  });
  assert.strictEqual(state.orderDisplayState, "TERMINAL_NO_FILL");
  assert.strictEqual(state.lifecycleResult, "WARN");
  assert.strictEqual(state.expectedOrAbnormal, "REVIEW");
  assert.strictEqual(state.requiresUserAction, false);
});

runScenario("terminal with executed qty is critical", () => {
  const state = displayState.deriveOrderTerminalDisplayState({
    orderStatus: "EXPIRED_IN_MATCH",
    quantity: 10,
    executedQty: 2,
  });
  assert.strictEqual(state.orderDisplayState, "PARTIAL_TERMINAL_WITH_EXPOSURE");
  assert.strictEqual(state.lifecycleResult, "CRITICAL");
  assert.strictEqual(state.expectedOrAbnormal, "ABNORMAL");
  assert.strictEqual(state.requiresUserAction, true);
});

runScenario("cleanup marker guard is expected", () => {
  const state = displayState.classifyCleanupEvent({
    guard: "QA_MARKER_REQUIRED",
    note: "non-QA production row skipped",
  });
  assert.strictEqual(state.lifecycleResult, "EXPECTED");
  assert.strictEqual(state.expectedOrAbnormal, "EXPECTED");
  assert.strictEqual(state.cleanupGuardReason, "QA_MARKER_REQUIRED");
});

runScenario("user display restored OFF row", () => {
  const label = displayState.deriveUserDisplayStatus({
    enabled: "N",
    status: "READY",
    r_qty: 0,
    restoreStatus: "RESTORED",
  });
  assert.strictEqual(label, "대기중 / OFF");
});

const finalStatus = scenarios.every((scenario) => scenario.status === "PASS") ? "PASS" : "FAIL";
console.log(JSON.stringify({ finalStatus, scenarioCount: scenarios.length, scenarios }, null, 2));
if (finalStatus !== "PASS") {
  process.exitCode = 1;
}
