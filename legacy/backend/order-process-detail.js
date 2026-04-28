const data = require("./data");
const canonicalRuntimeState = require("./canonical-runtime-state");

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeSignalType = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const sumRealizedPnl = (rows = []) =>
  (rows || []).reduce((sum, row) => sum + toNumber(row?.realizedPnl, 0), 0);

const countLedgerEvents = (rows = [], eventType) => {
  const normalizedEventType = String(eventType || "").trim().toUpperCase();
  return (rows || []).filter(
    (row) => String(row?.eventType || "").trim().toUpperCase() === normalizedEventType
  ).length;
};

const sumOpenQtyBySide = (rows = [], positionSide) => {
  const normalizedSide = String(positionSide || "").trim().toUpperCase();
  return (rows || [])
    .filter((row) => String(row?.positionSide || "").trim().toUpperCase() === normalizedSide)
    .reduce((sum, row) => sum + toNumber(row?.openQty, 0), 0);
};

const sumOpenCostBySide = (rows = [], positionSide) => {
  const normalizedSide = String(positionSide || "").trim().toUpperCase();
  return (rows || [])
    .filter((row) => String(row?.positionSide || "").trim().toUpperCase() === normalizedSide)
    .reduce((sum, row) => sum + toNumber(row?.openCost, 0), 0);
};

const toCompactOrderId = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  return raw.length > 32 ? `${raw.slice(0, 14)}...${raw.slice(-10)}` : raw;
};

const formatOrderLine = (label, segments = []) => {
  const normalizedSegments = segments
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (!normalizedSegments.length) {
    return null;
  }
  return `${label}: ${normalizedSegments.join(" / ")}`;
};

const formatReservationStatusLabel = (status) => {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "ACTIVE") return "대기";
  if (normalized === "PARTIAL") return "부분체결";
  if (normalized === "FILLED") return "체결완료";
  if (normalized === "CANCELED") return "취소";
  if (normalized === "EXPIRED") return "만료";
  return normalized || null;
};

const buildSnapshotBasisLabel = (snapshotRows = [], positionSide = null) => {
  const openQty = positionSide
    ? sumOpenQtyBySide(snapshotRows, positionSide)
    : (snapshotRows || []).reduce((sum, row) => sum + toNumber(row?.openQty, 0), 0);
  const openCost = positionSide
    ? sumOpenCostBySide(snapshotRows, positionSide)
    : (snapshotRows || []).reduce((sum, row) => sum + toNumber(row?.openCost, 0), 0);
  const avgEntryPrice = openQty > 0 ? openCost / openQty : 0;
  if (!(openQty > 0) && !(avgEntryPrice > 0)) {
    return null;
  }
  return `Ledger 기준 수량 ${openQty.toFixed(8)} / 평단 ${avgEntryPrice.toFixed(10)}`;
};

const buildEntryLineage = (ledgerRows = [], positionSide = null) => {
  const filtered = (ledgerRows || []).filter((row) => {
    const eventType = String(row?.eventType || "").trim().toUpperCase();
    if (!eventType.includes("ENTRY")) {
      return false;
    }
    if (!positionSide) {
      return true;
    }
    return String(row?.positionSide || "").trim().toUpperCase() === String(positionSide).trim().toUpperCase();
  });
  const latest = filtered[filtered.length - 1] || null;
  if (!latest) {
    return [];
  }
  return [
    formatOrderLine("진입", [
      latest.sourceClientOrderId ? `CID ${toCompactOrderId(latest.sourceClientOrderId)}` : null,
      latest.sourceOrderId ? `OID ${latest.sourceOrderId}` : null,
      toNumber(latest.fillQty, 0) > 0 ? `QTY ${toNumber(latest.fillQty, 0).toFixed(8)}` : null,
      toNumber(latest.fillPrice, 0) > 0 ? `AVG ${toNumber(latest.fillPrice, 0).toFixed(10)}` : null,
    ]),
  ].filter(Boolean);
};

const buildReservationLineage = (reservationRows = [], positionSide = null) =>
  (reservationRows || [])
    .filter((row) => {
      if (!positionSide) {
        return true;
      }
      return String(row?.positionSide || "").trim().toUpperCase() === String(positionSide).trim().toUpperCase();
    })
    .slice()
    .sort((a, b) => {
      const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
      const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, 3)
    .map((row) =>
      formatOrderLine(row.reservationKind || "보호주문", [
        row.clientOrderId ? `CID ${toCompactOrderId(row.clientOrderId)}` : null,
        row.sourceOrderId ? `ALGO ${row.sourceOrderId}` : null,
        row.actualOrderId ? `EXCH ${row.actualOrderId}` : null,
        formatReservationStatusLabel(row.status),
      ])
    )
    .filter(Boolean);

const getCurrentMarketPrice = (symbol) => {
  const row = data.getPrice(symbol);
  const lastPrice = toNumber(row?.lastPrice, 0);
  if (lastPrice > 0) {
    return lastPrice;
  }

  const bestBid = toNumber(row?.bestBid, 0);
  const bestAsk = toNumber(row?.bestAsk, 0);
  if (bestBid > 0 && bestAsk > 0) {
    return (bestBid + bestAsk) / 2;
  }

  return bestBid || bestAsk || 0;
};

const calculateUnrealizedPnl = ({
  signalType,
  entryPrice,
  openQty,
  currentPrice,
}) => {
  const normalizedSignalType = normalizeSignalType(signalType);
  const quantity = toNumber(openQty, 0);
  const averageEntryPrice = toNumber(entryPrice, 0);
  const latestPrice = toNumber(currentPrice, 0);

  if (!(quantity > 0) || !(averageEntryPrice > 0) || !(latestPrice > 0)) {
    return 0;
  }

  const sign = normalizedSignalType === "SELL" ? -1 : 1;
  return (latestPrice - averageEntryPrice) * quantity * sign;
};

const parsePayloadJson = (payloadJson) => {
  if (!payloadJson) {
    return null;
  }

  if (typeof payloadJson === "object") {
    return payloadJson;
  }

  try {
    return JSON.parse(payloadJson);
  } catch (error) {
    return null;
  }
};

const buildAlgorithmOrderProcessDetail = ({
  currentItem,
  targetRow,
  cycleLedgerRows = [],
  allLedgerRows = [],
  snapshotRows = [],
  reservationRows = [],
} = {}) => {
  const decorated =
    currentItem && typeof currentItem === "object"
      ? canonicalRuntimeState.decorateSignalItemSync(currentItem, { snapshots: snapshotRows })
      : null;

  const symbol = decorated?.symbol || targetRow?.symbol || null;
  const direction =
    normalizeSignalType(
      decorated?.signalType || targetRow?.incomingSignalType || targetRow?.runtimeSignalType
    ) || null;
  const currentPrice = getCurrentMarketPrice(symbol);
  const entryPrice = toNumber(decorated?.entryPrice, 0);
  const openQty = toNumber(decorated?.openQty, 0);
  const positionSide = direction === "SELL" ? "SHORT" : "LONG";
  const lineageLines = [
    buildSnapshotBasisLabel(snapshotRows, positionSide),
    ...buildEntryLineage(cycleLedgerRows, positionSide),
    ...buildReservationLineage(reservationRows, positionSide),
  ].filter(Boolean);

  return {
    symbol,
    direction,
    strategyName: decorated?.a_name || decorated?.strategyName || targetRow?.strategyName || "-",
    statusLabel: decorated?.userStatusLabel || "대기중",
    entryPrice: entryPrice > 0 ? entryPrice : null,
    targetTakeProfitPrice:
      toNumber(decorated?.targetTakeProfitPrice, 0) > 0
        ? toNumber(decorated?.targetTakeProfitPrice, 0)
        : null,
    tradeAmount: toNumber(decorated?.tradeAmount, 0),
    stopConditionLabel: decorated?.stopConditionLabel || "-",
    unrealizedPnl: calculateUnrealizedPnl({
      signalType: direction,
      entryPrice,
      openQty,
      currentPrice,
    }),
    realizedPnl: sumRealizedPnl(cycleLedgerRows),
    cumulativeRealizedPnl:
      toNumber(decorated?.realizedPnlTotal, 0) !== 0
        ? toNumber(decorated?.realizedPnlTotal, 0)
        : sumRealizedPnl(allLedgerRows),
    lineageLines,
  };
};

const buildGridOrderProcessDetail = ({
  currentItem,
  targetRow,
  payloadJson,
  cycleLedgerRows = [],
  allLedgerRows = [],
  snapshotRows = [],
  reservationRows = [],
} = {}) => {
  const payload = parsePayloadJson(payloadJson);
  const decorated =
    currentItem && typeof currentItem === "object"
      ? canonicalRuntimeState.decorateGridItemSync(currentItem, { snapshots: snapshotRows })
      : null;
  const longLineageLines = [
    buildSnapshotBasisLabel(snapshotRows, "LONG"),
    ...buildEntryLineage(cycleLedgerRows, "LONG"),
    ...buildReservationLineage(reservationRows, "LONG"),
  ].filter(Boolean);
  const shortLineageLines = [
    buildSnapshotBasisLabel(snapshotRows, "SHORT"),
    ...buildEntryLineage(cycleLedgerRows, "SHORT"),
    ...buildReservationLineage(reservationRows, "SHORT"),
  ].filter(Boolean);
  const lineageLines = [
    longLineageLines.length > 0 ? `LONG | ${longLineageLines.join(" | ")}` : null,
    shortLineageLines.length > 0 ? `SHORT | ${shortLineageLines.join(" | ")}` : null,
  ].filter(Boolean);

  return {
    symbol: decorated?.symbol || targetRow?.symbol || null,
    strategyName: decorated?.a_name || decorated?.strategyName || targetRow?.strategyName || "-",
    overallStatusLabel: decorated?.userOverallStatusLabel || "대기중",
    buyStatusLabel: decorated?.longPositionStatusLabel || "Ready",
    sellStatusLabel: decorated?.shortPositionStatusLabel || "Ready",
    tradeAmount: toNumber(decorated?.tradeAmount, 0),
    triggerPrice: toNumber(payload?.triggerPrice ?? decorated?.triggerPrice, 0) || null,
    supportPrice: toNumber(payload?.supportPrice ?? decorated?.supportPrice, 0) || null,
    resistancePrice: toNumber(payload?.resistancePrice ?? decorated?.resistancePrice, 0) || null,
    targetTakeProfitPercent: toNumber(decorated?.profit, 0) || null,
    currentRegimeRealizedPnl: sumRealizedPnl(cycleLedgerRows),
    currentRegimeTakeProfitCount: countLedgerEvents(cycleLedgerRows, "GRID_TP_FILL"),
    cumulativeRealizedPnl: sumRealizedPnl(allLedgerRows),
    cumulativeTakeProfitCount: countLedgerEvents(allLedgerRows, "GRID_TP_FILL"),
    cumulativeStopLossCount: countLedgerEvents(allLedgerRows, "GRID_STOP_FILL"),
    currentLongQty: sumOpenQtyBySide(snapshotRows, "LONG"),
    currentShortQty: sumOpenQtyBySide(snapshotRows, "SHORT"),
    lineageLines,
  };
};

module.exports = {
  buildAlgorithmOrderProcessDetail,
  buildGridOrderProcessDetail,
};
