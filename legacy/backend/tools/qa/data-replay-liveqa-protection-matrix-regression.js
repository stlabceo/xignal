const assert = require("assert");
const {
  buildAggregateComparisonRows,
  buildActiveProtectionRiskRows,
  buildUnprotectedOpenPositionRows,
} = require("./qa-live");

const uid = 147;

const position = (symbol, side, qty) => ({
  symbol,
  positionSide: side,
  positionAmt: String(side === "SHORT" ? -Math.abs(qty) : Math.abs(qty)),
});

const snapshot = (pid, symbol, side, openQty, strategyCategory = "grid") => ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide: side,
  openQty,
});

const reservation = (pid, symbol, side, kind, clientOrderId, status = "ACTIVE") => ({
  uid,
  pid,
  strategyCategory: "grid",
  symbol,
  positionSide: side,
  reservationKind: kind,
  status,
  clientOrderId,
});

const algo = (symbol, side, qty, clientOrderId) => ({
  symbol,
  positionSide: side,
  side: side === "LONG" ? "SELL" : "BUY",
  reduceOnly: true,
  origQty: String(qty),
  clientAlgoId: clientOrderId,
  algoId: `algo-${clientOrderId}`,
  status: "NEW",
});

const scenarios = [];

{
  const aggregate = buildAggregateComparisonRows({
    uid,
    localRows: [{ symbol: "XRPUSDT", positionSide: "LONG", localOpenQty: 18.2, pidList: "991501" }],
    positionRows: [position("XRPUSDT", "LONG", 3.4)],
    compareSymbols: ["XRPUSDT"],
  });
  const unprotected = buildUnprotectedOpenPositionRows({
    uid,
    snapshots: [snapshot(991501, "XRPUSDT", "LONG", 18.2)],
    localReservations: [],
    positionRows: [position("XRPUSDT", "LONG", 3.4)],
    openAlgoOrders: [],
    compareSymbols: ["XRPUSDT"],
  });
  assert(aggregate.some((row) => row.risk === "AGGREGATE_MISMATCH"));
  assert(unprotected.some((row) => row.risk === "PID_OPEN_NO_EFFECTIVE_PROTECTION"));
  scenarios.push(["current XRP LONG residual without protection", "PASS"]);
}

{
  const unprotected = buildUnprotectedOpenPositionRows({
    uid,
    snapshots: [],
    localReservations: [],
    positionRows: [position("PUMPUSDT", "SHORT", 14116)],
    openAlgoOrders: [algo("PUMPUSDT", "LONG", 14116, "GSTOP_L_147_991502_48618296")],
    compareSymbols: ["PUMPUSDT"],
  });
  const protection = buildActiveProtectionRiskRows({
    uid,
    localReservations: [reservation(991502, "PUMPUSDT", "LONG", "GRID_STOP", "GSTOP_L_147_991502_48618296")],
    snapshotRows: [],
    positionRows: [position("PUMPUSDT", "SHORT", 14116)],
    openAlgoOrders: [algo("PUMPUSDT", "LONG", 14116, "GSTOP_L_147_991502_48618296")],
    compareSymbols: ["PUMPUSDT"],
  });
  assert(unprotected.some((row) => row.risk === "UNOWNED_EXCHANGE_OPEN_NO_EFFECTIVE_PROTECTION"));
  assert(protection.some((row) => String(row.risk).includes("ORPHAN_CLOSE_ORDER_FOR_FLAT_SIDE")));
  scenarios.push(["PUMP SHORT with Close Long wrong-side protection", "PASS"]);
}

{
  const rows = buildActiveProtectionRiskRows({
    uid,
    localReservations: [reservation(42, "PUMPUSDT", "LONG", "GRID_STOP", "GSTOP_L_147_42_TEST")],
    snapshotRows: [snapshot(42, "PUMPUSDT", "LONG", 1000)],
    positionRows: [position("PUMPUSDT", "LONG", 1000)],
    openAlgoOrders: [algo("PUMPUSDT", "LONG", 1075, "GSTOP_L_147_42_TEST")],
    compareSymbols: ["PUMPUSDT"],
  });
  assert(rows.some((row) => String(row.risk).includes("OVERSIZED_PROTECTION_VS_POSITION")));
  scenarios.push(["protection qty mismatch after shrink", "PASS"]);
}

{
  const rows = buildUnprotectedOpenPositionRows({
    uid,
    snapshots: [
      snapshot(1001, "XRPUSDT", "LONG", 3.4),
      snapshot(1002, "XRPUSDT", "LONG", 3.4),
    ],
    localReservations: [
      reservation(1002, "XRPUSDT", "LONG", "GRID_TP", "GTP_L_147_1002_TEST"),
      reservation(1002, "XRPUSDT", "LONG", "GRID_STOP", "GSTOP_L_147_1002_TEST"),
    ],
    positionRows: [position("XRPUSDT", "LONG", 6.8)],
    openAlgoOrders: [
      algo("XRPUSDT", "LONG", 3.4, "GTP_L_147_1002_TEST"),
      algo("XRPUSDT", "LONG", 3.4, "GSTOP_L_147_1002_TEST"),
    ],
    compareSymbols: ["XRPUSDT"],
  });
  assert(rows.some((row) => Number(row.pid) === 1001 && row.risk === "PID_OPEN_NO_EFFECTIVE_PROTECTION"));
  scenarios.push(["same symbol/side protection cannot mask PID-level missing protection", "PASS"]);
}

{
  const rows = buildUnprotectedOpenPositionRows({
    uid,
    snapshots: [snapshot(77, "XRPUSDT", "LONG", 5)],
    localReservations: [],
    positionRows: [position("XRPUSDT", "LONG", 5)],
    openAlgoOrders: [],
    compareSymbols: ["XRPUSDT"],
  });
  assert(rows.some((row) => row.risk === "PID_OPEN_NO_EFFECTIVE_PROTECTION"));
  scenarios.push(["entry filled but TP/STOP not confirmed", "PASS"]);
}

console.table(scenarios.map(([scenario, status]) => ({ scenario, status })));
console.log("data-replay-liveqa-protection-matrix-regression PASS");
process.exit(0);
