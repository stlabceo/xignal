"use strict";

const assert = require("assert");
const protection = require("../../grid-protection-guarantee");

const tp = { clientOrderId: "GTP_L_156_5_22222222" };
const sl = { clientOrderId: "GSTOP_L_156_5_22222222" };
const reject2021 = {
  errorCode: -2021,
  errorMessage: "Order would immediately trigger.",
  immediateTrigger: true,
};

const scenarios = [
  {
    name: "LONG fill then TP+SL success",
    actual: protection.classifyProtectionOutcome({ takeProfit: tp, stop: sl }).state,
    expected: protection.GRID_PROTECTION_STATE.FULL,
  },
  {
    name: "SHORT fill then TP+SL success",
    actual: protection.classifyProtectionOutcome({
      takeProfit: { clientOrderId: "GTP_S_156_5_22222222" },
      stop: { clientOrderId: "GSTOP_S_156_5_22222222" },
    }).state,
    expected: protection.GRID_PROTECTION_STATE.FULL,
  },
  {
    name: "TP success / SL fail",
    actual: protection.classifyProtectionOutcome({ takeProfit: tp, stop: { errorCode: -2019 } }).state,
    expected: protection.GRID_PROTECTION_STATE.PARTIAL,
  },
  {
    name: "SL success / TP fail",
    actual: protection.classifyProtectionOutcome({ takeProfit: { errorCode: -2019 }, stop: sl }).state,
    expected: protection.GRID_PROTECTION_STATE.PARTIAL,
  },
  {
    name: "TP -2021 immediate trigger",
    actual: protection.classifyProtectionOutcome({ takeProfit: reject2021, stop: sl }).reason,
    expected: "PROTECTION_IMMEDIATE_TRIGGER_REJECTED",
  },
  {
    name: "STOP -2021 immediate trigger",
    actual: protection.classifyProtectionOutcome({ takeProfit: tp, stop: reject2021 }).reason,
    expected: "PROTECTION_IMMEDIATE_TRIGGER_REJECTED",
  },
  {
    name: "both protection fail",
    actual: protection.classifyProtectionOutcome({ takeProfit: { errorCode: -2019 }, stop: { errorCode: -2019 } }).state,
    expected: protection.GRID_PROTECTION_STATE.NONE,
  },
  {
    name: "one-leg filled emergency then protection success",
    actual: protection.classifyProtectionOutcome({ takeProfit: tp, stop: sl, oneLegEmergency: true }).state,
    expected: protection.GRID_PROTECTION_STATE.ONE_LEG_PROTECTED,
  },
  {
    name: "one-leg filled emergency then protection fail",
    actual: protection.classifyProtectionOutcome({
      takeProfit: { errorCode: -2019 },
      stop: { errorCode: -2019 },
      oneLegEmergency: true,
    }).state,
    expected: protection.GRID_PROTECTION_STATE.ONE_LEG_UNPROTECTED,
  },
];

for (const scenario of scenarios) {
  assert.strictEqual(scenario.actual, scenario.expected, scenario.name);
}

const retryIds = [
  protection.deriveProtectionClientOrderId({
    entryClientOrderId: "GENTRY_L_156_5_22222222",
    prefix: "GTP",
  }),
  protection.deriveProtectionClientOrderId({
    entryClientOrderId: "GENTRY_L_156_5_22222222",
    prefix: "GTP",
  }),
];
assert.strictEqual(new Set(retryIds).size, 1, "duplicate protection retry uses same clientOrderId");
assert.strictEqual(
  protection.isProtectionCriticalState({ regimeStatus: "GRID_UNPROTECTED" }),
  true,
  "local reset is blocked while unprotected open position state remains"
);

console.log("grid-protection-guarantee-mock-replay PASS");
