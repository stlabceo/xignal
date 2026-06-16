"use strict";

const crypto = require("crypto");
const gridPriceSource = require("./grid-price-source");

const GRID_REENTRY_STATE = Object.freeze({
  INTENT_PENDING: "REENTRY_INTENT_PENDING",
  RUNNING: "REENTRY_CREATE_RUNNING",
  PENDING: "REENTRY_PENDING",
  BLOCKED_PRICE_STALE: "REENTRY_BLOCKED_PRICE_STALE",
  BLOCKED_OWNERSHIP: "REENTRY_BLOCKED_OWNERSHIP",
  BLOCKED_REDIS: "REENTRY_BLOCKED_REDIS",
  STALE_PRICE: "GRID_REENTRY_STALE",
  FAILED: "GRID_REENTRY_FAILED",
});

const GRID_SL_STATE = Object.freeze({
  CLEANUP_PENDING: "GRID_SL_CLEANUP_PENDING",
  OPPOSITE_CRITICAL: "GRID_SL_OPPOSITE_CRITICAL",
});

const GRID_REENTRY_REASON = Object.freeze({
  INTENT_PENDING: "REENTRY_INTENT_PENDING",
  PENDING: "REENTRY_PENDING",
  PRICE_STALE_BLOCKED: "REENTRY_BLOCKED_PRICE_STALE",
  OWNERSHIP_BLOCKED: "REENTRY_BLOCKED_OWNERSHIP",
  REDIS_BLOCKED: "REENTRY_BLOCKED_REDIS",
  PRICE_STALE: "GRID_TP_REENTRY_PRICE_STALE",
  SUBMIT_FAILED: "GRID_TP_REENTRY_FAILED",
});

const GRID_SL_REASON = Object.freeze({
  TERMINATED: "GRID_SL_REGIME_TERMINATED",
  CLEANUP_PENDING: "GRID_SL_CLEANUP_PENDING",
  OPPOSITE_CLOSE_REQUIRED: "GRID_SL_OPPOSITE_CLOSE_REQUIRED",
});

const GRID_EXIT_RECOVERY_KIND = Object.freeze({
  TAKE_PROFIT: "GRID_TP",
  STOP: "GRID_STOP",
  MANUAL: "GRID_MANUAL_OFF",
  GRID_EXIT: "GRID_EXIT_MARKET_CLOSE",
  UNKNOWN: "UNKNOWN",
});

const getLegCode = (leg) => String(leg || "").toUpperCase() === "SHORT" ? "S" : "L";

const classifyGridExitRecoveryKind = (source = {}) => {
  const reservationKind = String(source?.reservationKind || source?.kind || "").trim().toUpperCase();
  if (reservationKind === GRID_EXIT_RECOVERY_KIND.TAKE_PROFIT) {
    return GRID_EXIT_RECOVERY_KIND.TAKE_PROFIT;
  }
  if (reservationKind === GRID_EXIT_RECOVERY_KIND.STOP) {
    return GRID_EXIT_RECOVERY_KIND.STOP;
  }
  if (reservationKind === GRID_EXIT_RECOVERY_KIND.MANUAL) {
    return GRID_EXIT_RECOVERY_KIND.MANUAL;
  }
  if (reservationKind === GRID_EXIT_RECOVERY_KIND.GRID_EXIT) {
    return GRID_EXIT_RECOVERY_KIND.GRID_EXIT;
  }

  const clientOrderIds = []
    .concat(source?.clientOrderId || [])
    .concat(source?.sourceClientOrderId || [])
    .concat(source?.takeProfitClientOrderId || [])
    .concat(source?.recoveredReservationClientOrderIds || [])
    .filter(Boolean)
    .map((value) => String(value).trim().toUpperCase());

  if (clientOrderIds.some((value) => value.startsWith("GTP_"))) {
    return GRID_EXIT_RECOVERY_KIND.TAKE_PROFIT;
  }
  if (clientOrderIds.some((value) => value.startsWith("GSTOP_"))) {
    return GRID_EXIT_RECOVERY_KIND.STOP;
  }
  if (clientOrderIds.some((value) => value.startsWith("GMANUAL_"))) {
    return GRID_EXIT_RECOVERY_KIND.MANUAL;
  }
  if (clientOrderIds.some((value) => value.startsWith("GEXIT_"))) {
    return GRID_EXIT_RECOVERY_KIND.GRID_EXIT;
  }
  return GRID_EXIT_RECOVERY_KIND.UNKNOWN;
};

const isRecoveredTakeProfit = (source = {}) =>
  classifyGridExitRecoveryKind(source) === GRID_EXIT_RECOVERY_KIND.TAKE_PROFIT;

const isRecoveredStop = (source = {}) =>
  classifyGridExitRecoveryKind(source) === GRID_EXIT_RECOVERY_KIND.STOP;

const buildGridReentryIntentSeed = (row = {}, leg, source = {}) => [
  row.uid || "",
  row.id || "",
  row.regimeReceivedAt || row.signalTime || row.updatedAt || "",
  row.symbol || "",
  row.bunbong || "",
  row.triggerPrice || "",
  String(leg || "").toUpperCase(),
  source.takeProfitClientOrderId || source.clientOrderId || "",
  source.orderId || "",
  source.tradeId || "",
  source.tradeTime || "",
].join("|");

const buildGridReentryIntentSuffix = (row = {}, leg, source = {}) => {
  const digest = crypto
    .createHash("sha1")
    .update(buildGridReentryIntentSeed(row, leg, source))
    .digest("hex");
  const numeric = Number.parseInt(digest.slice(0, 12), 16) % 100000000;
  return String(numeric).padStart(8, "0");
};

const buildGridReentryClientOrderId = (row = {}, leg, source = {}) =>
  `GENTRY_${getLegCode(leg)}_${row.uid}_${row.id}_${buildGridReentryIntentSuffix(row, leg, source)}`;

const getReentryPriceDecision = (price = {}, options = {}) =>
  gridPriceSource.requireFreshGridQuote(price, options);

const isReentryCriticalState = (row = {}) =>
  Object.values(GRID_REENTRY_STATE).includes(String(row?.regimeStatus || "").trim().toUpperCase());

const isSlCriticalState = (row = {}) =>
  Object.values(GRID_SL_STATE).includes(String(row?.regimeStatus || "").trim().toUpperCase());

module.exports = {
  GRID_EXIT_RECOVERY_KIND,
  GRID_REENTRY_REASON,
  GRID_REENTRY_STATE,
  GRID_SL_REASON,
  GRID_SL_STATE,
  buildGridReentryClientOrderId,
  buildGridReentryIntentSeed,
  buildGridReentryIntentSuffix,
  classifyGridExitRecoveryKind,
  getReentryPriceDecision,
  isRecoveredStop,
  isRecoveredTakeProfit,
  isReentryCriticalState,
  isSlCriticalState,
};
