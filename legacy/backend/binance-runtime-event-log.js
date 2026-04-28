const db = require("./database/connect/config");
const recentEventCache = new Map();
const RECENT_EVENT_CACHE_MS = 5000;

const safeJsonStringify = (value) => {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({
      stringifyError: true,
      message: error?.message || "unknown",
    });
  }
};

const toNullableNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeSignatureValue = (value) => {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  return String(value).trim();
};

const buildRecentEventSignature = (event = {}) => {
  return [
    normalizeSignatureValue(event.uid),
    normalizeSignatureValue(event.pid),
    normalizeSignatureValue(event.strategyCategory).toLowerCase(),
    normalizeSignatureValue(event.eventType).toUpperCase(),
    normalizeSignatureValue(event.eventCode).toUpperCase(),
    normalizeSignatureValue(event.symbol).toUpperCase(),
    normalizeSignatureValue(event.side).toUpperCase(),
    normalizeSignatureValue(event.positionSide).toUpperCase(),
    normalizeSignatureValue(event.clientOrderId),
    normalizeSignatureValue(event.clientAlgoId),
    normalizeSignatureValue(event.orderId),
    normalizeSignatureValue(event.algoId),
    normalizeSignatureValue(event.actualOrderId),
    normalizeSignatureValue(event.executionType).toUpperCase(),
    normalizeSignatureValue(event.orderStatus).toUpperCase(),
    normalizeSignatureValue(event.algoStatus).toUpperCase(),
    normalizeSignatureValue(event.quantity),
    normalizeSignatureValue(event.executedQty),
    normalizeSignatureValue(event.avgPrice),
    normalizeSignatureValue(event.lastPrice),
    normalizeSignatureValue(event.eventTime),
    normalizeSignatureValue(event.tradeTime),
    normalizeSignatureValue(event.rejectReason),
    normalizeSignatureValue(event.expireReason),
  ].join("|");
};

const shouldSkipRecentDuplicate = (event = {}) => {
  const signature = buildRecentEventSignature(event);
  if (!signature) {
    return false;
  }

  const now = Date.now();
  const lastSeenAt = recentEventCache.get(signature);
  recentEventCache.set(signature, now);

  if (recentEventCache.size > 5000) {
    for (const [key, seenAt] of recentEventCache.entries()) {
      if (now - seenAt > RECENT_EVENT_CACHE_MS) {
        recentEventCache.delete(key);
      }
    }
  }

  return Boolean(lastSeenAt && now - lastSeenAt <= RECENT_EVENT_CACHE_MS);
};

const insertBinanceRuntimeEventLog = async (event = {}) => {
  try {
    if (shouldSkipRecentDuplicate(event)) {
      return null;
    }

    const [result] = await db.query(
      `INSERT INTO binance_runtime_event_log
        (
          uid,
          pid,
          strategy_category,
          event_type,
          event_code,
          severity,
          symbol,
          side,
          position_side,
          client_order_id,
          client_algo_id,
          order_id,
          algo_id,
          actual_order_id,
          execution_type,
          order_status,
          algo_status,
          reject_reason,
          expire_reason,
          order_type,
          orig_type,
          quantity,
          executed_qty,
          avg_price,
          last_price,
          event_time,
          trade_time,
          note,
          payload_json
        )
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(event.uid || 0),
        event.pid ? Number(event.pid) : null,
        String(event.strategyCategory || "").trim().toLowerCase() || null,
        String(event.eventType || "UNKNOWN").trim().toUpperCase(),
        String(event.eventCode || "UNKNOWN").trim().toUpperCase(),
        String(event.severity || "low").trim().toLowerCase(),
        event.symbol || null,
        event.side || null,
        event.positionSide || null,
        event.clientOrderId || null,
        event.clientAlgoId || null,
        toNullableNumber(event.orderId),
        toNullableNumber(event.algoId),
        toNullableNumber(event.actualOrderId),
        event.executionType || null,
        event.orderStatus || null,
        event.algoStatus || null,
        event.rejectReason || null,
        event.expireReason || null,
        event.orderType || null,
        event.origType || null,
        toNullableNumber(event.quantity),
        toNullableNumber(event.executedQty),
        toNullableNumber(event.avgPrice),
        toNullableNumber(event.lastPrice),
        toNullableNumber(event.eventTime),
        toNullableNumber(event.tradeTime),
        event.note || null,
        safeJsonStringify(event.payload),
      ]
    );

    return result.insertId || null;
  } catch (error) {
    console.log("[binance-runtime-log] insert failed", error?.message || error);
    return null;
  }
};

module.exports = {
  safeJsonStringify,
  insertBinanceRuntimeEventLog,
};
