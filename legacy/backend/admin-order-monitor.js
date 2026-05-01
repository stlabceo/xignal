const db = require("./database/connect/config");
const qaBinance = require("./tools/qa/qa-binance");

const DEFAULT_SYMBOLS = ["PUMPUSDT", "XRPUSDT"];
const POSITION_SIDES = ["LONG", "SHORT"];

const EXPECTED_IGNORE_CODES = new Set([
  "NO_MATCHING_STRATEGY",
  "GRID_ACTIVE_IGNORED",
  "DUPLICATE_IGNORED",
  "DUPLICATE",
  "SMOKE_UNMATCHED",
  "RUNTIME_NOT_READY",
  "ALREADY_OPEN_IGNORED",
  "ALREADY_CLEAN",
]);

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const abs = (value) => Math.abs(toNumber(value));

const normalizeSymbol = (value) => String(value || "").trim().toUpperCase();
const normalizeSide = (value) => String(value || "").trim().toUpperCase();
const normalizeCategory = (value) => String(value || "").trim().toLowerCase();

const isoOrNull = (value) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const unique = (values) =>
  [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];

const includesOrderIntent = (clientOrderId, tokens = []) => {
  const normalized = String(clientOrderId || "").trim().toUpperCase();
  return tokens.some((token) => normalized.includes(token));
};

const inferPidFromClientOrderId = (clientOrderId) => {
  const numericTokens = String(clientOrderId || "")
    .split("_")
    .map((token) => Number(token))
    .filter((value) => Number.isInteger(value) && value > 0);
  const pidLike = numericTokens.find((value) => value >= 1000);
  return pidLike || numericTokens[1] || numericTokens[0] || null;
};

const inferOrderIntent = (order = {}) => {
  const cid = String(order.clientOrderId || order.clientAlgoId || "").trim().toUpperCase();
  if (!cid) return "UNKNOWN";
  if (cid.startsWith("NEW_")) return "ENTRY";
  if (cid.startsWith("GENTRY_")) return "GRID_ENTRY";
  if (cid.startsWith("PROFIT_")) return "TAKE_PROFIT";
  if (cid.startsWith("SPLITTP_")) return "SPLIT_TAKE_PROFIT";
  if (cid.startsWith("STOP_")) return "STOP";
  if (cid.startsWith("GTP_")) return "GRID_TAKE_PROFIT";
  if (cid.startsWith("GSTOP_")) return "GRID_STOP";
  if (cid.startsWith("TIME_")) return "TIME_CLOSE";
  if (cid.startsWith("GMANUAL_")) return "GRID_MANUAL_CLOSE";
  if (cid.startsWith("WEB_") || cid.startsWith("WEB")) return "USER_WEB";
  return "UNKNOWN";
};

const sideToPositionSide = (value) => {
  const side = normalizeSide(value);
  if (side === "BUY" || side === "LONG") return "LONG";
  if (side === "SELL" || side === "SHORT") return "SHORT";
  return side || null;
};

const protectionKind = (order = {}) => {
  const cid = String(order.clientOrderId || order.clientAlgoId || "").trim().toUpperCase();
  const type = String(order.type || order.origType || "").trim().toUpperCase();
  if (cid.includes("STOP") || type.includes("STOP")) return "STOP";
  if (cid.includes("TP") || cid.includes("PROFIT") || type.includes("TAKE_PROFIT")) return "TP";
  return "UNKNOWN";
};

const isActiveBinanceProtection = (order = {}) => {
  const status = String(order.status || order.algoStatus || "").trim().toUpperCase();
  if (status && !["NEW", "PARTIALLY_FILLED"].includes(status)) {
    return false;
  }
  const intent = inferOrderIntent(order);
  if (["TAKE_PROFIT", "SPLIT_TAKE_PROFIT", "STOP", "GRID_TAKE_PROFIT", "GRID_STOP"].includes(intent)) {
    return true;
  }
  const type = String(order.type || order.origType || "").trim().toUpperCase();
  return type.includes("STOP") || type.includes("TAKE_PROFIT");
};

const isEntryLedgerEvent = (row = {}) =>
  String(row.eventType || "").trim().toUpperCase().includes("ENTRY");

const isExitLedgerEvent = (row = {}) => {
  const eventType = String(row.eventType || "").trim().toUpperCase();
  return eventType.includes("EXIT") || eventType.includes("CLOSE") || eventType.includes("TP") || eventType.includes("STOP");
};

const isExpectedIgnoreCode = (value) => {
  const code = String(value || "").trim().toUpperCase();
  if (!code) return false;
  if (EXPECTED_IGNORE_CODES.has(code)) return true;
  return code.includes("NO_MATCHING_STRATEGY") ||
    code.includes("GRID_ACTIVE_IGNORED") ||
    code.includes("DUPLICATE") ||
    code.includes("SMOKE") ||
    code.includes("ALREADY_OPEN");
};

const severityForLifecycle = (lifecycleStatus) => {
  const status = String(lifecycleStatus || "").trim().toUpperCase();
  if ([
    "OPEN_NO_PROTECTION",
    "PROTECTION_MISSING",
    "PROTECTION_OVERSIZED",
    "ORPHAN_PROTECTION",
    "LOCAL_CANCELED_BUT_BINANCE_ACTIVE",
    "BINANCE_OPEN_LOCAL_FLAT",
    "LOCAL_OPEN_BINANCE_FLAT",
    "TERMINAL_EXECUTED_WITHOUT_LEDGER",
    "ENTRY_REQUIRED_BUT_NO_ORDER",
    "UNKNOWN_EXCHANGE_MUTATION",
    "QA_REPLAY_ACCIDENT_ACTIVE",
  ].includes(status)) {
    return "CRITICAL";
  }
  if ([
    "ENTRY_TERMINAL_NO_FILL",
    "RESOLVED_PROTECTION_DELAY",
    "RESOLVED_SAFE_CLEANUP",
    "RESOLVED_CONTROLLED_RESTORE",
    "RESOLVED_QA_ACCIDENT",
  ].includes(status)) {
    return status.startsWith("RESOLVED") ? "INFO" : "WARN";
  }
  return "OK";
};

const buildIssueKey = ({
  uid,
  pid,
  category,
  symbol,
  side,
  cycleId,
  orderId,
  reservationId,
  issueType,
}) =>
  [
    uid || "uid",
    pid || "pid",
    category || "category",
    normalizeSymbol(symbol) || "symbol",
    normalizeSide(side) || "side",
    cycleId || "cycle",
    orderId || reservationId || "evidence",
    issueType || "issue",
  ].join(":");

const classifyCurrentRisk = ({
  uid,
  symbol,
  side,
  binanceQty,
  localOpenQty,
  activeProtectionCount,
  expectedProtectionCount,
  activeProtectionQty,
  localReservationCount,
  actualTP,
  actualSTOP,
  localReservationTP,
  localReservationSTOP,
  ownerPids,
}) => {
  const bQty = abs(binanceQty);
  const lQty = abs(localOpenQty);
  const pQty = abs(activeProtectionQty);
  const hasOpen = bQty > 0 || lQty > 0;
  const hasActiveProtection = Number(activeProtectionCount || 0) > 0;
  let lifecycleStatus = "CLOSED_FLAT_CLEAN";
  let verdict = "FLAT_CLEAN";
  let issueReason = null;
  let nextAction = "No action";

  if (bQty > 0 && lQty === 0) {
    lifecycleStatus = "BINANCE_OPEN_LOCAL_FLAT";
    verdict = "BINANCE_OPEN_LOCAL_FLAT";
    issueReason = "Binance position exists without matching local ownership projection.";
    nextAction = "Reconstruct ownership before enabling live-write mode.";
  } else if (lQty > 0 && bQty === 0) {
    lifecycleStatus = "LOCAL_OPEN_BINANCE_FLAT";
    verdict = "LOCAL_OPEN_BINANCE_FLAT";
    issueReason = "Local snapshot says open while Binance is flat.";
    nextAction = "Review local projection and recovery evidence.";
  } else if (hasOpen && Number(expectedProtectionCount || 0) > 0 && !hasActiveProtection) {
    lifecycleStatus = "OPEN_NO_PROTECTION";
    verdict = "OPEN_EXPOSURE_WITHOUT_EFFECTIVE_PROTECTION";
    issueReason = "Open exposure has no active TP/STOP protection.";
    nextAction = "User action or controlled runtime recovery is required.";
  } else if (!hasOpen && hasActiveProtection) {
    lifecycleStatus = "ORPHAN_PROTECTION";
    verdict = "ORPHAN_PROTECTION";
    issueReason = "Active protection exists while Binance/local position is flat.";
    nextAction = "User must verify/cancel orphan order on Binance.";
  } else if (hasOpen && pQty > Math.max(bQty, lQty) + 1e-8) {
    lifecycleStatus = "PROTECTION_OVERSIZED";
    verdict = "OVERSIZED_PROTECTION";
    issueReason = "Active protection quantity exceeds current exposure.";
    nextAction = "Resize or cancel stale protection before continuing.";
  } else if (hasOpen && hasActiveProtection) {
    lifecycleStatus = "OPEN_PROTECTED";
    verdict = "OPEN_PROTECTED";
  }

  const severity = severityForLifecycle(lifecycleStatus);
  return {
    uid,
    symbol: normalizeSymbol(symbol),
    side: normalizeSide(side),
    binanceQty: String(bQty),
    localOpenQty: String(lQty),
    ownerPids: unique(ownerPids || []),
    activeProtectionCount: Number(activeProtectionCount || 0),
    expectedProtectionCount: Number(expectedProtectionCount || 0),
    localReservationCount: Number(localReservationCount || 0),
    actualTP: Number(actualTP || 0),
    actualSTOP: Number(actualSTOP || 0),
    localReservationTP: Number(localReservationTP || 0),
    localReservationSTOP: Number(localReservationSTOP || 0),
    activeProtectionQty: String(pQty),
    lifecycleStatus,
    verdict,
    severity,
    currentRisk: severity === "CRITICAL",
    issueReason,
    nextAction,
  };
};

const classifyOrderCycle = ({
  uid,
  pid,
  category,
  strategy,
  symbol,
  side,
  ledgerRows = [],
  rawOrders = [],
  snapshots = [],
  reservations = [],
}) => {
  const normalizedSide = normalizeSide(side);
  const entryLedger = ledgerRows.filter(isEntryLedgerEvent);
  const exitLedger = ledgerRows.filter(isExitLedgerEvent);
  const activeReservations = reservations.filter((row) =>
    ["ACTIVE", "PARTIAL"].includes(String(row.status || "").trim().toUpperCase())
  );
  const latestOrder = rawOrders[0] || {};
  const latestEntryOrder = rawOrders.find((row) => String(row.inferredIntent || "").includes("ENTRY")) || {};
  const latestExitOrder =
    rawOrders.find((row) =>
      ["TAKE_PROFIT", "SPLIT_TAKE_PROFIT", "STOP", "GRID_TAKE_PROFIT", "GRID_STOP", "TIME_CLOSE", "GRID_MANUAL_CLOSE", "USER_WEB"].includes(row.inferredIntent)
    ) || {};
  const currentOpenQty = snapshots.reduce((sum, row) => sum + abs(row.openQty), 0);
  const realizedPnl = exitLedger.reduce((sum, row) => sum + toNumber(row.realizedPnl), 0);
  const entryExecutedQty = entryLedger.reduce((sum, row) => sum + abs(row.fillQty), 0);
  const exitExecutedQty = exitLedger.reduce((sum, row) => sum + abs(row.fillQty), 0);
  const entryTradeIds = unique(entryLedger.map((row) => row.sourceTradeId));
  const exitTradeIds = unique(exitLedger.map((row) => row.sourceTradeId));
  let lifecycleStatus = "WAITING_SIGNAL";
  let protectionStatus = "NONE_REQUIRED";
  let currentRisk = false;

  if (currentOpenQty > 0 && activeReservations.length >= 2) {
    lifecycleStatus = "OPEN_PROTECTED";
    protectionStatus = "PROTECTED";
  } else if (currentOpenQty > 0 && activeReservations.length > 0) {
    lifecycleStatus = "PARTIAL_OPEN_PROTECTED";
    protectionStatus = "PARTIAL";
  } else if (currentOpenQty > 0) {
    lifecycleStatus = "OPEN_NO_PROTECTION";
    protectionStatus = "MISSING";
    currentRisk = true;
  } else if (exitLedger.length > 0 || exitExecutedQty > 0) {
    if (includesOrderIntent(latestExitOrder.clientOrderId, ["STOP", "GSTOP"])) {
      lifecycleStatus = "CLOSED_BY_STOP";
    } else if (includesOrderIntent(latestExitOrder.clientOrderId, ["TIME"])) {
      lifecycleStatus = "CLOSED_BY_TIME";
    } else if (includesOrderIntent(latestExitOrder.clientOrderId, ["GMANUAL", "WEB"])) {
      lifecycleStatus = "CLOSED_BY_MANUAL";
    } else if (normalizeCategory(category) === "grid" && includesOrderIntent(latestExitOrder.clientOrderId, ["BOX", "BREAK"])) {
      lifecycleStatus = "CLOSED_BY_BOX_BREAK";
    } else {
      lifecycleStatus = "CLOSED_BY_TP";
    }
    protectionStatus = "CLOSED";
  } else if (entryLedger.length > 0 || entryExecutedQty > 0) {
    lifecycleStatus = "ENTRY_FILLED";
    protectionStatus = "REVIEW";
  } else if (rawOrders.some((row) => String(row.status || "").trim().toUpperCase() === "NEW")) {
    lifecycleStatus = "ENTRY_PENDING";
    protectionStatus = "PENDING";
  }

  const severity = currentRisk ? "CRITICAL" : severityForLifecycle(lifecycleStatus);
  const lastEventTime =
    latestOrder.eventTime ||
    latestOrder.updateTime ||
    ledgerRows[0]?.tradeTime ||
    snapshots[0]?.updatedAt ||
    null;

  return {
    cycleId: `${uid}:${category}:${pid}:${normalizeSymbol(symbol)}:${normalizedSide || "NA"}`,
    uid,
    pid,
    category,
    strategy,
    symbol: normalizeSymbol(symbol),
    side: normalizedSide || null,
    entryOrderId: latestEntryOrder.orderId || null,
    entryClientOrderId: latestEntryOrder.clientOrderId || null,
    entryStatus: latestEntryOrder.status || null,
    entryExecutedQty: String(entryExecutedQty),
    entryTradeIds,
    protectionStatus,
    expectedProtectionCount: currentOpenQty > 0 ? 2 : 0,
    activeProtectionCount: activeReservations.length,
    exitOrderId: latestExitOrder.orderId || null,
    exitClientOrderId: latestExitOrder.clientOrderId || null,
    exitStatus: latestExitOrder.status || null,
    exitTradeIds,
    realizedPnl: String(realizedPnl),
    lifecycleStatus,
    severity,
    currentRisk,
    historicalIssueCount: 0,
    lastOrderStatus: latestOrder.status || null,
    lastOrderIntent: latestOrder.inferredIntent || null,
    lastOrderId: latestOrder.orderId || null,
    lastClientOrderId: latestOrder.clientOrderId || null,
    executedQty: latestOrder.executedQty || null,
    remainingQty: String(Math.max(0, toNumber(latestOrder.origQty) - toNumber(latestOrder.executedQty))),
    lastEventTime: isoOrNull(lastEventTime),
  };
};

const buildRawOrderRow = ({ order = {}, trades = [], ledgerRows = [], reservationRows = [] }) => {
  const tradeIds = trades.map((trade) => String(trade.id || trade.tradeId || "")).filter(Boolean);
  const inferredPid = inferPidFromClientOrderId(order.clientOrderId) || null;
  const inferredIntent = inferOrderIntent(order);
  const orderId = String(order.orderId || "");
  const clientOrderId = String(order.clientOrderId || "");
  const localLedgerMatch = ledgerRows.some((row) =>
    String(row.sourceOrderId || "") === orderId ||
    String(row.sourceClientOrderId || "") === clientOrderId ||
    tradeIds.includes(String(row.sourceTradeId || ""))
  );
  const localReservationMatch = reservationRows.some((row) =>
    String(row.sourceOrderId || "") === orderId ||
    String(row.actualOrderId || "") === orderId ||
    String(row.clientOrderId || "") === clientOrderId
  );

  return {
    time: isoOrNull(order.time || order.updateTime),
    symbol: normalizeSymbol(order.symbol),
    orderId: order.orderId || null,
    clientOrderId: order.clientOrderId || null,
    type: order.type || null,
    origType: order.origType || null,
    side: order.side || null,
    positionSide: order.positionSide || null,
    reduceOnly: order.reduceOnly === true || String(order.reduceOnly || "").toLowerCase() === "true",
    price: order.price || null,
    stopPrice: order.stopPrice || order.activatePrice || null,
    origQty: order.origQty || null,
    executedQty: order.executedQty || null,
    status: order.status || null,
    tradeIds,
    inferredPid,
    inferredIntent,
    localLedgerMatch,
    localReservationMatch,
  };
};

const safeBinanceCall = async (name, fn, fallback) => {
  try {
    return { ok: true, name, data: await fn(), error: null };
  } catch (error) {
    return { ok: false, name, data: fallback, error: error?.response?.data || error?.message || String(error) };
  }
};

const queryRows = async (sql, params = []) => {
  const [rows] = await db.query(sql, params);
  return Array.isArray(rows) ? rows : [];
};

const loadLocalRows = async (uid) => {
  const [
    signalRows,
    gridRows,
    snapshots,
    reservations,
    ledgerRows,
    controlRows,
    msgRows,
    runtimeRows,
  ] = await Promise.all([
    queryRows(
      `SELECT id, uid, a_name, symbol, bunbong, type, signalType, st, status, enabled, r_qty, margin, leverage, created_at
         FROM live_play_list
        WHERE uid = ?
        ORDER BY id DESC
        LIMIT 300`,
      [uid]
    ),
    queryRows(
      `SELECT id, uid, a_name, strategySignal, symbol, bunbong, st, enabled, regimeStatus, regimeEndReason,
              longLegStatus, shortLegStatus, longQty, shortQty, tradeValue, margin, leverage, updatedAt
         FROM live_grid_strategy_list
        WHERE uid = ?
        ORDER BY id DESC
        LIMIT 300`,
      [uid]
    ),
    queryRows(
      `SELECT *
         FROM live_pid_position_snapshot
        WHERE uid = ?
        ORDER BY updatedAt DESC
        LIMIT 500`,
      [uid]
    ),
    queryRows(
      `SELECT *
         FROM live_pid_exit_reservation
        WHERE uid = ?
        ORDER BY updatedAt DESC
        LIMIT 500`,
      [uid]
    ),
    queryRows(
      `SELECT *
         FROM live_pid_position_ledger
        WHERE uid = ?
        ORDER BY COALESCE(tradeTime, createdAt) DESC, id DESC
        LIMIT 1000`,
      [uid]
    ),
    queryRows(
      `SELECT *
         FROM strategy_control_audit
        WHERE targetUserId = ?
        ORDER BY createdAt DESC
        LIMIT 120`,
      [uid]
    ),
    queryRows(
      `SELECT *
         FROM msg_list
        WHERE uid = ?
        ORDER BY created_at DESC
        LIMIT 200`,
      [uid]
    ),
    queryRows(
      `SELECT *
         FROM binance_runtime_event_log
        WHERE uid = ?
        ORDER BY id DESC
        LIMIT 200`,
      [uid]
    ),
  ]);

  return {
    signalRows,
    gridRows,
    snapshots,
    reservations,
    ledgerRows,
    controlRows,
    msgRows,
    runtimeRows,
  };
};

const resolveSymbols = (localRows, extraSymbols = []) =>
  unique([
    ...DEFAULT_SYMBOLS,
    ...extraSymbols,
    ...localRows.signalRows.map((row) => row.symbol),
    ...localRows.gridRows.map((row) => row.symbol),
    ...localRows.snapshots.map((row) => row.symbol),
    ...localRows.reservations.map((row) => row.symbol),
    ...localRows.ledgerRows.map((row) => row.symbol),
  ]).map(normalizeSymbol);

const resolveSymbolsWithBinancePositions = (symbols = [], positionRows = []) =>
  unique([
    ...(symbols || []),
    ...(positionRows || [])
      .filter((row) => abs(row.positionAmt) > 0)
      .map((row) => row.symbol),
  ]).map(normalizeSymbol);

const loadBinanceEvidence = async (uid, symbols) => {
  const [positionRiskResult, openOrdersResult, openAlgoOrdersResult] = await Promise.all([
    safeBinanceCall("positionRisk", () => qaBinance.getPositionRisk(uid), []),
    safeBinanceCall("openOrders", () => qaBinance.getOpenOrders(uid), []),
    safeBinanceCall("openAlgoOrders", () => qaBinance.getOpenAlgoOrders(uid), []),
  ]);

  const perSymbolResults = await Promise.all(
    symbols.map(async (symbol) => {
      const [allOrdersResult, userTradesResult] = await Promise.all([
        safeBinanceCall(`allOrders:${symbol}`, () => qaBinance.getAllOrders(uid, symbol, 100), []),
        safeBinanceCall(`userTrades:${symbol}`, () => qaBinance.getUserTrades(uid, symbol, 100), []),
      ]);
      return {
        symbol,
        allOrders: allOrdersResult,
        userTrades: userTradesResult,
      };
    })
  );

  return {
    positionRisk: positionRiskResult,
    openOrders: openOrdersResult,
    openAlgoOrders: openAlgoOrdersResult,
    perSymbol: perSymbolResults,
    sourceStatus: [
      positionRiskResult,
      openOrdersResult,
      openAlgoOrdersResult,
      ...perSymbolResults.flatMap((item) => [item.allOrders, item.userTrades]),
    ].map((item) => ({ name: item.name, ok: item.ok, error: item.error })),
  };
};

const buildStrategyMetaMap = (localRows) => {
  const map = new Map();
  localRows.signalRows.forEach((row) => {
    map.set(`signal:${row.id}`, {
      uid: row.uid,
      pid: row.id,
      category: "signal",
      strategy: row.a_name || row.type || "signal",
      strategyCode: row.type || null,
      symbol: normalizeSymbol(row.symbol),
      side: sideToPositionSide(row.signalType),
      timeframe: row.bunbong || null,
      enabled: row.enabled,
      status: row.status || row.st || null,
    });
  });
  localRows.gridRows.forEach((row) => {
    map.set(`grid:${row.id}`, {
      uid: row.uid,
      pid: row.id,
      category: "grid",
      strategy: row.a_name || row.strategySignal || "grid",
      strategyCode: row.strategySignal || null,
      symbol: normalizeSymbol(row.symbol),
      side: null,
      timeframe: row.bunbong || null,
      enabled: row.enabled,
      status: row.regimeStatus || row.st || null,
    });
  });
  return map;
};

const mapPositionRiskBySymbolSide = (rows = []) => {
  const map = new Map();
  rows.forEach((row) => {
    const symbol = normalizeSymbol(row.symbol);
    const side = sideToPositionSide(row.positionSide);
    if (!symbol || !side || !POSITION_SIDES.includes(side)) return;
    map.set(`${symbol}:${side}`, row);
  });
  return map;
};

const sideCloseOrderSide = (positionSide) => (normalizeSide(positionSide) === "LONG" ? "SELL" : "BUY");

const buildCurrentRiskBoard = ({ uid, symbols, localRows, binanceEvidence }) => {
  const positionRiskMap = mapPositionRiskBySymbolSide(binanceEvidence.positionRisk.data || []);
  const openOrders = [
    ...(Array.isArray(binanceEvidence.openOrders.data) ? binanceEvidence.openOrders.data : []),
    ...(Array.isArray(binanceEvidence.openAlgoOrders.data) ? binanceEvidence.openAlgoOrders.data : []),
  ];
  const activeReservations = localRows.reservations.filter((row) =>
    ["ACTIVE", "PARTIAL"].includes(String(row.status || "").trim().toUpperCase())
  );

  return symbols.flatMap((symbol) =>
    POSITION_SIDES.map((side) => {
      const position = positionRiskMap.get(`${symbol}:${side}`) || {};
      const binanceQty = abs(position.positionAmt);
      const snapshots = localRows.snapshots.filter(
        (row) => normalizeSymbol(row.symbol) === symbol && normalizeSide(row.positionSide) === side
      );
      const localOpenQty = snapshots.reduce((sum, row) => sum + abs(row.openQty), 0);
      const ownerPids = snapshots.filter((row) => abs(row.openQty) > 0).map((row) => row.pid);
      const activeProtection = openOrders.filter((order) => {
        if (!isActiveBinanceProtection(order)) return false;
        if (normalizeSymbol(order.symbol) !== symbol) return false;
        const orderPositionSide = sideToPositionSide(order.positionSide);
        if (orderPositionSide && orderPositionSide !== side) return false;
        const orderSide = normalizeSide(order.side);
        return !orderSide || orderSide === sideCloseOrderSide(side);
      });
      const reservations = activeReservations.filter(
        (row) => normalizeSymbol(row.symbol) === symbol && normalizeSide(row.positionSide) === side
      );
      const actualTP = activeProtection.filter((order) => protectionKind(order) === "TP").length;
      const actualSTOP = activeProtection.filter((order) => protectionKind(order) === "STOP").length;
      const localReservationTP = reservations.filter((row) =>
        String(row.reservationKind || "").trim().toUpperCase().includes("TP")
      ).length;
      const localReservationSTOP = reservations.filter((row) =>
        String(row.reservationKind || "").trim().toUpperCase().includes("STOP")
      ).length;
      return classifyCurrentRisk({
        uid,
        symbol,
        side,
        binanceQty,
        localOpenQty,
        ownerPids,
        activeProtectionCount: activeProtection.length,
        expectedProtectionCount: binanceQty > 0 || localOpenQty > 0 ? 2 : 0,
        activeProtectionQty: activeProtection.reduce(
          (maxQty, order) => Math.max(maxQty, abs(order.origQty || order.quantity)),
          0
        ),
        localReservationCount: reservations.length,
        actualTP,
        actualSTOP,
        localReservationTP,
        localReservationSTOP,
      });
    })
  );
};

const buildRawRows = ({ localRows, binanceEvidence }) => {
  const ledgerRows = localRows.ledgerRows || [];
  const reservationRows = localRows.reservations || [];
  const rows = [];
  binanceEvidence.perSymbol.forEach((symbolEvidence) => {
    const trades = Array.isArray(symbolEvidence.userTrades.data) ? symbolEvidence.userTrades.data : [];
    const tradesByOrderId = new Map();
    trades.forEach((trade) => {
      const key = String(trade.orderId || "");
      if (!tradesByOrderId.has(key)) tradesByOrderId.set(key, []);
      tradesByOrderId.get(key).push(trade);
    });
    (Array.isArray(symbolEvidence.allOrders.data) ? symbolEvidence.allOrders.data : []).forEach((order) => {
      rows.push(buildRawOrderRow({
        order,
        trades: tradesByOrderId.get(String(order.orderId || "")) || [],
        ledgerRows,
        reservationRows,
      }));
    });
  });
  return rows.sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime());
};

const buildOrderCycles = ({ uid, localRows, rawBinanceOrders }) => {
  const strategyMap = buildStrategyMetaMap(localRows);
  const cycleKeys = new Set();
  const rows = [];

  localRows.ledgerRows.forEach((row) => {
    if (row.pid) cycleKeys.add(`${normalizeCategory(row.strategyCategory)}:${row.pid}:${normalizeSide(row.positionSide) || "NA"}`);
  });
  localRows.snapshots.forEach((row) => {
    if (row.pid) cycleKeys.add(`${normalizeCategory(row.strategyCategory)}:${row.pid}:${normalizeSide(row.positionSide) || "NA"}`);
  });
  localRows.reservations.forEach((row) => {
    if (row.pid) cycleKeys.add(`${normalizeCategory(row.strategyCategory)}:${row.pid}:${normalizeSide(row.positionSide) || "NA"}`);
  });
  rawBinanceOrders.forEach((row) => {
    if (!row.inferredPid) return;
    const category = String(row.inferredIntent || "").startsWith("GRID") ? "grid" : "signal";
    cycleKeys.add(`${category}:${row.inferredPid}:${sideToPositionSide(row.positionSide || row.side) || "NA"}`);
  });
  [...strategyMap.values()].slice(0, 40).forEach((row) => {
    cycleKeys.add(`${row.category}:${row.pid}:${row.side || "NA"}`);
  });

  cycleKeys.forEach((key) => {
    const [category, pidRaw, sideRaw] = key.split(":");
    const pid = Number(pidRaw);
    const meta =
      strategyMap.get(`${category}:${pid}`) ||
      [...strategyMap.values()].find((row) => Number(row.pid) === pid) ||
      { uid, pid, category, strategy: category, symbol: null, side: sideRaw === "NA" ? null : sideRaw };
    const side = sideRaw === "NA" ? meta.side : sideRaw;
    const ledgerRows = localRows.ledgerRows.filter(
      (row) => Number(row.pid) === pid && normalizeCategory(row.strategyCategory) === category && (!side || normalizeSide(row.positionSide) === side)
    );
    const snapshots = localRows.snapshots.filter(
      (row) => Number(row.pid) === pid && normalizeCategory(row.strategyCategory) === category && (!side || normalizeSide(row.positionSide) === side)
    );
    const reservations = localRows.reservations.filter(
      (row) => Number(row.pid) === pid && normalizeCategory(row.strategyCategory) === category && (!side || normalizeSide(row.positionSide) === side)
    );
    const rawOrders = rawBinanceOrders.filter((row) => Number(row.inferredPid) === pid);
    rows.push(classifyOrderCycle({
      uid,
      pid,
      category,
      strategy: meta.strategy,
      symbol: meta.symbol || ledgerRows[0]?.symbol || snapshots[0]?.symbol || rawOrders[0]?.symbol,
      side,
      ledgerRows,
      rawOrders,
      snapshots,
      reservations,
    }));
  });

  return rows.sort((a, b) => new Date(b.lastEventTime || 0).getTime() - new Date(a.lastEventTime || 0).getTime()).slice(0, 120);
};

const buildProtectionMatrix = ({ uid, currentRiskBoard }) =>
  currentRiskBoard.map((row) => ({
    uid,
    pid: row.ownerPids.join(",") || null,
    symbol: row.symbol,
    side: row.side,
    localOpenQty: row.localOpenQty,
    binanceQtyContribution: row.binanceQty,
    expectedTP: Number(row.expectedProtectionCount || 0) > 0 ? 1 : 0,
    expectedSTOP: Number(row.expectedProtectionCount || 0) > 0 ? 1 : 0,
    actualTP: row.actualTP || 0,
    actualSTOP: row.actualSTOP || 0,
    localReservationTP: row.localReservationTP || 0,
    localReservationSTOP: row.localReservationSTOP || 0,
    verdict: row.verdict,
    severity: row.severity,
  }));

const buildIssueCenter = ({ uid, currentRiskBoard, controlRows, rawBinanceOrders, msgRows, runtimeRows }) => {
  const open = currentRiskBoard
    .filter((row) => row.currentRisk)
    .map((row) => ({
      issueId: buildIssueKey({
        uid,
        pid: row.ownerPids[0],
        category: "runtime",
        symbol: row.symbol,
        side: row.side,
        cycleId: `${uid}:${row.symbol}:${row.side}`,
        issueType: row.lifecycleStatus,
      }),
      issueType: row.lifecycleStatus,
      uid,
      pid: row.ownerPids[0] || null,
      cycleId: `${uid}:${row.symbol}:${row.side}`,
      symbol: row.symbol,
      side: row.side,
      status: "OPEN",
      severity: row.severity,
      firstSeenAt: new Date().toISOString(),
      resolvedAt: null,
      evidence: row.issueReason,
      nextAction: row.nextAction,
    }));

  const resolved = [];
  controlRows
    .filter((row) => String(row.actionCode || "").trim().toUpperCase().includes("RESTORE"))
    .slice(0, 20)
    .forEach((row) => {
      resolved.push({
        issueId: buildIssueKey({
          uid,
          pid: row.pid,
          category: row.strategyCategory,
          cycleId: `audit:${row.id}`,
          issueType: "RESOLVED_CONTROLLED_RESTORE",
        }),
        issueType: "RESOLVED_CONTROLLED_RESTORE",
        uid,
        pid: row.pid,
        cycleId: `audit:${row.id}`,
        status: "RESOLVED",
        severity: "WARN",
        firstSeenAt: isoOrNull(row.createdAt),
        resolvedAt: isoOrNull(row.createdAt),
        evidence: row.note || row.actionCode,
        nextAction: "Historical only. Do not count as current abnormal.",
      });
    });

  rawBinanceOrders
    .filter((row) =>
      ["147797474565", "4289769085", "4289774077"].includes(String(row.orderId || "")) ||
      String(row.clientOrderId || "").startsWith("GMANUAL_L_147_9919")
    )
    .forEach((row) => {
      resolved.push({
        issueId: buildIssueKey({
          uid,
          pid: row.inferredPid,
          category: "incident",
          symbol: row.symbol,
          side: row.positionSide,
          cycleId: `order:${row.orderId}`,
          orderId: row.orderId,
          issueType: "RESOLVED_QA_ACCIDENT",
        }),
        issueType: "RESOLVED_QA_ACCIDENT",
        uid,
        pid: row.inferredPid,
        orderId: row.orderId,
        clientOrderId: row.clientOrderId,
        cycleId: `order:${row.orderId}`,
        symbol: row.symbol,
        side: row.positionSide,
        status: "RESOLVED",
        severity: "WARN",
        firstSeenAt: row.time,
        resolvedAt: row.time,
        evidence: "Historical QA write-escape incident; current live state is evaluated separately.",
        nextAction: "Keep as incident history only.",
      });
    });

  const annotationOnly = [
    ...msgRows.slice(0, 20).map((row) => ({
      source: "msg_list",
      id: row.id,
      code: row.code,
      fun: row.fun,
      expectedIgnore: isExpectedIgnoreCode(row.code),
      createdAt: isoOrNull(row.created_at),
    })),
    ...runtimeRows.slice(0, 20).map((row) => ({
      source: "binance_runtime_event_log",
      id: row.id,
      code: row.event_code,
      eventType: row.event_type,
      expectedIgnore: isExpectedIgnoreCode(row.event_code),
      createdAt: isoOrNull(row.created_at),
    })),
  ];

  return {
    open,
    resolved,
    annotationOnly,
    all: [...open, ...resolved],
  };
};

const buildAdminOrderMonitor = async (uid, options = {}) => {
  const targetUid = Number(uid || 0);
  if (!targetUid) {
    throw new Error("ADMIN_ORDER_MONITOR_UID_REQUIRED");
  }

  const localRows = await loadLocalRows(targetUid);
  const requestedSymbols = Array.isArray(options.symbols)
    ? options.symbols
    : String(options.symbols || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const symbols = resolveSymbols(localRows, requestedSymbols);
  let binanceEvidence = await loadBinanceEvidence(targetUid, symbols);
  const expandedSymbols = resolveSymbolsWithBinancePositions(
    symbols,
    binanceEvidence.positionRisk.data || []
  );
  if (expandedSymbols.length !== symbols.length) {
    binanceEvidence = await loadBinanceEvidence(targetUid, expandedSymbols);
  }
  const rawBinanceOrders = buildRawRows({ localRows, binanceEvidence });
  const currentRiskBoard = buildCurrentRiskBoard({ uid: targetUid, symbols: expandedSymbols, localRows, binanceEvidence });
  const orderCycles = buildOrderCycles({ uid: targetUid, localRows, rawBinanceOrders });
  const protectionMatrix = buildProtectionMatrix({ uid: targetUid, currentRiskBoard });
  const issueCenter = buildIssueCenter({
    uid: targetUid,
    currentRiskBoard,
    controlRows: localRows.controlRows,
    rawBinanceOrders,
    msgRows: localRows.msgRows,
    runtimeRows: localRows.runtimeRows,
  });
  const currentCriticalCount = currentRiskBoard.filter((row) => row.severity === "CRITICAL").length;
  const unresolvedWarnCount = currentRiskBoard.filter((row) => row.severity === "WARN").length;

  return {
    generatedAt: new Date().toISOString(),
    uid: targetUid,
    symbols: expandedSymbols,
    sourcePolicy: {
      primaryOrderEvidence: [
        "Binance allOrders",
        "Binance userTrades",
        "Binance openOrders",
        "Binance openAlgoOrders",
        "Binance positionRisk",
      ],
      localProjection: [
        "live_pid_position_ledger",
        "live_pid_position_snapshot",
        "live_pid_exit_reservation",
        "live_play_list",
        "live_grid_strategy_list",
      ],
      annotationOnly: [
        "webhook_event_log",
        "webhook_event_target_log",
        "strategy_control_audit",
        "binance_runtime_event_log",
        "msg_list",
      ],
    },
    sourceStatus: binanceEvidence.sourceStatus,
    summary: {
      currentCriticalCount,
      unresolvedWarnCount,
      currentRiskCount: currentCriticalCount,
      openIssueCount: issueCenter.open.length,
      resolvedIssueCount: issueCenter.resolved.length,
      cycleCount: orderCycles.length,
      rawOrderCount: rawBinanceOrders.length,
      normalCycleCount: orderCycles.filter((row) => ["OK", "INFO"].includes(row.severity)).length,
    },
    currentRiskBoard,
    orderCycles,
    protectionMatrix,
    issueCenter,
    rawBinanceOrders: rawBinanceOrders.slice(0, Number(options.rawLimit || 120)),
    strategyControlHistory: localRows.controlRows.slice(0, 120).map((row) => ({
      id: row.id,
      uid: row.targetUserId,
      pid: row.pid,
      category: row.strategyCategory,
      actionCode: row.actionCode,
      previousEnabled: row.previousEnabled,
      nextEnabled: row.nextEnabled,
      note: row.note,
      createdAt: isoOrNull(row.createdAt),
    })),
  };
};

module.exports = {
  buildAdminOrderMonitor,
  buildIssueKey,
  classifyCurrentRisk,
  classifyOrderCycle,
  buildRawOrderRow,
  inferOrderIntent,
  isExpectedIgnoreCode,
};
