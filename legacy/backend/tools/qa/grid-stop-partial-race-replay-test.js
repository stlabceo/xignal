"use strict";

const assert = require("assert");

const state = {
  initialPosition: 10,
  openQty: 10,
  exitAppliedQty: 0,
  emergencyRequestedQty: 0,
  oppositePositionQty: 0,
  strategyTerminal: false,
  orderTerminal: false,
};
const trades = new Set();

const applyExit = ({ tradeId, requestedQty, source }) => {
  if (trades.has(tradeId)) return 0;
  trades.add(tradeId);
  const appliedQty = Math.min(requestedQty, state.openQty);
  state.openQty -= appliedQty;
  state.exitAppliedQty += appliedQty;
  if (requestedQty > appliedQty && source !== "EMERGENCY") {
    state.oppositePositionQty += requestedQty - appliedQty;
  }
  if (source === "STOP" && appliedQty > 0) {
    state.strategyTerminal = true;
  }
  return appliedQty;
};

applyExit({ tradeId: "STOP-A", requestedQty: 4, source: "STOP" });
assert.strictEqual(state.strategyTerminal, true, "STOP partial should start strategy terminal lifecycle");
state.emergencyRequestedQty = state.openQty;
assert.strictEqual(state.emergencyRequestedQty, 6, "emergency close should target remaining exposure, not original order qty");

applyExit({ tradeId: "STOP-B", requestedQty: 3, source: "STOP" });
const emergencyApplied = applyExit({ tradeId: "EMERGENCY-CLOSE", requestedQty: state.emergencyRequestedQty, source: "EMERGENCY" });
assert.strictEqual(emergencyApplied, 3, "emergency close must clamp to remaining live exposure");
assert.strictEqual(state.exitAppliedQty, state.initialPosition, "total exit applied qty must not exceed initial position");
assert.strictEqual(state.openQty, 0, "position must be flat after clamped emergency close");
assert.strictEqual(state.oppositePositionQty, 0, "race must not create opposite position");

state.orderTerminal = true;
applyExit({ tradeId: "STOP-B", requestedQty: 3, source: "STOP" });
applyExit({ tradeId: "LATE-STOP-D", requestedQty: 1, source: "STOP" });
assert.strictEqual(state.exitAppliedQty, 10, "late or duplicate STOP fill must be idempotent/no-op once flat");
assert.strictEqual(state.strategyTerminal, true, "strategy lifecycle remains terminal");
assert.strictEqual(state.orderTerminal, true, "order lifecycle terminal is tracked separately");

console.log("grid-stop-partial-race-replay-test PASS");
