const crypto = require("crypto");

const STATS_TYPE = "ING_ZR_GRID_STATS";
const REQUIRED_PERIODS = ["all", "12month", "6month", "3month", "1month"];
const TP_CANDIDATES = [
  "0.4",
  "0.5",
  "0.6",
  "0.7",
  "0.8",
  "0.9",
  "1",
  "1.1",
  "1.2",
  "1.3",
  "1.4",
  "1.5",
];

const LANDING_PERIOD_MAP = {
  "1M": "1month",
  "3M": "3month",
  "6M": "6month",
  "1Y": "12month",
};

const normalizeGridStatsSymbol = (raw) =>
  String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z]+:/, "")
    .replace(/\.P$/i, "");

const normalizeGridStatsTimeframe = (raw) => {
  const value = String(raw || "")
    .trim()
    .toUpperCase();
  const compact = value.replace(/\s+/g, "");
  const numeric = Number(compact.replace(/MIN|M$/i, ""));

  if (["1H", "60", "60M", "60MIN"].includes(compact)) {
    return "1H";
  }
  if (["2H", "120", "120M", "120MIN"].includes(compact)) {
    return "2H";
  }
  if (Number.isFinite(numeric) && numeric > 0) {
    return `${numeric}MIN`;
  }
  return compact || null;
};

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeTpKey = (value) => {
  const numeric = toNumber(value);
  if (numeric == null) {
    return String(value || "").trim();
  }
  return String(Number(numeric.toFixed(4))).replace(/\.0+$/, "");
};

const tpKeyCandidates = (tp) => {
  const normalized = normalizeTpKey(tp);
  const numeric = toNumber(normalized);
  const decimalWithoutLeadingZero =
    numeric != null && Math.abs(numeric) > 0 && Math.abs(numeric) < 1
      ? `.${String(numeric.toFixed(4)).replace(/^0\./, "").replace(/0+$/, "")}`
      : null;
  return [
    String(tp),
    normalized,
    numeric == null ? null : numeric.toFixed(1),
    numeric == null ? null : String(numeric),
    decimalWithoutLeadingZero,
  ].filter((value, index, values) => value && values.indexOf(value) === index);
};

const readMetricValue = (cell = {}, keys = []) => {
  for (const key of keys) {
    if (cell[key] != null) {
      return cell[key];
    }
  }
  return null;
};

const readMetricValueWithPresence = (cell = {}, keys = []) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(cell, key)) {
      return {
        present: true,
        value: cell[key],
      };
    }
  }
  return {
    present: false,
    value: null,
  };
};

const toStatsMetricNumber = (value) => {
  if (value == null) {
    return 0;
  }
  return toNumber(value);
};

const getPeriodMatrix = (payload = {}, periodKey) => {
  if (
    Object.prototype.hasOwnProperty.call(payload.matrix || {}, periodKey) &&
    payload.matrix?.[periodKey] == null
  ) {
    return null;
  }
  if (
    Object.prototype.hasOwnProperty.call(payload.periods || {}, periodKey) &&
    payload.periods?.[periodKey] == null
  ) {
    return null;
  }
  const direct = payload.matrix?.[periodKey];
  if (direct && typeof direct === "object") {
    return direct;
  }
  const nested = payload.periods?.[periodKey]?.matrix || payload.periods?.[periodKey]?.tp;
  if (nested && typeof nested === "object") {
    return nested;
  }
  if (Array.isArray(payload.tpCandidates)) {
    const rows = payload.tpCandidates.filter((item) => String(item?.period || periodKey) === periodKey);
    if (rows.length > 0) {
      return rows.reduce((acc, item) => {
        const key = normalizeTpKey(item.tpPct ?? item.tp ?? item.takeProfit);
        if (key) {
          acc[key] = item;
        }
        return acc;
      }, {});
    }
  }
  return null;
};

const getTpCell = (periodMatrix = {}, tp) => {
  for (const key of tpKeyCandidates(tp)) {
    if (periodMatrix?.[key] && typeof periodMatrix[key] === "object") {
      return periodMatrix[key];
    }
  }
  return null;
};

const isUsableBestcaseCell = (cell) => {
  if (!cell || typeof cell !== "object") {
    return false;
  }
  const tp = toNumber(cell.tp ?? cell.tpPct ?? cell.takeProfit);
  if (tp == null) {
    return false;
  }
  const winRaw = readMetricValueWithPresence(cell, ["winrate", "winRate"]);
  const netRaw = readMetricValueWithPresence(cell, ["net_profit", "netProfit", "netPnl"]);
  return winRaw.present && netRaw.present
    && toStatsMetricNumber(winRaw.value) != null
    && toStatsMetricNumber(netRaw.value) != null;
};

const getBestcaseCell = (payload = {}, periodKey) => {
  const direct = payload.bestcase?.[periodKey] || payload.bestCase?.[periodKey];
  if (isUsableBestcaseCell(direct)) {
    return direct;
  }
  const period = payload.periods?.[periodKey];
  if (isUsableBestcaseCell(period?.bestcase)) {
    return period.bestcase;
  }
  if (isUsableBestcaseCell(period?.bestCase)) {
    return period.bestCase;
  }
  const matrix = getPeriodMatrix(payload, periodKey);
  if (matrix && typeof matrix === "object") {
    return Object.entries(matrix).reduce((best, [tpKey, cell]) => {
      const netRaw = readMetricValueWithPresence(cell, ["net_profit", "netProfit", "netPnl"]);
      if (!netRaw.present) {
        return best;
      }
      const netProfit = toStatsMetricNumber(netRaw.value);
      if (netProfit == null) {
        return best;
      }
      if (!best || netProfit > best.net_profit) {
        const winRaw = readMetricValueWithPresence(cell, ["winrate", "winRate"]);
        return {
          tp: toNumber(cell.tpPct ?? cell.tp ?? cell.takeProfit ?? normalizeTpKey(tpKey)),
          winrate: winRaw.present ? toStatsMetricNumber(winRaw.value) : null,
          net_profit: netProfit,
        };
      }
      return best;
    }, null);
  }
  return null;
};

const stableJson = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const computeStatsPayloadHash = (payload) =>
  crypto.createHash("sha256").update(stableJson(payload || {})).digest("hex");

const validateGridStatsPayload = (payload = {}) => {
  const errors = [];
  const warnings = [];
  const usablePeriods = [];
  const skippedPeriods = [];
  const symbol = normalizeGridStatsSymbol(payload.symbol);
  const timeframe = normalizeGridStatsTimeframe(payload.timeframe ?? payload.candle_min ?? payload.candleMin);
  const calcMode = String(payload.calc_mode || payload.calcMode || "").trim();

  if (String(payload.type || "").trim() !== STATS_TYPE) {
    errors.push("INVALID_TYPE");
  }
  if (!symbol) {
    errors.push("SYMBOL_REQUIRED");
  }
  if (!timeframe) {
    errors.push("TIMEFRAME_REQUIRED");
  }
  if (!calcMode) {
    errors.push("CALC_MODE_REQUIRED");
  }

  for (const periodKey of REQUIRED_PERIODS) {
    const periodMatrix = getPeriodMatrix(payload, periodKey);
    const periodPresent =
      Object.prototype.hasOwnProperty.call(payload.matrix || {}, periodKey) ||
      Object.prototype.hasOwnProperty.call(payload.periods || {}, periodKey);
    if (!periodMatrix || typeof periodMatrix !== "object" || Object.keys(periodMatrix).length === 0) {
      skippedPeriods.push(periodKey);
      warnings.push(periodPresent ? `NO_DATA_PERIOD_SKIPPED:${periodKey}` : `MATRIX_PERIOD_MISSING:${periodKey}`);
      continue;
    }

    let periodHasError = false;
    for (const tp of TP_CANDIDATES) {
      const cell = getTpCell(periodMatrix, tp);
      if (!cell || typeof cell !== "object") {
        errors.push(`MATRIX_CELL_MISSING:${periodKey}:${tp}`);
        periodHasError = true;
        continue;
      }
      const winRaw = readMetricValueWithPresence(cell, ["winrate", "winRate"]);
      const netRaw = readMetricValueWithPresence(cell, ["net_profit", "netProfit", "netPnl"]);
      if (!winRaw.present || toStatsMetricNumber(winRaw.value) == null) {
        errors.push(`MATRIX_WINRATE_INVALID:${periodKey}:${tp}`);
        periodHasError = true;
      }
      if (!netRaw.present || toStatsMetricNumber(netRaw.value) == null) {
        errors.push(`MATRIX_NET_PROFIT_INVALID:${periodKey}:${tp}`);
        periodHasError = true;
      }
    }

    const best = getBestcaseCell(payload, periodKey);
    if (!best || typeof best !== "object") {
      errors.push(`BESTCASE_MISSING:${periodKey}`);
      periodHasError = true;
    } else {
      if (toNumber(best.tp ?? best.tpPct ?? best.takeProfit) == null) {
        errors.push(`BESTCASE_TP_INVALID:${periodKey}`);
        periodHasError = true;
      }
      const bestWinRaw = readMetricValueWithPresence(best, ["winrate", "winRate"]);
      const bestNetRaw = readMetricValueWithPresence(best, ["net_profit", "netProfit", "netPnl"]);
      if (!bestWinRaw.present || toStatsMetricNumber(bestWinRaw.value) == null) {
        errors.push(`BESTCASE_WINRATE_INVALID:${periodKey}`);
        periodHasError = true;
      }
      if (!bestNetRaw.present || toStatsMetricNumber(bestNetRaw.value) == null) {
        errors.push(`BESTCASE_NET_PROFIT_INVALID:${periodKey}`);
        periodHasError = true;
      }
    }

    if (!periodHasError) {
      usablePeriods.push(periodKey);
    }
  }

  if (usablePeriods.length === 0) {
    errors.push("MATRIX_EMPTY_NO_USABLE_PERIOD");
  }

  const expectedPairCount = REQUIRED_PERIODS.length * TP_CANDIDATES.length;
  if (payload.pair_count != null && Number(payload.pair_count) !== expectedPairCount) {
    errors.push(`PAIR_COUNT_INVALID:${payload.pair_count}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      type: STATS_TYPE,
      source: "tradingview",
      category: "grid",
      strategyCode: "SQZGRID",
      strategyDisplayName: "SQZ+GRID",
      symbol,
      timeframe,
      calcMode,
      pairCount: expectedPairCount,
      usablePeriods,
      skippedPeriods,
      warnings,
    },
  };
};

const expandGridStatsMetrics = (payload = {}) => {
  const validation = validateGridStatsPayload(payload);
  if (!validation.ok) {
    return [];
  }
  const base = validation.normalized;
  const rows = [];
  for (const periodKey of base.usablePeriods || REQUIRED_PERIODS) {
    for (const tp of TP_CANDIDATES) {
      const cell = getTpCell(getPeriodMatrix(payload, periodKey), tp);
      rows.push({
        category: base.category,
        strategyCode: base.strategyCode,
        strategyDisplayName: base.strategyDisplayName,
        symbol: base.symbol,
        timeframe: base.timeframe,
        periodKey,
        tp: Number(tp),
        winRate: toStatsMetricNumber(readMetricValueWithPresence(cell, ["winrate", "winRate"]).value),
        netProfit: toStatsMetricNumber(readMetricValueWithPresence(cell, ["net_profit", "netProfit", "netPnl"]).value),
        source: base.source,
      });
    }
  }
  return rows;
};

const extractGridStatsBestcases = (payload = {}) => {
  const validation = validateGridStatsPayload(payload);
  if (!validation.ok) {
    return [];
  }
  const base = validation.normalized;
  return (base.usablePeriods || REQUIRED_PERIODS).map((periodKey) => {
    const best = getBestcaseCell(payload, periodKey);
    return {
      category: base.category,
      strategyCode: base.strategyCode,
      strategyDisplayName: base.strategyDisplayName,
      symbol: base.symbol,
      timeframe: base.timeframe,
      periodKey,
      bestTp: toNumber(best.tp ?? best.tpPct ?? best.takeProfit),
      bestWinRate: toStatsMetricNumber(readMetricValueWithPresence(best, ["winrate", "winRate"]).value),
      bestNetProfit: toStatsMetricNumber(readMetricValueWithPresence(best, ["net_profit", "netProfit", "netPnl"]).value),
      source: base.source,
    };
  });
};

const buildLandingRankRows = (bestcases = []) =>
  Object.entries(LANDING_PERIOD_MAP)
    .map(([landingPeriod, sourcePeriod]) => {
      const best = bestcases.find((item) => item.periodKey === sourcePeriod);
      if (!best) {
        return null;
      }
      return {
        category: best.category,
        periodKey: landingPeriod,
        strategyCode: best.strategyCode,
        strategyDisplayName: best.strategyDisplayName,
        symbol: best.symbol,
        timeframe: best.timeframe,
        score: best.bestNetProfit,
        bestTp: best.bestTp,
        netProfit: best.bestNetProfit,
        winRate: best.bestWinRate,
        source: best.source,
      };
    })
    .filter(Boolean);

module.exports = {
  STATS_TYPE,
  REQUIRED_PERIODS,
  TP_CANDIDATES,
  LANDING_PERIOD_MAP,
  normalizeGridStatsSymbol,
  normalizeGridStatsTimeframe,
  normalizeTpKey,
  validateGridStatsPayload,
  computeStatsPayloadHash,
  expandGridStatsMetrics,
  extractGridStatsBestcases,
  buildLandingRankRows,
};
