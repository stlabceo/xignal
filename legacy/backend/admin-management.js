const axios = require("axios");
const db = require("./database/connect/config");
const data = require("./data");
const canonicalRuntimeState = require("./canonical-runtime-state");
const gridRuntime = require("./grid-runtime");
const signalStrategyIdentity = require("./signal-strategy-identity");

const EXCHANGE_NAMES = {
  BINANCE: "BINANCE",
};
const KNOWN_SYMBOLS = ["BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT", "DOGEUSDT", "PUMPUSDT"];
const KNOWN_TIMEFRAMES = ["1MIN", "2MIN", "3MIN", "5MIN", "10MIN", "15MIN", "30MIN", "1H", "2H", "4H", "1D"];
const SIGNAL_RUNTIME_TYPE_MAX_LENGTH = signalStrategyIdentity.SIGNAL_RUNTIME_TYPE_MAX_LENGTH;
const TRADE_ACCESS_MODES = {
  DEMO_ONLY: "DEMO_ONLY",
  LIVE_DEMO: "LIVE_DEMO",
};
const STRATEGY_CATEGORY_LABELS = {
  signal: "알고리즘",
  grid: "그리드",
};
const DEFAULT_REFERRAL_SHARE_RATE = 0.3;
const MIN_REFERRAL_SHARE_RATE = 0.1;
const MAX_REFERRAL_SHARE_RATE = 0.5;
const EXCHANGE_SYMBOL_REFRESH_MS = 24 * 60 * 60 * 1000;
const BINANCE_FUTURES_EXCHANGE_INFO_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo";

let exchangeCatalogRefreshPromise = null;

const NORMAL_WEBHOOK_RESULT_CODES = new Set([
  "ENTERED_PENDING",
  "GRID_ARMED",
  "GRID_ACTIVE_IGNORED",
  "DUPLICATE",
  "BACKTEST_IMPORTED",
]);

const ABNORMAL_WEBHOOK_RESULT_CODES = new Set([
  "INVALID_PAYLOAD",
  "NO_MATCHING_STRATEGY",
  "ENTRY_REJECTED",
  "POSITION_TRACKING_ERROR",
  "POSITION_BUCKET_CONFLICT",
  "KILL_SWITCH_BLOCKED",
  "GRID_SYMBOL_CONFLICT",
  "GRID_SIGNAL_MISMATCH",
  "PRICE_UNAVAILABLE",
  "RUNTIME_NOT_READY",
]);

const parseJsonArray = (value) => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  return [];
};

const normalizeSymbol = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\.P$/i, "");

  return normalized || null;
};

const normalizeTimeframe = (value) => {
  return gridRuntime.normalizeGridBunbong(value) || null;
};

const splitFlexibleValues = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  return String(value || "")
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeSignalName = signalStrategyIdentity.normalizeSignalName;
const normalizeSignalStrategyCode = signalStrategyIdentity.normalizeSignalStrategyCode;
const normalizeSignalStrategyKey = signalStrategyIdentity.normalizeSignalStrategyKey;
const resolveSignalStrategyIdentity = signalStrategyIdentity.resolveSignalStrategyIdentity;
const normalizeStrategyKey = (value) => normalizeSignalStrategyKey(value);

const normalizeStrategyCategory = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "grid") {
    return "grid";
  }
  return "signal";
};

const normalizeTradeAccessMode = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === TRADE_ACCESS_MODES.LIVE_DEMO) {
    return TRADE_ACCESS_MODES.LIVE_DEMO;
  }
  return TRADE_ACCESS_MODES.DEMO_ONLY;
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const uniq = (values) => Array.from(new Set(values.filter(Boolean)));
const isItemEnabled = (item = {}) => canonicalRuntimeState.getItemEnabled(item);
const getStrategyCategoryLabel = (category) =>
  STRATEGY_CATEGORY_LABELS[String(category || "").trim().toLowerCase()] || category;

const nowMs = () => Date.now();

const decorateRowsByUid = async (rows = [], decorator) => {
  const groups = new Map();
  (rows || []).forEach((row) => {
    const uid = Number(row?.uid || 0);
    if (!uid) {
      return;
    }

    if (!groups.has(uid)) {
      groups.set(uid, []);
    }

    groups.get(uid).push(row);
  });

  const decoratedGroups = await Promise.all(
    Array.from(groups.entries()).map(async ([uid, items]) => [uid, await decorator(items, { uid })])
  );

  const decoratedByPid = new Map();
  decoratedGroups.forEach(([, items]) => {
    (items || []).forEach((item) => {
      decoratedByPid.set(`${item.uid}|${item.pid}`, item);
    });
  });

  return (rows || []).map((row) => decoratedByPid.get(`${row.uid}|${row.pid}`) || row);
};

const parseExchangeCatalogRows = (rows) => {
  const items = (rows || []).map((row) => ({
    exchangeName: String(row.exchangeName || EXCHANGE_NAMES.BINANCE).toUpperCase(),
    symbol: normalizeSymbol(row.symbol),
    baseAsset: row.baseAsset || null,
    quoteAsset: row.quoteAsset || null,
    contractType: row.contractType || null,
    status: row.status || null,
    isActive: String(row.isActive || "Y").toUpperCase() === "Y",
    updatedAt: row.updatedAt || null,
  }));

  const activeItems = items.filter((item) => item.isActive && item.symbol);
  return {
    items: activeItems,
    symbols: activeItems.map((item) => item.symbol),
    refreshedAt: activeItems[0]?.updatedAt || items[0]?.updatedAt || null,
  };
};

const parseRawExchangeSymbolRules = (rawJson) => {
  if (!rawJson) {
    return null;
  }

  let parsed = null;
  try {
    parsed = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
  } catch (error) {
    parsed = null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const filters = Array.isArray(parsed.filters) ? parsed.filters : [];
  const findFilter = (filterType) =>
    filters.find((item) => String(item?.filterType || "").toUpperCase() === String(filterType || "").toUpperCase()) || null;
  const toFiniteNumber = (...values) => {
    for (const value of values) {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue) && numericValue > 0) {
        return numericValue;
      }
    }
    return 0;
  };

  const priceFilter = findFilter("PRICE_FILTER");
  const lotSizeFilter = findFilter("LOT_SIZE");
  const marketLotSizeFilter = findFilter("MARKET_LOT_SIZE");
  const minNotionalFilter = findFilter("MIN_NOTIONAL");
  const notionalFilter = findFilter("NOTIONAL");

  const minTradeValue = toFiniteNumber(
    minNotionalFilter?.notional,
    notionalFilter?.minNotional,
    notionalFilter?.notional
  );

  return {
    tickSize: toFiniteNumber(priceFilter?.tickSize),
    minQty: toFiniteNumber(lotSizeFilter?.minQty),
    stepSize: toFiniteNumber(lotSizeFilter?.stepSize),
    marketMinQty: toFiniteNumber(marketLotSizeFilter?.minQty, lotSizeFilter?.minQty),
    marketStepSize: toFiniteNumber(marketLotSizeFilter?.stepSize, lotSizeFilter?.stepSize),
    minTradeValue,
  };
};

const refreshExchangeSymbolCatalog = async (exchangeName = EXCHANGE_NAMES.BINANCE) => {
  if (exchangeCatalogRefreshPromise) {
    return exchangeCatalogRefreshPromise;
  }

  exchangeCatalogRefreshPromise = (async () => {
    if (exchangeName !== EXCHANGE_NAMES.BINANCE) {
      throw new Error("지원하지 않는 거래소입니다.");
    }

    const response = await axios.get(BINANCE_FUTURES_EXCHANGE_INFO_URL, {
      timeout: 15000,
    });

    const symbols = Array.isArray(response?.data?.symbols) ? response.data.symbols : [];
    const tradableItems = symbols
      .filter((item) => String(item?.status || "").toUpperCase() === "TRADING")
      .filter((item) => {
        const contractType = String(item?.contractType || "").toUpperCase();
        return !contractType || contractType === "PERPETUAL";
      })
      .map((item) => ({
        symbol: normalizeSymbol(item.symbol),
        baseAsset: item.baseAsset || null,
        quoteAsset: item.quoteAsset || null,
        contractType: item.contractType || null,
        status: item.status || null,
        rawJson: JSON.stringify(item),
      }))
      .filter((item) => item.symbol)
      .sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));

    await db.query(`DELETE FROM exchange_symbol_catalog WHERE exchangeName = ?`, [exchangeName]);

    for (const item of tradableItems) {
      await db.query(
        `INSERT INTO exchange_symbol_catalog
          (exchangeName, symbol, baseAsset, quoteAsset, contractType, status, isActive, rawJson, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, 'Y', ?, NOW())`,
        [exchangeName, item.symbol, item.baseAsset, item.quoteAsset, item.contractType, item.status, item.rawJson]
      );
    }

    const [rows] = await db.query(
      `SELECT exchangeName, symbol, baseAsset, quoteAsset, contractType, status, isActive, updatedAt
         FROM exchange_symbol_catalog
        WHERE exchangeName = ?
        ORDER BY symbol ASC`,
      [exchangeName]
    );

    return parseExchangeCatalogRows(rows);
  })();

  try {
    return await exchangeCatalogRefreshPromise;
  } finally {
    exchangeCatalogRefreshPromise = null;
  }
};

const loadExchangeSymbolCatalog = async (exchangeName = EXCHANGE_NAMES.BINANCE) => {
  const [rows] = await db.query(
    `SELECT exchangeName, symbol, baseAsset, quoteAsset, contractType, status, isActive, updatedAt
       FROM exchange_symbol_catalog
      WHERE exchangeName = ?
      ORDER BY symbol ASC`,
    [exchangeName]
  );

  const parsed = parseExchangeCatalogRows(rows);
  const refreshedMs = parsed.refreshedAt ? new Date(parsed.refreshedAt).getTime() : 0;
  const shouldRefresh =
    !parsed.items.length ||
    !Number.isFinite(refreshedMs) ||
    refreshedMs <= 0 ||
    nowMs() - refreshedMs >= EXCHANGE_SYMBOL_REFRESH_MS;

  if (!shouldRefresh) {
    return parsed;
  }

  try {
    return await refreshExchangeSymbolCatalog(exchangeName);
  } catch (error) {
    if (parsed.items.length) {
      return parsed;
    }

    return {
      items: KNOWN_SYMBOLS.map((symbol) => ({
        exchangeName,
        symbol,
        baseAsset: null,
        quoteAsset: "USDT",
        contractType: "PERPETUAL",
        status: "FALLBACK",
        isActive: true,
        updatedAt: null,
      })),
      symbols: KNOWN_SYMBOLS.slice(),
      refreshedAt: null,
      errorMessage: error.message,
    };
  }
};

const getExchangeSymbolRuleSummary = async (symbol, exchangeName = EXCHANGE_NAMES.BINANCE) => {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) {
    return null;
  }

  await loadExchangeSymbolCatalog(exchangeName);

  let [rows] = await db.query(
    `SELECT exchangeName, symbol, baseAsset, quoteAsset, contractType, status, isActive, rawJson, updatedAt
       FROM exchange_symbol_catalog
      WHERE exchangeName = ? AND symbol = ?
      LIMIT 1`,
    [exchangeName, normalizedSymbol]
  );

  if (!rows.length) {
    try {
      await refreshExchangeSymbolCatalog(exchangeName);
      [rows] = await db.query(
        `SELECT exchangeName, symbol, baseAsset, quoteAsset, contractType, status, isActive, rawJson, updatedAt
           FROM exchange_symbol_catalog
          WHERE exchangeName = ? AND symbol = ?
          LIMIT 1`,
        [exchangeName, normalizedSymbol]
      );
    } catch (error) {
      rows = [];
    }
  }

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  const rules = parseRawExchangeSymbolRules(row.rawJson);

  return {
    exchangeName: String(row.exchangeName || exchangeName).toUpperCase(),
    symbol: normalizeSymbol(row.symbol),
    baseAsset: row.baseAsset || null,
    quoteAsset: row.quoteAsset || null,
    contractType: row.contractType || null,
    status: row.status || null,
    isActive: String(row.isActive || "Y").toUpperCase() === "Y",
    updatedAt: row.updatedAt || null,
    tickSize: Number(rules?.tickSize || 0),
    minQty: Number(rules?.minQty || 0),
    stepSize: Number(rules?.stepSize || 0),
    marketMinQty: Number(rules?.marketMinQty || 0),
    marketStepSize: Number(rules?.marketStepSize || 0),
    minTradeValue: Number(rules?.minTradeValue || 0),
  };
};

const getPriceFeedStatus = (symbols) => {
  const uniqueSymbols = uniq((symbols || []).map(normalizeSymbol));
  if (!uniqueSymbols.length) {
    return {
      status: "UNKNOWN",
      label: "미확인",
      abnormal: false,
      detail: "확인할 종목이 없습니다.",
    };
  }

  const staleSymbols = [];
  const missingSymbols = [];
  const currentTime = nowMs();

  uniqueSymbols.forEach((symbol) => {
    const item = data.getPrice(symbol);
    if (!item?.st) {
      missingSymbols.push(symbol);
      return;
    }

    const freshnessMs = Math.max(0, currentTime - Number(item.lastTradeTime || 0));
    if (freshnessMs > 15000) {
      staleSymbols.push(symbol);
    }
  });

  if (!missingSymbols.length && !staleSymbols.length) {
    return {
      status: "NORMAL",
      label: "정상",
      abnormal: false,
      detail: `${uniqueSymbols.length}개 종목 모두 최근 가격 수신 정상`,
    };
  }

  const parts = [];
  if (missingSymbols.length) {
    parts.push(`미수신: ${missingSymbols.join(", ")}`);
  }
  if (staleSymbols.length) {
    parts.push(`지연: ${staleSymbols.join(", ")}`);
  }

  return {
    status: "ABNORMAL",
    label: "비정상",
    abnormal: true,
    detail: parts.join(" / "),
  };
};

const dedupeLiveTradeLogs = (rows) => {
  const uniqueMap = new Map();

  rows.forEach((row) => {
    const key = [
      row.uid,
      row.pid,
      row.symbol,
      row.type,
      row.bunbong,
      row.signalType,
      row.openTime,
      row.closeTime,
      row.openPrice,
      row.closePrice,
      row.positionSize,
      row.pol_sum,
      row.charge,
      row.exitReason,
      row.exitMode,
    ].join("|");

    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, {
        uid: Number(row.uid),
        pid: Number(row.pid),
        symbol: normalizeSymbol(row.symbol),
        strategyKey: normalizeStrategyKey(row.type),
        bunbong: normalizeTimeframe(row.bunbong),
        signalType: String(row.signalType || "").toUpperCase(),
        tradeAmount: toNumber(row.positionSize, 0) * 2,
        pnl: toNumber(row.pol_sum, 0),
        charge: toNumber(row.charge, 0),
        openTime: row.openTime,
        closeTime: row.closeTime,
      });
    }
  });

  return Array.from(uniqueMap.values());
};

const extractTradePayloadMetrics = (payloadJson) => {
  if (!payloadJson) {
    return { realizedPnl: 0, commission: 0, tradeId: null, commissionAsset: null };
  }

  try {
    const payload = JSON.parse(payloadJson);
    const order = payload?.o || {};
    return {
      realizedPnl: toNumber(order.rp, 0),
      commission: toNumber(order.n, 0),
      tradeId: order.t == null ? null : String(order.t),
      commissionAsset: order.N || null,
    };
  } catch (error) {
    return { realizedPnl: 0, commission: 0, tradeId: null, commissionAsset: null };
  }
};

const dedupeRuntimeTradeEvents = (rows) => {
  const uniqueMap = new Map();

  rows.forEach((row) => {
    const payloadMetrics = extractTradePayloadMetrics(row.payload_json);
    const price = toNumber(row.last_price || row.avg_price, 0);
    const qty = toNumber(row.executed_qty, 0);
    if (qty <= 0 || price <= 0) {
      return;
    }

    const key = [
      row.uid,
      row.pid,
      row.strategy_category,
      row.client_order_id,
      row.order_id,
      payloadMetrics.tradeId,
      row.execution_type,
      row.order_status,
      row.executed_qty,
      row.last_price,
      row.avg_price,
      row.trade_time,
    ].join("|");

    if (!uniqueMap.has(key)) {
      const orderType = String(row.order_type || row.orig_type || "").toUpperCase();
      uniqueMap.set(key, {
        uid: Number(row.uid),
        pid: row.pid == null ? null : Number(row.pid),
        category: String(row.strategy_category || "").toLowerCase(),
        symbol: normalizeSymbol(row.symbol),
        side: String(row.side || "").toUpperCase(),
        orderType,
        tradeAmount: qty * price,
        commission: payloadMetrics.commission,
        commissionAsset: payloadMetrics.commissionAsset,
        realizedPnl: payloadMetrics.realizedPnl,
        netPnl: payloadMetrics.realizedPnl - payloadMetrics.commission,
        sourceTradeId: payloadMetrics.tradeId,
        sourceOrderId: row.order_id == null ? null : String(row.order_id),
        sourceClientOrderId: row.client_order_id || null,
        tradeTime: row.trade_time,
      });
    }
  });

  return Array.from(uniqueMap.values());
};

const deriveWebhookStatus = (rows, options = {}) => {
  const baselineAtMs = options?.baselineAt ? new Date(options.baselineAt).getTime() : 0;
  const filteredRows = baselineAtMs
    ? (rows || []).filter((row) => {
        const createdAtMs = row?.created_at ? new Date(row.created_at).getTime() : 0;
        return Number.isFinite(createdAtMs) && createdAtMs >= baselineAtMs;
      })
    : (rows || []);

  const latest = filteredRows[0];
  if (!latest) {
    return {
      status: "UNKNOWN",
      label: "미확인",
      abnormal: false,
      detail: baselineAtMs
        ? "현재 전략 저장/ON 이후 수신 기록이 없습니다."
        : "최근 수신 기록이 없습니다.",
    };
  }

  const resultCode = String(latest.result_code || "").trim().toUpperCase();
  const status = String(latest.status || "").trim().toUpperCase();

  if (ABNORMAL_WEBHOOK_RESULT_CODES.has(resultCode) || status === "ERROR" || toNumber(latest.http_status, 200) >= 400) {
    return {
      status: "ABNORMAL",
      label: "비정상",
      abnormal: true,
      detail: `${latest.result_code || latest.status} @ ${latest.created_at || "-"}`,
    };
  }

  if (NORMAL_WEBHOOK_RESULT_CODES.has(resultCode) || status === "PROCESSED") {
    return {
      status: "NORMAL",
      label: "정상",
      abnormal: false,
      detail: `${latest.result_code || latest.status} @ ${latest.created_at || "-"}`,
    };
  }

  return {
    status: "UNKNOWN",
    label: "미확인",
    abnormal: false,
    detail: `${latest.result_code || latest.status} @ ${latest.created_at || "-"}`,
  };
};

const deriveBacktestStatus = (rows) => {
  const latest = (rows || [])[0];
  if (!latest) {
    return {
      status: "UNKNOWN",
      label: "미확인",
      abnormal: false,
      detail: "최근 통계 수신 기록이 없습니다.",
    };
  }

  const status = String(latest.status || "").trim().toUpperCase();
  if (status === "IMPORTED" || status === "BACKTEST_IMPORTED") {
    return {
      status: "NORMAL",
      label: "정상",
      abnormal: false,
      detail: `${latest.status} @ ${latest.created_at || "-"}`,
    };
  }

  return {
    status: "ABNORMAL",
    label: "비정상",
    abnormal: true,
    detail: `${latest.status} @ ${latest.created_at || "-"}`,
  };
};

const parseCatalogRow = (row, memberMap) => {
  const allowedSymbols = uniq(parseJsonArray(row.allowedSymbolsJson).map(normalizeSymbol));
  const allowedTimeframes = uniq(parseJsonArray(row.allowedTimeframesJson).map(normalizeTimeframe));
  const allowedMemberIds = uniq(parseJsonArray(row.allowedMemberIdsJson).map((item) => toNumber(item, 0))).filter((item) => item > 0);
  const strategyCategory = normalizeStrategyCategory(row.strategyCategory);
  const signalName = normalizeSignalName(row.signalName);
  const identity =
    strategyCategory === "signal"
      ? resolveSignalStrategyIdentity(signalName, row.strategyName)
      : {
          displayName: normalizeSignalName(row.strategyName || signalName),
          strategyCode: signalName,
          aliases: signalName ? [signalName] : [],
        };

  return {
    id: Number(row.id),
    strategyCategory,
    strategyName: row.strategyName,
    signalName,
    displayName: identity.displayName,
    strategyCode: identity.strategyCode,
    runtimeType: identity.strategyCode,
    aliases: identity.aliases,
    strategyKey: normalizeStrategyKey(identity.strategyCode),
    allowedSymbols,
    allowedTimeframes,
    permissionMode: String(row.permissionMode || "ALL").toUpperCase(),
    allowedMemberIds,
    allowedMembers: allowedMemberIds.map((memberId) => memberMap.get(memberId)).filter(Boolean),
    isActive: String(row.isActive || "Y").toUpperCase() === "Y",
    notes: row.notes || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const getStrategyCatalogCreateConstraint = (catalogRow = {}) => {
  if (normalizeStrategyCategory(catalogRow.strategyCategory) !== "signal") {
    return {
      canCreatePid: true,
      createBlockerCode: null,
      createBlockerMessage: null,
    };
  }

  const signalName = normalizeSignalName(catalogRow.signalName);
  const strategyCode = normalizeSignalStrategyCode(catalogRow.strategyCode || signalName);
  if (!strategyCode) {
    return {
      canCreatePid: false,
      createBlockerCode: "MISSING_SIGNAL_NAME",
      createBlockerMessage: "Signal strategy name is missing.",
    };
  }

  if (strategyCode.length > SIGNAL_RUNTIME_TYPE_MAX_LENGTH) {
    return {
      canCreatePid: false,
      createBlockerCode: "SIGNAL_TYPE_LENGTH_EXCEEDED",
      createBlockerMessage: `Signal PID create is blocked because runtime strategy code length ${strategyCode.length} exceeds live/test signal type column max length ${SIGNAL_RUNTIME_TYPE_MAX_LENGTH}.`,
    };
  }

  return {
    canCreatePid: true,
    createBlockerCode: null,
    createBlockerMessage: null,
  };
};

const listUserSelectableStrategyCatalog = async ({ uid = null, category = null } = {}) => {
  const normalizedUid = Number(uid || 0);
  const requestedCategory = category ? normalizeStrategyCategory(category) : null;
  const [catalogRows] = await db.query(
    `SELECT *
       FROM strategy_catalog
      WHERE isActive = 'Y'
      ORDER BY strategyCategory ASC, signalName ASC`
  );

  return catalogRows
    .map((row) => parseCatalogRow(row, new Map()))
    .filter((row) => !requestedCategory || row.strategyCategory === requestedCategory)
    .filter((row) => row.permissionMode !== "SPECIFIC" || row.allowedMemberIds.includes(normalizedUid))
    .map((row) => ({
      ...row,
      ...getStrategyCatalogCreateConstraint(row),
    }));
};

const loadMemberMap = async () => {
  const [rows] = await db.query(
    `SELECT id, mem_id AS memId, mem_name AS memName, mem_mobile AS mobile, email, grade, tradeAccessMode,
            appKey, appSecret
       FROM admin_member
      ORDER BY id ASC`
  );

  const memberMap = new Map();
  rows.forEach((row) => {
    memberMap.set(Number(row.id), {
      uid: Number(row.id),
      memId: row.memId,
      memName: row.memName,
      mobile: row.mobile,
      email: row.email,
      grade: Number(row.grade || 0),
      tradeAccessMode: normalizeTradeAccessMode(row.tradeAccessMode),
      hasCredentials: Boolean(row.appKey && row.appSecret),
    });
  });

  return { rows, memberMap };
};

const loadCurrentStrategyInstances = async () => {
  const [signalLiveRows] = await db.query(
    `SELECT id AS pid, uid, a_name AS strategyName, symbol, bunbong, type, signalType, enabled, status, marginType, leverage, margin, profit, stopLoss, r_pol_sum, r_qty, r_exactPrice, r_splitRealizedPnl, created_at AS updatedAt
       FROM live_play_list`
  );
  const [signalTestRows] = await db.query(
    `SELECT id AS pid, uid, a_name AS strategyName, symbol, bunbong, type, signalType, enabled, status, marginType, leverage, margin, profit, stopLoss, r_pol_sum, r_qty, r_exactPrice, r_splitRealizedPnl, created_at AS updatedAt
       FROM test_play_list`
  );
  const [gridLiveRows] = await db.query(
    `SELECT id AS pid, uid, a_name AS strategyName, strategySignal, symbol, bunbong, enabled, regimeStatus, marginType, leverage, margin, profit, triggerPrice, supportPrice, resistancePrice, longQty, shortQty, updatedAt
       FROM live_grid_strategy_list`
  );
  const [gridTestRows] = await db.query(
    `SELECT id AS pid, uid, a_name AS strategyName, strategySignal, symbol, bunbong, enabled, regimeStatus, marginType, leverage, margin, profit, triggerPrice, supportPrice, resistancePrice, longQty, shortQty, updatedAt
       FROM test_grid_strategy_list`
  );

  const mapSignalInstanceRow = (row, mode) => {
    const identity = resolveSignalStrategyIdentity(row.type, row.strategyName);
    return {
      mode,
      category: "signal",
      pid: Number(row.pid),
      uid: Number(row.uid),
      strategyName: row.strategyName,
      displayName: identity.displayName,
      strategyCode: identity.strategyCode,
      categoryLabel: getStrategyCategoryLabel("signal"),
      strategyKey: normalizeStrategyKey(identity.strategyCode),
      signalName: row.type,
      symbol: normalizeSymbol(row.symbol),
      bunbong: normalizeTimeframe(row.bunbong),
      signalType: String(row.signalType || "").toUpperCase(),
      enabled: row.enabled,
      status: row.status,
      marginType: row.marginType,
      leverage: toNumber(row.leverage, 0),
      margin: toNumber(row.margin, 0),
      profit: toNumber(row.profit, 0),
      stopLoss: toNumber(row.stopLoss, 0),
      r_qty: toNumber(row.r_qty, 0),
      r_exactPrice: toNumber(row.r_exactPrice, 0),
      r_splitRealizedPnl: toNumber(row.r_splitRealizedPnl, 0),
      runningPnl: toNumber(row.r_pol_sum, 0),
      updatedAt: row.updatedAt || null,
    };
  };

  const signalRows = signalLiveRows
    .map((row) => mapSignalInstanceRow(row, "LIVE"))
    .concat(signalTestRows.map((row) => mapSignalInstanceRow(row, "TEST")));

  const gridRows = gridLiveRows
    .map((row) => ({
      mode: "LIVE",
      category: "grid",
      pid: Number(row.pid),
      uid: Number(row.uid),
      strategyName: row.strategyName,
      categoryLabel: getStrategyCategoryLabel("grid"),
      strategyKey: normalizeStrategyKey(row.strategySignal),
      signalName: row.strategySignal,
      symbol: normalizeSymbol(row.symbol),
      bunbong: normalizeTimeframe(row.bunbong),
      enabled: row.enabled,
      status: row.regimeStatus,
      marginType: row.marginType,
      leverage: toNumber(row.leverage, 0),
      margin: toNumber(row.margin, 0),
      profit: toNumber(row.profit, 0),
      triggerPrice: toNumber(row.triggerPrice, 0),
      supportPrice: toNumber(row.supportPrice, 0),
      resistancePrice: toNumber(row.resistancePrice, 0),
      longQty: toNumber(row.longQty, 0),
      shortQty: toNumber(row.shortQty, 0),
      runningPnl: 0,
      updatedAt: row.updatedAt || null,
    }))
    .concat(
      gridTestRows.map((row) => ({
        mode: "TEST",
        category: "grid",
        pid: Number(row.pid),
        uid: Number(row.uid),
        strategyName: row.strategyName,
        categoryLabel: getStrategyCategoryLabel("grid"),
        strategyKey: normalizeStrategyKey(row.strategySignal),
        signalName: row.strategySignal,
        symbol: normalizeSymbol(row.symbol),
        bunbong: normalizeTimeframe(row.bunbong),
        enabled: row.enabled,
        status: row.regimeStatus,
        marginType: row.marginType,
        leverage: toNumber(row.leverage, 0),
        margin: toNumber(row.margin, 0),
        profit: toNumber(row.profit, 0),
        triggerPrice: toNumber(row.triggerPrice, 0),
        supportPrice: toNumber(row.supportPrice, 0),
        resistancePrice: toNumber(row.resistancePrice, 0),
        longQty: toNumber(row.longQty, 0),
        shortQty: toNumber(row.shortQty, 0),
        runningPnl: 0,
        updatedAt: row.updatedAt || null,
      }))
    );

  const decoratedSignalRows = await decorateRowsByUid(signalRows, canonicalRuntimeState.decorateSignalCollection);
  const decoratedGridRows = await decorateRowsByUid(gridRows, canonicalRuntimeState.decorateGridCollection);

  return { signalRows: decoratedSignalRows, gridRows: decoratedGridRows, allRows: decoratedSignalRows.concat(decoratedGridRows) };
};

const buildSignalProfitSummary = (liveTradeLogs) => {
  const byStrategyKey = new Map();

  liveTradeLogs.forEach((row) => {
    const strategyKey = normalizeStrategyKey(row.strategyKey);
    if (!strategyKey) {
      return;
    }

    const current = byStrategyKey.get(strategyKey) || {
      totalPnl: 0,
      buyPnl: 0,
      sellPnl: 0,
      instanceMap: new Map(),
    };

    current.totalPnl += toNumber(row.pnl, 0);
    if (row.signalType === "BUY") {
      current.buyPnl += toNumber(row.pnl, 0);
    }
    if (row.signalType === "SELL") {
      current.sellPnl += toNumber(row.pnl, 0);
    }

    const instanceKey = `${row.uid}|${row.pid}`;
    const instance = current.instanceMap.get(instanceKey) || {
      uid: row.uid,
      pid: row.pid,
      mode: "LIVE",
      symbol: row.symbol,
      bunbong: row.bunbong,
      signalType: row.signalType,
      pnl: 0,
      tradeAmount: 0,
      tradeCount: 0,
    };

    instance.pnl += toNumber(row.pnl, 0);
    instance.tradeAmount += toNumber(row.tradeAmount, 0);
    instance.tradeCount += 1;
    current.instanceMap.set(instanceKey, instance);

    byStrategyKey.set(strategyKey, current);
  });

  return byStrategyKey;
};

const buildGridProfitSummary = (runtimeTradeEvents, gridRows) => {
  const pidToStrategyKey = new Map();
  gridRows
    .filter((row) => row.mode === "LIVE")
    .forEach((row) => pidToStrategyKey.set(Number(row.pid), normalizeStrategyKey(row.signalName)));

  const byStrategyKey = new Map();

  runtimeTradeEvents
    .filter((row) => row.category === "grid")
    .forEach((row) => {
      const strategyKey = pidToStrategyKey.get(Number(row.pid));
      if (!strategyKey) {
        return;
      }

      const current = byStrategyKey.get(strategyKey) || {
        totalPnl: 0,
        buyPnl: 0,
        sellPnl: 0,
        instanceMap: new Map(),
      };

      current.totalPnl += toNumber(row.netPnl, 0);
      if (row.side === "BUY") {
        current.buyPnl += toNumber(row.netPnl, 0);
      }
      if (row.side === "SELL") {
        current.sellPnl += toNumber(row.netPnl, 0);
      }

      const instanceKey = `${row.uid}|${row.pid}`;
      const instance = current.instanceMap.get(instanceKey) || {
        uid: row.uid,
        pid: row.pid,
        mode: "LIVE",
        symbol: row.symbol,
        bunbong: null,
        signalType: row.side,
        pnl: 0,
        tradeAmount: 0,
        tradeCount: 0,
      };

      instance.pnl += toNumber(row.netPnl, 0);
      instance.tradeAmount += toNumber(row.tradeAmount, 0);
      instance.tradeCount += 1;
      current.instanceMap.set(instanceKey, instance);

      byStrategyKey.set(strategyKey, current);
    });

  return byStrategyKey;
};

const loadLatestRiskMap = async () => {
  const [rows] = await db.query(
    `SELECT s.*
       FROM account_risk_snapshot s
       INNER JOIN (
         SELECT uid, MAX(id) AS latestId
           FROM account_risk_snapshot
          GROUP BY uid
       ) latest
          ON latest.uid = s.uid
         AND latest.latestId = s.id`
  );

  const riskMap = new Map();
  rows.forEach((row) => riskMap.set(Number(row.uid), row));
  return riskMap;
};

const resolveAllowedMemberIds = async (inputIds) => {
  const rawItems = splitFlexibleValues(inputIds);

  if (!rawItems.length) {
    return [];
  }

  const numericIds = rawItems.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0);
  const memIds = rawItems
    .map((item) => String(item || "").trim())
    .filter((item) => item && !/^\d+$/.test(item));

  const [rows] = await db.query(
    `SELECT id, mem_id
       FROM admin_member
      WHERE id IN (?)
         OR mem_id IN (?)`,
    [numericIds.length ? numericIds : [0], memIds.length ? memIds : [""]]
  );

  return uniq(rows.map((row) => Number(row.id)));
};

const normalizeCatalogPayload = async (body = {}) => {
  const strategyCategory = normalizeStrategyCategory(body.strategyCategory || body.category);
  const strategyName = normalizeSignalName(body.strategyName || body.a_name);
  const signalName = normalizeSignalName(body.signalName || body.strategySignal || body.type);
  const allowedSymbols = uniq(
    splitFlexibleValues(body.allowedSymbols)
      .map(normalizeSymbol)
      .filter(Boolean)
  );
  const allowedTimeframes = uniq(
    splitFlexibleValues(body.allowedTimeframes)
      .map(normalizeTimeframe)
      .filter(Boolean)
  );
  const permissionMode = String(body.permissionMode || "ALL").trim().toUpperCase() === "SPECIFIC" ? "SPECIFIC" : "ALL";
  const allowedMemberIds = permissionMode === "SPECIFIC" ? await resolveAllowedMemberIds(body.allowedMemberIds) : [];
  const isActive = String(body.isActive || "Y").trim().toUpperCase() === "N" ? "N" : "Y";

  if (!strategyName) {
    throw new Error("전략 이름이 필요합니다.");
  }
  if (!signalName) {
    throw new Error("시그널 이름이 필요합니다.");
  }

  return {
    id: body.id ? Number(body.id) : null,
    strategyCategory,
    strategyName,
    signalName,
    allowedSymbols,
    allowedTimeframes,
    permissionMode,
    allowedMemberIds,
    isActive,
    notes: String(body.notes || "").trim(),
  };
};

const listStrategyCatalogOverview = async () => {
  const [{ memberMap }, { allRows, signalRows, gridRows }, riskMap, exchangeSymbolCatalog] = await Promise.all([
    loadMemberMap(),
    loadCurrentStrategyInstances(),
    loadLatestRiskMap(),
    loadExchangeSymbolCatalog(EXCHANGE_NAMES.BINANCE),
  ]);

  const [catalogRows] = await db.query(`SELECT * FROM strategy_catalog ORDER BY strategyCategory ASC, signalName ASC`);
  const [webhookRows] = await db.query(
    `SELECT hook_category, strategy_key, status, result_code, http_status, created_at
       FROM webhook_event_log
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY created_at DESC`
  );
  const [backtestRows] = await db.query(
    `SELECT strategy_key, status, created_at
       FROM backtest_webhook_log
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      ORDER BY created_at DESC`
  );
  const [liveLogRows] = await db.query(
    `SELECT uid, pid, symbol, type, bunbong, signalType, positionSize, pol_sum, charge, openTime, closeTime, openPrice, closePrice, exitReason, exitMode
       FROM live_play_log`
  );
  const [runtimeTradeRows] = await db.query(
    `SELECT uid, pid, strategy_category, symbol, side, client_order_id, order_id, execution_type, order_status,
            order_type, orig_type, executed_qty, avg_price, last_price, trade_time, payload_json
       FROM binance_runtime_event_log
      WHERE event_type = 'ORDER_TRADE_UPDATE'
        AND execution_type = 'TRADE'
        AND executed_qty IS NOT NULL`
  );

  const parsedCatalogRows = catalogRows.map((row) => parseCatalogRow(row, memberMap));
  const liveTradeLogs = dedupeLiveTradeLogs(liveLogRows);
  const runtimeTrades = dedupeRuntimeTradeEvents(runtimeTradeRows);
  const signalProfitSummary = buildSignalProfitSummary(liveTradeLogs);
  const gridProfitSummary = buildGridProfitSummary(runtimeTrades, gridRows);

  const rows = parsedCatalogRows.map((catalogRow) => {
    const matchingInstances = allRows.filter(
      (row) =>
        row.category === catalogRow.strategyCategory &&
        row.strategyKey === catalogRow.strategyKey
    );
    const statusBaselineAt = [catalogRow.updatedAt]
      .concat(matchingInstances.map((item) => item.updatedAt).filter(Boolean))
      .reduce((latest, current) => {
        const latestMs = latest ? new Date(latest).getTime() : 0;
        const currentMs = current ? new Date(current).getTime() : 0;
        return currentMs > latestMs ? current : latest;
      }, null);

    const usersTotal = uniq(matchingInstances.map((item) => item.uid)).length;
    const registeredCount = matchingInstances.length;
    const onCount = matchingInstances.filter((item) => isItemEnabled(item)).length;

    const strategyWebhookRows = webhookRows.filter(
      (row) =>
        String(row.hook_category || "").toLowerCase() === catalogRow.strategyCategory &&
        normalizeStrategyKey(row.strategy_key) === catalogRow.strategyKey
    );

    const signalWebhookStatus = deriveWebhookStatus(strategyWebhookRows, {
      baselineAt: statusBaselineAt,
    });
    const statsWebhookStatus = deriveBacktestStatus(
      backtestRows.filter((row) => normalizeStrategyKey(row.strategy_key) === catalogRow.strategyKey)
    );

    const priceFeedStatus = getPriceFeedStatus(
      catalogRow.allowedSymbols.length
        ? catalogRow.allowedSymbols
        : uniq(matchingInstances.map((item) => item.symbol))
    );

    const profitSummary =
      catalogRow.strategyCategory === "grid"
        ? gridProfitSummary.get(catalogRow.strategyKey) || {
            totalPnl: 0,
            buyPnl: 0,
            sellPnl: 0,
            instanceMap: new Map(),
          }
        : signalProfitSummary.get(catalogRow.strategyKey) || {
            totalPnl: 0,
            buyPnl: 0,
            sellPnl: 0,
            instanceMap: new Map(),
          };

    const instancePerformance = Array.from(profitSummary.instanceMap.values())
      .map((item) => ({
        ...item,
        member: memberMap.get(Number(item.uid)) || null,
        riskLevel: riskMap.get(Number(item.uid))?.risk_level || "UNKNOWN",
      }))
      .sort((a, b) => toNumber(b.pnl, 0) - toNumber(a.pnl, 0));

    return {
      ...catalogRow,
      signalWebhookStatus,
      statsWebhookStatus,
      priceFeedStatus,
      usage: {
        usersTotal,
        registeredCount,
        onCount,
      },
      statusBaselineAt,
      profit: {
        totalPnl: toNumber(profitSummary.totalPnl, 0),
        buyPnl: toNumber(profitSummary.buyPnl, 0),
        sellPnl: toNumber(profitSummary.sellPnl, 0),
      },
      instancePerformance,
      matchingInstances: matchingInstances.map((item) => ({
        ...item,
        member: memberMap.get(Number(item.uid)) || null,
        riskLevel: riskMap.get(Number(item.uid))?.risk_level || "UNKNOWN",
      })),
    };
  });

  rows.exchangeSymbolCatalog = exchangeSymbolCatalog;
  return rows;
};

const getStrategyCatalogItem = async (catalogId) => {
  const items = await listStrategyCatalogOverview();
  return items.find((item) => Number(item.id) === Number(catalogId)) || null;
};

const saveStrategyCatalog = async (body) => {
  const payload = await normalizeCatalogPayload(body);
  const params = [
    payload.strategyCategory,
    payload.strategyName,
    payload.signalName,
    JSON.stringify(payload.allowedSymbols),
    JSON.stringify(payload.allowedTimeframes),
    payload.permissionMode,
    JSON.stringify(payload.allowedMemberIds),
    payload.isActive,
    payload.notes,
  ];

  if (payload.id) {
    await db.query(
      `UPDATE strategy_catalog
          SET strategyCategory = ?,
              strategyName = ?,
              signalName = ?,
              allowedSymbolsJson = ?,
              allowedTimeframesJson = ?,
              permissionMode = ?,
              allowedMemberIdsJson = ?,
              isActive = ?,
              notes = ?,
              updatedAt = NOW()
        WHERE id = ?
        LIMIT 1`,
      params.concat([payload.id])
    );

    return payload.id;
  }

  const [result] = await db.query(
    `INSERT INTO strategy_catalog
      (strategyCategory, strategyName, signalName, allowedSymbolsJson, allowedTimeframesJson, permissionMode, allowedMemberIdsJson, isActive, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );

  return result.insertId;
};

const deleteStrategyCatalog = async (catalogId) => {
  const item = await getStrategyCatalogItem(catalogId);
  if (!item) {
    throw new Error("전략 카탈로그를 찾을 수 없습니다.");
  }

  if (item.usage.registeredCount > 0) {
    throw new Error("사용 중인 전략이 있어 삭제할 수 없습니다. 먼저 사용자 전략을 정리해 주세요.");
  }

  await db.query(`DELETE FROM strategy_catalog WHERE id = ? LIMIT 1`, [catalogId]);
  return true;
};

const listUserManagementOverview = async (filters = {}) => {
  const [{ rows: members }, { allRows }, riskMap] = await Promise.all([
    loadMemberMap(),
    loadCurrentStrategyInstances(),
    loadLatestRiskMap(),
  ]);

  const [liveLogRows] = await db.query(
    `SELECT uid, pid, symbol, type, bunbong, signalType, positionSize, pol_sum, charge, openTime, closeTime, openPrice, closePrice, exitReason, exitMode
       FROM live_play_log`
  );
  const [testLogRows] = await db.query(
    `SELECT uid, pid, symbol, type, bunbong, signalType, positionSize, pol_sum, charge, openTime, closeTime, openPrice, closePrice, exitReason, exitMode
       FROM test_play_log`
  );
  const [runtimeTradeRows] = await db.query(
    `SELECT uid, pid, strategy_category, symbol, side, client_order_id, order_id, execution_type, order_status,
            order_type, orig_type, executed_qty, avg_price, last_price, trade_time, payload_json
       FROM binance_runtime_event_log
      WHERE event_type = 'ORDER_TRADE_UPDATE'
        AND execution_type = 'TRADE'
        AND executed_qty IS NOT NULL`
  );

  const liveTrades = dedupeLiveTradeLogs(liveLogRows);
  const testTrades = dedupeLiveTradeLogs(testLogRows);
  const runtimeTrades = dedupeRuntimeTradeEvents(runtimeTradeRows).filter((item) => item.category === "grid");

  const strategyFilterKey = normalizeStrategyKey(filters.strategyKey || filters.signalName || filters.keywordStrategy);
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  const requestedAccessMode = filters.tradeAccessMode ? normalizeTradeAccessMode(filters.tradeAccessMode) : null;

  return members
    .map((member) => {
      const uid = Number(member.id);
      const currentStrategies = allRows.filter((row) => Number(row.uid) === uid);
      const signalStrategies = currentStrategies.filter((row) => row.category === "signal");
      const gridStrategies = currentStrategies.filter((row) => row.category === "grid");
      const filteredStrategies = strategyFilterKey
        ? currentStrategies.filter((row) => row.strategyKey === strategyFilterKey)
        : currentStrategies;

      const userLiveTrades = liveTrades.filter((row) => row.uid === uid);
      const userTestTrades = testTrades.filter((row) => row.uid === uid);
      const userGridTrades = runtimeTrades.filter((row) => row.uid === uid);

      const livePnl =
        userLiveTrades.reduce((sum, row) => sum + toNumber(row.pnl, 0), 0) +
        userGridTrades.reduce((sum, row) => sum + toNumber(row.netPnl, 0), 0);
      const demoPnl = userTestTrades.reduce((sum, row) => sum + toNumber(row.pnl, 0), 0);
      const liveTradeAmount =
        userLiveTrades.reduce((sum, row) => sum + toNumber(row.tradeAmount, 0), 0) +
        userGridTrades.reduce((sum, row) => sum + toNumber(row.tradeAmount, 0), 0);

      const latestRisk = riskMap.get(uid) || null;
      const totalStrategyCount = currentStrategies.length;
      const onStrategyCount = currentStrategies.filter((row) => isItemEnabled(row)).length;

      return {
        uid,
        memId: member.mem_id,
        memName: member.mem_name,
        mobile: member.mem_mobile,
        email: member.email,
        grade: Number(member.grade || 0),
        tradeAccessMode: normalizeTradeAccessMode(member.tradeAccessMode),
        hasCredentials: Boolean(member.appKey && member.appSecret),
        liveStrategyCount: signalStrategies.filter((row) => row.mode === "LIVE").length + gridStrategies.filter((row) => row.mode === "LIVE").length,
        demoStrategyCount: signalStrategies.filter((row) => row.mode === "TEST").length + gridStrategies.filter((row) => row.mode === "TEST").length,
        totalStrategyCount,
        onStrategyCount,
        livePnl,
        demoPnl,
        totalPnl: livePnl + demoPnl,
        liveTradeAmount,
        latestRisk: latestRisk
          ? {
              accountEquity: toNumber(latestRisk.account_equity, 0),
              availableBalance: toNumber(latestRisk.available_balance, 0),
              accountMarginRatio: toNumber(latestRisk.account_margin_ratio, 0),
              marginBuffer: toNumber(latestRisk.account_margin_buffer, 0),
              riskLevel: latestRisk.risk_level || "UNKNOWN",
              recordedAt: latestRisk.created_at || null,
            }
          : null,
        currentStrategies,
        filteredStrategyMatchCount: filteredStrategies.length,
      };
    })
    .filter((item) => {
      if (requestedAccessMode && item.tradeAccessMode !== requestedAccessMode) {
        return false;
      }

      if (strategyFilterKey && item.filteredStrategyMatchCount === 0) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      return [
        item.memId,
        item.memName,
        item.mobile,
        item.email,
        item.uid,
      ]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(keyword));
    })
    .sort((a, b) => {
      const riskA = toNumber(a.latestRisk?.accountMarginRatio, -1);
      const riskB = toNumber(b.latestRisk?.accountMarginRatio, -1);
      if (riskA !== riskB) {
        return riskB - riskA;
      }
      return toNumber(b.liveTradeAmount, 0) - toNumber(a.liveTradeAmount, 0);
    });
};

const getUserManagementItem = async (uid) => {
  const items = await listUserManagementOverview();
  const item = items.find((row) => Number(row.uid) === Number(uid));
  if (!item) {
    return null;
  }

  const currentStrategies = item.currentStrategies
    .slice()
    .sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return String(a.strategyName || "").localeCompare(String(b.strategyName || ""));
    });

  return {
    ...item,
    currentStrategies,
  };
};

const updateUserTradeAccess = async (uid, tradeAccessMode) => {
  const finalMode = normalizeTradeAccessMode(tradeAccessMode);
  await db.query(`UPDATE admin_member SET tradeAccessMode = ? WHERE id = ? LIMIT 1`, [finalMode, uid]);
  return finalMode;
};

const deleteUser = async (uid) => {
  const [currentCounts] = await db.query(
    `SELECT
        (SELECT COUNT(*) FROM live_play_list WHERE uid = ?) AS liveSignalCount,
        (SELECT COUNT(*) FROM test_play_list WHERE uid = ?) AS testSignalCount,
        (SELECT COUNT(*) FROM live_grid_strategy_list WHERE uid = ?) AS liveGridCount,
        (SELECT COUNT(*) FROM test_grid_strategy_list WHERE uid = ?) AS testGridCount,
        (SELECT COUNT(*) FROM live_play_log WHERE uid = ?) AS liveLogCount,
        (SELECT COUNT(*) FROM test_play_log WHERE uid = ?) AS testLogCount`,
    [uid, uid, uid, uid, uid, uid]
  );

  const counts = currentCounts[0] || {};
  const totalCurrent =
    toNumber(counts.liveSignalCount, 0) +
    toNumber(counts.testSignalCount, 0) +
    toNumber(counts.liveGridCount, 0) +
    toNumber(counts.testGridCount, 0);
  const totalLogs = toNumber(counts.liveLogCount, 0) + toNumber(counts.testLogCount, 0);

  if (totalCurrent > 0 || totalLogs > 0) {
    throw new Error("현재 전략 또는 거래 이력이 남아 있어 삭제할 수 없습니다.");
  }

  await db.query(`DELETE FROM admin_member WHERE id = ? LIMIT 1`, [uid]);
  return true;
};

const getRevenueSummary = async (filters = {}) => {
  const startDate = filters.startDate ? new Date(filters.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = filters.endDate ? new Date(filters.endDate) : new Date();
  const referralShareRate = Number(filters.referralShareRate);
  const finalShareRate =
    Number.isFinite(referralShareRate) && referralShareRate >= MIN_REFERRAL_SHARE_RATE && referralShareRate <= MAX_REFERRAL_SHARE_RATE
      ? referralShareRate
      : DEFAULT_REFERRAL_SHARE_RATE;

  const toSqlDate = (date) => date.toISOString().slice(0, 19).replace("T", " ");
  const [runtimeTradeRows] = await db.query(
    `SELECT uid, pid, strategy_category, symbol, side, client_order_id, order_id, execution_type, order_status,
            order_type, orig_type, executed_qty, avg_price, last_price, trade_time, payload_json, created_at
       FROM binance_runtime_event_log
      WHERE event_type = 'ORDER_TRADE_UPDATE'
        AND execution_type = 'TRADE'
        AND created_at BETWEEN ? AND ?
        AND executed_qty IS NOT NULL`,
    [toSqlDate(startDate), toSqlDate(endDate)]
  );

  const tradeEvents = dedupeRuntimeTradeEvents(runtimeTradeRows);
  const summary = {
    period: {
      startDate: toSqlDate(startDate),
      endDate: toSqlDate(endDate),
    },
    totalTradeAmount: 0,
    limitTradeAmount: 0,
    marketTradeAmount: 0,
    totalCommission: 0,
    estimatedRevenue: 0,
    referralShareRate: finalShareRate,
    perUser: [],
    tradeCount: 0,
    source: "binance-runtime-event-log-trade-units",
    dataAvailability: {
      commission: "AVAILABLE_WHEN_BINANCE_EVENT_HAS_COMMISSION",
      sourceTradeId: "PAYLOAD_TRADE_ID_OR_RUNTIME_EVENT_FALLBACK",
    },
    lastUpdatedAt: null,
  };

  const perUserMap = new Map();

  tradeEvents.forEach((event) => {
    const isMarket = String(event.orderType || "").includes("MARKET");
    summary.totalTradeAmount += toNumber(event.tradeAmount, 0);
    summary.totalCommission += toNumber(event.commission, 0);
    summary.tradeCount += 1;
    if (!summary.lastUpdatedAt || new Date(event.tradeTime || 0) > new Date(summary.lastUpdatedAt || 0)) {
      summary.lastUpdatedAt = event.tradeTime || summary.lastUpdatedAt;
    }
    if (isMarket) {
      summary.marketTradeAmount += toNumber(event.tradeAmount, 0);
    } else {
      summary.limitTradeAmount += toNumber(event.tradeAmount, 0);
    }

    const current = perUserMap.get(event.uid) || {
      uid: event.uid,
      totalTradeAmount: 0,
      marketTradeAmount: 0,
      limitTradeAmount: 0,
      totalCommission: 0,
      estimatedRevenue: 0,
      tradeCount: 0,
    };

    current.totalTradeAmount += toNumber(event.tradeAmount, 0);
    current.totalCommission += toNumber(event.commission, 0);
    if (isMarket) {
      current.marketTradeAmount += toNumber(event.tradeAmount, 0);
    } else {
      current.limitTradeAmount += toNumber(event.tradeAmount, 0);
    }
    current.tradeCount += 1;
    perUserMap.set(event.uid, current);
  });

  const { memberMap } = await loadMemberMap();
  summary.estimatedRevenue = summary.totalCommission * finalShareRate;
  summary.perUser = Array.from(perUserMap.values())
    .map((item) => ({
      ...item,
      estimatedRevenue: item.totalCommission * finalShareRate,
      member: memberMap.get(Number(item.uid)) || null,
    }))
    .sort((a, b) => toNumber(b.totalTradeAmount, 0) - toNumber(a.totalTradeAmount, 0));

  return summary;
};

module.exports = {
  KNOWN_SYMBOLS,
  KNOWN_TIMEFRAMES,
  SIGNAL_RUNTIME_TYPE_MAX_LENGTH,
  TRADE_ACCESS_MODES,
  normalizeSignalStrategyCode,
  normalizeSignalStrategyKey,
  resolveSignalStrategyIdentity,
  getStrategyCatalogCreateConstraint,
  loadExchangeSymbolCatalog,
  getExchangeSymbolRuleSummary,
  listStrategyCatalogOverview,
  getStrategyCatalogItem,
  listUserSelectableStrategyCatalog,
  saveStrategyCatalog,
  deleteStrategyCatalog,
  listUserManagementOverview,
  getUserManagementItem,
  updateUserTradeAccess,
  deleteUser,
  getRevenueSummary,
};
