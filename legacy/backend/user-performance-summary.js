"use strict";

const db = require("./database/connect/config");

const INCIDENT_ORDER_IDS = new Set(["147797474565", "4289769085", "4289774077"]);
const INCIDENT_TRADE_IDS = new Set([
  "3097747576",
  "3097747577",
  "3097747578",
  "3097747579",
  "221477564",
  "221477649",
]);

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const toSqlDate = (date) => date.toISOString().slice(0, 19).replace("T", " ");

const buildPeriodStart = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return toSqlDate(date);
};

const isIncidentLedgerRow = (row = {}) =>
  INCIDENT_ORDER_IDS.has(String(row.sourceOrderId || row.orderId || "")) ||
  INCIDENT_TRADE_IDS.has(String(row.sourceTradeId || row.tradeId || ""));

const isExitLedgerRow = (row = {}) => {
  const eventType = String(row.eventType || row.type || row.intent || "").trim().toUpperCase();
  if (!eventType) {
    return toNumber(row.realizedPnl) !== 0;
  }
  if (eventType.includes("ENTRY")) {
    return false;
  }
  return (
    eventType.includes("EXIT") ||
    eventType.includes("PROFIT") ||
    eventType.includes("STOP") ||
    eventType.includes("CLOSE") ||
    eventType.includes("TP")
  );
};

const getEventTime = (row = {}) => row.tradeTime || row.createdAt || row.updatedAt || null;

const isAtOrAfter = (value, sqlDate) => {
  if (!value) {
    return false;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= new Date(`${sqlDate.replace(" ", "T")}Z`).getTime();
};

const summarizeLedgerRows = (rows = []) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = toSqlDate(today);
  const sevenDayStart = buildPeriodStart(7);
  const thirtyDayStart = buildPeriodStart(30);
  const exitCycles = new Map();
  const totals = {
    totalRealizedPnl: 0,
    todayRealizedPnl: 0,
    sevenDayRealizedPnl: 0,
    thirtyDayRealizedPnl: 0,
    lastTradeAt: null,
    incidentExcludedCount: 0,
  };

  rows.forEach((row) => {
    if (isIncidentLedgerRow(row)) {
      totals.incidentExcludedCount += 1;
      return;
    }

    const pnl = toNumber(row.realizedPnl);
    const eventTime = getEventTime(row);
    totals.totalRealizedPnl += pnl;
    if (isAtOrAfter(eventTime, todayStart)) {
      totals.todayRealizedPnl += pnl;
    }
    if (isAtOrAfter(eventTime, sevenDayStart)) {
      totals.sevenDayRealizedPnl += pnl;
    }
    if (isAtOrAfter(eventTime, thirtyDayStart)) {
      totals.thirtyDayRealizedPnl += pnl;
    }
    if (eventTime && (!totals.lastTradeAt || new Date(eventTime).getTime() > new Date(totals.lastTradeAt).getTime())) {
      totals.lastTradeAt = eventTime;
    }

    if (isExitLedgerRow(row)) {
      const cycleKey = [
        row.pid || "",
        row.strategyCategory || "",
        row.sourceClientOrderId || row.clientOrderId || "",
        row.sourceOrderId || row.orderId || "",
        row.sourceTradeId ? "" : row.dedupeKey || row.id || "",
      ].join("|");
      exitCycles.set(cycleKey, (exitCycles.get(cycleKey) || 0) + pnl);
    }
  });

  let winCount = 0;
  let lossCount = 0;
  let breakevenCount = 0;
  exitCycles.forEach((pnl) => {
    if (pnl > 0) {
      winCount += 1;
    } else if (pnl < 0) {
      lossCount += 1;
    } else {
      breakevenCount += 1;
    }
  });

  return {
    ...totals,
    winCount,
    lossCount,
    breakevenCount,
    completedCycleCount: exitCycles.size,
  };
};

const getUserPerformanceSummary = async (uid) => {
  const [[ledgerRows], [strategyCounts], [openSnapshotRows]] = await Promise.all([
    db.query(
      `SELECT id, pid, strategyCategory, eventType, sourceClientOrderId, sourceOrderId, sourceTradeId, dedupeKey, realizedPnl, tradeTime, createdAt
         FROM live_pid_position_ledger
        WHERE uid = ?`,
      [uid]
    ),
    db.query(
      `SELECT
          (SELECT COUNT(*) FROM live_play_list WHERE uid = ? AND UPPER(COALESCE(enabled, 'N')) IN ('Y', 'TRUE', '1', 'ON')) AS activeSignalCount,
          (SELECT COUNT(*) FROM live_grid_strategy_list WHERE uid = ? AND UPPER(COALESCE(enabled, 'N')) IN ('Y', 'TRUE', '1', 'ON')) AS activeGridCount,
          (SELECT COUNT(*) FROM live_play_list WHERE uid = ?) AS signalCount,
          (SELECT COUNT(*) FROM live_grid_strategy_list WHERE uid = ?) AS gridCount`,
      [uid, uid, uid, uid]
    ),
    db.query(
      `SELECT
          pid,
          strategyCategory,
          symbol,
          positionSide,
          openQty,
          avgEntryPrice,
          cycleRealizedPnl,
          cycleFees,
          lastEntryAt,
          lastExitAt
        FROM live_pid_position_snapshot
       WHERE uid = ? AND UPPER(status) = 'OPEN' AND openQty > 0`,
      [uid]
    ),
  ]);

  const totals = summarizeLedgerRows(ledgerRows || []);
  const counts = strategyCounts[0] || {};
  const completedCycleCount = toNumber(totals.completedCycleCount);
  const activeStrategyCount = toNumber(counts.activeSignalCount) + toNumber(counts.activeGridCount);

  return {
    source: "live-ledger-readonly",
    dataAvailability: {
      realizedPnl: "AVAILABLE",
      unrealizedPnl: "PRICE_REQUIRED",
      winRate: completedCycleCount > 0 ? "AVAILABLE" : "INSUFFICIENT_COMPLETED_TRADES",
      fee: "LEDGER_FEE_IF_RECORDED",
      incidentHandling: totals.incidentExcludedCount > 0 ? "QA_REPLAY_ACCIDENT_EXCLUDED" : "NONE",
    },
    cards: {
      totalRealizedPnl: toNumber(totals.totalRealizedPnl),
      currentUnrealizedPnl: null,
      todayPnl: toNumber(totals.todayRealizedPnl),
      sevenDayPnl: toNumber(totals.sevenDayRealizedPnl),
      thirtyDayPnl: toNumber(totals.thirtyDayRealizedPnl),
      runningStrategyCount: activeStrategyCount,
      openPositionCount: openSnapshotRows.length,
      recentWinRate: completedCycleCount > 0 ? (totals.winCount / completedCycleCount) * 100 : null,
    },
    winCount: totals.winCount,
    lossCount: totals.lossCount,
    breakevenCount: totals.breakevenCount,
    completedCycleCount,
    completedFillCount: completedCycleCount,
    incidentExcludedCount: totals.incidentExcludedCount,
    signalCount: toNumber(counts.signalCount),
    gridCount: toNumber(counts.gridCount),
    openPositions: openSnapshotRows,
    lastTradeAt: totals.lastTradeAt || null,
    generatedAt: new Date().toISOString(),
  };
};

module.exports = {
  getUserPerformanceSummary,
};
