"use strict";

const db = require("./database/connect/config");
const canonicalRuntimeState = require("./canonical-runtime-state");

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

const toNullableFixed = (value, digits = 8) => {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric.toFixed(digits);
};

const isIncidentLedgerRow = (row = {}) =>
  INCIDENT_ORDER_IDS.has(String(row.sourceOrderId || row.orderId || "")) ||
  INCIDENT_TRADE_IDS.has(String(row.sourceTradeId || row.tradeId || ""));

const normalizeCategory = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "grid" ? "grid" : "signal";
};

const getPid = (row = {}) => Number(row.id || row.pid || row.playId || 0);

const toSqlDate = (date) => date.toISOString().slice(0, 19).replace("T", " ");

const buildPeriodStarts = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sevenDays = new Date(today);
  sevenDays.setDate(sevenDays.getDate() - 7);

  const thirtyDays = new Date(today);
  thirtyDays.setDate(thirtyDays.getDate() - 30);

  return {
    today: toSqlDate(today),
    sevenDays: toSqlDate(sevenDays),
    thirtyDays: toSqlDate(thirtyDays),
  };
};

const getConfiguredNotional = (row = {}) => {
  const direct = toNumber(
    row.tradeValue ??
      row.tradeAmount ??
      row.orderNotional ??
      row.configuredNotional ??
      row.investmentAmount
  );
  if (direct > 0) {
    return direct;
  }

  const margin = toNumber(row.margin ?? row.r_margin);
  const leverage = toNumber(row.leverage ?? row.r_leverage);
  if (margin > 0 && leverage > 0) {
    return margin * leverage;
  }

  return null;
};

const getLeverage = (row = {}) => {
  const leverage = toNumber(row.leverage ?? row.r_leverage);
  return leverage > 0 ? leverage : null;
};

const normalizePositionSide = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "LONG" || normalized === "BUY") {
    return "LONG";
  }
  if (normalized === "SHORT" || normalized === "SELL") {
    return "SHORT";
  }
  return null;
};

const getPositionSide = (row = {}, openSnapshots = []) => {
  const snapshotSide = openSnapshots
    .map((snapshot) => normalizePositionSide(snapshot.positionSide))
    .find(Boolean);
  if (snapshotSide) {
    return snapshotSide;
  }
  return normalizePositionSide(row.positionSide || row.signalType || row.r_signalType || row.side);
};

const groupByPid = (rows = []) => {
  const map = new Map();
  rows.forEach((row) => {
    const pid = Number(row.pid || 0);
    if (!pid) {
      return;
    }
    if (!map.has(pid)) {
      map.set(pid, []);
    }
    map.get(pid).push(row);
  });
  return map;
};

const isOpenSnapshot = (row = {}) =>
  String(row.status || "").trim().toUpperCase() === "OPEN" && toNumber(row.openQty) > 0;

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

const getEventTime = (row = {}) =>
  row.tradeTime || row.createdAt || row.updatedAt || row.eventTime || null;

const isAtOrAfter = (value, sqlDate) => {
  if (!value) {
    return false;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= new Date(`${sqlDate.replace(" ", "T")}Z`).getTime();
};

const summarizePid = ({ row = {}, category, snapshots = [], ledgers = [] }) => {
  const pid = getPid(row);
  const cleanLedgers = ledgers.filter((ledger) => !isIncidentLedgerRow(ledger));
  const openSnapshots = snapshots.filter(isOpenSnapshot);
  const openQty = openSnapshots.reduce((sum, snapshot) => sum + toNumber(snapshot.openQty), 0);
  const actualEntryNotional = openSnapshots.reduce((sum, snapshot) => {
    const openCost = Math.abs(toNumber(snapshot.openCost));
    if (openCost > 0) {
      return sum + openCost;
    }
    return sum + Math.abs(toNumber(snapshot.openQty) * toNumber(snapshot.avgEntryPrice));
  }, 0);

  const avgEntryPrice =
    openQty > 0 && actualEntryNotional > 0
      ? actualEntryNotional / openQty
      : openSnapshots.find((snapshot) => toNumber(snapshot.avgEntryPrice) > 0)?.avgEntryPrice || null;

  const periodStarts = buildPeriodStarts();
  let realizedPnlTotal = 0;
  let realizedPnlToday = 0;
  let realizedPnl7d = 0;
  let realizedPnl30d = 0;
  let commission = 0;
  let hasCommissionEvidence = false;
  let lastTradeAt = null;
  const exitCycles = new Map();

  cleanLedgers.forEach((ledger) => {
    const pnl = toNumber(ledger.realizedPnl);
    if (ledger.fee !== null && ledger.fee !== undefined && ledger.fee !== "") {
      commission += Math.abs(toNumber(ledger.fee));
      hasCommissionEvidence = true;
    }
    const eventTime = getEventTime(ledger);
    realizedPnlTotal += pnl;
    if (isAtOrAfter(eventTime, periodStarts.today)) {
      realizedPnlToday += pnl;
    }
    if (isAtOrAfter(eventTime, periodStarts.sevenDays)) {
      realizedPnl7d += pnl;
    }
    if (isAtOrAfter(eventTime, periodStarts.thirtyDays)) {
      realizedPnl30d += pnl;
    }
    if (eventTime && (!lastTradeAt || new Date(eventTime).getTime() > new Date(lastTradeAt).getTime())) {
      lastTradeAt = eventTime;
    }
    if (isExitLedgerRow(ledger)) {
      const cycleKey = [
        pid,
        ledger.sourceClientOrderId || ledger.clientOrderId || "",
        ledger.sourceOrderId || ledger.orderId || "",
        ledger.sourceTradeId ? "" : ledger.dedupeKey || ledger.id || "",
      ].join("|");
      const prev = exitCycles.get(cycleKey) || 0;
      exitCycles.set(cycleKey, prev + pnl);
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

  const enabled = canonicalRuntimeState.getItemEnabled(row);
  const requiresUserAction = Boolean(row.requiresUserAction || row.attentionRequired);
  const displayStatus =
    requiresUserAction
      ? "확인 필요"
      : openQty > 0
        ? "포지션 보유중"
        : enabled
          ? "운용중 / 신호대기"
          : "OFF / 대기중";

  const leverage = getLeverage(row);
  const realizedPnlGross = realizedPnlTotal;
  const realizedPnlNet = hasCommissionEvidence ? realizedPnlGross - commission : null;
  const actualEntryNotionalSource =
    openQty > 0
      ? actualEntryNotional > 0
        ? "OPEN_SNAPSHOT_REMAINING_COST"
        : "UNAVAILABLE"
      : "FLAT_NONE";

  return {
    pid,
    category,
    positionSide: getPositionSide(row, openSnapshots),
    configuredNotional: toNullableFixed(getConfiguredNotional(row)),
    actualEntryNotional: openQty > 0 ? toNullableFixed(actualEntryNotional) : null,
    actualMarginUsed: openQty > 0 && leverage ? toNullableFixed(actualEntryNotional / leverage) : null,
    nominalMarginUsed: openQty > 0 && leverage ? toNullableFixed(actualEntryNotional / leverage) : null,
    leverage,
    openQty: toNullableFixed(openQty),
    avgEntryPrice: openQty > 0 ? toNullableFixed(avgEntryPrice) : null,
    unrealizedPnl: openQty > 0 ? null : "0.00000000",
    unrealizedPnlEstimatePolicy: openQty > 0 ? "FRONTEND_MARK_PRICE_ESTIMATE_ONLY" : "FLAT_ZERO",
    realizedPnlGross: toNullableFixed(realizedPnlGross),
    commission: hasCommissionEvidence ? toNullableFixed(commission) : null,
    realizedPnlNet: hasCommissionEvidence ? toNullableFixed(realizedPnlNet) : null,
    realizedPnlTotal: toNullableFixed(realizedPnlTotal),
    realizedPnlToday: toNullableFixed(realizedPnlToday),
    realizedPnl7d: toNullableFixed(realizedPnl7d),
    realizedPnl30d: toNullableFixed(realizedPnl30d),
    winCount,
    lossCount,
    breakevenCount,
    lastTradeAt,
    displayStatus,
    userStatusLabel: displayStatus,
    requiresUserAction,
    incidentExcluded: cleanLedgers.length !== ledgers.length,
    actualEntryNotionalSource,
    realizedPnlSource: cleanLedgers.length > 0 ? "LIVE_LEDGER" : "UNAVAILABLE",
    commissionSource: hasCommissionEvidence ? "LIVE_LEDGER_FEE" : "UNAVAILABLE",
    dataAvailability: {
      unrealizedPnlSource: openQty > 0 ? "FRONTEND_MARK_PRICE_ESTIMATE_ONLY" : "FLAT_ZERO",
      realizedPnlSource: cleanLedgers.length > 0 ? "LIVE_LEDGER" : "UNAVAILABLE",
      realizedPnlNetSource: hasCommissionEvidence ? "LIVE_LEDGER_MINUS_FEE" : "UNAVAILABLE",
      commissionSource: hasCommissionEvidence ? "LIVE_LEDGER_FEE" : "UNAVAILABLE",
      actualEntryNotionalSource,
      incidentHandling: cleanLedgers.length !== ledgers.length ? "QA_REPLAY_ACCIDENT_EXCLUDED" : "NONE",
    },
  };
};

const loadSummaryContext = async ({ uid, category, items = [] } = {}) => {
  const pids = (items || []).map(getPid).filter((pid) => pid > 0);
  if (!uid || pids.length === 0) {
    return {
      snapshotsByPid: new Map(),
      ledgersByPid: new Map(),
    };
  }

  const normalizedCategory = normalizeCategory(category);
  const placeholders = pids.map(() => "?").join(",");
  const [snapshotRows, ledgerRows] = await Promise.all([
    db.query(
      `SELECT pid, strategyCategory, symbol, positionSide, status, openQty, avgEntryPrice, openCost, lastEntryAt, lastExitAt, updatedAt, createdAt
         FROM live_pid_position_snapshot
        WHERE uid = ? AND LOWER(strategyCategory) = ? AND pid IN (${placeholders})`,
      [uid, normalizedCategory, ...pids]
    ),
    db.query(
      `SELECT id, pid, strategyCategory, eventType, sourceClientOrderId, sourceOrderId, sourceTradeId, fillQty, fillPrice, fillValue, fee, dedupeKey, realizedPnl, tradeTime, createdAt
         FROM live_pid_position_ledger
        WHERE uid = ? AND LOWER(strategyCategory) = ? AND pid IN (${placeholders})`,
      [uid, normalizedCategory, ...pids]
    ),
  ]);

  return {
    snapshotsByPid: groupByPid(snapshotRows[0] || []),
    ledgersByPid: groupByPid(ledgerRows[0] || []),
  };
};

const decorateStrategyRows = async (items = [], { uid, category = "signal" } = {}) => {
  const context = await loadSummaryContext({ uid, category, items });
  const normalizedCategory = normalizeCategory(category);
  return (items || []).map((row) => {
    const pid = getPid(row);
    const performance = summarizePid({
      row,
      category: normalizedCategory,
      snapshots: context.snapshotsByPid.get(pid) || [],
      ledgers: context.ledgersByPid.get(pid) || [],
    });
    return {
      ...row,
      ...performance,
      performanceSummary: performance,
    };
  });
};

const decorateStrategyItem = async (item = {}, { uid, category = "signal" } = {}) => {
  const rows = await decorateStrategyRows(item ? [item] : [], { uid, category });
  return rows[0] || null;
};

module.exports = {
  decorateStrategyRows,
  decorateStrategyItem,
  summarizePid,
};
