const assert = require("assert");

const pidPositionLedger = require("../../pid-position-ledger");
const {
  closePool,
  createTempGridStrategy,
  createTempSignalPlay,
  cleanupArtifacts,
  insertReservation,
  loadLedgerRows,
  loadSnapshot,
  loadReservations,
  countArtifactRowsForPids,
} = require("./qa-db");
const { loadQaConfig } = require("./qa-config");

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const run = async () => {
  process.env.QA_REPLAY_MODE = "1";
  process.env.QA_DISABLE_BINANCE_WRITES = "1";
  const config = loadQaConfig();
  const uid = Number(config.uid || 147);
  const scenarios = [];

  const grid = await createTempGridStrategy({
    uid,
    symbol: "XRPUSDT",
    bunbong: "1H",
    regimeStatus: "ENDED",
    longLegStatus: "OPEN",
    longQty: 18.2,
  });
  const signal = await createTempSignalPlay({
    uid,
    symbol: "XRPUSDT",
    bunbong: "5MIN",
    status: "EXACT",
    signalType: "SELL",
    rSignalType: "SELL",
    rQty: 18.3,
  });
  const staleGridReservation = await createTempGridStrategy({
    uid,
    symbol: "PUMPUSDT",
    bunbong: "1H",
    regimeStatus: "WAITING_WEBHOOK",
    longLegStatus: "IDLE",
    longQty: 0,
  });
  const pids = [grid.id, signal.id, staleGridReservation.id];
  const beforeCounts = await countArtifactRowsForPids({ uid, pids });

  try {
    await pidPositionLedger.applyEntryFill({
      uid,
      pid: grid.id,
      strategyCategory: "grid",
      symbol: "XRPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `GENTRY_L_${uid}_${grid.id}_QA`,
      sourceOrderId: `GRID-ENTRY-${grid.id}`,
      sourceTradeId: `GRID-ENTRY-TRADE-${grid.id}`,
      fillQty: 18.2,
      fillPrice: 1.3709,
      tradeTime: "2026-05-01T01:00:00Z",
      eventType: "GRID_ENTRY_FILL",
    });
    await pidPositionLedger.syncGridLegSnapshot(grid.id, "LONG");
    await pidPositionLedger.applyExitFill({
      uid,
      pid: grid.id,
      strategyCategory: "grid",
      symbol: "XRPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: "web_QA_XRP_LONG_34",
      sourceOrderId: "147883985483",
      sourceTradeId: "3098434937_QA",
      fillQty: 3.4,
      fillPrice: 1.3652,
      fee: 0.00232083,
      realizedPnl: -0.01938,
      tradeTime: "2026-05-01T01:34:02Z",
      eventType: "GRID_EXTERNAL_MANUAL_CLOSE_FILL",
      note: "qa-approved-local-stale-convergence-clear-fill",
    });
    const afterClearFill = await loadSnapshot({
      uid,
      pid: grid.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });
    assert(Math.abs(toNumber(afterClearFill.openQty) - 14.8) < 1e-9);
    await pidPositionLedger.closeSnapshotAsOrphan({
      uid,
      pid: grid.id,
      strategyCategory: "grid",
      symbol: "XRPUSDT",
      positionSide: "LONG",
      eventType: "GRID_EXCHANGE_FLAT_LOCAL_STALE_FLATTEN",
      note: "qa-controlled-local-stale-convergence: ambiguous remainder realizedPnl=0",
      tradeTime: "2026-05-01T01:35:00Z",
    });
    await pidPositionLedger.syncGridLegSnapshot(grid.id, "LONG");
    const gridLedger = await loadLedgerRows({ pid: grid.id, strategyCategory: "grid" });
    const correction = gridLedger.find((row) => row.eventType === "GRID_EXCHANGE_FLAT_LOCAL_STALE_FLATTEN");
    assert(correction, "correction row missing");
    assert.strictEqual(toNumber(correction.realizedPnl), 0);
    assert.strictEqual(String(correction.sourceTradeId || ""), "");
    const gridSnapshot = await loadSnapshot({
      uid,
      pid: grid.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });
    assert.strictEqual(toNumber(gridSnapshot.openQty), 0);
    scenarios.push(["PID 991501-style partial clear fill plus ambiguous remainder correction", "PASS"]);

    await pidPositionLedger.applyEntryFill({
      uid,
      pid: signal.id,
      strategyCategory: "signal",
      symbol: "XRPUSDT",
      positionSide: "SHORT",
      sourceClientOrderId: `NEW_${uid}_${signal.id}`,
      sourceOrderId: "147846553633_QA",
      sourceTradeId: `SIG-ENTRY-${signal.id}`,
      fillQty: 18.3,
      fillPrice: 1.3657,
      tradeTime: "2026-05-01T01:20:00Z",
      eventType: "SIGNAL_ENTRY_FILL",
    });
    await insertReservation({
      uid,
      pid: signal.id,
      strategyCategory: "signal",
      symbol: "XRPUSDT",
      positionSide: "SHORT",
      clientOrderId: `PROFIT_${uid}_${signal.id}_QA`,
      reservationKind: "BOUND_PROFIT",
      reservedQty: 18.3,
      status: "ACTIVE",
    });
    await insertReservation({
      uid,
      pid: signal.id,
      strategyCategory: "signal",
      symbol: "XRPUSDT",
      positionSide: "SHORT",
      clientOrderId: `STOP_${uid}_${signal.id}_QA`,
      reservationKind: "BOUND_STOP",
      reservedQty: 18.3,
      status: "ACTIVE",
    });
    await pidPositionLedger.applyExitFill({
      uid,
      pid: signal.id,
      strategyCategory: "signal",
      symbol: "XRPUSDT",
      positionSide: "SHORT",
      sourceClientOrderId: "web_QA_XRP_SHORT_183",
      sourceOrderId: "147883985484",
      sourceTradeId: "3098434938_QA",
      fillQty: 18.3,
      fillPrice: 1.3653,
      fee: 0.01249249,
      realizedPnl: 0.00732,
      tradeTime: "2026-05-01T01:34:02Z",
      eventType: "SIGNAL_EXTERNAL_MANUAL_CLOSE_FILL",
      note: "qa-approved-local-stale-convergence-owner-clear",
    });
    await pidPositionLedger.markReservationsCanceled([
      `PROFIT_${uid}_${signal.id}_QA`,
      `STOP_${uid}_${signal.id}_QA`,
    ], {
      uid,
      pid: signal.id,
      strategyCategory: "signal",
      positionSide: "SHORT",
    });
    await pidPositionLedger.syncSignalPlaySnapshot(signal.id, "SHORT");
    const signalSnapshot = await loadSnapshot({
      uid,
      pid: signal.id,
      strategyCategory: "signal",
      positionSide: "SHORT",
    });
    const signalReservations = await loadReservations({
      pid: signal.id,
      strategyCategory: "signal",
    });
    assert.strictEqual(toNumber(signalSnapshot.openQty), 0);
    assert.strictEqual(signalReservations.filter((row) => row.status === "ACTIVE").length, 0);
    scenarios.push(["PID 991749-style owner-clear web cleanup fill recovery", "PASS"]);

    await insertReservation({
      uid,
      pid: staleGridReservation.id,
      strategyCategory: "grid",
      symbol: "PUMPUSDT",
      positionSide: "LONG",
      clientOrderId: `GSTOP_L_${uid}_${staleGridReservation.id}_QA`,
      reservationKind: "GRID_STOP",
      reservedQty: 14116,
      status: "ACTIVE",
    });
    await pidPositionLedger.markReservationsCanceled([`GSTOP_L_${uid}_${staleGridReservation.id}_QA`], {
      uid,
      pid: staleGridReservation.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });
    const staleReservations = await loadReservations({
      pid: staleGridReservation.id,
      strategyCategory: "grid",
    });
    const staleLedger = await loadLedgerRows({
      pid: staleGridReservation.id,
      strategyCategory: "grid",
    });
    assert.strictEqual(staleReservations.filter((row) => row.status === "ACTIVE").length, 0);
    assert.strictEqual(staleLedger.length, 0);
    scenarios.push(["stale reservation only terminalization has no ledger PnL", "PASS"]);

    console.table(scenarios.map(([scenario, status]) => ({ scenario, status })));
    const afterCounts = await countArtifactRowsForPids({ uid, pids });
    await cleanupArtifacts({ uid, pids });
    const afterCleanup = await countArtifactRowsForPids({ uid, pids });
    console.log(JSON.stringify({ beforeCounts, afterCounts, afterCleanup }, null, 2));
    assert(Object.values(afterCleanup).every((value) => Number(value) === 0));
    console.log("data-replay-approved-local-stale-convergence PASS");
  } catch (error) {
    await cleanupArtifacts({ uid, pids });
    throw error;
  }
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
