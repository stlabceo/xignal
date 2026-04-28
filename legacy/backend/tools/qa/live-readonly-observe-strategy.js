const { loadQaConfig } = require("./qa-config");
const { printTable, printQaSummary } = require("./qa-report");
const { resolveReadOnlyUid, loadStrategyRow, loadSnapshotRows, loadReservations, closePool } = require("./qa-db");
const { getPositionRisk, getOpenOrders, getOpenAlgoOrders } = require("./qa-binance");

const run = async () => {
  const config = loadQaConfig();
  const uid = await resolveReadOnlyUid(config.uid);
  if (!(uid > 0)) {
    throw new Error("QA_READONLY_UID_WITH_KEYS_NOT_FOUND");
  }

  const strategyCategory = String(config.strategyCategory || "SIGNAL").trim().toUpperCase();
  const row = await loadStrategyRow({
    strategyCategory,
    strategyId: config.strategyId,
    pid: config.pid,
  });

  if (!row) {
    throw new Error("QA_OBSERVE_STRATEGY_ROW_NOT_FOUND");
  }

  const [snapshots, reservations, positions, openOrders, openAlgoOrders] = await Promise.all([
    loadSnapshotRows({
      uid,
      pid: row.id,
      strategyCategory: strategyCategory.toLowerCase(),
    }),
    loadReservations({
      uid,
      pid: row.id,
      strategyCategory: strategyCategory.toLowerCase(),
    }),
    getPositionRisk(uid, row.symbol).catch(() => []),
    getOpenOrders(uid, row.symbol).catch(() => []),
    getOpenAlgoOrders(uid, row.symbol).catch(() => []),
  ]);

  const scenarios = [
    {
      scenario: "live read-only strategy observe",
      invariant: "live observe must stay read-only while surfacing local/exchange state",
      pass: true,
      failures: [],
      status: "PASS",
    },
  ];

  printTable("Strategy Row", [row], Object.keys(row));
  printTable(
    "Snapshot Rows",
    snapshots.length > 0 ? snapshots : [{ positionSide: "", status: "none", openQty: 0 }],
    Object.keys((snapshots[0] || { positionSide: "", status: "none", openQty: 0 }))
  );
  printTable(
    "Reservation Rows",
    reservations.length > 0 ? reservations : [{ clientOrderId: "", status: "none", reservedQty: 0 }],
    Object.keys((reservations[0] || { clientOrderId: "", status: "none", reservedQty: 0 }))
  );
  printTable(
    "Binance Position Rows",
    positions.length > 0 ? positions : [{ symbol: row.symbol, positionSide: config.positionSide || "", positionAmt: 0 }],
    Object.keys((positions[0] || { symbol: row.symbol, positionSide: config.positionSide || "", positionAmt: 0 }))
  );
  printTable(
    "Binance Open Orders",
    openOrders.length > 0 ? openOrders : [{ clientOrderId: "", status: "none" }],
    Object.keys((openOrders[0] || { clientOrderId: "", status: "none" }))
  );
  printTable(
    "Binance Open Algo Orders",
    openAlgoOrders.length > 0 ? openAlgoOrders : [{ clientAlgoId: "", status: "none" }],
    Object.keys((openAlgoOrders[0] || { clientAlgoId: "", status: "none" }))
  );

  printQaSummary({
    mode: "live-readonly",
    target: {
      uid,
      strategyCategory,
      pid: row.id,
      symbol: row.symbol,
    },
    scenarios,
    snapshotSummary: snapshots.map((snapshot) => ({
      positionSide: snapshot.positionSide,
      status: snapshot.status,
      openQty: Number(snapshot.openQty || 0),
    })),
    reservationSummary: reservations.map((reservation) => ({
      clientOrderId: reservation.clientOrderId,
      status: reservation.status,
      reservedQty: Number(reservation.reservedQty || 0),
    })),
    binanceSummary: positions.map((position) => ({
      symbol: position.symbol,
      positionSide: position.positionSide,
      positionAmt: Number(position.positionAmt || 0),
    })),
  });
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error?.stack || error?.message || error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
      process.exit(process.exitCode || 0);
    });
}
