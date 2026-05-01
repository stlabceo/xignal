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
  return [
    String(tp),
    normalized,
    numeric == null ? null : numeric.toFixed(1),
    numeric == null ? null : String(numeric),
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

const getPeriodMatrix = (payload = {}, periodKey) => {
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

const getBestcaseCell = (payload = {}, periodKey) => {
  const direct = payload.bestcase?.[periodKey] || payload.bestCase?.[periodKey];
  if (direct && typeof direct === "object") {
    return direct;
  }
  const period = payload.periods?.[periodKey];
  if (period?.bestcase && typeof period.bestcase === "object") {
    return period.bestcase;
  }
  if (period?.bestCase && typeof period.bestCase === "object") {
    return period.bestCase;
  }
  const matrix = getPeriodMatrix(payload, periodKey);
  if (matrix && typeof matrix === "object") {
    return Object.entries(matrix).reduce((best, [tpKey, cell]) => {
      const netProfit = toNumber(readMetricValue(cell, ["net_profit", "netProfit", "netPnl"]));
      if (netProfit == null) {
        return best;
      }
      if (!best || netProfit > best.net_profit) {
        return {
          tp: toNumber(cell.tpPct ?? cell.tp ?? cell.takeProfit ?? normalizeTpKey(tpKey)),
          winrate: toNumber(readMetricValue(cell, ["winrate", "winRate"])),
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
    if (!periodMatrix || typeof periodMatrix !== "object") {
      errors.push(`MATRIX_PERIOD_MISSING:${periodKey}`);
      continue;
    }

    for (const tp of TP_CANDIDATES) {
      const cell = getTpCell(periodMatrix, tp);
      if (!cell || typeof cell !== "object") {
        errors.push(`MATRIX_CELL_MISSING:${periodKey}:${tp}`);
        continue;
      }
      if (toNumber(readMetricValue(cell, ["winrate", "winRate"])) == null) {
        errors.push(`MATRIX_WINRATE_INVALID:${periodKey}:${tp}`);
      }
      if (toNumber(readMetricValue(cell, ["net_profit", "netProfit", "netPnl"])) == null) {
        errors.push(`MATRIX_NET_PROFIT_INVALID:${periodKey}:${tp}`);
      }
    }

    const best = getBestcaseCell(payload, periodKey);
    if (!best || typeof best !== "object") {
      errors.push(`BESTCASE_MISSING:${periodKey}`);
    } else {
      if (toNumber(best.tp ?? best.tpPct ?? best.takeProfit) == null) {
        errors.push(`BESTCASE_TP_INVALID:${periodKey}`);
      }
      if (toNumber(readMetricValue(best, ["winrate", "winRate"])) == null) {
        errors.push(`BESTCASE_WINRATE_INVALID:${periodKey}`);
      }
      if (toNumber(readMetricValue(best, ["net_profit", "netProfit", "netPnl"])) == null) {
        errors.push(`BESTCASE_NET_PROFIT_INVALID:${periodKey}`);
      }
    }
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
  for (const periodKey of REQUIRED_PERIODS) {
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
        winRate: toNumber(readMetricValue(cell, ["winrate", "winRate"])),
        netProfit: toNumber(readMetricValue(cell, ["net_profit", "netProfit", "netPnl"])),
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
  return REQUIRED_PERIODS.map((periodKey) => {
    const best = getBestcaseCell(payload, periodKey);
    return {
      category: base.category,
      strategyCode: base.strategyCode,
      strategyDisplayName: base.strategyDisplayName,
      symbol: base.symbol,
      timeframe: base.timeframe,
      periodKey,
      bestTp: toNumber(best.tp ?? best.tpPct ?? best.takeProfit),
      bestWinRate: toNumber(readMetricValue(best, ["winrate", "winRate"])),
      bestNetProfit: toNumber(readMetricValue(best, ["net_profit", "netProfit", "netPnl"])),
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
