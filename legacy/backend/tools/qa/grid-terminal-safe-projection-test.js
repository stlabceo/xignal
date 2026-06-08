"use strict";

const assert = require("assert");
const canonicalRuntimeState = require("../../canonical-runtime-state");

const baseGridRow = (overrides = {}) => ({
  id: 204,
  uid: 156,
  symbol: "PUMPUSDT",
  enabled: "N",
  regimeStatus: "WAITING_WEBHOOK",
  regimeEndReason: "GRID_CANCEL_NO_LOCAL_ORDER_REFS",
  longLegStatus: "IDLE",
  shortLegStatus: "IDLE",
  longQty: "0.000000000000",
  shortQty: "0.000000000000",
  longEntryOrderId: null,
  shortEntryOrderId: null,
  longExitOrderId: null,
  longStopOrderId: null,
  shortExitOrderId: null,
  shortStopOrderId: null,
  ...overrides,
});

const baseContext = (overrides = {}) => ({
  snapshots: [
    { pid: 204, positionSide: "LONG", status: "CLOSED", openQty: "0.000000000000" },
    { pid: 204, positionSide: "SHORT", status: "CLOSED", openQty: "0.000000000000" },
  ],
  ownerRows: [
    {
      pid: 204,
      positionSide: "LONG",
      ownerState: "RELEASED",
      status: "CLOSED",
      ownedQty: "0.000000000000",
      reservedCloseQty: "0.000000000000",
    },
    {
      pid: 204,
      positionSide: "SHORT",
      ownerState: "RELEASED",
      status: "CLOSED",
      ownedQty: "0.000000000000",
      reservedCloseQty: "0.000000000000",
    },
  ],
  reservations: [
    { pid: 204, positionSide: "LONG", status: "FILLED", reservedQty: "3773.000000000000" },
    { pid: 204, positionSide: "SHORT", status: "FILLED", reservedQty: "3773.000000000000" },
    { pid: 204, positionSide: "SHORT", status: "CANCELED", reservedQty: "3934.000000000000" },
  ],
  exchangeEvidence: {
    longPositionAmt: "0",
    shortPositionAmt: "0",
    openOrders: [],
    openAlgoOrders: [],
  },
  requireExchange: true,
  ...overrides,
});

const classify = (rowOverrides = {}, contextOverrides = {}) =>
  canonicalRuntimeState.classifyGridTerminalSafeProjection(
    baseGridRow(rowOverrides),
    baseContext(contextOverrides)
  );

const assertBlockedBy = (label, rowOverrides, contextOverrides, blocker) => {
  const result = classify(rowOverrides, contextOverrides);
  assert.strictEqual(result.terminalSafe, false, `${label}: not terminal-safe`);
  assert(
    result.blockers.includes(blocker),
    `${label}: expected blocker ${blocker}, got ${result.blockers.join(",")}`
  );
};

const terminal = classify();
assert.strictEqual(terminal.terminalSafe, true, "disabled zero-exposure row is terminal-safe");
assert.strictEqual(
  terminal.classification,
  canonicalRuntimeState.GRID_TERMINAL_SAFE_CLASSIFICATION,
  "terminal-safe classification is stable"
);
assert.strictEqual(terminal.exchangeVerified, true, "exchange evidence is included");

const decorated = canonicalRuntimeState.decorateGridItemSync(baseGridRow(), baseContext());
assert.strictEqual(decorated.terminalSafeDisplay, true, "decorated row marks terminal-safe display");
assert.strictEqual(decorated.status, "DISABLED_NO_EXPOSURE", "decorated status does not expose WAITING_WEBHOOK");
assert.strictEqual(
  decorated.displayRegimeStatus,
  "DISABLED_NO_EXPOSURE",
  "decorated displayRegimeStatus does not expose WAITING_WEBHOOK"
);
assert.strictEqual(
  decorated.legacyRegimeStatus,
  "WAITING_WEBHOOK",
  "legacy regimeStatus remains available for audit"
);
assert.strictEqual(decorated.runtimeState, "READY", "terminal-safe display remains non-active runtime state");

assertBlockedBy(
  "owner nonzero",
  {},
  { ownerRows: [{ pid: 204, positionSide: "LONG", ownedQty: "1", reservedCloseQty: "0" }] },
  "OWNER_NONZERO"
);
assertBlockedBy(
  "snapshot open",
  {},
  { snapshots: [{ pid: 204, positionSide: "LONG", status: "OPEN", openQty: "1" }] },
  "SNAPSHOT_OPEN"
);
assertBlockedBy(
  "active reservation",
  {},
  { reservations: [{ pid: 204, positionSide: "LONG", status: "ACTIVE", reservedQty: "1" }] },
  "ACTIVE_RESERVATION"
);
assertBlockedBy(
  "openOrders present",
  {},
  { exchangeEvidence: { longPositionAmt: "0", shortPositionAmt: "0", openOrders: [{ orderId: 1 }], openAlgoOrders: [] } },
  "OPEN_ORDERS_PRESENT"
);
assertBlockedBy(
  "openAlgoOrders present",
  {},
  { exchangeEvidence: { longPositionAmt: "0", shortPositionAmt: "0", openOrders: [], openAlgoOrders: [{ algoId: 1 }] } },
  "OPEN_ALGO_ORDERS_PRESENT"
);
assertBlockedBy("enabled row", { enabled: "Y" }, {}, "ENABLED");
assertBlockedBy("missing exchange required", {}, { exchangeEvidence: null }, "EXCHANGE_EVIDENCE_NOT_PROVIDED");

const pid204Fixture = canonicalRuntimeState.classifyGridTerminalSafeProjection(
  baseGridRow({
    id: 204,
    enabled: "N",
    regimeStatus: "WAITING_WEBHOOK",
    longLegStatus: "IDLE",
    shortLegStatus: "IDLE",
  }),
  baseContext({
    exchangeEvidence: {
      longPositionAmt: "0",
      shortPositionAmt: "0",
      openOrdersCount: 0,
      openAlgoOrdersCount: 0,
    },
  })
);
assert.strictEqual(pid204Fixture.terminalSafe, true, "PID204 current fixture is terminal-safe");
assert.deepStrictEqual(pid204Fixture.blockers, [], "PID204 fixture has no blockers");

console.log("grid-terminal-safe-projection-test PASS");
process.exit(0);
