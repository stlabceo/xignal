"use strict";

const db = require("./database/connect/config");

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

const getUserPerformanceSummary = async (uid) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = toSqlDate(today);
  const sevenDayStart = buildPeriodStart(7);
  const thirtyDayStart = buildPeriodStart(30);

  const [[ledgerTotals], [strategyCounts], [openSnapshotRows]] = await Promise.all([
    db.query(
      `SELECT
          COALESCE(SUM(realizedPnl), 0) AS totalRealizedPnl,
          COALESCE(SUM(CASE WHEN createdAt >= ? THEN realizedPnl ELSE 0 END), 0) AS todayRealizedPnl,
          COALESCE(SUM(CASE WHEN createdAt >= ? THEN realizedPnl ELSE 0 END), 0) AS sevenDayRealizedPnl,
          COALESCE(SUM(CASE WHEN createdAt >= ? THEN realizedPnl ELSE 0 END), 0) AS thirtyDayRealizedPnl,
          SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) AS winCount,
          SUM(CASE WHEN realizedPnl < 0 THEN 1 ELSE 0 END) AS lossCount,
          COUNT(DISTINCT CASE WHEN realizedPnl <> 0 THEN COALESCE(sourceTradeId, dedupeKey, id) END) AS completedFillCount,
          MAX(tradeTime) AS lastTradeAt
        FROM live_pid_position_ledger
       WHERE uid = ?`,
      [todayStart, sevenDayStart, thirtyDayStart, uid]
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

  const totals = ledgerTotals[0] || {};
  const counts = strategyCounts[0] || {};
  const winCount = toNumber(totals.winCount);
  const lossCount = toNumber(totals.lossCount);
  const completedFillCount = toNumber(totals.completedFillCount);
  const activeStrategyCount = toNumber(counts.activeSignalCount) + toNumber(counts.activeGridCount);

  return {
    source: "live-ledger-readonly",
    dataAvailability: {
      realizedPnl: "AVAILABLE",
      unrealizedPnl: "PRICE_REQUIRED",
      winRate: completedFillCount > 0 ? "AVAILABLE" : "INSUFFICIENT_COMPLETED_TRADES",
      fee: "LEDGER_FEE_IF_RECORDED",
    },
    cards: {
      totalRealizedPnl: toNumber(totals.totalRealizedPnl),
      currentUnrealizedPnl: null,
      todayPnl: toNumber(totals.todayRealizedPnl),
      sevenDayPnl: toNumber(totals.sevenDayRealizedPnl),
      thirtyDayPnl: toNumber(totals.thirtyDayRealizedPnl),
      runningStrategyCount: activeStrategyCount,
      openPositionCount: openSnapshotRows.length,
      recentWinRate: completedFillCount > 0 ? (winCount / completedFillCount) * 100 : null,
    },
    winCount,
    lossCount,
    completedFillCount,
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
