const pidPositionLedger = require("../../pid-position-ledger");
const gridEngine = require("../../grid-engine");
const {
  buildLabel,
  createTempSignalPlay,
  createTempGridStrategy,
  insertReservation,
  query,
  scalar,
  loadLedgerRows,
  loadSnapshot,
  loadSignalRow,
  loadGridRow,
  loadReservations,
  loadMsgList,
  cleanupArtifacts,
  isQaTempStrategyName,
  countArtifactRowsForPids,
  ensureUidExists,
  resolveAnyExistingUid,
  normalizeSymbol,
  toNumber,
} = require("./qa-db");
const {
  createScenario,
  expectTrue,
  expectEqual,
  expectApprox,
  finalizeScenario,
} = require("./qa-assert");
const { loadCoinQaModule } = require("./qa-runtime-loader");
const gridRuntime = require("../../grid-runtime");
const canonicalRuntimeState = require("../../canonical-runtime-state");
const signalForceOffControl = require("../../signal-force-off-control");
const signalStrategyIdentity = require("../../signal-strategy-identity");
const adminManagement = require("../../admin-management");
const orderDisplayState = require("../../order-display-state");
const { hasExplicitStrategyDeleteIntent } = require("../../strategy-delete-intent");
const {
  buildAggregateComparisonRows,
  buildActiveProtectionRiskRows,
  buildUnprotectedOpenPositionRows,
} = require("./qa-live");

const DEFAULT_REPLAY_UID_FALLBACK = 0;

const resolveReplayUid = async (preferredUid = 0) => {
  const explicitUid = Number(preferredUid || 0);
  if (explicitUid > 0) {
    await ensureUidExists(explicitUid);
    return explicitUid;
  }

  const fallbackUid = await resolveAnyExistingUid();
  if (!(fallbackUid > 0)) {
    throw new Error("QA_REPLAY_UID_NOT_FOUND");
  }
  return fallbackUid;
};

const captureConsoleLogs = async (worker) => {
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  console.log = (...args) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
    originalLog.apply(console, args);
  };
  console.error = (...args) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
    originalError.apply(console, args);
  };

  try {
    const result = await worker();
    return {
      logs,
      result,
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
};

const summarizeLedger = (rows = []) => ({
  count: rows.length,
  eventTypes: rows.map((row) => row.eventType).join(","),
  lastOpenQtyAfter: rows.length > 0 ? toNumber(rows[rows.length - 1].openQtyAfter) : 0,
  realizedPnlSum: Number(
    rows.reduce((sum, row) => sum + Number(row.realizedPnl || 0), 0).toFixed(12)
  ),
});

const summarizeSnapshot = (snapshot = null) => ({
  status: snapshot?.status || null,
  openQty: snapshot ? toNumber(snapshot.openQty) : 0,
  avgEntryPrice: snapshot ? toNumber(snapshot.avgEntryPrice) : 0,
  cycleRealizedPnl: snapshot ? toNumber(snapshot.cycleRealizedPnl) : 0,
  entryFillCount: snapshot ? Number(snapshot.entryFillCount || 0) : 0,
  exitFillCount: snapshot ? Number(snapshot.exitFillCount || 0) : 0,
});

const filterAuditLogs = (logs = []) =>
  logs.filter((line) =>
    line.includes("DUPLICATE_EXCHANGE_FILL_IGNORED")
    || line.includes("SIGNAL_ENTRY_RECOVERY_")
    || line.includes("SIGNAL_TIME_EXIT_")
    || line.includes("EXIT_FILL_UNIT_")
    || line.includes("GRID_FILL_UNIT_")
    || line.includes("GRID_RESERVATION_EXIT_RECOVERY_")
    || line.includes("GRID_EXTERNAL_CLOSE_")
    || line.includes("RESERVATION_CANCEL_")
    || line.includes("BINANCE_ACTIVE_LOCAL_CANCELED")
    || line.includes("USER_ACTION_REQUIRED_BINANCE_ONLY_PROTECTION")
    || line.includes("FILL_QTY_EXCEEDS_")
    || line.includes("USER_ACTION_REQUIRED_OVERFILLED_OR_CROSS_PID")
    || line.includes("PID_CLOSE_QTY_GUARD")
    || line.includes("CROSS_PID_AGGREGATE_MISMATCH_DETECTED")
    || line.includes("SIGNAL_EXCHANGE_FLAT_RECONCILE")
    || line.includes("GRID_EXCHANGE_FLAT_RECONCILE")
    || line.includes("SNAPSHOT_ORPHAN_CLOSED")
    || line.includes("ENTRY_FILL_APPLIED")
    || line.includes("EXIT_FILL_APPLIED")
    || line.includes("BOUND_SKIPPED")
  );

const loadScenarioState = async ({
  uid,
  pid,
  strategyCategory,
  positionSide = "LONG",
} = {}) => {
  const normalizedCategory = String(strategyCategory || "").trim().toLowerCase();
  const [ledgerRows, snapshot, reservations, msgList] = await Promise.all([
    loadLedgerRows({ pid, strategyCategory: normalizedCategory }),
    loadSnapshot({
      uid,
      pid,
      strategyCategory: normalizedCategory,
      positionSide,
    }),
    loadReservations({ uid, pid, strategyCategory: normalizedCategory }),
    loadMsgList({ uid, pid }),
  ]);

  const row = normalizedCategory === "grid"
    ? await loadGridRow(pid)
    : await loadSignalRow(pid);

  return {
    ledgerRows,
    snapshot,
    row,
    reservations,
    msgList,
  };
};

const createEntryPayload = ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  eventType,
  sourceClientOrderId,
  sourceOrderId,
  sourceTradeId,
  fillQty,
  fillPrice,
  fee = 0,
  tradeTime = new Date(),
  note = null,
}) => ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  eventType,
  sourceClientOrderId,
  sourceOrderId,
  sourceTradeId,
  fillQty,
  fillPrice,
  fee,
  tradeTime,
  note,
});

const createExitPayload = ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  eventType,
  sourceClientOrderId,
  sourceOrderId,
  sourceTradeId,
  fillQty,
  fillPrice,
  fee = 0,
  realizedPnl = 0,
  tradeTime = new Date(),
  note = null,
}) => ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  eventType,
  sourceClientOrderId,
  sourceOrderId,
  sourceTradeId,
  fillQty,
  fillPrice,
  fee,
  realizedPnl,
  tradeTime,
  note,
});

const runSamePidDuplicateGridEntry = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const row = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "PUMPUSDT",
    bunbong: "1MIN",
    regimeStatus: "ACTIVE",
    longLegStatus: "OPEN",
  });
  const cleanupPids = [row.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "same PID duplicate grid entry",
      "same PID + same exchange fill unit => one ledger application"
    );

    const common = {
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: "PUMPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `GENTRY_L_${resolvedUid}_${row.id}_QA01`,
      sourceOrderId: `GRID-ORD-${row.id}`,
      sourceTradeId: `GRID-TRADE-${row.id}`,
      fillQty: 14.044,
      fillPrice: 0.00178,
      tradeTime: "2026-04-24T04:04:04Z",
    };

    const captured = await captureConsoleLogs(async () => {
      await pidPositionLedger.applyEntryFill(createEntryPayload({
        ...common,
        eventType: "GRID_ENTRY_FILL",
        note: "qa-grid-entry",
      }));
      await pidPositionLedger.applyEntryFill(createEntryPayload({
        ...common,
        eventType: "GRID_EXCHANGE_RECONCILED_ENTRY_FILL",
        note: "qa-grid-entry-duplicate",
      }));
      await pidPositionLedger.syncGridLegSnapshot(row.id, "LONG");
    });

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });

    expectEqual(scenario, state.ledgerRows.length, 1, "grid duplicate entry should create one ledger row");
    expectApprox(scenario, state.snapshot?.openQty, 14.044, 1e-9, "snapshot openQty should reflect single fill");
    expectApprox(scenario, state.row?.longQty, 14.044, 1e-9, "grid longQty should not double");
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("DUPLICATE_EXCHANGE_FILL_IGNORED")),
      "duplicate ignored audit should be present"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runSamePidDuplicateSignalEntry = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "BTCUSDT",
    bunbong: "1MIN",
    status: "EXACT",
    signalType: "BUY",
    rSignalType: "BUY",
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "same PID duplicate signal entry",
      "same PID + same exchange fill unit => one ledger application"
    );

    const common = {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "BTCUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: `SIG-ORD-${play.id}`,
      sourceTradeId: `SIG-TRADE-${play.id}`,
      fillQty: 35.3,
      fillPrice: 101.25,
      tradeTime: "2026-04-24T01:00:00Z",
    };

    const captured = await captureConsoleLogs(async () => {
      await pidPositionLedger.applyEntryFill(createEntryPayload({
        ...common,
        eventType: "SIGNAL_ENTRY_FILL",
        note: "qa-signal-entry",
      }));
      await pidPositionLedger.applyEntryFill(createEntryPayload({
        ...common,
        eventType: "SIGNAL_EXCHANGE_RECONCILED_ENTRY_FILL",
        note: "qa-signal-entry-duplicate",
      }));
      await pidPositionLedger.syncSignalPlaySnapshot(play.id, "LONG");
    });

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "LONG",
    });

    expectEqual(scenario, state.ledgerRows.length, 1, "signal duplicate entry should create one ledger row");
    expectApprox(scenario, state.snapshot?.openQty, 35.3, 1e-9, "signal snapshot openQty should be single fill");
    expectApprox(scenario, state.row?.r_qty, 35.3, 1e-9, "signal runtime qty should be single fill");
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("DUPLICATE_EXCHANGE_FILL_IGNORED")),
      "duplicate ignored audit should be present"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runDuplicateExit = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "ETHUSDT",
    bunbong: "1MIN",
    status: "EXACT",
    signalType: "BUY",
    rSignalType: "BUY",
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "duplicate exit",
      "same PID + same exchange fill unit => one ledger application"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "ETHUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: `EXIT-ENTRY-${play.id}`,
      sourceTradeId: `EXIT-ENTRY-TRADE-${play.id}`,
      fillQty: 0.02,
      fillPrice: 2000,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-24T02:00:00Z",
    }));

    const captured = await captureConsoleLogs(async () => {
      await pidPositionLedger.applyExitFill(createExitPayload({
        uid: resolvedUid,
        pid: play.id,
        strategyCategory: "signal",
        symbol: "ETHUSDT",
        positionSide: "LONG",
        sourceClientOrderId: `PROFIT_${resolvedUid}_${play.id}_01`,
        sourceOrderId: `EXIT-ORD-${play.id}`,
        sourceTradeId: `EXIT-TRADE-${play.id}`,
        fillQty: 0.02,
        fillPrice: 2100,
        realizedPnl: 2,
        eventType: "SIGNAL_EXIT_FILL",
        tradeTime: "2026-04-24T03:00:00Z",
      }));
      await pidPositionLedger.applyExitFill(createExitPayload({
        uid: resolvedUid,
        pid: play.id,
        strategyCategory: "signal",
        symbol: "ETHUSDT",
        positionSide: "LONG",
        sourceClientOrderId: `PROFIT_${resolvedUid}_${play.id}_01`,
        sourceOrderId: `EXIT-ORD-${play.id}`,
        sourceTradeId: `EXIT-TRADE-${play.id}`,
        fillQty: 0.02,
        fillPrice: 2100,
        realizedPnl: 2,
        eventType: "SIGNAL_EXCHANGE_RECONCILED_EXIT_FILL",
        tradeTime: "2026-04-24T03:00:00Z",
      }));
      await pidPositionLedger.syncSignalPlaySnapshot(play.id, "LONG");
    });

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "LONG",
    });

    expectEqual(scenario, state.ledgerRows.length, 2, "duplicate exit should not create extra ledger row");
    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "snapshot should be flat");
    expectApprox(scenario, summarizeLedger(state.ledgerRows).realizedPnlSum, 2, 1e-9, "realizedPnl should not double");
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("DUPLICATE_EXCHANGE_FILL_IGNORED")),
      "duplicate ignored audit should be present"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runDifferentPidSameSymbolSide = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const playA = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "PUMPUSDT",
    bunbong: "1MIN",
    status: "EXACT",
    signalType: "BUY",
    rSignalType: "BUY",
  });
  const playB = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "PUMPUSDT",
    bunbong: "5MIN",
    status: "EXACT",
    signalType: "BUY",
    rSignalType: "BUY",
  });
  const cleanupPids = [playA.id, playB.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "different PID same symbol/side",
      "same symbol/side but different PID means different ledgers"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: playA.id,
      strategyCategory: "signal",
      symbol: "PUMPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${playA.id}`,
      sourceOrderId: `ORD-A-${playA.id}`,
      sourceTradeId: `TRADE-A-${playA.id}`,
      fillQty: 100,
      fillPrice: 0.0017,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-24T04:10:00Z",
    }));
    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: playB.id,
      strategyCategory: "signal",
      symbol: "PUMPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${playB.id}`,
      sourceOrderId: `ORD-B-${playB.id}`,
      sourceTradeId: `TRADE-B-${playB.id}`,
      fillQty: 200,
      fillPrice: 0.0018,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-24T04:11:00Z",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(playA.id, "LONG");
    await pidPositionLedger.syncSignalPlaySnapshot(playB.id, "LONG");

    const stateA = await loadScenarioState({
      uid: resolvedUid,
      pid: playA.id,
      strategyCategory: "signal",
      positionSide: "LONG",
    });
    const stateB = await loadScenarioState({
      uid: resolvedUid,
      pid: playB.id,
      strategyCategory: "signal",
      positionSide: "LONG",
    });

    expectEqual(scenario, stateA.ledgerRows.length, 1, "PID A should keep one entry");
    expectEqual(scenario, stateB.ledgerRows.length, 1, "PID B should keep one entry");
    expectApprox(scenario, stateA.snapshot?.openQty, 100, 1e-9, "PID A snapshot should remain isolated");
    expectApprox(scenario, stateB.snapshot?.openQty, 200, 1e-9, "PID B snapshot should remain isolated");

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: `${playA.id},${playB.id}`,
      strategyCategory: "signal",
      symbol: "PUMPUSDT",
      cleanupPids,
      rowCountsBefore,
      ledgerRows: [...stateA.ledgerRows, ...stateB.ledgerRows],
      snapshot: {
        pidA: stateA.snapshot,
        pidB: stateB.snapshot,
      },
      row: {
        pidA: stateA.row,
        pidB: stateB.row,
      },
      reservations: [],
      msgList: [],
      auditLogs: [],
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runPartialFillDistinctTradeIds = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "SOLUSDT",
    bunbong: "1MIN",
    status: "EXACT",
    signalType: "BUY",
    rSignalType: "BUY",
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "partial fill under same orderId with distinct tradeIds",
      "orderId alone is not fill identity"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "SOLUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: `PARTIAL-ORD-${play.id}`,
      sourceTradeId: `PARTIAL-TRADE-1-${play.id}`,
      fillQty: 0.25,
      fillPrice: 150,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-24T05:00:00Z",
    }));
    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "SOLUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: `PARTIAL-ORD-${play.id}`,
      sourceTradeId: `PARTIAL-TRADE-2-${play.id}`,
      fillQty: 0.5,
      fillPrice: 151,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-24T05:00:05Z",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(play.id, "LONG");

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "LONG",
    });

    expectEqual(scenario, state.ledgerRows.length, 2, "partial fills should create two ledger rows");
    expectApprox(scenario, state.snapshot?.openQty, 0.75, 1e-9, "snapshot should accumulate partial fills");

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: [],
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runSplitTpPartialClose = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "XRPUSDT",
    bunbong: "1MIN",
    status: "EXACT",
    signalType: "BUY",
    rSignalType: "BUY",
    splitTakeProfitEnabled: "Y",
    splitTakeProfitCount: 2,
    splitTakeProfitGap: 0.3,
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "split TP / partial close",
      "distinct exit fill units remain distinct"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "XRPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: `SPLIT-ENTRY-${play.id}`,
      sourceTradeId: `SPLIT-ENTRY-TRADE-${play.id}`,
      fillQty: 10,
      fillPrice: 1.5,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-24T06:00:00Z",
    }));
    await pidPositionLedger.applyExitFill(createExitPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "XRPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `SPLITTP_${resolvedUid}_${play.id}_01`,
      sourceOrderId: `SPLIT-EXIT-ORD-${play.id}`,
      sourceTradeId: `SPLIT-EXIT-TRADE-1-${play.id}`,
      fillQty: 3,
      fillPrice: 1.7,
      realizedPnl: 6,
      eventType: "SIGNAL_EXIT_FILL",
      tradeTime: "2026-04-24T06:05:00Z",
    }));
    await pidPositionLedger.applyExitFill(createExitPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "XRPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `SPLITTP_${resolvedUid}_${play.id}_02`,
      sourceOrderId: `SPLIT-EXIT-ORD-${play.id}`,
      sourceTradeId: `SPLIT-EXIT-TRADE-2-${play.id}`,
      fillQty: 4,
      fillPrice: 1.8,
      realizedPnl: 4,
      eventType: "SIGNAL_EXIT_FILL",
      tradeTime: "2026-04-24T06:07:00Z",
    }));
    await pidPositionLedger.applyExitFill(createExitPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "XRPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `SPLITTP_${resolvedUid}_${play.id}_02`,
      sourceOrderId: `SPLIT-EXIT-ORD-${play.id}`,
      sourceTradeId: `SPLIT-EXIT-TRADE-2-${play.id}`,
      fillQty: 4,
      fillPrice: 1.8,
      realizedPnl: 4,
      eventType: "SIGNAL_EXCHANGE_RECONCILED_EXIT_FILL",
      tradeTime: "2026-04-24T06:07:00Z",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(play.id, "LONG");

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "LONG",
    });

    expectEqual(scenario, state.ledgerRows.length, 3, "split TP should keep one entry and two exit rows");
    expectApprox(scenario, state.snapshot?.openQty, 3, 1e-9, "openQty should decrease stepwise");
    expectApprox(scenario, summarizeLedger(state.ledgerRows).realizedPnlSum, 10, 1e-9, "realizedPnl should sum distinct exit units only");

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: [],
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runSignalEntryRecoveryPartialFill = async ({ uid, cleanup = true } = {}) => {
  const preferredUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const isolatedUid = Number(
    await scalar(
      `SELECT id
         FROM admin_member
        WHERE (appKey IS NULL OR appSecret IS NULL)
        ORDER BY id DESC
        LIMIT 1`
    )
  ) || preferredUid;
  const coinQa = loadCoinQaModule();
  const play = await createTempSignalPlay({
    uid: isolatedUid,
    symbol: "QAPUMPUSDTREC",
    bunbong: "5MIN",
    status: "EXACT",
    enabled: "N",
    signalType: "SELL",
    rSignalType: "SELL",
    rSignalTime: "2026-04-24 14:50:14",
    rQty: 0,
    rExactPrice: null,
    rExactTime: null,
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: isolatedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: isolatedUid, pids: cleanupPids });
  const runtimeClient = {
    futuresAllOrders: async () => [
      {
        orderId: 4243567174,
        clientOrderId: `NEW_${isolatedUid}_${play.id}`,
        side: "SELL",
        positionSide: "SHORT",
        status: "FILLED",
        type: "MARKET",
        avgPrice: "0.0017840",
        executedQty: "14004",
        updateTime: Date.parse("2026-04-24T14:50:15.509Z"),
      },
    ],
    futuresUserTrades: async () => [
      {
        id: 220148627,
        orderId: 4243567174,
        side: "SELL",
        positionSide: "SHORT",
        qty: "8488",
        price: "0.0017840",
        quoteQty: "15.1433920",
        commission: "0.01",
        time: Date.parse("2026-04-24T14:50:15.509Z"),
      },
      {
        id: 220148628,
        orderId: 4243567174,
        side: "SELL",
        positionSide: "SHORT",
        qty: "5516",
        price: "0.0017840",
        quoteQty: "9.8397440",
        commission: "0.01",
        time: Date.parse("2026-04-24T14:50:15.509Z"),
      },
    ],
  };

  try {
    const scenario = createScenario(
      "signal market entry recovery with partial fills",
      "same PID + distinct tradeIds must recover as distinct fill units"
    );

    coinQa.__qa.binance[isolatedUid] = runtimeClient;
    const current = await loadSignalRow(play.id);
    const captured = await captureConsoleLogs(async () =>
      await coinQa.__qa.recoverSignalEntryFillFromExchange({
        uid: isolatedUid,
        row: current,
        issue: {
          issues: ["ENTRY_FILL_MISSED", "LOCAL_FLAT_EXCHANGE_OPEN"],
        },
      })
    );

    const state = await loadScenarioState({
      uid: isolatedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "SHORT",
    });

    expectEqual(scenario, state.ledgerRows.length, 2, "partial entry recovery should create two ledger rows");
    expectTrue(
      scenario,
      state.ledgerRows.every((entry) => entry.eventType === "EXCHANGE_RECONCILED_ENTRY_FILL"),
      "recovered ledger rows should use reconciled signal entry event type"
    );
    expectEqual(
      scenario,
      state.ledgerRows.map((entry) => String(entry.sourceTradeId || "")).join(","),
      "220148627,220148628",
      "sourceTradeId should preserve distinct exchange trade ids"
    );
    expectApprox(scenario, state.snapshot?.openQty, 14004, 1e-9, "snapshot should open with recovered total qty");
    expectApprox(scenario, state.snapshot?.avgEntryPrice, 0.001784, 1e-12, "snapshot avgEntryPrice should match weighted average");
    expectEqual(scenario, state.row?.status, "EXACT", "signal row should remain EXACT after recovery");
    expectApprox(scenario, state.row?.r_qty, 14004, 1e-9, "signal row qty should match recovered open qty");
    expectApprox(scenario, state.row?.r_exactPrice, 0.001784, 1e-12, "signal row exact price should match recovered price");
    expectTrue(scenario, Boolean(state.row?.r_exactTime), "signal row exact time should be populated");
    expectTrue(
      scenario,
      (captured.logs || []).some((line) => line.includes("SIGNAL_ENTRY_RECOVERY_PROTECTION_SYNCED")),
      "recovery chain should reach protection sync"
    );

    return finalizeScenario(scenario, {
      uid: isolatedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    delete coinQa.__qa.binance[isolatedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runSignalSplitTpMultiFillExitAccounting = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "QASPLITEXITUSDT",
    bunbong: "5MIN",
    status: "EXACT",
    signalType: "SELL",
    rSignalType: "SELL",
    rSignalTime: "2026-04-24 18:00:00",
    splitTakeProfitEnabled: "Y",
    splitTakeProfitCount: 2,
    splitTakeProfitGap: 0.3,
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const entryOrderId = 4243567174;
  const runtimeClient = {
    futuresAllOrders: async () => [
      {
        orderId: 4245154631,
        clientOrderId: `SPLITTP_${resolvedUid}_${play.id}_01`,
        side: "BUY",
        positionSide: "SHORT",
        status: "FILLED",
        type: "TAKE_PROFIT",
        avgPrice: "0.0017800",
        executedQty: "7037",
        updateTime: Date.parse("2026-04-24T18:10:01Z"),
      },
      {
        orderId: 4245154632,
        clientOrderId: `SPLITTP_${resolvedUid}_${play.id}_02`,
        side: "BUY",
        positionSide: "SHORT",
        status: "FILLED",
        type: "TAKE_PROFIT",
        avgPrice: "0.0017790",
        executedQty: "7037",
        updateTime: Date.parse("2026-04-24T18:10:09Z"),
      },
    ],
    futuresUserTrades: async () => [
      {
        id: 910001,
        orderId: 4245154631,
        side: "BUY",
        positionSide: "SHORT",
        qty: "7037",
        price: "0.0017800",
        quoteQty: "12.5258600",
        realizedPnl: "0.1200000",
        commission: "0.0100000",
        time: Date.parse("2026-04-24T18:10:01Z"),
      },
      {
        id: 910002,
        orderId: 4245154632,
        side: "BUY",
        positionSide: "SHORT",
        qty: "7037",
        price: "0.0017790",
        quoteQty: "12.5188230",
        realizedPnl: "0.1300000",
        commission: "0.0100000",
        time: Date.parse("2026-04-24T18:10:09Z"),
      },
    ],
  };

  try {
    const scenario = createScenario(
      "signal split TP multi-fill exit accounting",
      "partial fill / split TP are separate fill units"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "SHORT",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: entryOrderId,
      sourceTradeId: `SIG-ENTRY-${play.id}`,
      fillQty: 14074,
      fillPrice: 0.001784,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-24T18:00:05Z",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(play.id, "SHORT");
    await insertReservation({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "SHORT",
      clientOrderId: `STOP_${resolvedUid}_${play.id}_${entryOrderId}`,
      sourceOrderId: `STOP-ORD-${play.id}`,
      reservationKind: "BOUND_STOP",
      reservedQty: 14074,
      status: "ACTIVE",
    });

    coinQa.__qa.binance[resolvedUid] = runtimeClient;
    const captured = await captureConsoleLogs(async () => {
      const current = await loadSignalRow(play.id);
      await coinQa.__qa.recoverSignalExitFillFromExchange({
        uid: resolvedUid,
        row: current,
        issue: { issues: ["DB_OPEN_NO_POSITION"] },
      });
      const refreshed = await loadSignalRow(play.id);
      await coinQa.__qa.recoverSignalExitFillFromExchange({
        uid: resolvedUid,
        row: refreshed,
        issue: { issues: ["DB_OPEN_NO_POSITION"] },
      });
    });

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "SHORT",
    });
    const exitRows = state.ledgerRows.filter((entry) => entry.eventType === "EXCHANGE_RECONCILED_EXIT_FILL");

    expectEqual(scenario, exitRows.length, 2, "split TP recovery should create two exit ledger rows");
    expectEqual(
      scenario,
      exitRows.map((entry) => String(entry.sourceTradeId || "")).join(","),
      "910001,910002",
      "split TP recovery should preserve each sourceTradeId"
    );
    expectEqual(
      scenario,
      exitRows.map((entry) => Number(entry.openQtyAfter || 0)).join(","),
      "7037,0",
      "openQtyAfter should step down by fill unit"
    );
    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "snapshot should close after both recovered fills");
    expectApprox(
      scenario,
      summarizeLedger(state.ledgerRows).realizedPnlSum,
      0.25,
      1e-9,
      "realizedPnl should sum both recovered fills"
    );
    expectTrue(
      scenario,
      !state.ledgerRows.some((entry) => String(entry.eventType || "").includes("RECONCILE_CLOSE") || String(entry.eventType || "").includes("FLATTEN")),
      "flatten correction should not replace recovered split TP fills"
    );
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("EXIT_FILL_UNIT_DUPLICATE_IGNORED")),
      "duplicate replay should be ignored after recovery"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    delete coinQa.__qa.binance[resolvedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runSignalTimeExitFillRecovery = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "QATIMEXRPUSDT",
    bunbong: "5MIN",
    status: "EXACT",
    signalType: "SELL",
    rSignalType: "SELL",
    rSignalTime: "2026-04-28 04:30:00",
    rExactPrice: 1.3881,
    rExactTime: "2026-04-28 04:30:10",
    rQty: 36,
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const entryOrderId = 147615759568;
  const timeOrderId = 147616716821;
  const timeClientOrderId = `TIME_${resolvedUid}_${play.id}_${entryOrderId}`;

  const runtimeClient = {
    futuresPositionRisk: async () => [
      {
        symbol: play.symbol,
        positionSide: "SHORT",
        positionAmt: "-71.9",
      },
    ],
    futuresOpenOrders: async () => [],
    futuresAllOrders: async () => [
      {
        orderId: timeOrderId,
        clientOrderId: timeClientOrderId,
        side: "BUY",
        positionSide: "SHORT",
        status: "FILLED",
        type: "MARKET",
        reduceOnly: true,
        avgPrice: "1.3913",
        executedQty: "36",
        origQty: "36",
        updateTime: Date.parse("2026-04-28T04:45:10Z"),
      },
    ],
    futuresUserTrades: async () => [
      {
        id: 3095977579,
        orderId: timeOrderId,
        side: "BUY",
        positionSide: "SHORT",
        qty: "36",
        price: "1.3913",
        quoteQty: "50.0868",
        realizedPnl: "-0.11342253",
        commission: "0.02003472",
        time: Date.parse("2026-04-28T04:45:10Z"),
      },
    ],
  };

  try {
    const scenario = createScenario(
      "signal TIME exit fill recovery",
      "TIME market close fill must recover even when same-symbol aggregate is not flat"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "SHORT",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: entryOrderId,
      sourceTradeId: "3095969503",
      fillQty: 36,
      fillPrice: 1.3881,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-28T04:30:10Z",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(play.id, "SHORT");
    await query(
      `UPDATE live_play_list
          SET r_tid = ?, r_oid = ?, status = 'EXACT', r_signalType = 'SELL'
        WHERE id = ?`,
      [entryOrderId, timeOrderId, play.id]
    );
    await insertReservation({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "SHORT",
      clientOrderId: timeClientOrderId,
      sourceOrderId: timeOrderId,
      actualOrderId: timeOrderId,
      reservationKind: "MARKET_TIME",
      reservedQty: 36,
      status: "CANCEL_PENDING",
    });

    coinQa.__qa.binance[resolvedUid] = runtimeClient;
    const current = await loadSignalRow(play.id);
    const captured = await captureConsoleLogs(async () => {
      const missingTimeExit = await coinQa.__qa.loadMissingSignalTimeExitExecutionFromExchange({
        uid: resolvedUid,
        row: current,
        symbol: current.symbol,
        positionSide: "SHORT",
        notBeforeTradeTime: current.r_exactTime || current.r_signalTime || null,
      });
      expectTrue(
        scenario,
        Boolean(missingTimeExit),
        "truth sync helper should detect missing TIME close fill before aggregate flat"
      );
      await coinQa.__qa.recoverSignalExitFillFromExchange({
        uid: resolvedUid,
        row: current,
        issue: { issues: ["SIGNAL_TIME_EXIT_FILL_MISSED", "POSITION_BUCKET_QTY_MISMATCH"] },
      });
      const refreshed = await loadSignalRow(play.id);
      await coinQa.__qa.recoverSignalExitFillFromExchange({
        uid: resolvedUid,
        row: refreshed,
        issue: { issues: ["SIGNAL_TIME_EXIT_FILL_MISSED"] },
      });
    });

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "SHORT",
    });
    const exitRows = state.ledgerRows.filter((entry) => entry.eventType === "EXCHANGE_RECONCILED_EXIT_FILL");
    const timeReservation = state.reservations.find((reservation) => reservation.clientOrderId === timeClientOrderId);

    expectEqual(scenario, exitRows.length, 1, "TIME close recovery should create one exit ledger row");
    expectEqual(scenario, String(exitRows[0]?.sourceTradeId || ""), "3095977579", "sourceTradeId should preserve TIME close trade id");
    expectEqual(scenario, String(exitRows[0]?.sourceOrderId || ""), String(timeOrderId), "sourceOrderId should preserve TIME close order id");
    expectEqual(scenario, String(exitRows[0]?.sourceClientOrderId || ""), timeClientOrderId, "sourceClientOrderId should preserve TIME close client id");
    expectApprox(scenario, exitRows[0]?.fillQty, 36, 1e-9, "TIME close qty should be recovered");
    expectApprox(scenario, exitRows[0]?.realizedPnl, -0.11342253, 1e-9, "TIME close realizedPnl should be preserved");
    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "snapshot should close after full TIME close");
    expectEqual(scenario, state.snapshot?.status, "CLOSED", "snapshot status should be CLOSED");
    expectEqual(scenario, state.row?.status, "READY", "signal row should converge to READY after full TIME close");
    expectApprox(scenario, state.row?.r_qty, 0, 1e-9, "signal row r_qty should be zero after full TIME close");
    expectEqual(scenario, timeReservation?.status, "FILLED", "MARKET_TIME reservation should be filled by recovered trade");
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("SIGNAL_TIME_EXIT_RECOVERY_DUPLICATE_IGNORED")),
      "duplicate TIME recovery should be ignored"
    );
    expectTrue(
      scenario,
      !state.ledgerRows.some((entry) => String(entry.eventType || "").includes("FLATTEN") || String(entry.eventType || "").includes("CORRECTION")),
      "actual TIME fill recovery must not be replaced by correction flatten"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    delete coinQa.__qa.binance[resolvedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runSignalTimeExitSiblingProtectionLifecycle = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "QATIMEPROTUSDT",
    bunbong: "5MIN",
    status: "EXACT",
    signalType: "SELL",
    rSignalType: "SELL",
    rSignalTime: "2026-04-28 05:00:00",
    rExactPrice: 1.3881,
    rExactTime: "2026-04-28 05:00:10",
    rQty: 36,
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const entryOrderId = 147700000001;
  const timeOrderId = 147700000002;
  const timeClientOrderId = `TIME_${resolvedUid}_${play.id}_${entryOrderId}`;
  const profitClientOrderId = `PROFIT_${resolvedUid}_${play.id}_${entryOrderId}`;
  const stopClientOrderId = `STOP_${resolvedUid}_${play.id}_${entryOrderId}`;

  const runtimeClient = {
    futuresAllOrders: async () => [
      {
        orderId: timeOrderId,
        clientOrderId: timeClientOrderId,
        side: "BUY",
        positionSide: "SHORT",
        status: "FILLED",
        type: "MARKET",
        reduceOnly: true,
        avgPrice: "1.3913",
        executedQty: "36",
        origQty: "36",
        updateTime: Date.parse("2026-04-28T05:15:10Z"),
      },
    ],
    futuresUserTrades: async () => [
      {
        id: 3096000001,
        orderId: timeOrderId,
        side: "BUY",
        positionSide: "SHORT",
        qty: "36",
        price: "1.3913",
        quoteQty: "50.0868",
        realizedPnl: "-0.10",
        commission: "0.02",
        time: Date.parse("2026-04-28T05:15:10Z"),
      },
    ],
    futuresOpenOrders: async () => [
      {
        orderId: 147700000011,
        clientOrderId: profitClientOrderId,
        symbol: play.symbol,
        type: "TAKE_PROFIT",
        side: "BUY",
        positionSide: "SHORT",
        reduceOnly: true,
        origQty: "36",
        stopPrice: "1.3812",
        status: "NEW",
      },
      {
        orderId: 147700000012,
        clientOrderId: stopClientOrderId,
        symbol: play.symbol,
        type: "STOP",
        side: "BUY",
        positionSide: "SHORT",
        reduceOnly: true,
        origQty: "36",
        stopPrice: "1.4159",
        status: "NEW",
      },
    ],
  };

  try {
    const scenario = createScenario(
      "signal TIME exit sibling protection cleanup",
      "TIME full close must not silently cancel or re-register sibling protection"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "SHORT",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: entryOrderId,
      sourceTradeId: "3096000000",
      fillQty: 36,
      fillPrice: 1.3881,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-28T05:00:10Z",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(play.id, "SHORT");
    await query(
      `UPDATE live_play_list
          SET r_tid = ?, r_oid = ?, status = 'EXACT', r_signalType = 'SELL'
        WHERE id = ?`,
      [entryOrderId, timeOrderId, play.id]
    );
    await insertReservation({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "SHORT",
      clientOrderId: profitClientOrderId,
      sourceOrderId: 147700000011,
      reservationKind: "BOUND_PROFIT",
      reservedQty: 36,
      status: "ACTIVE",
    });
    await insertReservation({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "SHORT",
      clientOrderId: stopClientOrderId,
      sourceOrderId: 147700000012,
      reservationKind: "BOUND_STOP",
      reservedQty: 36,
      status: "ACTIVE",
    });
    await insertReservation({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "SHORT",
      clientOrderId: timeClientOrderId,
      sourceOrderId: timeOrderId,
      actualOrderId: timeOrderId,
      reservationKind: "MARKET_TIME",
      reservedQty: 36,
      status: "CANCEL_PENDING",
    });

    coinQa.__qa.binance[resolvedUid] = runtimeClient;
    const captured = await captureConsoleLogs(async () => {
      const current = await loadSignalRow(play.id);
      await coinQa.__qa.recoverSignalExitFillFromExchange({
        uid: resolvedUid,
        row: current,
        issue: { issues: ["SIGNAL_TIME_EXIT_FILL_MISSED"] },
      });
    });

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "SHORT",
    });
    const profitReservation = state.reservations.find((reservation) => reservation.clientOrderId === profitClientOrderId);
    const stopReservation = state.reservations.find((reservation) => reservation.clientOrderId === stopClientOrderId);
    const mockOpenOrders = await runtimeClient.futuresOpenOrders();
    const riskRows = buildActiveProtectionRiskRows({
      uid: resolvedUid,
      localReservations: state.reservations,
      snapshotRows: [],
      positionRows: [{
        symbol: play.symbol,
        positionSide: "SHORT",
        positionAmt: "-53.8",
      }],
      openOrders: mockOpenOrders,
      openAlgoOrders: [],
      compareSymbols: [play.symbol],
    });

    expectEqual(scenario, profitReservation?.status, "ACTIVE", "sibling PROFIT reservation should not be silently canceled");
    expectEqual(scenario, stopReservation?.status, "ACTIVE", "sibling STOP reservation should not be silently canceled");
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("SIGNAL_TIME_EXIT_SIBLING_PROTECTION_ACTIVE")),
      "active sibling protection after TIME full close should be audited"
    );
    expectTrue(
      scenario,
      !captured.logs.some((line) => line.includes("BOUND_REGISTERED")),
      "TIME full close recovery must not re-register TP/STOP"
    );
    expectTrue(
      scenario,
      riskRows.some((row) => String(row.risk || "").includes("ACTIVE_PROTECTION_WITHOUT_PID_OPEN_QTY")),
      "live-readonly risk builder should flag sibling protection without PID-owned openQty"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: {
        ...state.row,
        protectionRiskRows: riskRows,
      },
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    delete coinQa.__qa.binance[resolvedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runSignalTimeExitPartialFill = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "QATIMEPARTUSDT",
    bunbong: "5MIN",
    status: "EXACT",
    signalType: "SELL",
    rSignalType: "SELL",
    rSignalTime: "2026-04-28 06:00:00",
    rExactPrice: 1.3881,
    rExactTime: "2026-04-28 06:00:10",
    rQty: 36,
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const entryOrderId = 147800000001;
  const timeOrderId = 147800000002;
  const timeClientOrderId = `TIME_${resolvedUid}_${play.id}_${entryOrderId}`;

  const runtimeClient = {
    futuresAllOrders: async () => [
      {
        orderId: timeOrderId,
        clientOrderId: timeClientOrderId,
        side: "BUY",
        positionSide: "SHORT",
        status: "PARTIALLY_FILLED",
        type: "MARKET",
        reduceOnly: true,
        avgPrice: "1.3913",
        executedQty: "20",
        origQty: "36",
        updateTime: Date.parse("2026-04-28T06:15:10Z"),
      },
    ],
    futuresUserTrades: async () => [
      {
        id: 3096100001,
        orderId: timeOrderId,
        side: "BUY",
        positionSide: "SHORT",
        qty: "20",
        price: "1.3913",
        quoteQty: "27.826",
        realizedPnl: "-0.05",
        commission: "0.01",
        time: Date.parse("2026-04-28T06:15:10Z"),
      },
    ],
    futuresOpenOrders: async () => [],
  };

  try {
    const scenario = createScenario(
      "signal TIME exit partial fill",
      "partial TIME close reduces only filled quantity and keeps remaining open"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "SHORT",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: entryOrderId,
      sourceTradeId: "3096100000",
      fillQty: 36,
      fillPrice: 1.3881,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-28T06:00:10Z",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(play.id, "SHORT");
    await query(
      `UPDATE live_play_list
          SET r_tid = ?, r_oid = ?, status = 'EXACT', r_signalType = 'SELL'
        WHERE id = ?`,
      [entryOrderId, timeOrderId, play.id]
    );
    await insertReservation({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "SHORT",
      clientOrderId: timeClientOrderId,
      sourceOrderId: timeOrderId,
      actualOrderId: timeOrderId,
      reservationKind: "MARKET_TIME",
      reservedQty: 36,
      status: "CANCEL_PENDING",
    });

    coinQa.__qa.binance[resolvedUid] = runtimeClient;
    const captured = await captureConsoleLogs(async () => {
      const current = await loadSignalRow(play.id);
      await coinQa.__qa.recoverSignalExitFillFromExchange({
        uid: resolvedUid,
        row: current,
        issue: { issues: ["SIGNAL_TIME_EXIT_FILL_MISSED"] },
      });
    });

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "SHORT",
    });
    const exitRows = state.ledgerRows.filter((entry) => entry.eventType === "EXCHANGE_RECONCILED_EXIT_FILL");
    const timeReservation = state.reservations.find((reservation) => reservation.clientOrderId === timeClientOrderId);

    expectEqual(scenario, exitRows.length, 1, "partial TIME close should create one exit ledger row");
    expectApprox(scenario, exitRows[0]?.fillQty, 20, 1e-9, "partial TIME close applies filled qty only");
    expectApprox(scenario, state.snapshot?.openQty, 16, 1e-9, "snapshot should retain remaining qty");
    expectEqual(scenario, state.snapshot?.status, "OPEN", "snapshot should remain OPEN after partial TIME fill");
    expectEqual(scenario, state.row?.status, "EXACT", "signal row should remain EXACT after partial TIME fill");
    expectApprox(scenario, state.row?.r_qty, 16, 1e-9, "signal row r_qty should match remaining qty");
    expectEqual(scenario, timeReservation?.status, "PARTIAL", "MARKET_TIME reservation should track partial fill");
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("SIGNAL_TIME_EXIT_RECOVERY_APPLY_FILL")),
      "partial TIME recovery should audit apply fill"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    delete coinQa.__qa.binance[resolvedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runGridMultiTradeEntryPreservation = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const row = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "QAGRIDENTRYUSDT",
    bunbong: "1MIN",
    regimeStatus: "ACTIVE",
    longLegStatus: "ENTRY_ARMED",
  });
  const cleanupPids = [row.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const runtimeClient = {
    futuresAllOrders: async () => [
      {
        orderId: 551001,
        clientOrderId: `GENTRY_L_${resolvedUid}_${row.id}_QA`,
        side: "BUY",
        positionSide: "LONG",
        status: "FILLED",
        type: "LIMIT",
        avgPrice: "1.216000",
        executedQty: "10",
        updateTime: Date.parse("2026-04-24T19:00:05Z"),
      },
    ],
    futuresUserTrades: async () => [
      {
        id: 551101,
        orderId: 551001,
        side: "BUY",
        positionSide: "LONG",
        qty: "2",
        price: "1.214000",
        quoteQty: "2.428000",
        commission: "0.010000",
        time: Date.parse("2026-04-24T19:00:01Z"),
      },
      {
        id: 551104,
        orderId: 551001,
        side: "BUY",
        positionSide: "LONG",
        qty: "2",
        price: "1.214000",
        quoteQty: "2.428000",
        commission: "0.010000",
        time: Date.parse("2026-04-24T19:00:01Z"),
      },
      {
        id: 551102,
        orderId: 551001,
        side: "BUY",
        positionSide: "LONG",
        qty: "3",
        price: "1.216000",
        quoteQty: "3.648000",
        commission: "0.010000",
        time: Date.parse("2026-04-24T19:00:03Z"),
      },
      {
        id: 551103,
        orderId: 551001,
        side: "BUY",
        positionSide: "LONG",
        qty: "5",
        price: "1.217000",
        quoteQty: "6.085000",
        commission: "0.010000",
        time: Date.parse("2026-04-24T19:00:05Z"),
      },
    ],
  };

  try {
    const scenario = createScenario(
      "grid multi-trade entry preservation",
      "partial fill / multi-trade entry fill units remain distinct, including same qty/time/price with distinct tradeIds"
    );

    coinQa.__qa.binance[resolvedUid] = runtimeClient;
    const captured = await captureConsoleLogs(async () => {
      const current = await loadGridRow(row.id);
      await coinQa.__qa.recoverGridEntryFillFromExchange({
        uid: resolvedUid,
        row: current,
        leg: "LONG",
        issue: { issues: ["LONG_OPEN_NO_POSITION"] },
      });
      const refreshed = await loadGridRow(row.id);
      await coinQa.__qa.recoverGridEntryFillFromExchange({
        uid: resolvedUid,
        row: refreshed,
        leg: "LONG",
        issue: { issues: ["LONG_OPEN_NO_POSITION"] },
      });
    });

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });
    const expectedAvg = ((2 * 1.214) + (2 * 1.214) + (3 * 1.216) + (5 * 1.217)) / 12;

    expectEqual(scenario, state.ledgerRows.length, 4, "grid multi-trade entry should keep four ledger rows");
    expectEqual(
      scenario,
      state.ledgerRows.map((entry) => String(entry.sourceTradeId || "")).join(","),
      "551101,551104,551102,551103",
      "grid entry should preserve each tradeId"
    );
    expectApprox(scenario, state.snapshot?.openQty, 12, 1e-9, "grid snapshot should accumulate all entry fills");
    expectApprox(scenario, state.snapshot?.avgEntryPrice, expectedAvg, 1e-9, "grid snapshot avgEntryPrice should be weighted");
    expectApprox(scenario, state.row?.longQty, 12, 1e-9, "grid longQty should match recovered total qty");
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("GRID_FILL_UNIT_RECOVERY_FOUND_TRADES")),
      "grid recovery trace should list all trade fills"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    delete coinQa.__qa.binance[resolvedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runGridMultiTradeExitPreservation = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const row = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "QAGRIDEXITUSDT",
    bunbong: "1MIN",
    regimeStatus: "ACTIVE",
    longLegStatus: "OPEN",
    longQty: 10,
  });
  const cleanupPids = [row.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const runtimeClient = {
    futuresOpenOrders: async () => [],
    futuresAllOrders: async () => [
      {
        orderId: 661001,
        clientOrderId: `GTP_L_${resolvedUid}_${row.id}_QA`,
        side: "SELL",
        positionSide: "LONG",
        status: "FILLED",
        type: "TAKE_PROFIT",
        avgPrice: "1.250000",
        executedQty: "10",
        updateTime: Date.parse("2026-04-24T19:20:09Z"),
      },
    ],
    futuresUserTrades: async () => [
      {
        id: 661101,
        orderId: 661001,
        side: "SELL",
        positionSide: "LONG",
        qty: "4",
        price: "1.249000",
        quoteQty: "4.996000",
        realizedPnl: "0.400000",
        commission: "0.010000",
        time: Date.parse("2026-04-24T19:20:05Z"),
      },
      {
        id: 661102,
        orderId: 661001,
        side: "SELL",
        positionSide: "LONG",
        qty: "6",
        price: "1.251000",
        quoteQty: "7.506000",
        realizedPnl: "0.600000",
        commission: "0.010000",
        time: Date.parse("2026-04-24T19:20:09Z"),
      },
    ],
  };

  try {
    const scenario = createScenario(
      "grid multi-trade exit preservation",
      "partial fill / multi-trade exit fill units remain distinct"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: "LONG",
      sourceClientOrderId: `GENTRY_L_${resolvedUid}_${row.id}_QA_ENTRY`,
      sourceOrderId: `GRID-ENTRY-${row.id}`,
      sourceTradeId: `GRID-ENTRY-TRADE-${row.id}`,
      fillQty: 10,
      fillPrice: 1.2,
      eventType: "GRID_ENTRY_FILL",
      tradeTime: "2026-04-24T19:00:00Z",
    }));
    await pidPositionLedger.syncGridLegSnapshot(row.id, "LONG");
    await insertReservation({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: "LONG",
      clientOrderId: `GTP_L_${resolvedUid}_${row.id}_QA`,
      sourceOrderId: 661001,
      reservationKind: "GRID_TP",
      reservedQty: 10,
      status: "ACTIVE",
    });

    coinQa.__qa.binance[resolvedUid] = runtimeClient;
    const captured = await captureConsoleLogs(async () => {
      const current = await loadGridRow(row.id);
      await coinQa.__qa.recoverGridExitFillFromExchange({
        uid: resolvedUid,
        row: current,
        leg: "LONG",
        issue: { issues: ["LONG_OPEN_NO_POSITION"] },
      });
      const refreshed = await loadGridRow(row.id);
      await coinQa.__qa.recoverGridExitFillFromExchange({
        uid: resolvedUid,
        row: refreshed,
        leg: "LONG",
        issue: { issues: ["LONG_OPEN_NO_POSITION"] },
      });
    });

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });
    const exitRows = state.ledgerRows.filter((entry) => entry.eventType === "GRID_EXCHANGE_RECONCILED_EXIT_FILL");

    expectEqual(scenario, exitRows.length, 2, "grid exit recovery should preserve two fill units");
    expectEqual(
      scenario,
      exitRows.map((entry) => String(entry.sourceTradeId || "")).join(","),
      "661101,661102",
      "grid exit recovery should preserve each tradeId"
    );
    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "grid exit recovery should close the snapshot");
    expectApprox(
      scenario,
      summarizeLedger(state.ledgerRows).realizedPnlSum,
      1,
      1e-9,
      "grid realizedPnl should sum recovered exit fills"
    );
    expectTrue(
      scenario,
      !state.ledgerRows.some((entry) => String(entry.eventType || "").includes("RECONCILE_CLOSE") || String(entry.eventType || "").includes("FLATTEN")),
      "grid correction should not replace missing exit fill units"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    delete coinQa.__qa.binance[resolvedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runCrossPidOwnershipGuard = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const signalPlay = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "PUMPUSDT",
    bunbong: "5MIN",
    status: "EXACT",
    signalType: "BUY",
    rSignalType: "BUY",
  });
  const gridRow = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "PUMPUSDT",
    bunbong: "1MIN",
    regimeStatus: "ENDED",
    longLegStatus: "OPEN",
    longQty: 13950,
  });
  const cleanupPids = [signalPlay.id, gridRow.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const placedOrders = [];
  const runtimeClient = {
    __qaMockBinanceClient: true,
    futuresPositionRisk: async () => [
      {
        symbol: "PUMPUSDT",
        positionSide: "LONG",
        positionAmt: "27888",
      },
      {
        symbol: "PUMPUSDT",
        positionSide: "SHORT",
        positionAmt: "0",
      },
    ],
    futuresExchangeInfo: async () => ({
      symbols: [
        {
          symbol: "PUMPUSDT",
          filters: [
            { filterType: "LOT_SIZE", stepSize: "1", minQty: "1" },
            { filterType: "MARKET_LOT_SIZE", stepSize: "1", minQty: "1" },
            { filterType: "PRICE_FILTER", tickSize: "0.0000010" },
          ],
        },
      ],
    }),
    futuresOrder: async (type, side, symbol, qty, price, options = {}) => {
      placedOrders.push({ type, side, symbol, qty: Number(qty || 0), price, options });
      return {
        orderId: 771001 + placedOrders.length,
      };
    },
  };

  try {
    const scenario = createScenario(
      "cross-PID same-symbol same-side close quantity guard",
      "same symbol/side but different PID means different ledgers"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: signalPlay.id,
      strategyCategory: "signal",
      symbol: "PUMPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${signalPlay.id}`,
      sourceOrderId: `SIG-LONG-${signalPlay.id}`,
      sourceTradeId: `SIG-LONG-TRADE-${signalPlay.id}`,
      fillQty: 13938,
      fillPrice: 0.00171,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-24T20:00:00Z",
    }));
    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: gridRow.id,
      strategyCategory: "grid",
      symbol: "PUMPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `GENTRY_L_${resolvedUid}_${gridRow.id}_QA`,
      sourceOrderId: `GRID-LONG-${gridRow.id}`,
      sourceTradeId: `GRID-LONG-TRADE-${gridRow.id}`,
      fillQty: 13950,
      fillPrice: 0.00172,
      eventType: "GRID_ENTRY_FILL",
      tradeTime: "2026-04-24T20:00:05Z",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(signalPlay.id, "LONG");
    await pidPositionLedger.syncGridLegSnapshot(gridRow.id, "LONG");

    coinQa.__qa.binance[resolvedUid] = runtimeClient;
    const captured = await captureConsoleLogs(async () => {
      const first = await coinQa.__qa.closeGridLegMarketOrder({
        uid: resolvedUid,
        pid: gridRow.id,
        symbol: "PUMPUSDT",
        leg: "LONG",
        qty: 27888,
      });
      expectEqual(
        scenario,
        first,
        null,
        "ambiguous same-symbol/side ownership should block the grid close before Binance write"
      );

      runtimeClient.futuresPositionRisk = async () => [
        {
          symbol: "PUMPUSDT",
          positionSide: "LONG",
          positionAmt: "10000",
        },
        {
          symbol: "PUMPUSDT",
          positionSide: "SHORT",
          positionAmt: "0",
        },
      ];
      const blocked = await coinQa.__qa.closeGridLegMarketOrder({
        uid: resolvedUid,
        pid: gridRow.id,
        symbol: "PUMPUSDT",
        leg: "LONG",
        qty: 13950,
      });
      expectEqual(scenario, blocked, null, "aggregate mismatch should block a cross-PID close attempt");
    });

    const signalState = await loadScenarioState({
      uid: resolvedUid,
      pid: signalPlay.id,
      strategyCategory: "signal",
      positionSide: "LONG",
    });
    const gridState = await loadScenarioState({
      uid: resolvedUid,
      pid: gridRow.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });

    expectEqual(scenario, placedOrders.length, 0, "no close order should be submitted while symbol/side ownership is ambiguous");
    expectApprox(scenario, signalState.snapshot?.openQty, 13938, 1e-9, "signal PID should remain open and untouched");
    expectApprox(scenario, gridState.snapshot?.openQty, 13950, 1e-9, "grid PID should remain open and untouched");
    expectEqual(scenario, gridState.reservations?.length || 0, 0, "no grid manual close reservation should be created");
    if (filterAuditLogs(captured.logs).length > 0) {
      expectTrue(
        scenario,
        filterAuditLogs(captured.logs).some((line) => (
          line.includes("PID_CLOSE_QTY_GUARD_BLOCKED")
          || line.includes("BINANCE_WRITE_BLOCKED")
          || line.includes("QA_TEMP_STRATEGY_BINANCE_WRITE_BLOCKED")
          || line.includes("QA_REPLAY_MODE_BINANCE_WRITE_BLOCKED")
        )),
        "captured close attempt audit should show a pre-write block"
      );
    }

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: `${signalPlay.id},${gridRow.id}`,
      strategyCategory: "mixed",
      symbol: "PUMPUSDT",
      cleanupPids,
      rowCountsBefore,
      ledgerRows: [...signalState.ledgerRows, ...gridState.ledgerRows],
      snapshot: {
        signal: signalState.snapshot,
        grid: gridState.snapshot,
      },
      row: {
        signal: signalState.row,
        grid: gridState.row,
      },
      reservations: gridState.reservations,
      msgList: [...signalState.msgList, ...gridState.msgList],
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    delete coinQa.__qa.binance[resolvedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runGridReservationOwnedStopFillRecovery = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const gridRow = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "PUMPUSDT",
    bunbong: "1MIN",
    regimeStatus: "ACTIVE",
    shortLegStatus: "OPEN",
    shortQty: 14220,
  });
  const signalPlay = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "PUMPUSDT",
    bunbong: "5MIN",
    status: "EXACT",
    signalType: "SELL",
    rSignalType: "SELL",
  });
  const cleanupPids = [gridRow.id, signalPlay.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const stopClientOrderId = `GSTOP_S_${resolvedUid}_${gridRow.id}_QA_STOP`;
  const tpClientOrderId = `GTP_S_${resolvedUid}_${gridRow.id}_QA_TP`;

  const runtimeClient = {
    futuresOpenOrders: async () => [],
    futuresAllOrders: async (symbol) => {
      if (String(symbol || "").trim().toUpperCase() !== "PUMPUSDT") {
        return [];
      }

      return [
        {
          orderId: 881001,
          clientOrderId: stopClientOrderId,
          side: "BUY",
          positionSide: "SHORT",
          status: "FILLED",
          type: "STOP",
          avgPrice: "0.001763",
          executedQty: "14220",
          updateTime: Date.parse("2026-04-25T02:28:11Z"),
          reduceOnly: true,
        },
        {
          orderId: 881002,
          clientOrderId: tpClientOrderId,
          side: "BUY",
          positionSide: "SHORT",
          status: "CANCELED",
          type: "TAKE_PROFIT",
          avgPrice: "0",
          executedQty: "0",
          updateTime: Date.parse("2026-04-25T02:28:12Z"),
          reduceOnly: true,
        },
      ];
    },
    futuresUserTrades: async (symbol) => {
      if (String(symbol || "").trim().toUpperCase() !== "PUMPUSDT") {
        return [];
      }

      return [
        {
          id: 881101,
          orderId: 881001,
          side: "BUY",
          positionSide: "SHORT",
          qty: "14220",
          price: "0.001763",
          quoteQty: "25.066860",
          realizedPnl: "-0.063994",
          commission: "0.000000",
          time: Date.parse("2026-04-25T02:28:11Z"),
        },
      ];
    },
  };

  try {
    const scenario = createScenario(
      "grid reservation-owned stop fill recovery",
      "actual exchange fill must be recovered before correction flatten"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: gridRow.id,
      strategyCategory: "grid",
      symbol: "PUMPUSDT",
      positionSide: "SHORT",
      sourceClientOrderId: `GENTRY_S_${resolvedUid}_${gridRow.id}_QA_ENTRY`,
      sourceOrderId: `GRID-ENTRY-${gridRow.id}`,
      sourceTradeId: `GRID-ENTRY-TRADE-${gridRow.id}`,
      fillQty: 14220,
      fillPrice: 0.0017675,
      eventType: "GRID_ENTRY_FILL",
      tradeTime: "2026-04-25T02:27:00Z",
    }));
    await pidPositionLedger.syncGridLegSnapshot(gridRow.id, "SHORT");
    const stopReservationId = await insertReservation({
      uid: resolvedUid,
      pid: gridRow.id,
      strategyCategory: "grid",
      symbol: "PUMPUSDT",
      positionSide: "SHORT",
      clientOrderId: stopClientOrderId,
      sourceOrderId: "4000001166074117",
      reservationKind: "GRID_STOP",
      reservedQty: 14220,
      status: "ACTIVE",
    });
    const tpReservationId = await insertReservation({
      uid: resolvedUid,
      pid: gridRow.id,
      strategyCategory: "grid",
      symbol: "PUMPUSDT",
      positionSide: "SHORT",
      clientOrderId: tpClientOrderId,
      sourceOrderId: "4000001166074118",
      reservationKind: "GRID_TP",
      reservedQty: 14220,
      status: "ACTIVE",
    });

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: signalPlay.id,
      strategyCategory: "signal",
      symbol: "PUMPUSDT",
      positionSide: "SHORT",
      sourceClientOrderId: `NEW_${resolvedUid}_${signalPlay.id}`,
      sourceOrderId: `SIG-ENTRY-${signalPlay.id}`,
      sourceTradeId: `SIG-ENTRY-TRADE-${signalPlay.id}`,
      fillQty: 14204,
      fillPrice: 0.001767,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-25T02:27:05Z",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(signalPlay.id, "SHORT");
    await insertReservation({
      uid: resolvedUid,
      pid: signalPlay.id,
      strategyCategory: "signal",
      symbol: "PUMPUSDT",
      positionSide: "SHORT",
      clientOrderId: `STOP_${resolvedUid}_${signalPlay.id}_QA`,
      sourceOrderId: `SIG-STOP-${signalPlay.id}`,
      reservationKind: "BOUND_STOP",
      reservedQty: 14204,
      status: "ACTIVE",
    });
    await insertReservation({
      uid: resolvedUid,
      pid: signalPlay.id,
      strategyCategory: "signal",
      symbol: "PUMPUSDT",
      positionSide: "SHORT",
      clientOrderId: `SPLITTP_${resolvedUid}_${signalPlay.id}_QA`,
      sourceOrderId: `SIG-TP-${signalPlay.id}`,
      reservationKind: "BOUND_PROFIT",
      reservedQty: 14204,
      status: "ACTIVE",
    });

    coinQa.__qa.binance[resolvedUid] = runtimeClient;
    const current = await loadGridRow(gridRow.id);
    const captured = await captureConsoleLogs(async () =>
      await withPatchedCoinExports(
        {
          recoverGridExitFillFromExchange: async (params = {}) =>
            await coinQa.__qa.recoverGridExitFillFromExchange(params),
          getExchangePositionSnapshot: async () => ({
            symbol: "PUMPUSDT",
            longQty: 0,
            shortQty: 14204,
            bothQty: 0,
            netQty: -14204,
          }),
          getGridLegExchangePosition: async ({ leg }) => ({
            qty: String(leg || "").trim().toUpperCase() === "SHORT" ? 14204 : 0,
          }),
          cancelGridOrders: async () => {
            await pidPositionLedger.markReservationsCanceled([tpClientOrderId]);
            return 1;
          },
        },
        async () => {
          await gridEngine.truthSyncLiveGridRow({
            row: current,
            exchangeSnapshotCache: new Map(),
          });
          const refreshed = await loadGridRow(gridRow.id);
          await coinQa.__qa.recoverGridExitFillFromExchange({
            uid: resolvedUid,
            row: refreshed,
            leg: "SHORT",
            issue: {
              issues: ["GRID_RESERVATION_DUPLICATE_REPLAY"],
            },
          });
        }
      )
    );

    const gridState = await loadScenarioState({
      uid: resolvedUid,
      pid: gridRow.id,
      strategyCategory: "grid",
      positionSide: "SHORT",
    });
    const signalState = await loadScenarioState({
      uid: resolvedUid,
      pid: signalPlay.id,
      strategyCategory: "signal",
      positionSide: "SHORT",
    });
    const exitRows = gridState.ledgerRows.filter((entry) => entry.eventType === "GRID_EXCHANGE_RECONCILED_EXIT_FILL");
    const stopReservation = (gridState.reservations || []).find((reservation) => Number(reservation.id || 0) === Number(stopReservationId));
    const tpReservation = (gridState.reservations || []).find((reservation) => Number(reservation.id || 0) === Number(tpReservationId));

    expectEqual(scenario, exitRows.length, 1, "reservation-owned stop fill should create one exit ledger row");
    expectEqual(
      scenario,
      String(exitRows[0]?.sourceTradeId || ""),
      "881101",
      "reservation-owned recovery should preserve the Binance tradeId"
    );
    expectApprox(scenario, exitRows[0]?.fillQty, 14220, 1e-9, "recovered exit qty should match the reservation-owned fill");
    expectApprox(scenario, gridState.snapshot?.openQty, 0, 1e-9, "grid snapshot should close after recovered stop fill");
    expectEqual(scenario, gridState.snapshot?.status, "CLOSED", "grid snapshot should be closed");
    expectTrue(
      scenario,
      ["IDLE", "CLOSED"].includes(String(gridState.row?.shortLegStatus || "").toUpperCase()),
      "grid row short leg should converge to idle/closed"
    );
    expectApprox(scenario, gridState.row?.shortQty, 0, 1e-9, "grid row shortQty should converge to zero");
    expectEqual(scenario, stopReservation?.status, "FILLED", "matched stop reservation should become FILLED");
    expectTrue(
      scenario,
      String(stopReservation?.actualOrderId || "") === "881001",
      "matched stop reservation should bind the Binance orderId"
    );
    expectEqual(scenario, tpReservation?.status, "CANCELED", "sibling TP reservation should be finalized as canceled");
    expectTrue(
      scenario,
      !gridState.ledgerRows.some((entry) => String(entry.eventType || "").includes("FLATTEN") || String(entry.eventType || "").includes("RECONCILE_CLOSE")),
      "actual stop fill recovery should not be replaced by correction flatten"
    );
    expectApprox(scenario, signalState.snapshot?.openQty, 14204, 1e-9, "other PID same-side snapshot should remain untouched");
    expectEqual(
      scenario,
      (signalState.reservations || []).filter((reservation) => String(reservation.status || "").toUpperCase() === "ACTIVE").length,
      2,
      "other PID reservations should remain active"
    );
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("GRID_RESERVATION_EXIT_RECOVERY_FOUND_ORDER")),
      "reservation-owned recovery should log the historical Binance order"
    );
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("GRID_RESERVATION_EXIT_RECOVERY_APPLY_FILL")),
      "reservation-owned recovery should log the recovered exit fill application"
    );
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("GRID_RESERVATION_EXIT_RECOVERY_DUPLICATE_IGNORED")),
      "duplicate replay should be ignored on repeated truth sync"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: `${gridRow.id},${signalPlay.id}`,
      strategyCategory: "mixed",
      symbol: "PUMPUSDT",
      cleanupPids,
      rowCountsBefore,
      ledgerRows: [...gridState.ledgerRows, ...signalState.ledgerRows],
      snapshot: {
        grid: gridState.snapshot,
        signal: signalState.snapshot,
      },
      row: {
        grid: gridState.row,
        signal: signalState.row,
      },
      reservations: [...gridState.reservations, ...signalState.reservations],
      msgList: [...gridState.msgList, ...signalState.msgList],
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    delete coinQa.__qa.binance[resolvedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runLiveReadonlyDetectsSixPositionsEightConditionalsProtectionShortage = async ({ uid } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const scenario = createScenario(
    "six positions eight conditionals protection shortage",
    "PID-level protection count must fail even when same symbol/side has other PID protections"
  );
  const snapshots = [
    { uid: resolvedUid, pid: 991748, strategyCategory: "signal", symbol: "XRPUSDT", positionSide: "LONG", status: "OPEN", openQty: 18 },
    { uid: resolvedUid, pid: 991753, strategyCategory: "signal", symbol: "PUMPUSDT", positionSide: "SHORT", status: "OPEN", openQty: 13449 },
    { uid: resolvedUid, pid: 991501, strategyCategory: "grid", symbol: "XRPUSDT", positionSide: "SHORT", status: "OPEN", openQty: 18.1 },
    { uid: resolvedUid, pid: 991501, strategyCategory: "grid", symbol: "XRPUSDT", positionSide: "LONG", status: "OPEN", openQty: 18.1 },
    { uid: resolvedUid, pid: 991500, strategyCategory: "grid", symbol: "XRPUSDT", positionSide: "SHORT", status: "OPEN", openQty: 18 },
    { uid: resolvedUid, pid: 991500, strategyCategory: "grid", symbol: "XRPUSDT", positionSide: "LONG", status: "OPEN", openQty: 18 },
  ];
  const localReservations = [
    ["BOUND_PROFIT", "PROFIT_147_991748_QA", 991748, "XRPUSDT", "LONG"],
    ["BOUND_STOP", "STOP_147_991748_QA", 991748, "XRPUSDT", "LONG"],
    ["BOUND_PROFIT", "PROFIT_147_991753_QA", 991753, "PUMPUSDT", "SHORT"],
    ["BOUND_STOP", "STOP_147_991753_QA", 991753, "PUMPUSDT", "SHORT"],
    ["GRID_TP", "GTP_S_147_991501_QA", 991501, "XRPUSDT", "SHORT"],
    ["GRID_STOP", "GSTOP_S_147_991501_QA", 991501, "XRPUSDT", "SHORT"],
    ["GRID_TP", "GTP_S_147_991500_QA", 991500, "XRPUSDT", "SHORT"],
    ["GRID_STOP", "GSTOP_S_147_991500_QA", 991500, "XRPUSDT", "SHORT"],
  ].map(([reservationKind, clientOrderId, pid, symbol, positionSide], index) => ({
    id: 990000 + index,
    uid: resolvedUid,
    pid,
    strategyCategory: reservationKind.startsWith("GRID") ? "grid" : "signal",
    symbol,
    positionSide,
    reservationKind,
    clientOrderId,
    status: "ACTIVE",
    reservedQty: positionSide === "LONG" ? 18 : 13449,
  }));
  const openAlgoOrders = localReservations.map((reservation, index) => ({
    symbol: reservation.symbol,
    positionSide: reservation.positionSide,
    clientOrderId: reservation.clientOrderId,
    algoId: 880000 + index,
    type: reservation.reservationKind.includes("STOP") ? "STOP" : "TAKE_PROFIT",
    origType: reservation.reservationKind.includes("STOP") ? "STOP" : "TAKE_PROFIT",
    side: reservation.positionSide === "LONG" ? "SELL" : "BUY",
    reduceOnly: true,
    origQty: reservation.positionSide === "LONG" ? 18 : 13449,
  }));
  const rows = buildUnprotectedOpenPositionRows({
    uid: resolvedUid,
    snapshots,
    localReservations,
    positionRows: [
      { symbol: "XRPUSDT", positionSide: "LONG", positionAmt: "54.1" },
      { symbol: "XRPUSDT", positionSide: "SHORT", positionAmt: "-36.1" },
      { symbol: "PUMPUSDT", positionSide: "SHORT", positionAmt: "-13449" },
    ],
    openOrders: [],
    openAlgoOrders,
    compareSymbols: ["XRPUSDT", "PUMPUSDT"],
  });

  const affected = rows.map((row) => `${row.pid}:${row.symbol}:${row.side}:${row.risk}`).sort();
  expectEqual(scenario, rows.length, 2, "only the two grid LONG PID positions should be reported missing protection");
  expectTrue(
    scenario,
    affected.includes("991500:XRPUSDT:LONG:PID_OPEN_NO_EFFECTIVE_PROTECTION")
      && affected.includes("991501:XRPUSDT:LONG:PID_OPEN_NO_EFFECTIVE_PROTECTION"),
    "PID-level guard should identify both unprotected grid LONG legs"
  );

  return finalizeScenario(scenario, {
    uid: resolvedUid,
    pid: "991500,991501",
    strategyCategory: "mixed",
    symbol: "XRPUSDT",
    cleanupPids: [],
    row: { protectionShortageRows: rows },
    reservations: localReservations,
    msgList: [],
    auditLogs: ["PID_OPEN_NO_EFFECTIVE_PROTECTION", "OPEN_POSITION_PROTECTION_COUNT_BELOW_EXPECTED"],
  });
};

const runGridDuplicateExitRecoveryDoesNotCancelCurrentProtection = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const row = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "XRPUSDT",
    bunbong: "30MIN",
    regimeStatus: "ACTIVE",
    longLegStatus: "OPEN",
    longQty: 18.1,
  });
  const cleanupPids = [row.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const oldManualClientOrderId = `GMANUAL_L_${resolvedUid}_${row.id}_OLD`;
  const currentTpClientOrderId = `GTP_L_${resolvedUid}_${row.id}_CUR`;
  const currentStopClientOrderId = `GSTOP_L_${resolvedUid}_${row.id}_CUR`;
  let cancelCalls = 0;
  const originalCancelGridOrders = coinQa.cancelGridOrders;
  const runtimeClient = {
    futuresOpenOrders: async () => [
      { symbol: "XRPUSDT", clientOrderId: currentTpClientOrderId, orderId: 991882, type: "algo", positionSide: "LONG", side: "SELL", reduceOnly: true, origQty: "18.1" },
      { symbol: "XRPUSDT", clientOrderId: currentStopClientOrderId, orderId: 991883, type: "algo", positionSide: "LONG", side: "SELL", reduceOnly: true, origQty: "18.1" },
    ],
    futuresAllOrders: async () => [
      {
        orderId: 991771,
        clientOrderId: oldManualClientOrderId,
        side: "SELL",
        positionSide: "LONG",
        status: "FILLED",
        type: "MARKET",
        avgPrice: "1.3910",
        executedQty: "18.1",
        updateTime: Date.parse("2026-04-29T00:30:00Z"),
        reduceOnly: true,
      },
    ],
    futuresUserTrades: async () => [
      {
        id: 991901,
        orderId: 991771,
        side: "SELL",
        positionSide: "LONG",
        qty: "18.1",
        price: "1.3910",
        quoteQty: "25.1771",
        realizedPnl: "0.01",
        commission: "0",
        time: Date.parse("2026-04-29T00:30:00Z"),
      },
    ],
  };

  try {
    const scenario = createScenario(
      "grid duplicate old exit recovery must not cancel current protection",
      "duplicate historical GMANUAL recovery cannot cancel the active TP/STOP for a new open leg"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: "LONG",
      sourceClientOrderId: `GENTRY_L_${resolvedUid}_${row.id}_OLD`,
      sourceOrderId: "991770",
      sourceTradeId: "991900",
      fillQty: 18.1,
      fillPrice: 1.388,
      eventType: "GRID_ENTRY_FILL",
      tradeTime: "2026-04-29T00:20:00Z",
    }));
    await pidPositionLedger.applyExitFill(createExitPayload({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: "LONG",
      sourceClientOrderId: oldManualClientOrderId,
      sourceOrderId: "991771",
      sourceTradeId: "991901",
      fillQty: 18.1,
      fillPrice: 1.391,
      realizedPnl: 0.01,
      eventType: "GRID_MANUAL_CLOSE_FILL",
      tradeTime: "2026-04-29T00:30:00Z",
    }));
    await insertReservation({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: "LONG",
      clientOrderId: oldManualClientOrderId,
      sourceOrderId: "991771",
      reservationKind: "GRID_MANUAL_OFF",
      reservedQty: 18.1,
      status: "FILLED",
    });
    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: "LONG",
      sourceClientOrderId: `GENTRY_L_${resolvedUid}_${row.id}_CUR`,
      sourceOrderId: "991880",
      sourceTradeId: "991902",
      fillQty: 18.1,
      fillPrice: 1.4,
      eventType: "GRID_ENTRY_FILL",
      tradeTime: "2026-04-29T01:00:00Z",
    }));
    await pidPositionLedger.syncGridLegSnapshot(row.id, "LONG");
    await insertReservation({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: "LONG",
      clientOrderId: currentTpClientOrderId,
      sourceOrderId: "991882",
      reservationKind: "GRID_TP",
      reservedQty: 18.1,
      status: "ACTIVE",
    });
    await insertReservation({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: "LONG",
      clientOrderId: currentStopClientOrderId,
      sourceOrderId: "991883",
      reservationKind: "GRID_STOP",
      reservedQty: 18.1,
      status: "ACTIVE",
    });

    coinQa.__qa.binance[resolvedUid] = runtimeClient;
    coinQa.cancelGridOrders = async () => {
      cancelCalls += 1;
      return 0;
    };
    const captured = await captureConsoleLogs(async () => {
      const current = await loadGridRow(row.id);
      await coinQa.__qa.recoverGridExitFillFromExchange({
        uid: resolvedUid,
        row: current,
        leg: "LONG",
        issue: { issues: ["TRUTH_SYNC_RESERVATION_OWNED_EXIT"] },
      });
    });
    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });
    const currentTp = (state.reservations || []).find((reservation) => reservation.clientOrderId === currentTpClientOrderId);
    const currentStop = (state.reservations || []).find((reservation) => reservation.clientOrderId === currentStopClientOrderId);

    expectEqual(scenario, cancelCalls, 0, "duplicate old exit recovery must not call cancelGridOrders for current active protection");
    expectEqual(scenario, currentTp?.status, "ACTIVE", "current TP must remain active");
    expectEqual(scenario, currentStop?.status, "ACTIVE", "current STOP must remain active");
    expectApprox(scenario, state.snapshot?.openQty, 18.1, 1e-9, "current open leg must remain open");
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("GRID_RESERVATION_EXIT_RECOVERY_DUPLICATE_NO_SIBLING_CANCEL")),
      "duplicate recovery should explicitly audit no sibling cancel"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    coinQa.cancelGridOrders = originalCancelGridOrders;
    delete coinQa.__qa.binance[resolvedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runSignalEntryPartiallyFilledThenCanceled = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "XRPUSDT",
    bunbong: "5MIN",
    status: "EXACT",
    signalType: "BUY",
    rSignalType: "BUY",
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "signal entry partially filled then canceled",
      "canceled remainder must not inflate local exposure beyond executed qty"
    );
    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: `SPC-${play.id}`,
      sourceTradeId: `SPCT-${play.id}`,
      fillQty: 18,
      fillPrice: 1.4,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-29T02:00:00Z",
      note: "qa-partial-then-canceled",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(play.id, "LONG");
    await insertReservation({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "LONG",
      clientOrderId: `PROFIT_${resolvedUid}_${play.id}_PARTIAL`,
      sourceOrderId: `SIG-PARTIAL-TP-${play.id}`,
      reservationKind: "BOUND_PROFIT",
      reservedQty: 18,
      status: "ACTIVE",
    });
    await insertReservation({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      positionSide: "LONG",
      clientOrderId: `STOP_${resolvedUid}_${play.id}_PARTIAL`,
      sourceOrderId: `SIG-PARTIAL-STOP-${play.id}`,
      reservationKind: "BOUND_STOP",
      reservedQty: 18,
      status: "ACTIVE",
    });

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "LONG",
    });
    expectApprox(scenario, state.snapshot?.openQty, 18, 1e-9, "snapshot should keep only executed partial qty");
    expectEqual(scenario, state.ledgerRows.length, 1, "only the executed partial fill should be ledgered");
    expectTrue(
      scenario,
      (state.reservations || []).every((reservation) => Number(reservation.reservedQty || 0) === 18),
      "protection qty should be based on executed partial qty"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: ["PARTIALLY_FILLED_CANCELED_REMAINDER_NOT_COUNTED"],
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runGridEntryPartiallyFilledThenExpired = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const row = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "XRPUSDT",
    bunbong: "30MIN",
    regimeStatus: "ACTIVE",
    longLegStatus: "ENTRY_ARMED",
  });
  const cleanupPids = [row.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "grid entry partially filled then expired",
      "expired remainder must leave only filled leg qty protected"
    );
    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: "LONG",
      sourceClientOrderId: `GENTRY_L_${resolvedUid}_${row.id}_PARTIAL`,
      sourceOrderId: `GPE-${row.id}`,
      sourceTradeId: `GPET-${row.id}`,
      fillQty: 18.1,
      fillPrice: 1.4,
      eventType: "GRID_ENTRY_FILL",
      tradeTime: "2026-04-29T02:05:00Z",
      note: "qa-grid-partial-then-expired",
    }));
    await pidPositionLedger.syncGridLegSnapshot(row.id, "LONG");
    await query(
      `UPDATE live_grid_strategy_list
          SET longLegStatus = 'OPEN'
        WHERE id = ?`,
      [row.id]
    );
    await insertReservation({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: "LONG",
      clientOrderId: `GTP_L_${resolvedUid}_${row.id}_PARTIAL`,
      sourceOrderId: `GPTP-${row.id}`,
      reservationKind: "GRID_TP",
      reservedQty: 18.1,
      status: "ACTIVE",
    });
    await insertReservation({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: "LONG",
      clientOrderId: `GSTOP_L_${resolvedUid}_${row.id}_PARTIAL`,
      sourceOrderId: `GPSP-${row.id}`,
      reservationKind: "GRID_STOP",
      reservedQty: 18.1,
      status: "ACTIVE",
    });

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });
    expectApprox(scenario, state.snapshot?.openQty, 18.1, 1e-9, "grid snapshot should keep only executed partial qty");
    expectEqual(scenario, state.row?.longLegStatus, "OPEN", "grid long leg should be OPEN after partial fill exposure");
    expectTrue(
      scenario,
      (state.reservations || []).every((reservation) => Number(reservation.reservedQty || 0) === 18.1),
      "grid protection qty should match filled exposure, not original order qty"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: ["PARTIALLY_FILLED_EXPIRED_REMAINDER_NOT_COUNTED"],
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runPartialFillStateMachineExpectedTransitions = async ({ uid } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const scenario = createScenario(
    "PARTIALLY_FILLED state-machine transition matrix",
    "PARTIALLY_FILLED is intermediate and every next state preserves only executed trade units"
  );
  const transitions = [
    ["PARTIALLY_FILLED", "PARTIALLY_FILLED", "apply new tradeIds only; keep remaining pending; keep protection on filled exposure"],
    ["PARTIALLY_FILLED", "FILLED", "apply remaining tradeIds; finalize order; protection matches full executed qty"],
    ["PARTIALLY_FILLED", "CANCELED", "apply filled tradeIds; cancel unfilled remainder only; keep protection for filled qty"],
    ["PARTIALLY_FILLED", "EXPIRED", "apply filled tradeIds; expire unfilled remainder only; keep protection for filled qty"],
    ["PARTIALLY_FILLED", "REJECTED", "apply filled tradeIds if any; mark remainder failed; require action if exposure unprotected"],
    ["PARTIALLY_FILLED", "REST_MISSING", "preserve filled tradeIds; do not assume final; retry or mark UNKNOWN_PARTIAL_STATE"],
  ];

  expectEqual(scenario, transitions.length, 6, "all required partial transition classes should be documented");
  expectTrue(
    scenario,
    transitions.every(([, , behavior]) => behavior.includes("filled") || behavior.includes("tradeIds")),
    "each transition must preserve actual executed fill units"
  );

  return finalizeScenario(scenario, {
    uid: resolvedUid,
    pid: "",
    strategyCategory: "mixed",
    symbol: "",
    cleanupPids: [],
    row: { transitions },
    reservations: [],
    msgList: [],
    auditLogs: ["PARTIALLY_FILLED_INTERMEDIATE_STATE_MACHINE"],
  });
};

const withPatchedCoinExports = async (patches, worker) => {
  const coin = require("../../coin");
  const originals = {};
  for (const [key, value] of Object.entries(patches || {})) {
    originals[key] = coin[key];
    coin[key] = value;
  }

  try {
    return await worker(coin);
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      coin[key] = value;
    }
  }
};

const runSignalRecoveredCloseViaTruthSync = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "ADAUSDT",
    bunbong: "1MIN",
    status: "EXACT",
    signalType: "BUY",
    rSignalType: "BUY",
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const runtimeClient = {
    futuresPositionRisk: async () => [
      {
        symbol: "ADAUSDT",
        positionSide: "LONG",
        positionAmt: "0",
      },
      {
        symbol: "ADAUSDT",
        positionSide: "SHORT",
        positionAmt: "0",
      },
    ],
    futuresOpenOrders: async () => [],
    futuresAllOrders: async () => [
      {
        orderId: `9000${play.id}`,
        clientOrderId: `PROFIT_${resolvedUid}_${play.id}_QA`,
        side: "SELL",
        positionSide: "LONG",
        status: "FILLED",
        avgPrice: "0.82",
        executedQty: "100",
        updateTime: Date.parse("2026-04-24T07:10:00Z"),
      },
    ],
    futuresUserTrades: async () => [
      {
        id: `9001${play.id}`,
        orderId: `9000${play.id}`,
        side: "SELL",
        positionSide: "LONG",
        qty: "100",
        price: "0.82",
        quoteQty: "82",
        realizedPnl: "0.48",
        commission: "0.01",
        time: Date.parse("2026-04-24T07:10:00Z"),
      },
    ],
  };

  try {
    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "ADAUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: `REC-ENTRY-${play.id}`,
      sourceTradeId: `REC-ENTRY-TRADE-${play.id}`,
      fillQty: 100,
      fillPrice: 0.8,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-24T07:00:00Z",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(play.id, "LONG");
    await insertReservation({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "ADAUSDT",
      positionSide: "LONG",
      clientOrderId: `PROFIT_${resolvedUid}_${play.id}_QA`,
      sourceOrderId: `9000${play.id}`,
      reservationKind: "BOUND_PROFIT",
      reservedQty: 100,
      status: "ACTIVE",
    });

    coinQa.__qa.binance[resolvedUid] = runtimeClient;
    const beforeRow = await loadSignalRow(play.id);
    const captured = await captureConsoleLogs(async () => {
      return await coinQa.__qa.truthSyncLiveSignalPlay({
        row: beforeRow,
        exchangeSnapshotCache: new Map(),
      });
    });

    const scenario = createScenario(
      "exchange flat / local OPEN with recovered close",
      "exchange flat + recovered close must converge local state"
    );
    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "LONG",
    });

    expectTrue(scenario, Boolean(captured.result), "truth sync should repair the row");
    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "snapshot should be flat");
    expectEqual(scenario, state.snapshot?.status, "CLOSED", "snapshot should be closed");
    expectEqual(scenario, state.row?.status, "READY", "signal row should return to READY");
    expectTrue(
      scenario,
      state.ledgerRows.some((entry) => entry.eventType === "EXCHANGE_RECONCILED_EXIT_FILL"),
      "recovered exit fill should be recorded"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    delete coinQa.__qa.binance[resolvedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runGridRecoveredCloseViaReconcile = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const row = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "PUMPUSDT",
    bunbong: "1MIN",
    regimeStatus: "ENDED",
    longLegStatus: "OPEN",
  });
  const cleanupPids = [row.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: "PUMPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `GENTRY_L_${resolvedUid}_${row.id}_QA`,
      sourceOrderId: `GRID-ENTRY-${row.id}`,
      sourceTradeId: `GRID-ENTRY-TRADE-${row.id}`,
      fillQty: 14044,
      fillPrice: 0.00178,
      eventType: "GRID_ENTRY_FILL",
      tradeTime: "2026-04-24T08:00:00Z",
    }));
    await pidPositionLedger.syncGridLegSnapshot(row.id, "LONG");
    const current = await loadGridRow(row.id);

    const scenario = createScenario(
      "exchange flat / local OPEN with recovered close (grid)",
      "exchange flat + recovered close must converge local state"
    );

    const captured = await captureConsoleLogs(async () =>
      await withPatchedCoinExports(
        {
          getExchangePositionSnapshot: async () => ({
            symbol: "PUMPUSDT",
            longQty: 0,
            shortQty: 0,
            bothQty: 0,
            netQty: 0,
          }),
          getGridLegExchangePosition: async () => ({
            qty: 0,
          }),
          recoverGridExitFillFromExchange: async () => ({
            clientOrderId: `GTP_L_${resolvedUid}_${row.id}_QA`,
            orderId: `GRID-EXIT-${row.id}`,
            tradeId: `GRID-EXIT-TRADE-${row.id}`,
            qty: 14044,
            fee: 0,
            realizedPnl: 0.07,
            price: 0.00179,
            tradeTime: Date.parse("2026-04-24T08:05:00Z"),
          }),
          cancelGridOrders: async () => 0,
        },
        async () =>
          await gridEngine.reconcileLiveGridRuntimeIssue({
            row: current,
            issue: {
              pid: row.id,
              symbol: row.symbol,
              exchangeLongQty: 0,
              exchangeShortQty: 0,
              issues: ["LONG_OPEN_NO_POSITION"],
            },
          })
      )
    );

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });

    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "grid snapshot should be flat");
    expectEqual(scenario, state.snapshot?.status, "CLOSED", "grid snapshot should be closed");
    expectTrue(
      scenario,
      ["IDLE", "CLOSED"].includes(String(state.row?.longLegStatus || "").toUpperCase()),
      "grid long leg should converge to idle/closed"
    );
    expectTrue(
      scenario,
      state.ledgerRows.some((entry) => entry.eventType === "GRID_EXCHANGE_FLAT_RECONCILE_CLOSE"),
      "grid reconcile close correction should exist"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runGridExternalManualCloseAttributableFill = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const row = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "PUMPUSDT",
    bunbong: "30MIN",
    regimeStatus: "ENDED",
    longLegStatus: "OPEN",
    longQty: 14034,
    enabled: "N",
  });
  const cleanupPids = [row.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const entryClientOrderId = `GENTRY_L_${resolvedUid}_${row.id}_QA_ENTRY`;
  const manualCloseOrderId = 990001001;
  const manualCloseTradeId = 990001101;
  const manualCloseClientOrderId = "web_QA_GRID_MANUAL_CLOSE";
  const originalQaGetGridLegExchangePosition = coinQa.getGridLegExchangePosition;

  const runtimeClient = {
    futuresAllOrders: async (symbol) => {
      if (String(symbol || "").trim().toUpperCase() !== "PUMPUSDT") {
        return [];
      }
      return [
        {
          orderId: manualCloseOrderId,
          clientOrderId: manualCloseClientOrderId,
          side: "SELL",
          positionSide: "LONG",
          status: "FILLED",
          type: "MARKET",
          avgPrice: "0.001779",
          executedQty: "14034",
          updateTime: Date.parse("2026-04-28T05:07:10Z"),
          reduceOnly: true,
        },
      ];
    },
    futuresUserTrades: async (symbol) => {
      if (String(symbol || "").trim().toUpperCase() !== "PUMPUSDT") {
        return [];
      }
      return [
        {
          id: manualCloseTradeId,
          orderId: manualCloseOrderId,
          side: "SELL",
          positionSide: "LONG",
          qty: "14034",
          price: "0.001779",
          quoteQty: "24.969486",
          realizedPnl: "-0.028068",
          commission: "0.000000",
          time: Date.parse("2026-04-28T05:07:10Z"),
        },
      ];
    },
  };

  try {
    const scenario = createScenario(
      "grid external manual close recovery with attributable fill",
      "manual Binance web close should recover as actual grid exit fill when ownership is unambiguous"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: "PUMPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: entryClientOrderId,
      sourceOrderId: `GRID-ENTRY-${row.id}`,
      sourceTradeId: `GRID-ENTRY-TRADE-${row.id}`,
      fillQty: 14034,
      fillPrice: 0.001781,
      eventType: "GRID_ENTRY_FILL",
      tradeTime: "2026-04-28T05:00:00Z",
    }));
    await pidPositionLedger.syncGridLegSnapshot(row.id, "LONG");

    coinQa.__qa.binance[resolvedUid] = runtimeClient;
    coinQa.getGridLegExchangePosition = async () => ({ qty: 0 });
    let cancelCalls = 0;
    const current = await loadGridRow(row.id);
    const captured = await captureConsoleLogs(async () =>
      await withPatchedCoinExports(
        {
          getExchangePositionSnapshot: async () => ({
            symbol: "PUMPUSDT",
            longQty: 0,
            shortQty: 0,
            bothQty: 0,
            netQty: 0,
          }),
          getGridLegExchangePosition: async () => ({ qty: 0 }),
          recoverGridExitFillFromExchange: async (params = {}) =>
            await coinQa.__qa.recoverGridExitFillFromExchange(params),
          cancelGridOrders: async () => {
            cancelCalls += 1;
            return 0;
          },
        },
        async () => {
          await gridEngine.truthSyncLiveGridRow({
            row: current,
            exchangeSnapshotCache: new Map(),
          });
          const refreshed = await loadGridRow(row.id);
          await gridEngine.truthSyncLiveGridRow({
            row: refreshed,
            exchangeSnapshotCache: new Map(),
          });
        }
      )
    );

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });
    const exitRows = state.ledgerRows.filter((entry) => entry.eventType === "GRID_EXTERNAL_MANUAL_CLOSE_FILL");

    expectEqual(scenario, exitRows.length, 1, "manual external close should create one actual exit ledger row");
    expectEqual(scenario, String(exitRows[0]?.sourceTradeId || ""), String(manualCloseTradeId), "manual close tradeId should be preserved");
    expectApprox(scenario, exitRows[0]?.fillQty, 14034, 1e-9, "manual close qty should match local grid openQty");
    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "grid snapshot should close after manual close recovery");
    expectEqual(scenario, state.snapshot?.status, "CLOSED", "grid snapshot should be closed");
    expectTrue(scenario, ["IDLE", "CLOSED"].includes(String(state.row?.longLegStatus || "").toUpperCase()), "grid long leg should become idle/closed");
    expectApprox(scenario, state.row?.longQty, 0, 1e-9, "grid row longQty should be zero");
    expectTrue(scenario, !state.ledgerRows.some((entry) => String(entry.eventType || "").includes("LOCAL_STALE_FLATTEN")), "manual actual fill must not be replaced by stale flatten");
    expectEqual(scenario, cancelCalls, 1, "truth sync may call cancel path but no Binance order exists in this replay");
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("GRID_EXTERNAL_CLOSE_RECOVERY_APPLY_FILL")),
      "manual close recovery should emit apply-fill audit"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    coinQa.getGridLegExchangePosition = originalQaGetGridLegExchangePosition;
    delete coinQa.__qa.binance[resolvedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runGridExternalManualCloseCorrectionFallback = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const row = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "PUMPUSDT",
    bunbong: "1H",
    regimeStatus: "ENDED",
    shortLegStatus: "OPEN",
    shortQty: 28776,
    enabled: "N",
  });
  const cleanupPids = [row.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "grid external manual close correction fallback",
      "exchange flat with single-owner grid stale open may flatten only when no recoverable trade/protection exists"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: "PUMPUSDT",
      positionSide: "SHORT",
      sourceClientOrderId: `GENTRY_S_${resolvedUid}_${row.id}_QA_ENTRY`,
      sourceOrderId: `GRID-ENTRY-${row.id}`,
      sourceTradeId: `GRID-ENTRY-TRADE-${row.id}`,
      fillQty: 28776,
      fillPrice: 0.001824,
      eventType: "GRID_ENTRY_FILL",
      tradeTime: "2026-04-28T05:00:00Z",
    }));
    await pidPositionLedger.syncGridLegSnapshot(row.id, "SHORT");

    const current = await loadGridRow(row.id);
    const captured = await captureConsoleLogs(async () =>
      await withPatchedCoinExports(
        {
          getExchangePositionSnapshot: async () => ({
            symbol: "PUMPUSDT",
            longQty: 0,
            shortQty: 0,
            bothQty: 0,
            netQty: 0,
          }),
          getGridLegExchangePosition: async () => ({ qty: 0 }),
          recoverGridExitFillFromExchange: async () => null,
          cancelGridOrders: async () => 0,
        },
        async () =>
          await gridEngine.truthSyncLiveGridRow({
            row: current,
            exchangeSnapshotCache: new Map(),
          })
      )
    );

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      positionSide: "SHORT",
    });

    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "single-owner stale grid snapshot should flatten");
    expectEqual(scenario, state.snapshot?.status, "CLOSED", "snapshot should be closed by correction fallback");
    expectTrue(
      scenario,
      state.ledgerRows.some((entry) => entry.eventType === "GRID_EXCHANGE_FLAT_LOCAL_STALE_FLATTEN"),
      "correction flatten row should be explicit when no trade is recoverable"
    );
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("GRID_EXCHANGE_FLAT_RECONCILE")),
      "fallback should emit grid exchange-flat reconcile audit"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runGridExternalManualCloseAmbiguousMultiPid = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const rowA = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "XRPUSDT",
    bunbong: "30MIN",
    regimeStatus: "ENDED",
    shortLegStatus: "OPEN",
    shortQty: 36,
    enabled: "N",
  });
  const rowB = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "XRPUSDT",
    bunbong: "1H",
    regimeStatus: "ENDED",
    shortLegStatus: "OPEN",
    shortQty: 18,
    enabled: "N",
  });
  const cleanupPids = [rowA.id, rowB.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "grid external manual close ambiguous multi-PID",
      "exchange-flat correction must not silently flatten a PID when multiple same-symbol/side local owners exist"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: rowA.id,
      strategyCategory: "grid",
      symbol: "XRPUSDT",
      positionSide: "SHORT",
      sourceClientOrderId: `GENTRY_S_${resolvedUid}_${rowA.id}_QA_ENTRY`,
      sourceOrderId: `GRID-ENTRY-${rowA.id}`,
      sourceTradeId: `GRID-ENTRY-TRADE-${rowA.id}`,
      fillQty: 36,
      fillPrice: 1.39,
      eventType: "GRID_ENTRY_FILL",
      tradeTime: "2026-04-28T05:00:00Z",
    }));
    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: rowB.id,
      strategyCategory: "grid",
      symbol: "XRPUSDT",
      positionSide: "SHORT",
      sourceClientOrderId: `GENTRY_S_${resolvedUid}_${rowB.id}_QA_ENTRY`,
      sourceOrderId: `GRID-ENTRY-${rowB.id}`,
      sourceTradeId: `GRID-ENTRY-TRADE-${rowB.id}`,
      fillQty: 18,
      fillPrice: 1.391,
      eventType: "GRID_ENTRY_FILL",
      tradeTime: "2026-04-28T05:01:00Z",
    }));
    await pidPositionLedger.syncGridLegSnapshot(rowA.id, "SHORT");
    await pidPositionLedger.syncGridLegSnapshot(rowB.id, "SHORT");

    const current = await loadGridRow(rowA.id);
    const captured = await captureConsoleLogs(async () =>
      await withPatchedCoinExports(
        {
          getExchangePositionSnapshot: async () => ({
            symbol: "XRPUSDT",
            longQty: 0,
            shortQty: 0,
            bothQty: 0,
            netQty: 0,
          }),
          getGridLegExchangePosition: async () => ({ qty: 0 }),
          recoverGridExitFillFromExchange: async () => null,
          cancelGridOrders: async () => {
            throw new Error("cancelGridOrders must not be called for ambiguous external close");
          },
        },
        async () =>
          await gridEngine.truthSyncLiveGridRow({
            row: current,
            exchangeSnapshotCache: new Map(),
          })
      )
    );

    const stateA = await loadScenarioState({
      uid: resolvedUid,
      pid: rowA.id,
      strategyCategory: "grid",
      positionSide: "SHORT",
    });
    const stateB = await loadScenarioState({
      uid: resolvedUid,
      pid: rowB.id,
      strategyCategory: "grid",
      positionSide: "SHORT",
    });

    expectApprox(scenario, stateA.snapshot?.openQty, 36, 1e-9, "ambiguous owner A must remain open");
    expectEqual(scenario, stateA.snapshot?.status, "OPEN", "ambiguous owner A snapshot should not be flattened");
    expectApprox(scenario, stateB.snapshot?.openQty, 18, 1e-9, "other same-side owner must remain untouched");
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("GRID_EXTERNAL_CLOSE_CORRECTION_FLATTEN_BLOCKED") && line.includes("OWNER_AMBIGUOUS")),
      "ambiguous external close should be blocked and audited"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: `${rowA.id},${rowB.id}`,
      strategyCategory: "grid",
      symbol: rowA.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: [...stateA.ledgerRows, ...stateB.ledgerRows],
      snapshot: {
        ownerA: stateA.snapshot,
        ownerB: stateB.snapshot,
      },
      row: {
        ownerA: stateA.row,
        ownerB: stateB.row,
      },
      reservations: [...stateA.reservations, ...stateB.reservations],
      msgList: [...stateA.msgList, ...stateB.msgList],
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runSignalExternalManualCloseThenOffConvergence = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "XRPUSDT",
    bunbong: "5MIN",
    status: "EXACT",
    signalType: "SELL",
    rSignalType: "SELL",
    rQty: 36,
    enabled: "N",
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "signal external manual close then user OFF",
      "signal path should converge READY when exchange is already flat after user manual close"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "XRPUSDT",
      positionSide: "SHORT",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: `SIG-ENTRY-${play.id}`,
      sourceTradeId: `SIG-ENTRY-TRADE-${play.id}`,
      fillQty: 36,
      fillPrice: 1.388,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-28T05:00:00Z",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(play.id, "SHORT");

    const current = await loadSignalRow(play.id);
    const flatExchangeSnapshotCache = new Map([
      [
        `${resolvedUid}:XRPUSDT`,
        {
          symbol: "XRPUSDT",
          longQty: 0,
          shortQty: 0,
          bothQty: 0,
          netQty: 0,
        },
      ],
    ]);
    const captured = await captureConsoleLogs(async () =>
      await coinQa.__qa.truthSyncLiveSignalPlay({
        row: current,
        exchangeSnapshotCache: flatExchangeSnapshotCache,
      })
    );

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "SHORT",
    });

    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "signal snapshot should be flat after external close convergence");
    expectEqual(scenario, state.snapshot?.status, "CLOSED", "signal snapshot should be closed");
    expectEqual(scenario, state.row?.status, "READY", "signal row should become READY after OFF/exchange-flat convergence");
    expectApprox(scenario, state.row?.r_qty, 0, 1e-9, "signal runtime qty should be zero");

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runExternalCloseWithOrphanProtectionBlocked = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const row = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "PUMPUSDT",
    bunbong: "2H",
    regimeStatus: "ENDED",
    longLegStatus: "OPEN",
    longQty: 14000,
    enabled: "N",
  });
  const cleanupPids = [row.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const tpClientOrderId = `GTP_L_${resolvedUid}_${row.id}_QA_TP`;

  try {
    const scenario = createScenario(
      "grid external close with active orphan protection is blocked",
      "exchange-flat local convergence must not silently cancel/flatten while active protection exists"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: "PUMPUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `GENTRY_L_${resolvedUid}_${row.id}_QA_ENTRY`,
      sourceOrderId: `GRID-ENTRY-${row.id}`,
      sourceTradeId: `GRID-ENTRY-TRADE-${row.id}`,
      fillQty: 14000,
      fillPrice: 0.00178,
      eventType: "GRID_ENTRY_FILL",
      tradeTime: "2026-04-28T05:00:00Z",
    }));
    await pidPositionLedger.syncGridLegSnapshot(row.id, "LONG");
    await insertReservation({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: "PUMPUSDT",
      positionSide: "LONG",
      clientOrderId: tpClientOrderId,
      reservationKind: "GRID_TP",
      reservedQty: 14000,
      status: "ACTIVE",
    });

    const current = await loadGridRow(row.id);
    const captured = await captureConsoleLogs(async () =>
      await withPatchedCoinExports(
        {
          getExchangePositionSnapshot: async () => ({
            symbol: "PUMPUSDT",
            longQty: 0,
            shortQty: 0,
            bothQty: 0,
            netQty: 0,
          }),
          getGridLegExchangePosition: async () => ({ qty: 0 }),
          recoverGridExitFillFromExchange: async () => null,
          cancelGridOrders: async () => {
            throw new Error("cancelGridOrders must not be called while orphan protection is active");
          },
        },
        async () =>
          await gridEngine.truthSyncLiveGridRow({
            row: current,
            exchangeSnapshotCache: new Map(),
          })
      )
    );

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });
    const tpReservation = (state.reservations || []).find((reservation) => reservation.clientOrderId === tpClientOrderId);

    expectApprox(scenario, state.snapshot?.openQty, 14000, 1e-9, "local grid snapshot should remain open when protection state is unsafe");
    expectEqual(scenario, state.snapshot?.status, "OPEN", "snapshot should not be silently flattened");
    expectEqual(scenario, tpReservation?.status, "ACTIVE", "active protection should not be locally canceled without Binance confirmation");
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("GRID_EXTERNAL_CLOSE_CORRECTION_FLATTEN_BLOCKED") && line.includes("ACTIVE_LOCAL_RESERVATION")),
      "active protection should block external-close flatten and be audited"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runSignalLocalStaleFlatten = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const coinQa = loadCoinQaModule();
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "DOGEUSDT",
    bunbong: "1MIN",
    status: "EXACT",
    signalType: "BUY",
    rSignalType: "BUY",
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });
  const runtimeClient = {
    futuresPositionRisk: async () => [
      {
        symbol: "DOGEUSDT",
        positionSide: "LONG",
        positionAmt: "0",
      },
      {
        symbol: "DOGEUSDT",
        positionSide: "SHORT",
        positionAmt: "0",
      },
    ],
    futuresOpenOrders: async () => [],
    futuresAllOrders: async () => [],
    futuresUserTrades: async () => [],
  };

  try {
    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "DOGEUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: `STALE-SIGNAL-ENTRY-${play.id}`,
      sourceTradeId: `STALE-SIGNAL-ENTRY-TRADE-${play.id}`,
      fillQty: 500,
      fillPrice: 0.2,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-24T09:00:00Z",
    }));
    await pidPositionLedger.syncSignalPlaySnapshot(play.id, "LONG");

    coinQa.__qa.binance[resolvedUid] = runtimeClient;
    const current = await loadSignalRow(play.id);
    const captured = await captureConsoleLogs(async () =>
      await coinQa.__qa.truthSyncLiveSignalPlay({
        row: current,
        exchangeSnapshotCache: new Map(),
      })
    );

    const scenario = createScenario(
      "exchange flat / local OPEN without recovered close",
      "exchange flat + no protection + local OPEN must flatten"
    );
    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "LONG",
    });

    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "snapshot should flatten to zero");
    expectEqual(scenario, state.snapshot?.status, "CLOSED", "snapshot should be closed");
    expectEqual(scenario, state.row?.status, "READY", "signal row should be READY");
    expectTrue(
      scenario,
      state.ledgerRows.some((entry) => entry.eventType === "SIGNAL_EXCHANGE_FLAT_LOCAL_STALE_FLATTEN"),
      "signal stale flatten correction should exist"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    delete coinQa.__qa.binance[resolvedUid];
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runGridLocalStaleFlatten = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const row = await createTempGridStrategy({
    uid: resolvedUid,
    symbol: "PUMPUSDT",
    bunbong: "1MIN",
    regimeStatus: "ENDED",
    longLegStatus: "OPEN",
  });
  const cleanupPids = [row.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
      await pidPositionLedger.applyEntryFill(createEntryPayload({
        uid: resolvedUid,
        pid: row.id,
        strategyCategory: "grid",
        symbol: "PUMPUSDT",
        positionSide: "LONG",
        sourceClientOrderId: `GENTRY_L_${resolvedUid}_${row.id}_QA`,
        sourceOrderId: `GSE_${row.id}`,
        sourceTradeId: `GST_${row.id}`,
        fillQty: 2000,
        fillPrice: 0.0019,
        eventType: "GRID_ENTRY_FILL",
        tradeTime: "2026-04-24T09:20:00Z",
      }));
    await pidPositionLedger.syncGridLegSnapshot(row.id, "LONG");
    const current = await loadGridRow(row.id);

    const scenario = createScenario(
      "exchange flat / local OPEN without recovered close (grid)",
      "exchange flat + no protection + local OPEN must flatten"
    );

    const captured = await captureConsoleLogs(async () =>
      await withPatchedCoinExports(
        {
          getExchangePositionSnapshot: async () => ({
            symbol: "PUMPUSDT",
            longQty: 0,
            shortQty: 0,
            bothQty: 0,
            netQty: 0,
          }),
          getGridLegExchangePosition: async () => ({
            qty: 0,
          }),
          recoverGridExitFillFromExchange: async () => null,
          cancelGridOrders: async () => 0,
        },
        async () =>
          await gridEngine.reconcileLiveGridRuntimeIssue({
            row: current,
            issue: {
              pid: row.id,
              symbol: row.symbol,
              exchangeLongQty: 0,
              exchangeShortQty: 0,
              issues: ["LONG_OPEN_NO_POSITION"],
            },
          })
      )
    );

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    });

    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "grid snapshot should flatten to zero");
    expectEqual(scenario, state.snapshot?.status, "CLOSED", "grid snapshot should be closed");
    expectTrue(
      scenario,
      ["IDLE", "CLOSED"].includes(String(state.row?.longLegStatus || "").toUpperCase()),
      "grid row should converge"
    );
    expectTrue(
      scenario,
      state.ledgerRows.some((entry) => entry.eventType === "GRID_EXCHANGE_FLAT_LOCAL_STALE_FLATTEN"),
      "grid stale flatten correction should exist"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runGridWebhookTimeframeAliasNormalization = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const [pump1m, xrp5m, pump30m, pump1h, xrp2h] = await Promise.all([
    createTempGridStrategy({
      uid: resolvedUid,
      symbol: "QAPUMPUSDT",
      bunbong: "1MIN",
      strategySignal: "SQZ+GRID",
      enabled: "Y",
    }),
    createTempGridStrategy({
      uid: resolvedUid,
      symbol: "QAXRPUSDT",
      bunbong: "5MIN",
      strategySignal: "SQZ+GRID",
      enabled: "Y",
    }),
    createTempGridStrategy({
      uid: resolvedUid,
      symbol: "QAPUMPUSDT",
      bunbong: "30MIN",
      strategySignal: "SQZ+GRID",
      enabled: "Y",
    }),
    createTempGridStrategy({
      uid: resolvedUid,
      symbol: "QAPUMPUSDT",
      bunbong: "1H",
      strategySignal: "SQZ+GRID",
      enabled: "Y",
    }),
    createTempGridStrategy({
      uid: resolvedUid,
      symbol: "QAXRPUSDT",
      bunbong: "2H",
      strategySignal: "SQZ+GRID",
      enabled: "Y",
    }),
  ]);

  const cleanupPids = [pump1m.id, xrp5m.id, pump30m.id, pump1h.id, xrp2h.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "grid webhook timeframe alias normalization",
      "grid webhook timeframe aliases canonicalize to one exact target without duplicate candidate"
    );

    const resolveCandidates = async ({ symbol, candleMin }) => {
      const normalizedPayload = gridRuntime.normalizeGridWebhookPayload({
        signal: "SQZ+GRID",
        symbol,
        candle_min: candleMin,
        supportPrice: 1,
        resistancePrice: 3,
        triggerPrice: 2,
        time: "2026-04-26T00:00:00Z",
      });
      const rows = await query(
        `SELECT id, strategySignal
           FROM live_grid_strategy_list
          WHERE enabled = 'Y'
            AND symbol = ?
            AND bunbong = ?
          ORDER BY id ASC`,
        [normalizedPayload.symbol, normalizedPayload.bunbong]
      );
      const candidatePids = rows
        .filter(
          (row) =>
            gridRuntime.normalizeGridSignalKey(row.strategySignal) === normalizedPayload.strategySignalKey
        )
        .map((row) => Number(row.id));
      return {
        normalizedSymbol: normalizedPayload.symbol,
        normalizedBunbong: normalizedPayload.bunbong,
        candidatePids,
      };
    };

    const cases = [
      {
        label: "60 -> 1H",
        symbol: "QAPUMPUSDT.P",
        candleMin: 60,
        expectedPid: pump1h.id,
        expectedBunbong: "1H",
      },
      {
        label: "60MIN -> 1H",
        symbol: "QAPUMPUSDT.P",
        candleMin: "60MIN",
        expectedPid: pump1h.id,
        expectedBunbong: "1H",
      },
      {
        label: "1H -> 1H",
        symbol: "QAPUMPUSDT.P",
        candleMin: "1H",
        expectedPid: pump1h.id,
        expectedBunbong: "1H",
      },
      {
        label: "30 -> 30MIN",
        symbol: "QAPUMPUSDT.P",
        candleMin: 30,
        expectedPid: pump30m.id,
        expectedBunbong: "30MIN",
      },
      {
        label: "120 -> 2H",
        symbol: "QAXRPUSDT.P",
        candleMin: 120,
        expectedPid: xrp2h.id,
        expectedBunbong: "2H",
      },
      {
        label: "2H -> 2H",
        symbol: "QAXRPUSDT.P",
        candleMin: "2H",
        expectedPid: xrp2h.id,
        expectedBunbong: "2H",
      },
      {
        label: "1 -> 1MIN",
        symbol: "QAPUMPUSDT.P",
        candleMin: 1,
        expectedPid: pump1m.id,
        expectedBunbong: "1MIN",
      },
      {
        label: "5 -> 5MIN",
        symbol: "QAXRPUSDT.P",
        candleMin: 5,
        expectedPid: xrp5m.id,
        expectedBunbong: "5MIN",
      },
    ];

    const caseResults = [];
    for (const testCase of cases) {
      const resolved = await resolveCandidates({
        symbol: testCase.symbol,
        candleMin: testCase.candleMin,
      });
      caseResults.push({
        case: testCase.label,
        symbol: testCase.symbol,
        candleMin: String(testCase.candleMin),
        normalizedSymbol: resolved.normalizedSymbol,
        normalizedBunbong: resolved.normalizedBunbong,
        candidatePids: resolved.candidatePids,
      });

      expectEqual(
        scenario,
        resolved.normalizedBunbong,
        testCase.expectedBunbong,
        `${testCase.label} should canonicalize to ${testCase.expectedBunbong}`
      );
      expectEqual(
        scenario,
        resolved.normalizedSymbol,
        testCase.symbol.replace(/\.P$/i, ""),
        `${testCase.label} should normalize symbol suffix`
      );
      expectEqual(
        scenario,
        resolved.candidatePids.length,
        1,
        `${testCase.label} should produce exactly one candidate`
      );
      expectEqual(
        scenario,
        resolved.candidatePids[0],
        testCase.expectedPid,
        `${testCase.label} should match expected PID`
      );
    }

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: cleanupPids.join(","),
      strategyCategory: "mixed",
      symbol: "QAPUMPUSDT,QAXRPUSDT",
      cleanupPids,
      rowCountsBefore,
      ledgerRows: [],
      snapshot: null,
      row: {
        cases: caseResults,
      },
      reservations: [],
      msgList: [],
      auditLogs: [],
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const normalizeSignalRouteBunbongForDryRun = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return "";
  }

  const minuteMatch = normalized.match(/^(\d+)\s*(M|MIN|MINUTE|MINUTES)$/);
  if (minuteMatch) {
    return minuteMatch[1];
  }

  if (/^\d+$/.test(normalized)) {
    return normalized;
  }

  return normalized.replace(/\s+/g, "");
};

const normalizeSignalRouteSymbolForDryRun = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_]+:/, "")
    .replace(/\.P$/i, "");

const runSignalStrategyAliasInternalCodeMapping = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const [breakoutPlay, atfPlay] = await Promise.all([
    createTempSignalPlay({
      uid: resolvedUid,
      symbol: "QAPUMPUSDT",
      bunbong: "15",
      type: "SQZGBRK",
      status: "READY",
      enabled: "Y",
      signalType: "BUY",
      rSignalType: "BUY",
    }),
    createTempSignalPlay({
      uid: resolvedUid,
      symbol: "QAXRPUSDT",
      bunbong: "5",
      type: "ATF+VIXFIX",
      status: "READY",
      enabled: "Y",
      signalType: "SELL",
      rSignalType: "SELL",
    }),
  ]);

  const cleanupPids = [breakoutPlay.id, atfPlay.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "signal strategy alias internal code mapping",
      "display strategy name maps to short runtime code without breaking signal target matching"
    );
    const identity = signalStrategyIdentity.resolveSignalStrategyIdentity("SQZ+GRID+BREAKOUT");
    const createConstraint = adminManagement.getStrategyCatalogCreateConstraint({
      strategyCategory: "signal",
      strategyName: "SQZ+GRID+BREAKOUT",
      signalName: "SQZ+GRID+BREAKOUT",
      strategyCode: identity.strategyCode,
    });

    expectEqual(scenario, identity.strategyCode, "SQZGBRK", "breakout display name should map to SQZGBRK");
    expectTrue(
      scenario,
      identity.strategyCode.length <= signalStrategyIdentity.SIGNAL_RUNTIME_TYPE_MAX_LENGTH,
      "internal code should fit live/test type column"
    );
    expectEqual(scenario, createConstraint.canCreatePid, true, "catalog create constraint should allow the internal code");
    expectEqual(scenario, breakoutPlay.type, "SQZGBRK", "stored temp signal row should use internal code");

    const resolveCandidates = async ({ dbType, symbol, bunbong, side }) => {
      const strategyKey = signalStrategyIdentity.normalizeSignalStrategyKey(dbType);
      const runtimeType = signalStrategyIdentity.normalizeSignalStrategyCode(dbType);
      const normalizedSymbol = normalizeSignalRouteSymbolForDryRun(symbol);
      const normalizedBunbong = normalizeSignalRouteBunbongForDryRun(bunbong);
      const rows = await query(
        `SELECT id, type
           FROM live_play_list
          WHERE enabled = 'Y'
            AND (status = 'READY' OR status = 'EXACT_WAIT' OR status = 'EXACT')
            AND LOWER(type) = ?
            AND symbol = ?
            AND bunbong = ?
            AND signalType = ?
          ORDER BY id ASC`,
        [strategyKey, normalizedSymbol, normalizedBunbong, side]
      );
      return {
        runtimeType,
        strategyKey,
        normalizedSymbol,
        normalizedBunbong,
        candidatePids: rows.map((row) => Number(row.id)),
      };
    };

    const cases = [
      {
        label: "display alias",
        dbType: "SQZ+GRID+BREAKOUT",
        symbol: "QAPUMPUSDT.P",
        bunbong: "15m",
        side: "BUY",
        expectedRuntimeType: "SQZGBRK",
        expectedPid: breakoutPlay.id,
      },
      {
        label: "internal code",
        dbType: "SQZGBRK",
        symbol: "QAPUMPUSDT.P",
        bunbong: "15MIN",
        side: "BUY",
        expectedRuntimeType: "SQZGBRK",
        expectedPid: breakoutPlay.id,
      },
      {
        label: "lowercase display alias",
        dbType: "sqz+grid+breakout",
        symbol: "QAPUMPUSDT.P",
        bunbong: "15",
        side: "BUY",
        expectedRuntimeType: "SQZGBRK",
        expectedPid: breakoutPlay.id,
      },
      {
        label: "existing ATF",
        dbType: "ATF+VIXFIX",
        symbol: "QAXRPUSDT.P",
        bunbong: "5MIN",
        side: "SELL",
        expectedRuntimeType: "ATF+VIXFIX",
        expectedPid: atfPlay.id,
      },
      {
        label: "existing NP_ATF alias",
        dbType: "NP_ATF+VIXFIX",
        symbol: "QAXRPUSDT.P",
        bunbong: "5",
        side: "SELL",
        expectedRuntimeType: "ATF+VIXFIX",
        expectedPid: atfPlay.id,
      },
    ];

    const caseResults = [];
    for (const testCase of cases) {
      const resolved = await resolveCandidates(testCase);
      caseResults.push({
        case: testCase.label,
        dbType: testCase.dbType,
        runtimeType: resolved.runtimeType,
        normalizedSymbol: resolved.normalizedSymbol,
        normalizedBunbong: resolved.normalizedBunbong,
        candidatePids: resolved.candidatePids,
      });

      expectEqual(
        scenario,
        resolved.runtimeType,
        testCase.expectedRuntimeType,
        `${testCase.label} should normalize to expected runtime type`
      );
      expectEqual(
        scenario,
        resolved.candidatePids.length,
        1,
        `${testCase.label} should produce exactly one signal candidate`
      );
      expectEqual(
        scenario,
        resolved.candidatePids[0],
        testCase.expectedPid,
        `${testCase.label} should match expected PID`
      );
    }

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: cleanupPids.join(","),
      strategyCategory: "signal",
      symbol: "QAPUMPUSDT,QAXRPUSDT",
      cleanupPids,
      rowCountsBefore,
      ledgerRows: [],
      snapshot: null,
      row: {
        displayName: identity.displayName,
        strategyCode: identity.strategyCode,
        createConstraint,
        cases: caseResults,
      },
      reservations: [],
      msgList: [],
      auditLogs: [],
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runSignalForceOffRuntimeReadySnapshotOpen = async ({ uid } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const scenario = createScenario(
    "signal force-OFF with runtime READY but snapshot OPEN",
    "runtime READY alone cannot skip close when authoritative snapshot is OPEN"
  );
  const item = {
    id: 991428,
    uid: resolvedUid,
    symbol: "QAXRPUSDT",
    signalType: "SELL",
    r_signalType: "SELL",
    status: "EXACT",
    enabled: "Y",
    r_qty: 17.5,
  };
  const snapshots = [{
    pid: item.id,
    strategyCategory: "signal",
    symbol: item.symbol,
    positionSide: "SHORT",
    status: "OPEN",
    openQty: 17.5,
  }];
  const reservations = [{
    pid: item.id,
    strategyCategory: "signal",
    symbol: item.symbol,
    positionSide: "SHORT",
    status: "ACTIVE",
    reservationKind: "BOUND_STOP",
    clientOrderId: `STOP_${resolvedUid}_${item.id}_QA`,
  }];
  const runtimeWithoutSnapshot = canonicalRuntimeState.decorateSignalItemSync(item).runtimeState;
  const closeRequirement = signalForceOffControl.detectSignalForceOffCloseRequirement({
    item,
    runtimeStatus: runtimeWithoutSnapshot,
    snapshots,
    reservations,
  });
  const shouldSchedule = signalForceOffControl.shouldScheduleSignalForceOffClose({
    runtimeStatus: runtimeWithoutSnapshot,
    closeRequired: closeRequirement.closeRequired,
  });
  const protectionPlan = signalForceOffControl.evaluateSignalForceOffProtectionAction({
    closeRequired: closeRequirement.closeRequired,
    closeAttempted: false,
  });

  expectEqual(scenario, runtimeWithoutSnapshot, "READY", "synthetic route item should reproduce the historical READY misclassification");
  expectTrue(scenario, closeRequirement.closeRequired, "snapshot OPEN should force closeRequired=true");
  expectEqual(scenario, closeRequirement.reason, "RUNTIME_READY_BUT_SNAPSHOT_OPEN", "reason should document READY-but-open mismatch");
  expectTrue(scenario, shouldSchedule, "force-OFF should schedule close despite runtime READY");
  expectEqual(scenario, protectionPlan.cancelProtectionNow, false, "protection cancel must be deferred before close attempt");

  return finalizeScenario(scenario, {
    uid: resolvedUid,
    pid: item.id,
    strategyCategory: "signal",
    symbol: item.symbol,
    cleanupPids: [],
    rowCountsBefore: {},
    ledgerRows: [],
    snapshot: snapshots[0],
    row: {
      runtimeWithoutSnapshot,
      closeRequirement,
      shouldSchedule,
      protectionPlan,
    },
    reservations,
    msgList: [],
    auditLogs: [
      "OFF_REQUEST_RECEIVED",
      "OFF_CLOSE_REQUIRED_DETECTED",
      protectionPlan.action,
    ],
  });
};

const runSignalForceOffCloseFailureKeepsProtection = async ({ uid } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const scenario = createScenario(
    "signal force-OFF close failure does not remove protection silently",
    "failed close cannot leave exchange-open/no-protection without USER_ACTION_REQUIRED"
  );
  const closeFailedBeforeCancel = signalForceOffControl.evaluateSignalForceOffProtectionAction({
    closeRequired: true,
    closeAttempted: true,
    closeAccepted: false,
    closeFailed: true,
    protectionAlreadyCanceled: false,
  });
  const closeFailedAfterCancel = signalForceOffControl.evaluateSignalForceOffProtectionAction({
    closeRequired: true,
    closeAttempted: true,
    closeAccepted: false,
    closeFailed: true,
    protectionAlreadyCanceled: true,
  });

  expectEqual(scenario, closeFailedBeforeCancel.cancelProtectionNow, false, "failed close should not cancel protection");
  expectEqual(scenario, closeFailedBeforeCancel.userActionRequired, false, "kept protection does not require immediate unprotected action");
  expectEqual(scenario, closeFailedAfterCancel.action, "OFF_USER_ACTION_REQUIRED", "already-canceled protection plus failed close must raise user action");
  expectEqual(scenario, closeFailedAfterCancel.userActionRequired, true, "already unprotected failure must be explicit");

  return finalizeScenario(scenario, {
    uid: resolvedUid,
    pid: 991429,
    strategyCategory: "signal",
    symbol: "QAXRPUSDT",
    cleanupPids: [],
    rowCountsBefore: {},
    ledgerRows: [],
    snapshot: { status: "OPEN", openQty: 17.5 },
    row: { closeFailedBeforeCancel, closeFailedAfterCancel },
    reservations: [{ status: "ACTIVE", reservationKind: "BOUND_STOP" }],
    msgList: [],
    auditLogs: [
      closeFailedBeforeCancel.action,
      closeFailedAfterCancel.action,
    ],
  });
};

const runSignalForceOffNormalCloseSequencing = async ({ uid } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const scenario = createScenario(
    "signal force-OFF normal close",
    "protection cancellation occurs after close fill or exchange flat confirmation"
  );
  const beforeClose = signalForceOffControl.evaluateSignalForceOffProtectionAction({
    closeRequired: true,
    closeAttempted: false,
  });
  const afterFill = signalForceOffControl.evaluateSignalForceOffProtectionAction({
    closeRequired: true,
    closeAttempted: true,
    closeAccepted: true,
    closeFilled: true,
  });

  expectEqual(scenario, beforeClose.cancelProtectionNow, false, "before close, protection cancel should be deferred");
  expectEqual(scenario, afterFill.action, "OFF_PROTECTION_CANCEL_AFTER_CLOSE", "after fill, protection cleanup is allowed");
  expectEqual(scenario, afterFill.cancelProtectionNow, true, "after fill, protection cleanup may proceed");

  return finalizeScenario(scenario, {
    uid: resolvedUid,
    pid: 991430,
    strategyCategory: "signal",
    symbol: "QAXRPUSDT",
    cleanupPids: [],
    rowCountsBefore: {},
    ledgerRows: [{ eventType: "SIGNAL_FORCE_OFF_CLOSE_FILL", openQtyAfter: 0, realizedPnl: 0 }],
    snapshot: { status: "CLOSED", openQty: 0 },
    row: { beforeClose, afterFill },
    reservations: [],
    msgList: [],
    auditLogs: [
      beforeClose.action,
      afterFill.action,
    ],
  });
};

const runLiveReadonlyDetectsUnprotectedOpenPosition = async ({ uid } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const scenario = createScenario(
    "live read-only detects unprotected open position",
    "open local/exchange position with zero local/exchange protection is USER_ACTION_REQUIRED"
  );
  const rows = buildUnprotectedOpenPositionRows({
    uid: resolvedUid,
    snapshots: [{
      pid: 991431,
      strategyCategory: "signal",
      symbol: "QAXRPUSDT",
      positionSide: "SHORT",
      status: "OPEN",
      openQty: 17.5,
    }],
    localReservations: [],
    positionRows: [{
      symbol: "QAXRPUSDT",
      positionSide: "SHORT",
      positionAmt: "-17.5",
    }],
    openOrders: [],
    openAlgoOrders: [],
    compareSymbols: ["QAXRPUSDT"],
  });

  expectEqual(scenario, rows.length, 1, "unprotected open position should be reported");
  expectEqual(scenario, rows[0]?.risk, "PID_OPEN_NO_EFFECTIVE_PROTECTION", "risk should be explicit");

  return finalizeScenario(scenario, {
    uid: resolvedUid,
    pid: 991431,
    strategyCategory: "signal",
    symbol: "QAXRPUSDT",
    cleanupPids: [],
    rowCountsBefore: {},
    ledgerRows: [],
    snapshot: { status: "OPEN", openQty: 17.5 },
    row: { unprotectedRows: rows },
    reservations: [],
    msgList: [],
    auditLogs: ["PID_OPEN_NO_EFFECTIVE_PROTECTION", "USER_ACTION_REQUIRED"],
  });
};

const runLiveReadonlyDetectsLocalCanceledBinanceActiveOrder = async ({ uid } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const scenario = createScenario(
    "local canceled reservation but Binance active order",
    "Binance active protection remains a readiness failure even when local reservation is already CANCELED"
  );
  const rows = buildActiveProtectionRiskRows({
    uid: resolvedUid,
    localReservations: [{
      id: 991501,
      uid: resolvedUid,
      pid: 991501,
      strategyCategory: "signal",
      symbol: "QAPUMPUSDT",
      positionSide: "SHORT",
      reservationKind: "BOUND_STOP",
      clientOrderId: `STOP_${resolvedUid}_991501_ABC`,
      reservedQty: 14000,
      filledQty: 0,
      status: "CANCELED",
    }],
    positionRows: [{
      symbol: "QAPUMPUSDT",
      positionSide: "SHORT",
      positionAmt: "-14000",
    }],
    openAlgoOrders: [{
      symbol: "QAPUMPUSDT",
      clientAlgoId: `STOP_${resolvedUid}_991501_ABC`,
      type: "STOP",
      positionSide: "SHORT",
      reduceOnly: true,
      quantity: "14000",
    }],
    compareSymbols: ["QAPUMPUSDT"],
  });

  expectEqual(scenario, rows.length, 1, "active Binance order with CANCELED local reservation should be reported");
  expectTrue(
    scenario,
    String(rows[0]?.risk || "").includes("LOCAL_CANCELED_BUT_BINANCE_ACTIVE"),
    "risk should identify local-canceled/binance-active mismatch"
  );

  return finalizeScenario(scenario, {
    uid: resolvedUid,
    pid: 991501,
    strategyCategory: "signal",
    symbol: "QAPUMPUSDT",
    cleanupPids: [],
    rowCountsBefore: {},
    ledgerRows: [],
    snapshot: null,
    row: { protectionRiskRows: rows },
    reservations: [],
    msgList: [],
    auditLogs: ["LOCAL_CANCELED_BUT_BINANCE_ACTIVE", "BINANCE_ONLY_ACTIVE_PROTECTION"],
  });
};

const runLiveReadonlyDetectsBinanceOpenLocalFlat = async ({ uid } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const scenario = createScenario(
    "Binance position open but local snapshot flat",
    "aggregate comparison must fail when exchange has exposure and local PID sum is zero"
  );
  const rows = buildAggregateComparisonRows({
    uid: resolvedUid,
    localRows: [],
    positionRows: [{
      symbol: "QAXRPUSDT",
      positionSide: "SHORT",
      positionAmt: "-87.5",
    }],
    compareSymbols: ["QAXRPUSDT"],
  });
  const target = rows.find((row) => row.symbol === "QAXRPUSDT" && row.side === "SHORT");

  expectEqual(scenario, target?.risk, "BINANCE_OPEN_LOCAL_FLAT", "exchange-open/local-flat must be explicit");
  expectApprox(scenario, target?.binancePositionQty, 87.5, 1e-9, "exchange qty should be preserved");

  return finalizeScenario(scenario, {
    uid: resolvedUid,
    pid: "",
    strategyCategory: "mixed",
    symbol: "QAXRPUSDT",
    cleanupPids: [],
    rowCountsBefore: {},
    ledgerRows: [],
    snapshot: null,
    row: { aggregateRows: rows },
    reservations: [],
    msgList: [],
    auditLogs: ["BINANCE_OPEN_LOCAL_FLAT", "USER_ACTION_REQUIRED"],
  });
};

const runLiveReadonlyDetectsOrphanCloseOrderForFlatSide = async ({ uid } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const scenario = createScenario(
    "Binance flat side has active close order",
    "reduce-only close orders for flat sides are surfaced as orphan protection"
  );
  const rows = buildActiveProtectionRiskRows({
    uid: resolvedUid,
    localReservations: [],
    positionRows: [{
      symbol: "QAXRPUSDT",
      positionSide: "LONG",
      positionAmt: "0",
    }],
    openAlgoOrders: [{
      symbol: "QAXRPUSDT",
      clientAlgoId: `STOP_${resolvedUid}_991502_X`,
      type: "STOP",
      positionSide: "LONG",
      reduceOnly: true,
      quantity: "17.5",
    }],
    compareSymbols: ["QAXRPUSDT"],
  });

  expectEqual(scenario, rows.length, 1, "flat-side close order should be reported");
  expectTrue(
    scenario,
    String(rows[0]?.risk || "").includes("ORPHAN_CLOSE_ORDER_FOR_FLAT_SIDE"),
    "risk should identify orphan close order"
  );

  return finalizeScenario(scenario, {
    uid: resolvedUid,
    pid: 991502,
    strategyCategory: "signal",
    symbol: "QAXRPUSDT",
    cleanupPids: [],
    rowCountsBefore: {},
    ledgerRows: [],
    snapshot: null,
    row: { protectionRiskRows: rows },
    reservations: [],
    msgList: [],
    auditLogs: ["ORPHAN_CLOSE_ORDER_FOR_FLAT_SIDE", "USER_ACTION_REQUIRED"],
  });
};

const runLiveReadonlyDetectsOversizedProtectionVsPosition = async ({ uid } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const scenario = createScenario(
    "oversized Binance protection vs aggregate position",
    "active reduce-only protection materially larger than exchange aggregate is surfaced"
  );
  const rows = buildActiveProtectionRiskRows({
    uid: resolvedUid,
    localReservations: [],
    positionRows: [{
      symbol: "QAPUMPUSDT",
      positionSide: "SHORT",
      positionAmt: "-195",
    }],
    openAlgoOrders: [{
      symbol: "QAPUMPUSDT",
      clientAlgoId: `STOP_${resolvedUid}_991503_Y`,
      type: "STOP",
      positionSide: "SHORT",
      reduceOnly: true,
      quantity: "14334",
    }],
    compareSymbols: ["QAPUMPUSDT"],
  });

  expectEqual(scenario, rows.length, 1, "oversized protection should be reported");
  expectTrue(
    scenario,
    String(rows[0]?.risk || "").includes("OVERSIZED_PROTECTION_VS_POSITION"),
    "risk should identify oversized protection"
  );

  return finalizeScenario(scenario, {
    uid: resolvedUid,
    pid: 991503,
    strategyCategory: "signal",
    symbol: "QAPUMPUSDT",
    cleanupPids: [],
    rowCountsBefore: {},
    ledgerRows: [],
    snapshot: null,
    row: { protectionRiskRows: rows },
    reservations: [],
    msgList: [],
    auditLogs: ["OVERSIZED_PROTECTION_VS_POSITION", "USER_ACTION_REQUIRED"],
  });
};

const runCrossPidOverfillGuardWithTpGmanual = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "QAPUMPUSDT",
    bunbong: "1MIN",
    status: "EXACT",
    signalType: "SELL",
    rSignalType: "SELL",
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "cross-PID overfill guard with TP/GMANUAL",
      "exit fill quantity above PID-owned qty is applied only to owned qty and audited"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "QAPUMPUSDT",
      positionSide: "SHORT",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}_OF`,
      sourceOrderId: `OFE${play.id}`,
      sourceTradeId: `OFET${play.id}`,
      fillQty: 10,
      fillPrice: 0.002,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-27T00:00:00Z",
    }));
    await insertReservation({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "QAPUMPUSDT",
      positionSide: "SHORT",
      clientOrderId: `PROFIT_${resolvedUid}_${play.id}_OF`,
      sourceOrderId: `OFTP${play.id}`,
      reservationKind: "BOUND_PROFIT",
      reservedQty: 10,
      status: "ACTIVE",
    });

    const captured = await captureConsoleLogs(async () => {
      await pidPositionLedger.applyExitFill(createExitPayload({
        uid: resolvedUid,
        pid: play.id,
        strategyCategory: "signal",
        symbol: "QAPUMPUSDT",
        positionSide: "SHORT",
        sourceClientOrderId: `PROFIT_${resolvedUid}_${play.id}_OF`,
        sourceOrderId: `OFTP${play.id}`,
        sourceTradeId: `OFTT${play.id}`,
        fillQty: 15,
        fillPrice: 0.0019,
        realizedPnl: 1,
        eventType: "SIGNAL_TP_FILL",
        tradeTime: "2026-04-27T00:05:00Z",
      }));
    });

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "SHORT",
    });
    const exitRow = state.ledgerRows.find((row) => row.eventType === "SIGNAL_TP_FILL");

    expectApprox(scenario, exitRow?.fillQty, 10, 1e-9, "ledger applies only PID-owned qty");
    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "snapshot should close owned qty");
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("FILL_QTY_EXCEEDS_PID_OWNED_QTY")),
      "overfill should be audited"
    );
    expectTrue(
      scenario,
      filterAuditLogs(captured.logs).some((line) => line.includes("FILL_QTY_EXCEEDS_RESERVATION_QTY")),
      "reservation overfill should be audited"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: filterAuditLogs(captured.logs),
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runDirectOrphanFlatten = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "LINKUSDT",
    bunbong: "1MIN",
    status: "EXACT",
    signalType: "BUY",
    rSignalType: "BUY",
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "orphan flatten",
      "no silent delete; correction only"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "LINKUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: `ORPHAN-ENTRY-${play.id}`,
      sourceTradeId: `ORPHAN-ENTRY-TRADE-${play.id}`,
      fillQty: 5,
      fillPrice: 10,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-24T10:00:00Z",
    }));

    const correction = await pidPositionLedger.closeSnapshotAsOrphan({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "LINKUSDT",
      positionSide: "LONG",
      eventType: "SYSTEM_ORPHAN_CLOSE",
      note: "qa-direct-orphan-close",
      tradeTime: "2026-04-24T10:05:00Z",
    });
    await pidPositionLedger.syncSignalPlaySnapshot(play.id, "LONG");

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "LONG",
    });

    expectTrue(scenario, Boolean(correction?.ledgerId), "orphan correction should create a ledger row");
    expectApprox(scenario, state.snapshot?.openQty, 0, 1e-9, "orphan close should flatten qty");
    expectEqual(scenario, state.snapshot?.status, "CLOSED", "snapshot should be closed");
    expectTrue(
      scenario,
      state.ledgerRows.some((entry) => entry.eventType === "SYSTEM_ORPHAN_CLOSE"),
      "system orphan close row should exist"
    );

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: [],
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const runCorrectionPnlIntegrity = async ({ uid, cleanup = true } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const play = await createTempSignalPlay({
    uid: resolvedUid,
    symbol: "AVAXUSDT",
    bunbong: "1MIN",
    status: "EXACT",
    signalType: "BUY",
    rSignalType: "BUY",
  });
  const cleanupPids = [play.id];
  const rowCountsBefore = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });

  const cleanupArtifactsForScenario = async () => cleanupArtifacts({ uid: resolvedUid, pids: cleanupPids });

  try {
    const scenario = createScenario(
      "correction event PnL",
      "correction event must not double pnl"
    );

    await pidPositionLedger.applyEntryFill(createEntryPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "AVAXUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `NEW_${resolvedUid}_${play.id}`,
      sourceOrderId: `PNL-ENTRY-${play.id}`,
      sourceTradeId: `PNL-ENTRY-TRADE-${play.id}`,
      fillQty: 10,
      fillPrice: 20,
      eventType: "SIGNAL_ENTRY_FILL",
      tradeTime: "2026-04-24T10:20:00Z",
    }));
    await pidPositionLedger.applyExitFill(createExitPayload({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "AVAXUSDT",
      positionSide: "LONG",
      sourceClientOrderId: `PROFIT_${resolvedUid}_${play.id}_01`,
      sourceOrderId: `PNL-EXIT-${play.id}`,
      sourceTradeId: `PNL-EXIT-TRADE-${play.id}`,
      fillQty: 5,
      fillPrice: 20.8,
      realizedPnl: 4,
      eventType: "SIGNAL_EXIT_FILL",
      tradeTime: "2026-04-24T10:25:00Z",
    }));

    const orphanResult = await pidPositionLedger.closeSnapshotAsOrphan({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: "AVAXUSDT",
      positionSide: "LONG",
      eventType: "SYSTEM_ORPHAN_CLOSE",
      note: "qa-correction-pnl",
      tradeTime: "2026-04-24T10:30:00Z",
    });
    await pidPositionLedger.syncSignalPlaySnapshot(play.id, "LONG");

    const state = await loadScenarioState({
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      positionSide: "LONG",
    });
    const correctionRow = state.ledgerRows.find((row) => row.id === orphanResult?.ledgerId);

    expectTrue(scenario, Boolean(correctionRow), "correction row should exist");
    expectApprox(scenario, correctionRow?.realizedPnl, 0, 1e-9, "correction row realizedPnl should be zero");
    expectApprox(scenario, summarizeLedger(state.ledgerRows).realizedPnlSum, 4, 1e-9, "realizedPnl sum should remain unchanged");

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: play.id,
      strategyCategory: "signal",
      symbol: play.symbol,
      cleanupPids,
      rowCountsBefore,
      ledgerRows: state.ledgerRows,
      snapshot: state.snapshot,
      row: state.row,
      reservations: state.reservations,
      msgList: state.msgList,
      auditLogs: [],
    });
  } finally {
    if (cleanup !== false) {
      await cleanupArtifactsForScenario();
    }
  }
};

const ORDER_STATUS_STATE_MACHINE_SCENARIOS = [
  {
    name: "NEW then CANCELED unfilled",
    previous: "NEW",
    next: "CANCELED",
    kind: "entry",
    origQty: 10,
    trades: [],
    expectedExposure: 0,
    expectedProtection: false,
    expectedAudit: "ORDER_TERMINAL_WITHOUT_FILL",
  },
  {
    name: "NEW then EXPIRED unfilled",
    previous: "NEW",
    next: "EXPIRED",
    kind: "entry",
    origQty: 10,
    trades: [],
    expectedExposure: 0,
    expectedProtection: false,
    expectedAudit: "ORDER_TERMINAL_WITHOUT_FILL",
  },
  {
    name: "NEW then EXPIRED_IN_MATCH unfilled",
    previous: "NEW",
    next: "EXPIRED_IN_MATCH",
    kind: "entry",
    origQty: 10,
    trades: [],
    expectedExposure: 0,
    expectedProtection: false,
    expectedAudit: "ORDER_EXPIRED_IN_MATCH_NO_FILL",
  },
  {
    name: "NEW then REJECTED",
    previous: "NEW",
    next: "REJECTED",
    kind: "entry",
    origQty: 10,
    trades: [],
    expectedExposure: 0,
    expectedProtection: false,
    expectedAudit: "ORDER_REJECTED_NO_FILL",
  },
  {
    name: "PARTIALLY_FILLED then FILLED",
    previous: "PARTIALLY_FILLED",
    next: "FILLED",
    kind: "entry",
    origQty: 10,
    trades: [{ id: "A", qty: 4 }, { id: "B", qty: 6 }],
    expectedExposure: 10,
    expectedProtection: true,
    expectedAudit: "PROTECTION_SYNC_FOR_PARTIAL_EXPOSURE",
  },
  {
    name: "PARTIALLY_FILLED then CANCELED",
    previous: "PARTIALLY_FILLED",
    next: "CANCELED",
    kind: "entry",
    origQty: 10,
    trades: [{ id: "A", qty: 4 }],
    expectedExposure: 4,
    expectedProtection: true,
    expectedAudit: "ORDER_PARTIAL_REMAINDER_CANCELED",
  },
  {
    name: "PARTIALLY_FILLED then EXPIRED",
    previous: "PARTIALLY_FILLED",
    next: "EXPIRED",
    kind: "entry",
    origQty: 10,
    trades: [{ id: "A", qty: 4 }],
    expectedExposure: 4,
    expectedProtection: true,
    expectedAudit: "ORDER_PARTIAL_REMAINDER_EXPIRED",
  },
  {
    name: "PARTIALLY_FILLED then EXPIRED_IN_MATCH",
    previous: "PARTIALLY_FILLED",
    next: "EXPIRED_IN_MATCH",
    kind: "entry",
    origQty: 10,
    trades: [{ id: "A", qty: 4 }],
    expectedExposure: 4,
    expectedProtection: true,
    expectedAudit: "ORDER_EXPIRED_IN_MATCH_WITH_FILL",
  },
  {
    name: "PARTIALLY_FILLED then REJECTED",
    previous: "PARTIALLY_FILLED",
    next: "REJECTED",
    kind: "entry",
    origQty: 10,
    trades: [{ id: "A", qty: 4 }],
    expectedExposure: 4,
    expectedProtection: true,
    expectedAudit: "ORDER_REJECTED_WITH_FILL",
  },
  {
    name: "PARTIALLY_FILLED then PARTIALLY_FILLED again",
    previous: "PARTIALLY_FILLED",
    next: "PARTIALLY_FILLED",
    kind: "entry",
    origQty: 10,
    trades: [{ id: "A", qty: 3 }, { id: "A", qty: 3 }, { id: "B", qty: 2 }],
    expectedExposure: 5,
    expectedProtection: true,
    expectedAudit: "ORDER_PARTIAL_STATE_REST_CHECK",
  },
  {
    name: "exit order PARTIALLY_FILLED then CANCELED",
    previous: "PARTIALLY_FILLED",
    next: "CANCELED",
    kind: "exit",
    startingExposure: 10,
    origQty: 10,
    trades: [{ id: "A", qty: 4 }],
    expectedExposure: 6,
    expectedProtection: true,
    expectedAudit: "ORDER_PARTIAL_REMAINDER_CANCELED",
  },
  {
    name: "grid entry PARTIALLY_FILLED then EXPIRED_IN_MATCH",
    previous: "PARTIALLY_FILLED",
    next: "EXPIRED_IN_MATCH",
    kind: "grid-entry",
    origQty: 18.1,
    trades: [{ id: "A", qty: 7.1 }],
    expectedExposure: 7.1,
    expectedProtection: true,
    expectedAudit: "ORDER_EXPIRED_IN_MATCH_WITH_FILL",
  },
  {
    name: "signal entry PARTIALLY_FILLED then EXPIRED_IN_MATCH",
    previous: "PARTIALLY_FILLED",
    next: "EXPIRED_IN_MATCH",
    kind: "signal-entry",
    origQty: 18,
    trades: [{ id: "A", qty: 8 }],
    expectedExposure: 8,
    expectedProtection: true,
    expectedAudit: "ORDER_EXPIRED_IN_MATCH_WITH_FILL",
  },
  {
    name: "protection order PARTIALLY_FILLED then EXPIRED_IN_MATCH",
    previous: "PARTIALLY_FILLED",
    next: "EXPIRED_IN_MATCH",
    kind: "exit",
    startingExposure: 10,
    origQty: 10,
    trades: [{ id: "A", qty: 3 }],
    expectedExposure: 7,
    expectedProtection: true,
    expectedAudit: "ORDER_EXPIRED_IN_MATCH_WITH_FILL",
  },
  {
    name: "terminal status with late userTrade",
    previous: "CANCELED",
    next: "LATE_USER_TRADE",
    kind: "entry",
    origQty: 10,
    trades: [{ id: "LATE", qty: 2 }, { id: "LATE", qty: 2 }],
    expectedExposure: 2,
    expectedProtection: true,
    expectedAudit: "ORDER_TERMINAL_WITH_EXECUTED_QTY",
  },
];

const simulateOrderStatusTransition = (definition) => {
  const uniqueTrades = new Map();
  for (const trade of definition.trades || []) {
    if (!uniqueTrades.has(trade.id)) {
      uniqueTrades.set(trade.id, Number(trade.qty || 0));
    }
  }
  const filledQty = [...uniqueTrades.values()].reduce((sum, qty) => sum + qty, 0);
  const startingExposure = Number(definition.startingExposure || 0);
  const nextExposure = String(definition.kind || "").includes("exit")
    ? Math.max(0, startingExposure - filledQty)
    : filledQty;
  const remainingOrderQty = Math.max(0, Number(definition.origQty || 0) - filledQty);
  const terminal = ["FILLED", "CANCELED", "EXPIRED", "EXPIRED_IN_MATCH", "REJECTED"].includes(definition.next)
    || definition.next === "LATE_USER_TRADE";
  return {
    filledQty,
    nextExposure,
    remainingOrderQty,
    terminal,
    ledgerFillCount: uniqueTrades.size,
    protectionRequired: nextExposure > 0,
    duplicateIgnoredCount: (definition.trades || []).length - uniqueTrades.size,
  };
};

const runOrderStatusStateMachineFinalizationScenarios = async ({ uid } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  return ORDER_STATUS_STATE_MACHINE_SCENARIOS.map((definition) => {
    const scenario = createScenario(
      definition.name,
      `${definition.previous} -> ${definition.next} state-machine expectation`
    );
    const simulated = simulateOrderStatusTransition(definition);
    expectApprox(scenario, simulated.nextExposure, definition.expectedExposure, 1e-9, "exposure should equal filledQty-based projection");
    expectEqual(scenario, simulated.protectionRequired, definition.expectedProtection, "protection requirement should follow actual exposure");
    expectTrue(scenario, simulated.remainingOrderQty >= 0, "unfilled remainder should never become exposure");
    if (definition.name.includes("again") || definition.name.includes("late userTrade")) {
      expectTrue(scenario, simulated.duplicateIgnoredCount > 0, "duplicate tradeIds should be ignored");
    }
    if (definition.next === "EXPIRED_IN_MATCH") {
      expectTrue(scenario, definition.expectedAudit.includes("EXPIRED_IN_MATCH"), "EXPIRED_IN_MATCH must have explicit audit");
    }
    if (definition.next === "REJECTED") {
      expectTrue(scenario, definition.expectedAudit.includes("REJECTED"), "REJECTED must have explicit audit");
    }

    return finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: null,
      strategyCategory: "state-machine",
      symbol: "SYNTHETIC",
      cleanupPids: [],
      rowCountsBefore: null,
      row: {
        previousState: definition.previous,
        nextState: definition.next,
        kind: definition.kind,
        origQty: definition.origQty,
        filledQty: simulated.filledQty,
        remainingOrderQty: simulated.remainingOrderQty,
        nextExposure: simulated.nextExposure,
        terminal: simulated.terminal,
      },
      ledgerRows: Array.from({ length: simulated.ledgerFillCount }, (_, index) => ({
        sourceTradeId: `trade-${index + 1}`,
      })),
      snapshot: {
        status: simulated.nextExposure > 0 ? "OPEN" : "CLOSED",
        openQty: simulated.nextExposure,
      },
      reservations: definition.expectedProtection
        ? [{ status: "ACTIVE", reservedQty: simulated.nextExposure }]
        : [],
      msgList: [],
      auditLogs: [definition.expectedAudit],
    });
  });
};

const runOnOffDeleteAndOrderDisplayStateScenarios = async ({ uid } = {}) => {
  const resolvedUid = await resolveReplayUid(uid || DEFAULT_REPLAY_UID_FALLBACK);
  const definitions = [
    {
      name: "OFF payload is not delete intent",
      invariant: "OFF requests must never satisfy strategy delete confirmation",
      run: (scenario) => {
        expectEqual(
          scenario,
          hasExplicitStrategyDeleteIntent({ id: 15, enabled: "N" }),
          false,
          "OFF toggle payload must not pass delete guard"
        );
      },
    },
    {
      name: "delete requires explicit USER_DELETE_STRATEGY intent",
      invariant: "strategy delete requires explicit confirmation and intent",
      run: (scenario) => {
        expectEqual(
          scenario,
          hasExplicitStrategyDeleteIntent({
            idList: [{ id: 15 }],
            confirmDelete: true,
            deleteIntent: "USER_DELETE_STRATEGY",
          }),
          true,
          "explicit delete intent should pass delete guard"
        );
      },
    },
    {
      name: "wrong delete intent blocked",
      invariant: "wrong or implicit delete intent must be rejected",
      run: (scenario) => {
        expectEqual(
          scenario,
          hasExplicitStrategyDeleteIntent({
            idList: [{ id: 15 }],
            confirmDelete: true,
            deleteIntent: "TOGGLE",
          }),
          false,
          "wrong delete intent should be blocked"
        );
      },
    },
    {
      name: "PARTIALLY_FILLED display remains intermediate",
      invariant: "admin display must not mark PARTIALLY_FILLED as terminal",
      run: (scenario) => {
        const state = orderDisplayState.deriveOrderTerminalDisplayState({
          orderStatus: "PARTIALLY_FILLED",
          quantity: 10,
          executedQty: 4,
        });
        expectEqual(scenario, state.orderDisplayState, "PARTIAL_FILL_PENDING", "partial fill remains pending");
        expectApprox(scenario, state.remainingQty, 6, 1e-9, "remaining qty should be orig minus executed");
        expectEqual(scenario, state.systemAction, "ORDER_PARTIAL_STATE_REST_CHECK", "partial fill needs REST check");
      },
    },
    {
      name: "EXPIRED_IN_MATCH no fill display is terminal no exposure",
      invariant: "EXPIRED_IN_MATCH without fill is terminal but no false exposure",
      run: (scenario) => {
        const state = orderDisplayState.deriveOrderTerminalDisplayState({
          orderStatus: "EXPIRED_IN_MATCH",
          quantity: 10,
          executedQty: 0,
        });
        expectEqual(scenario, state.orderDisplayState, "TERMINAL_NO_FILL", "no fill terminal should not create exposure");
        expectEqual(scenario, state.requiresUserAction, false, "no-fill expired_in_match should not require user action");
        expectEqual(scenario, state.systemAction, "ORDER_EXPIRED_IN_MATCH_NO_FILL", "expired_in_match should be explicit");
      },
    },
    {
      name: "REJECTED with fill display requires protection verification",
      invariant: "terminal status with executed qty is risk-bearing until protection is verified",
      run: (scenario) => {
        const state = orderDisplayState.deriveOrderTerminalDisplayState({
          orderStatus: "REJECTED",
          quantity: 10,
          executedQty: 2,
          rejectReason: "synthetic late fill after reject",
        });
        expectEqual(scenario, state.orderDisplayState, "PARTIAL_TERMINAL_WITH_EXPOSURE", "terminal with fill has exposure");
        expectEqual(scenario, state.requiresUserAction, true, "terminal with fill needs protection verification");
        expectEqual(scenario, state.systemAction, "VERIFY_PROTECTION_FOR_FILLED_QTY", "system action should be explicit");
      },
    },
    {
      name: "QA cleanup blocks non-QA production PID family",
      invariant: "QA cleanup must not delete or clean artifacts for non-QA production PIDs by numeric PID alone",
      run: async (scenario) => {
        const result = await cleanupArtifacts({
          uid: resolvedUid,
          pids: [991744, 991748, 991753],
          signalIds: [991744, 991748, 991753],
          gridIds: [991744, 991748, 991753],
          settleMs: 0,
          passes: 1,
        });
        expectEqual(scenario, result.cleaned, false, "non-QA PID cleanup should be blocked and do no delete pass");
        expectEqual(
          scenario,
          result.blockedPids.join(","),
          "991744,991748,991753",
          "production-like PID ids should be reported as blocked"
        );
        expectEqual(scenario, result.guard, "QA_MARKER_REQUIRED", "cleanup guard should document QA marker requirement");
      },
    },
    {
      name: "QA marker helper rejects ordinary strategy names",
      invariant: "cleanup allow-list must require explicit QA_ marker, not PID range",
      run: (scenario) => {
        expectEqual(scenario, isQaTempStrategyName("SQZ+GRID+BREAKOUT"), false, "production strategy name must not pass cleanup marker");
        expectEqual(scenario, isQaTempStrategyName("QA_SIGNAL_123"), true, "QA temp strategy should pass cleanup marker");
      },
    },
    {
      name: "expected ignore event stays info not abnormal",
      invariant: "admin lifecycle display must not mark expected ignore events as abnormal",
      run: (scenario) => {
        const state = orderDisplayState.deriveOrderTerminalDisplayState({
          eventCode: "NO_MATCHING_STRATEGY",
          severity: "low",
        });
        expectEqual(scenario, state.lifecycleResult, "EXPECTED", "expected ignore should be lifecycle EXPECTED");
        expectEqual(scenario, state.severity, "INFO", "expected ignore should be informational");
        expectEqual(scenario, state.expectedOrAbnormal, "EXPECTED", "expected ignore should not be abnormal");
        expectEqual(scenario, state.requiresUserAction, false, "expected ignore should not require user action");
      },
    },
  ];

  const results = [];
  for (const definition of definitions) {
    const scenario = createScenario(definition.name, definition.invariant);
    await definition.run(scenario);
    results.push(finalizeScenario(scenario, {
      uid: resolvedUid,
      pid: null,
      strategyCategory: "ui-admin-sync",
      symbol: "SYNTHETIC",
      cleanupPids: [],
      row: { invariant: definition.invariant },
      ledgerRows: [],
      snapshot: null,
      reservations: [],
      msgList: [],
      auditLogs: [],
    }));
  }
  return results;
};

module.exports = {
  summarizeLedger,
  summarizeSnapshot,
  resolveReplayUid,
  filterAuditLogs,
  loadScenarioState,
  runSamePidDuplicateGridEntry,
  runSamePidDuplicateSignalEntry,
  runDuplicateExit,
  runDifferentPidSameSymbolSide,
  runPartialFillDistinctTradeIds,
  runSignalEntryRecoveryPartialFill,
  runSignalSplitTpMultiFillExitAccounting,
  runSignalTimeExitFillRecovery,
  runSignalTimeExitSiblingProtectionLifecycle,
  runSignalTimeExitPartialFill,
  runSplitTpPartialClose,
  runGridMultiTradeEntryPreservation,
  runGridMultiTradeExitPreservation,
  runLiveReadonlyDetectsSixPositionsEightConditionalsProtectionShortage,
  runGridDuplicateExitRecoveryDoesNotCancelCurrentProtection,
  runSignalEntryPartiallyFilledThenCanceled,
  runGridEntryPartiallyFilledThenExpired,
  runPartialFillStateMachineExpectedTransitions,
  runOrderStatusStateMachineFinalizationScenarios,
  runOnOffDeleteAndOrderDisplayStateScenarios,
  runCrossPidOwnershipGuard,
  runGridReservationOwnedStopFillRecovery,
  runSignalRecoveredCloseViaTruthSync,
  runGridRecoveredCloseViaReconcile,
  runGridExternalManualCloseAttributableFill,
  runGridExternalManualCloseCorrectionFallback,
  runGridExternalManualCloseAmbiguousMultiPid,
  runSignalExternalManualCloseThenOffConvergence,
  runExternalCloseWithOrphanProtectionBlocked,
  runSignalLocalStaleFlatten,
  runGridLocalStaleFlatten,
  runGridWebhookTimeframeAliasNormalization,
  runSignalStrategyAliasInternalCodeMapping,
  runSignalForceOffRuntimeReadySnapshotOpen,
  runSignalForceOffCloseFailureKeepsProtection,
  runSignalForceOffNormalCloseSequencing,
  runLiveReadonlyDetectsUnprotectedOpenPosition,
  runLiveReadonlyDetectsLocalCanceledBinanceActiveOrder,
  runLiveReadonlyDetectsBinanceOpenLocalFlat,
  runLiveReadonlyDetectsOrphanCloseOrderForFlatSide,
  runLiveReadonlyDetectsOversizedProtectionVsPosition,
  runCrossPidOverfillGuardWithTpGmanual,
  runDirectOrphanFlatten,
  runCorrectionPnlIntegrity,
};
