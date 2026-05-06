"use strict";

const crypto = require("crypto");

const GRID_PAIR_STATE = Object.freeze({
  PENDING: "PAIR_ARM_PENDING",
  FAILED: "PAIR_ARM_FAILED",
  ROLLBACK_PENDING: "PAIR_ROLLBACK_PENDING",
  ONE_LEG_FILLED: "PAIR_ONE_LEG_FILLED",
});

const GRID_PAIR_LEG_STATUS = Object.freeze({
  ENTRY_ARMED: "ENTRY_ARMED",
  FAILED: "PAIR_ARM_FAILED",
  ROLLBACK_PENDING: "ROLLBACK_PENDING",
  ONE_LEG_FILLED: "ONE_LEG_FILLED",
});

const ACTIVE_ORDER_STATUSES = new Set(["NEW", "PARTIALLY_FILLED"]);
const FILLED_ORDER_STATUSES = new Set(["FILLED", "PARTIALLY_FILLED"]);
const TERMINAL_CANCEL_STATUSES = new Set(["CANCELED", "EXPIRED", "EXPIRED_IN_MATCH", "REJECTED"]);
const AMBIGUOUS_WRITE_CODES = new Set([-1001, -1007, -1021]);
const DUPLICATE_ORDER_CODES = new Set([-2010, -4111]);

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getLegCode = (leg) => String(leg || "").toUpperCase() === "SHORT" ? "S" : "L";

const getLegFieldPrefix = (leg) => String(leg || "").toUpperCase() === "SHORT" ? "short" : "long";

const buildGridPairIntentSeed = (row = {}) => [
  row.uid || "",
  row.id || "",
  row.regimeReceivedAt || row.signalTime || row.updatedAt || "",
  row.symbol || "",
  row.bunbong || "",
  row.supportPrice || "",
  row.resistancePrice || "",
  row.triggerPrice || "",
].join("|");

const buildGridPairIntentSuffix = (row = {}) => {
  const digest = crypto
    .createHash("sha1")
    .update(buildGridPairIntentSeed(row))
    .digest("hex");
  const numeric = Number.parseInt(digest.slice(0, 12), 16) % 100000000;
  return String(numeric).padStart(8, "0");
};

const buildGridPairClientOrderId = (row = {}, leg, prefix = "GENTRY") =>
  `${prefix}_${getLegCode(leg)}_${row.uid}_${row.id}_${buildGridPairIntentSuffix(row)}`;

const getBinanceErrorCode = (errorLike = {}) => {
  const candidates = [
    errorLike?.errorCode,
    errorLike?.code,
    errorLike?.response?.data?.code,
    errorLike?.body?.code,
    errorLike?.data?.code,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
};

const isAmbiguousWriteResult = (result = {}) => {
  const code = getBinanceErrorCode(result);
  const message = String(result?.errorMessage || result?.message || "").toLowerCase();
  return Boolean(
    result?.needsVerification ||
    AMBIGUOUS_WRITE_CODES.has(code) ||
    /timeout|timed out|econnreset|socket hang up|unknown/i.test(message)
  );
};

const isDuplicateOrderResult = (result = {}) => {
  const code = getBinanceErrorCode(result);
  const message = String(result?.errorMessage || result?.message || "").toLowerCase();
  return Boolean(
    result?.duplicate ||
    DUPLICATE_ORDER_CODES.has(code) ||
    /duplicate|clientorderid.*used|client order id.*used/i.test(message)
  );
};

const getOrderExecutedQty = (order = {}) =>
  toNumber(order.executedQty ?? order.cumQty ?? order.filledQty ?? order.z ?? order.quantityFilled);

const getOrderStatus = (order = {}) =>
  String(order.status || order.X || order.orderStatus || "").trim().toUpperCase();

const isOrderFilledOrPartiallyFilled = (order = {}) =>
  FILLED_ORDER_STATUSES.has(getOrderStatus(order)) || getOrderExecutedQty(order) > 0;

const isOrderActivePending = (order = {}) =>
  ACTIVE_ORDER_STATUSES.has(getOrderStatus(order)) && getOrderExecutedQty(order) <= 0;

const isOrderTerminalCanceled = (order = {}) =>
  TERMINAL_CANCEL_STATUSES.has(getOrderStatus(order));

const shouldVerifyAfterWriteResult = (result = {}) =>
  !result?.clientOrderId && (isAmbiguousWriteResult(result) || isDuplicateOrderResult(result));

const hasAnyGridEntryOrderRef = (row = {}) =>
  Boolean(row.longEntryOrderId || row.shortEntryOrderId);

const isPairArmDefectState = (row = {}) => {
  const regimeStatus = String(row.regimeStatus || "").trim().toUpperCase();
  return Object.values(GRID_PAIR_STATE).includes(regimeStatus);
};

const classifyGridPairArmOutcome = (placements = {}) => {
  const longOk = Boolean(placements.LONG?.ok);
  const shortOk = Boolean(placements.SHORT?.ok);
  if (longOk && shortOk) {
    return "PAIR_ARMED";
  }
  if (!longOk && !shortOk) {
    return GRID_PAIR_STATE.FAILED;
  }
  if (
    isOrderFilledOrPartiallyFilled(placements.LONG?.exchangeOrder || {}) ||
    isOrderFilledOrPartiallyFilled(placements.SHORT?.exchangeOrder || {})
  ) {
    return GRID_PAIR_STATE.ONE_LEG_FILLED;
  }
  return GRID_PAIR_STATE.ROLLBACK_PENDING;
};

module.exports = {
  ACTIVE_ORDER_STATUSES,
  FILLED_ORDER_STATUSES,
  GRID_PAIR_LEG_STATUS,
  GRID_PAIR_STATE,
  buildGridPairClientOrderId,
  buildGridPairIntentSeed,
  buildGridPairIntentSuffix,
  classifyGridPairArmOutcome,
  getBinanceErrorCode,
  getLegFieldPrefix,
  getOrderExecutedQty,
  getOrderStatus,
  hasAnyGridEntryOrderRef,
  isAmbiguousWriteResult,
  isDuplicateOrderResult,
  isOrderActivePending,
  isOrderFilledOrPartiallyFilled,
  isOrderTerminalCanceled,
  isPairArmDefectState,
  shouldVerifyAfterWriteResult,
};
