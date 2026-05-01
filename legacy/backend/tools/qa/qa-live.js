const {
  normalizeSymbol,
  normalizePositionSide,
  query,
  sumLocalOpenQtyBySymbolSide,
  loadActiveReservationsByUid,
  loadStrategyRow,
  loadSnapshotRows,
  loadReservations,
} = require("./qa-db");
const {
  getReadOnlyConnectivity,
  getPositionRisk,
  getOpenOrders,
  getOpenAlgoOrders,
  getPositionMode,
} = require("./qa-binance");

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const qtyTolerance = (qty = 0) =>
  Math.max(0.001, Math.abs(Number(qty || 0)) * 0.001);

const normalizeBinancePositionRows = (rows = []) =>
  (rows || [])
    .filter((row) => {
      const qty = Math.abs(Number(row?.positionAmt || 0));
      return qty > 0;
    })
    .map((row) => ({
      symbol: normalizeSymbol(row.symbol),
      side: normalizePositionSide(row.positionSide || (Number(row.positionAmt || 0) >= 0 ? "LONG" : "SHORT")),
      qty: Math.abs(Number(row.positionAmt || 0)),
      leverage: Number(row.leverage || 0),
      marginType: String(row.marginType || "").trim().toLowerCase() || null,
    }));

const buildAggregateComparisonRows = ({
  uid,
  localRows = [],
  positionRows = [],
  compareSymbols = [],
  positionError = null,
} = {}) => {
  const compareSymbolSet = new Set(
    []
      .concat(compareSymbols || [])
      .map((symbol) => normalizeSymbol(symbol))
      .filter(Boolean)
  );

  const localMap = new Map();
  for (const row of localRows || []) {
    const key = `${normalizeSymbol(row.symbol)}:${normalizePositionSide(row.positionSide)}`;
    localMap.set(key, {
      symbol: normalizeSymbol(row.symbol),
      side: normalizePositionSide(row.positionSide),
      localQty: toNumber(row.localOpenQty),
      pidList: String(row.pidList || "")
        .split(",")
        .map((value) => Number(String(value || "").trim()))
        .filter((value) => value > 0),
    });
    compareSymbolSet.add(normalizeSymbol(row.symbol));
  }

  const exchangeMap = new Map();
  for (const row of normalizeBinancePositionRows(positionRows)) {
    const key = `${row.symbol}:${row.side}`;
    exchangeMap.set(key, row);
    compareSymbolSet.add(row.symbol);
  }

  const results = [];
  for (const symbol of compareSymbolSet) {
    for (const side of ["LONG", "SHORT"]) {
      const key = `${symbol}:${side}`;
      const exchange = exchangeMap.get(key) || { symbol, side, qty: 0 };
      const local = localMap.get(key) || { symbol, side, localQty: 0, pidList: [] };
      const diff = Number((exchange.qty - local.localQty).toFixed(12));
      let risk = "OK";
      if (Math.abs(diff) > 0.000000001) {
        risk = exchange.qty === 0 && local.localQty > 0
          ? "EXCHANGE_FLAT_LOCAL_OPEN"
          : exchange.qty > 0 && local.localQty === 0
            ? "BINANCE_OPEN_LOCAL_FLAT"
            : "AGGREGATE_MISMATCH";
      }
      if (positionError) {
        risk = "BINANCE_READ_FAILED";
      }

      results.push({
        uid,
        symbol,
        side,
        binancePositionQty: exchange.qty,
        localPidOpenQtySum: local.localQty,
        diff,
        relatedPids: local.pidList.join(","),
        risk,
        note: positionError || "",
      });
    }
  }

  return results;
};

const compareAggregateState = async (uid, options = {}) => {
  const compareSymbols = new Set(
    []
      .concat(options.compareSymbols || [])
      .map((symbol) => normalizeSymbol(symbol))
      .filter(Boolean)
  );

  const [localRows, positionResult] = await Promise.all([
    sumLocalOpenQtyBySymbolSide(uid),
    getPositionRisk(uid).then(
      (rows) => ({ ok: true, rows }),
      (error) => ({ ok: false, rows: [], error })
    ),
  ]);
  const positionRows = positionResult.rows || [];
  const positionError = positionResult.ok
    ? null
    : (positionResult.error?.message || String(positionResult.error || "BINANCE_POSITION_READ_FAILED"));

  return buildAggregateComparisonRows({
    uid,
    localRows,
    positionRows,
    compareSymbols: Array.from(compareSymbols),
    positionError,
  });
};

const compareProtectionState = async (uid, options = {}) => {
  const compareSymbols = new Set(
    []
      .concat(options.compareSymbols || [])
      .map((symbol) => normalizeSymbol(symbol))
      .filter(Boolean)
  );

  const [localReservations, openSnapshots, openOrdersResult, openAlgoOrdersResult] = await Promise.all([
    loadActiveReservationsByUid(uid),
    loadOpenSnapshotRowsByUid(uid),
    getOpenOrders(uid).then(
      (rows) => ({ ok: true, rows }),
      (error) => ({ ok: false, rows: [], error })
    ),
    getOpenAlgoOrders(uid).then(
      (rows) => ({ ok: true, rows }),
      (error) => ({ ok: false, rows: [], error })
    ),
  ]);
  const openOrders = openOrdersResult.rows || [];
  const openAlgoOrders = openAlgoOrdersResult.rows || [];
  const protectionError = openOrdersResult.ok && openAlgoOrdersResult.ok
    ? null
    : [
        openOrdersResult.ok ? null : (openOrdersResult.error?.message || String(openOrdersResult.error || "")),
        openAlgoOrdersResult.ok ? null : (openAlgoOrdersResult.error?.message || String(openAlgoOrdersResult.error || "")),
      ]
        .filter(Boolean)
        .join(" | ");

  const activeClientIds = new Set(
    []
      .concat(openOrders || [])
      .concat(openAlgoOrders || [])
      .map((order) =>
        String(order?.clientOrderId || order?.origClientOrderId || order?.clientAlgoId || order?.newClientStrategyId || "")
          .trim()
      )
      .filter(Boolean)
  );

  const allActiveOrders = []
    .concat(openOrders || [])
    .concat(openAlgoOrders || []);
  const activeOrderClientIds = Array.from(new Set(
    allActiveOrders
      .map(getOrderClientOrderId)
      .filter(Boolean)
  ));
  const reservationRowsForActiveOrders = activeOrderClientIds.length > 0
    ? await query(
        `SELECT *
           FROM live_pid_exit_reservation
          WHERE uid = ?
            AND clientOrderId IN (${activeOrderClientIds.map(() => "?").join(",")})
          ORDER BY id ASC`,
        [uid, ...activeOrderClientIds]
      )
    : [];
  const reservationByClientId = new Map();
  for (const reservation of []
    .concat(localReservations || [])
    .concat(reservationRowsForActiveOrders || [])) {
    const clientOrderId = String(reservation.clientOrderId || "").trim();
    if (clientOrderId) {
      reservationByClientId.set(clientOrderId, reservation);
    }
  }
  const combinedReservations = Array.from(reservationByClientId.values());

  const rows = (localReservations || []).map((reservation) => {
    const clientOrderId = String(reservation.clientOrderId || "").trim();
    const match = activeClientIds.has(clientOrderId);
    return {
      pid: Number(reservation.pid || 0),
      symbol: reservation.symbol || null,
      side: reservation.positionSide || null,
      localReservation: `${reservation.reservationKind}:${reservation.status}:${clientOrderId}`,
      binanceActiveProtection: match ? clientOrderId : "",
      isMatch: match ? "Y" : "N",
      risk: protectionError ? "BINANCE_READ_FAILED" : (match ? "OK" : "LOCAL_ACTIVE_MISSING_ON_BINANCE"),
      note: protectionError || "",
    };
  });

  const [positionResult] = await Promise.all([
    getPositionRisk(uid).then(
      (positionRows) => ({ ok: true, rows: positionRows }),
      (error) => ({ ok: false, rows: [], error })
    ),
  ]);
  const binanceOnlyRiskRows = protectionError || !positionResult.ok
    ? []
    : buildActiveProtectionRiskRows({
        uid,
        localReservations: combinedReservations,
        snapshotRows: openSnapshots,
        positionRows: positionResult.rows,
        openOrders,
        openAlgoOrders,
        compareSymbols: Array.from(compareSymbols),
      });

  if (rows.length === 0 && protectionError) {
    return [{
      pid: "",
      symbol: Array.from(compareSymbols)[0] || "",
      side: "",
      localReservation: "",
      binanceActiveProtection: "",
      isMatch: "N",
      risk: "BINANCE_READ_FAILED",
      note: protectionError,
    }];
  }

  if (!positionResult.ok) {
    rows.push({
      pid: "",
      symbol: Array.from(compareSymbols)[0] || "",
      side: "",
      localReservation: "",
      binanceActiveProtection: "",
      isMatch: "N",
      risk: "BINANCE_READ_FAILED",
      note: positionResult.error?.message || String(positionResult.error || ""),
    });
  }

  return rows.concat(binanceOnlyRiskRows);
};

const loadOpenSnapshotRowsByUid = async (uid) =>
  await query(
    `SELECT uid, pid, strategyCategory, symbol, positionSide, status, openQty
       FROM live_pid_position_snapshot
      WHERE uid = ?
        AND status = 'OPEN'
        AND openQty > 0`,
    [uid]
  );

const isReduceOnlyProtectionOrder = (order = {}) => {
  const reduceOnly = String(order.reduceOnly ?? order.reduceOnlyFlag ?? "").trim().toLowerCase();
  const clientOrderId = String(
    order.clientOrderId || order.origClientOrderId || order.clientAlgoId || order.newClientStrategyId || ""
  ).trim();
  return (
    reduceOnly === "true" ||
    reduceOnly === "1" ||
    clientOrderId.startsWith("PROFIT_") ||
    clientOrderId.startsWith("STOP_") ||
    clientOrderId.startsWith("SPLITTP_") ||
    clientOrderId.startsWith("GTP_") ||
    clientOrderId.startsWith("GSTOP_")
  );
};

const getOrderClientOrderId = (order = {}) =>
  String(order.clientOrderId || order.origClientOrderId || order.clientAlgoId || order.newClientStrategyId || "")
    .trim();

const getOrderQty = (order = {}) =>
  toNumber(order.origQty || order.quantity || order.qty || order.stopLimitQuantity || order.executedQty);

const getOrderPositionSide = (order = {}) =>
  normalizePositionSide(order.positionSide || order.positionSideType || "");

const inferPidFromClientOrderId = (clientOrderId = "") => {
  const parts = String(clientOrderId || "").split("_");
  const numeric = parts
    .map((part) => Number(part))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (numeric.length >= 2) {
    return numeric[1];
  }
  return 0;
};

const buildActiveProtectionRiskRows = ({
  uid,
  localReservations = [],
  snapshotRows = [],
  positionRows = [],
  openOrders = [],
  openAlgoOrders = [],
  compareSymbols = [],
} = {}) => {
  const compareSymbolSet = new Set(
    []
      .concat(compareSymbols || [])
      .map((symbol) => normalizeSymbol(symbol))
      .filter(Boolean)
  );
  const exchangeMap = new Map();
  for (const row of normalizeBinancePositionRows(positionRows)) {
    exchangeMap.set(`${row.symbol}:${row.side}`, row);
    compareSymbolSet.add(row.symbol);
  }

  const reservationByClientId = new Map();
  for (const reservation of localReservations || []) {
    const clientOrderId = String(reservation.clientOrderId || "").trim();
    if (clientOrderId) {
      reservationByClientId.set(clientOrderId, reservation);
    }
  }
  const snapshotQtyByPidSymbolSide = new Map();
  for (const snapshot of snapshotRows || []) {
    const key = [
      Number(snapshot.pid || 0),
      normalizeSymbol(snapshot.symbol),
      normalizePositionSide(snapshot.positionSide),
    ].join(":");
    snapshotQtyByPidSymbolSide.set(key, toNumber(snapshot.openQty));
  }

  return []
    .concat(openOrders || [])
    .concat(openAlgoOrders || [])
    .filter(isReduceOnlyProtectionOrder)
    .filter((order) => {
      const symbol = normalizeSymbol(order.symbol);
      return compareSymbolSet.size === 0 || compareSymbolSet.has(symbol);
    })
    .map((order) => {
      const symbol = normalizeSymbol(order.symbol);
      const side = getOrderPositionSide(order);
      const clientOrderId = getOrderClientOrderId(order);
      const reservation = reservationByClientId.get(clientOrderId) || null;
      const reservationStatus = String(reservation?.status || "").trim().toUpperCase();
      const exchangeQty = toNumber(exchangeMap.get(`${symbol}:${side}`)?.qty);
      const orderQty = getOrderQty(order);
      const inferredPid = Number(reservation?.pid || inferPidFromClientOrderId(clientOrderId) || 0);
      const pidOwnedOpenQty = snapshotQtyByPidSymbolSide.get(`${inferredPid}:${symbol}:${side}`) || 0;

      let risk = "OK";
      if (!reservation) {
        risk = "BINANCE_ONLY_ACTIVE_PROTECTION";
      } else if (!["ACTIVE", "PARTIAL", "CANCEL_REQUESTED", "CANCEL_PENDING", "UNKNOWN_CANCEL_STATE"].includes(reservationStatus)) {
        risk = reservationStatus === "CANCELED"
          ? "LOCAL_CANCELED_BUT_BINANCE_ACTIVE"
          : "LOCAL_NON_ACTIVE_BUT_BINANCE_ACTIVE";
      }

      if (exchangeQty <= 0) {
        risk = risk === "OK"
          ? "ORPHAN_CLOSE_ORDER_FOR_FLAT_SIDE"
          : `${risk}|ORPHAN_CLOSE_ORDER_FOR_FLAT_SIDE`;
      } else if (orderQty > exchangeQty + qtyTolerance(exchangeQty)) {
        risk = risk === "OK"
          ? "OVERSIZED_PROTECTION_VS_POSITION"
          : `${risk}|OVERSIZED_PROTECTION_VS_POSITION`;
      }
      if (reservation && pidOwnedOpenQty <= 0) {
        risk = risk === "OK"
          ? "ACTIVE_PROTECTION_WITHOUT_PID_OPEN_QTY"
          : `${risk}|ACTIVE_PROTECTION_WITHOUT_PID_OPEN_QTY`;
      } else if (reservation && orderQty > pidOwnedOpenQty + qtyTolerance(pidOwnedOpenQty)) {
        risk = risk === "OK"
          ? "OVERSIZED_PROTECTION_VS_PID_OPEN_QTY"
          : `${risk}|OVERSIZED_PROTECTION_VS_PID_OPEN_QTY`;
      }

      return {
        uid,
        pid: inferredPid || "",
        symbol,
        side,
        localReservation: reservation
          ? `${reservation.reservationKind}:${reservation.status}:${clientOrderId}`
          : "",
        binanceActiveProtection: clientOrderId,
        binanceOrderId: order.orderId || order.algoId || "",
        binanceOrderType: order.type || order.origType || "",
        binanceOrderQty: orderQty,
        binancePositionQty: exchangeQty,
        pidOwnedOpenQty,
        isMatch: risk === "OK" ? "Y" : "N",
        risk,
        note: risk === "OK" ? "" : "USER_ACTION_REQUIRED",
      };
    })
    .filter((row) => row.risk !== "OK");
};

const buildUnprotectedOpenPositionRows = ({
  uid,
  snapshots = [],
  localReservations = [],
  positionRows = [],
  openOrders = [],
  openAlgoOrders = [],
  compareSymbols = [],
} = {}) => {
  const compareSymbolSet = new Set(
    []
      .concat(compareSymbols || [])
      .map((symbol) => normalizeSymbol(symbol))
      .filter(Boolean)
  );
  const exchangeMap = new Map();
  for (const row of normalizeBinancePositionRows(positionRows)) {
    exchangeMap.set(`${row.symbol}:${row.side}`, row);
  }

  const reservationMap = new Map();
  for (const reservation of localReservations || []) {
    const key = [
      Number(reservation.pid || 0),
      normalizeSymbol(reservation.symbol),
      normalizePositionSide(reservation.positionSide),
    ].join(":");
    reservationMap.set(key, (reservationMap.get(key) || 0) + 1);
  }

  const activeProtectionMap = new Map();
  const activeProtectionByPidMap = new Map();
  for (const order of []
    .concat(openOrders || [])
    .concat(openAlgoOrders || [])
    .filter(isReduceOnlyProtectionOrder)) {
    const clientOrderId = getOrderClientOrderId(order);
    const inferredPid = inferPidFromClientOrderId(clientOrderId);
    const key = [
      normalizeSymbol(order.symbol),
      normalizePositionSide(order.positionSide || order.positionSideType || ""),
    ].join(":");
    activeProtectionMap.set(key, (activeProtectionMap.get(key) || 0) + 1);
    if (inferredPid > 0) {
      const pidKey = [
        inferredPid,
        normalizeSymbol(order.symbol),
        normalizePositionSide(order.positionSide || order.positionSideType || ""),
      ].join(":");
      activeProtectionByPidMap.set(pidKey, (activeProtectionByPidMap.get(pidKey) || 0) + 1);
    }
  }

  const snapshotKeys = new Set();
  const rows = (snapshots || [])
    .filter((snapshot) => {
      const symbol = normalizeSymbol(snapshot.symbol);
      return compareSymbolSet.size === 0 || compareSymbolSet.has(symbol);
    })
    .map((snapshot) => {
      const symbol = normalizeSymbol(snapshot.symbol);
      const side = normalizePositionSide(snapshot.positionSide);
      const pid = Number(snapshot.pid || 0);
      snapshotKeys.add(`${symbol}:${side}`);
      const exchangeQty = toNumber(exchangeMap.get(`${symbol}:${side}`)?.qty);
      const localReservationCount = reservationMap.get(`${pid}:${symbol}:${side}`) || 0;
      const binanceProtectionCount = activeProtectionMap.get(`${symbol}:${side}`) || 0;
      const pidBinanceProtectionCount = activeProtectionByPidMap.get(`${pid}:${symbol}:${side}`) || 0;
      const expectedProtectionCount = toNumber(snapshot.openQty) > 0 ? 2 : 0;
      let risk = "OK";
      if (
        exchangeQty > 0
        && expectedProtectionCount > 0
        && (localReservationCount < expectedProtectionCount || pidBinanceProtectionCount < expectedProtectionCount)
      ) {
        risk = localReservationCount === 0 && pidBinanceProtectionCount === 0
          ? "PID_OPEN_NO_EFFECTIVE_PROTECTION"
          : "PID_OPEN_PROTECTION_COUNT_BELOW_EXPECTED";
      } else if (exchangeQty > 0 && localReservationCount === 0 && binanceProtectionCount === 0) {
        risk = "EXCHANGE_OPEN_NO_PROTECTION";
      } else if (exchangeQty === 0 && toNumber(snapshot.openQty) > 0) {
        risk = "LOCAL_OPEN_EXCHANGE_FLAT";
      }

      return {
        uid,
        pid,
        strategyCategory: snapshot.strategyCategory,
        symbol,
        side,
        localOpenQty: toNumber(snapshot.openQty),
        binancePositionQty: exchangeQty,
        localActiveReservationCount: localReservationCount,
        binanceActiveProtectionCount: binanceProtectionCount,
        pidBinanceActiveProtectionCount: pidBinanceProtectionCount,
        expectedProtectionCount,
        risk,
        note: risk === "OK" ? "" : "USER_ACTION_REQUIRED",
      };
    })
    .filter((row) => row.risk !== "OK");

  for (const [key, exchange] of exchangeMap.entries()) {
    const [symbol, side] = key.split(":");
    if (compareSymbolSet.size > 0 && !compareSymbolSet.has(symbol)) {
      continue;
    }
    if (snapshotKeys.has(key)) {
      continue;
    }
    const exchangeQty = toNumber(exchange?.qty);
    if (!(exchangeQty > 0)) {
      continue;
    }
    const binanceProtectionCount = activeProtectionMap.get(`${symbol}:${side}`) || 0;
    const risk = binanceProtectionCount > 0
      ? "BINANCE_OPEN_LOCAL_FLAT"
      : "UNOWNED_EXCHANGE_OPEN_NO_EFFECTIVE_PROTECTION";
    rows.push({
      uid,
      pid: "",
      strategyCategory: "",
      symbol,
      side,
      localOpenQty: 0,
      binancePositionQty: exchangeQty,
      localActiveReservationCount: 0,
      binanceActiveProtectionCount: binanceProtectionCount,
      pidBinanceActiveProtectionCount: 0,
      expectedProtectionCount: 2,
      risk,
      note: "USER_ACTION_REQUIRED",
    });
  }

  return rows;
};

const detectUnprotectedOpenPositions = async (uid, options = {}) => {
  const compareSymbols = []
    .concat(options.compareSymbols || [])
    .map((symbol) => normalizeSymbol(symbol))
    .filter(Boolean);
  const [snapshots, localReservations, positionResult, openOrdersResult, openAlgoOrdersResult] = await Promise.all([
    loadOpenSnapshotRowsByUid(uid),
    loadActiveReservationsByUid(uid),
    getPositionRisk(uid).then(
      (rows) => ({ ok: true, rows }),
      (error) => ({ ok: false, rows: [], error })
    ),
    getOpenOrders(uid).then(
      (rows) => ({ ok: true, rows }),
      (error) => ({ ok: false, rows: [], error })
    ),
    getOpenAlgoOrders(uid).then(
      (rows) => ({ ok: true, rows }),
      (error) => ({ ok: false, rows: [], error })
    ),
  ]);

  if (!positionResult.ok || !openOrdersResult.ok || !openAlgoOrdersResult.ok) {
    return [{
      uid,
      pid: "",
      strategyCategory: "",
      symbol: compareSymbols[0] || "",
      side: "",
      localOpenQty: "",
      binancePositionQty: "",
      localActiveReservationCount: "",
      binanceActiveProtectionCount: "",
      risk: "BINANCE_READ_FAILED",
      note: [
        positionResult.ok ? null : positionResult.error?.message,
        openOrdersResult.ok ? null : openOrdersResult.error?.message,
        openAlgoOrdersResult.ok ? null : openAlgoOrdersResult.error?.message,
      ].filter(Boolean).join(" | "),
    }];
  }

  return buildUnprotectedOpenPositionRows({
    uid,
    snapshots,
    localReservations,
    positionRows: positionResult.rows,
    openOrders: openOrdersResult.rows,
    openAlgoOrders: openAlgoOrdersResult.rows,
    compareSymbols,
  });
};

const detectStaleLocalState = async (uid, options = {}) => {
  const [aggregateRows, protectionRows] = await Promise.all([
    compareAggregateState(uid, options),
    compareProtectionState(uid, options),
  ]);

  const risks = [];
  for (const row of aggregateRows) {
    if (row.risk !== "OK") {
      risks.push({
        category: "AGGREGATE",
        symbol: row.symbol,
        side: row.side,
        pid: row.relatedPids,
        risk: row.risk,
      });
    }
  }
  for (const row of protectionRows) {
    if (row.risk !== "OK") {
      risks.push({
        category: "PROTECTION",
        symbol: row.symbol,
        side: row.side,
        pid: row.pid,
        risk: row.risk,
      });
    }
  }

  return risks;
};

const buildExecutionPreflight = async (config = {}) => {
  const uid = Number(config.uid || 0);
  const strategyCategory = String(config.strategyCategory || "SIGNAL").trim().toUpperCase();
  const targetRow = await loadStrategyRow({
    strategyCategory,
    strategyId: config.strategyId,
    pid: config.pid,
  });
  const connectivity = uid > 0 ? await getReadOnlyConnectivity(uid, config.symbol || null) : null;
  const symbol = normalizeSymbol(config.symbol);
  const positionSide = normalizePositionSide(config.positionSide);
  const [positionRows, openOrders, openAlgoOrders, positionMode] = uid > 0
    ? await Promise.all([
        getPositionRisk(uid, symbol).catch(() => []),
        getOpenOrders(uid, symbol).catch(() => []),
        getOpenAlgoOrders(uid, symbol).catch(() => []),
        getPositionMode(uid).catch(() => null),
      ])
    : [[], [], [], null];

  const symbolPositionRows = normalizeBinancePositionRows(positionRows);
  const targetPositionRow = symbolPositionRows.find((row) => row.side === positionSide) || null;
  const targetSnapshotRows = targetRow
    ? await loadSnapshotRows({
        uid,
        pid: targetRow.id,
        strategyCategory: strategyCategory.toLowerCase(),
      })
    : [];
  const targetReservations = targetRow
    ? await loadReservations({
        uid,
        pid: targetRow.id,
        strategyCategory: strategyCategory.toLowerCase(),
      })
    : [];

  const splitEnabled = strategyCategory === "SIGNAL"
    ? String(targetRow?.splitTakeProfitEnabled || "N").toUpperCase() === "Y"
    : false;
  const splitCount = Number(targetRow?.splitTakeProfitCount || 0);
  const splitGap = Number(targetRow?.splitTakeProfitGap || 0);
  const expectedSplitEnabled = Boolean(config?.splitTpConfig?.enabled);
  const expectedSplitCount = Number(config?.splitTpConfig?.count || 0);
  const expectedSplitGap = Number(config?.splitTpConfig?.gap || 0);
  const approxNotional = strategyCategory === "GRID"
    ? Number(targetRow?.tradeValue || 0)
    : Number(targetRow?.margin || 0) * Number(targetRow?.leverage || 0);

  const checks = [
    {
      item: "uid-api-connectivity",
      expected: "Binance read-only access",
      actual: connectivity && connectivity.positionRisk.ok ? "connected" : "not-connected",
      pass: Boolean(connectivity && connectivity.positionRisk.ok),
      note: connectivity?.positionRisk?.error || "",
    },
    {
      item: "target-strategy-row",
      expected: "target row exists",
      actual: targetRow ? `${strategyCategory}:${targetRow.id}` : "missing",
      pass: Boolean(targetRow),
      note: "",
    },
    {
      item: "symbol-match",
      expected: symbol,
      actual: targetRow?.symbol || "",
      pass: !targetRow || normalizeSymbol(targetRow.symbol) === symbol,
      note: "",
    },
    {
      item: "position-side",
      expected: positionSide,
      actual: positionSide,
      pass: true,
      note: "preflight config only",
    },
    {
      item: "binance-position",
      expected: "0 or explicitly intended",
      actual: targetPositionRow ? targetPositionRow.qty : 0,
      pass: !(targetPositionRow && targetPositionRow.qty > 0),
      note: "non-zero position blocks live execution by default",
    },
    {
      item: "binance-open-orders",
      expected: "0",
      actual: `${(openOrders || []).length + (openAlgoOrders || []).length}`,
      pass: ((openOrders || []).length + (openAlgoOrders || []).length) === 0,
      note: "existing symbol-level orders block live execution by default",
    },
    {
      item: "local-pid-mix",
      expected: "target PID only",
      actual: targetSnapshotRows.length > 0 ? targetSnapshotRows.map((row) => row.positionSide).join(",") : "none",
      pass: true,
      note: "observation only in this harness phase",
    },
    {
      item: "max-notional",
      expected: `<= ${Number(config.maxNotional || 0)}`,
      actual: approxNotional,
      pass: approxNotional <= Number(config.maxNotional || 0),
      note: "",
    },
    {
      item: "leverage",
      expected: Number(config.leverage || targetRow?.leverage || 0) || "config-defined",
      actual: Number(targetRow?.leverage || targetPositionRow?.leverage || 0),
      pass: true,
      note: "",
    },
    {
      item: "margin-mode",
      expected: String(config.marginMode || targetRow?.marginType || "").trim().toLowerCase() || "config-defined",
      actual: String(targetRow?.marginType || targetPositionRow?.marginType || "").trim().toLowerCase(),
      pass: true,
      note: "",
    },
    {
      item: "position-mode",
      expected: "hedge mode",
      actual: positionMode?.dualSidePosition,
      pass: positionMode ? String(positionMode.dualSidePosition).trim().toLowerCase() === "true" : false,
      note: "",
    },
    {
      item: "split-tp-config",
      expected: JSON.stringify({
        enabled: expectedSplitEnabled,
        count: expectedSplitCount,
        gap: expectedSplitGap,
      }),
      actual: JSON.stringify({
        enabled: splitEnabled,
        count: splitCount,
        gap: splitGap,
      }),
      pass:
        strategyCategory !== "SIGNAL" ||
        (
          splitEnabled === expectedSplitEnabled &&
          splitCount === expectedSplitCount &&
          Math.abs(splitGap - expectedSplitGap) < 0.000001
        ),
      note: "",
    },
    {
      item: "webhook-matchability",
      expected: "payload matches target symbol/strategy",
      actual: JSON.stringify(config.webhookPayload || {}),
      pass: Boolean(config.webhookPayload && normalizeSymbol(config.webhookPayload.symbol || symbol) === symbol),
      note: "",
    },
    {
      item: "kill-switch",
      expected: "documented",
      actual: String(config?.killSwitch?.manualCloseProcedure || "").trim() || "missing",
      pass: Boolean(String(config?.killSwitch?.manualCloseProcedure || "").trim()),
      note: "",
    },
    {
      item: "allow-live-orders-guard",
      expected: "false by default",
      actual: `${config.allowLiveOrders === true}`,
      pass: config.allowLiveOrders !== true,
      note: "this phase keeps live execution disabled",
    },
  ];

  return {
    connectivity,
    targetRow,
    targetSnapshotRows,
    targetReservations,
    checks,
    pass: checks.every((check) => check.pass),
  };
};

module.exports = {
  compareAggregateState,
  compareProtectionState,
  buildAggregateComparisonRows,
  buildActiveProtectionRiskRows,
  buildUnprotectedOpenPositionRows,
  detectStaleLocalState,
  detectUnprotectedOpenPositions,
  buildExecutionPreflight,
};
