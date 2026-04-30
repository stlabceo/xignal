"use strict";

const assert = require("assert");
const displayState = require("../../order-display-state");
const { writeReportFiles, buildTimestampSlug } = require("./qa-runner");

const scenarios = [];

const runScenario = (scenario, fn) => {
  try {
    const evidence = fn();
    scenarios.push({ scenario, status: "PASS", pass: true, evidence });
  } catch (error) {
    scenarios.push({ scenario, status: "FAIL", pass: false, failures: [error?.message || String(error)] });
  }
};

runScenario("admin expected-ignore lifecycle not abnormal", () => {
  const expectedEvents = [
    "GRID_ACTIVE_IGNORED",
    "NO_MATCHING_STRATEGY",
    "DUPLICATE_FILL_IGNORED",
    "SYSTEM_RESET_READY_SKIPPED_DISABLED",
  ];
  const results = expectedEvents.map((eventCode) =>
    displayState.deriveAdminLifecycleSeverity({ eventCode, severity: "low" })
  );
  results.forEach((state) => {
    assert.strictEqual(state.lifecycleResult, "EXPECTED");
    assert.strictEqual(state.expectedOrAbnormal, "EXPECTED");
    assert.strictEqual(state.isExpectedIgnore, true);
    assert.strictEqual(state.requiresUserAction, false);
  });
  return results.map((state) => ({ event: state.lastOrderIssue.intent, expectedOrAbnormal: state.expectedOrAbnormal }));
});

runScenario("admin physical missing PID without delete audit is critical", () => {
  const state = displayState.deriveAdminLifecycleSeverity({
    actionCode: "PHYSICAL_ROW_ABSENT_NO_DELETE_AUDIT",
    note: "PID row absent and USER_DELETE_STRATEGY audit missing",
  });
  assert.strictEqual(state.lifecycleResult, "CRITICAL");
  assert.strictEqual(state.expectedOrAbnormal, "ABNORMAL");
  assert.strictEqual(state.restoreStatus, "RESTORE_REQUIRED");
  assert.strictEqual(state.requiresUserAction, true);
  return state;
});

runScenario("admin restored PID is no longer active abnormal", () => {
  const state = displayState.deriveAdminLifecycleSeverity({
    restoreStatus: "RESTORED",
    note: "controlled restore completed",
  });
  assert.strictEqual(state.lifecycleResult, "INFO");
  assert.strictEqual(state.expectedOrAbnormal, "EXPECTED");
  assert.strictEqual(state.restoreStatus, "RESTORED");
  assert.strictEqual(state.requiresUserAction, false);
  return state;
});

runScenario("system reset skipped disabled row is not abnormal", () => {
  const state = displayState.deriveAdminLifecycleSeverity({
    actionCode: "SYSTEM_RESET_READY_SKIPPED_DISABLED",
    note: "disabled row, no state change",
  });
  assert.strictEqual(state.lifecycleResult, "EXPECTED");
  assert.strictEqual(state.expectedOrAbnormal, "EXPECTED");
  assert.strictEqual(state.isExpectedIgnore, true);
  return state;
});

runScenario("terminal rejected no-fill remains review", () => {
  const state = displayState.deriveAdminLifecycleSeverity({
    orderStatus: "REJECTED",
    quantity: 10,
    executedQty: 0,
    rejectReason: "synthetic rejected no-fill",
  });
  assert.strictEqual(state.lifecycleResult, "WARN");
  assert.strictEqual(state.expectedOrAbnormal, "REVIEW");
  assert.strictEqual(state.requiresUserAction, false);
  return state;
});

const startedAt = new Date().toISOString();
const finishedAt = new Date().toISOString();
const finalStatus = scenarios.every((item) => item.pass) ? "PASS" : "FAIL";
const report = {
  reportType: "admin-lifecycle-classification-targeted",
  startedAt,
  finishedAt,
  finalStatus,
  scenarioCount: scenarios.length,
  scenarios,
  cleanup: {
    afterCleanup: 0,
    note: "Pure display classification replay; no DB rows are created.",
  },
};
const written = writeReportFiles({
  reportType: "qa-admin-lifecycle-classification-targeted",
  runId: `admin-lifecycle-${buildTimestampSlug(startedAt)}`,
  report,
});
console.log(JSON.stringify({
  finalStatus,
  scenarioCount: scenarios.length,
  cleanup: "afterCleanup=0",
  reports: written,
}, null, 2));
if (finalStatus !== "PASS") {
  process.exitCode = 1;
}
