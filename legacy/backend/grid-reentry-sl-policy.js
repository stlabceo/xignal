"use strict";

const crypto = require("crypto");
const gridPriceSource = require("./grid-price-source");

const GRID_REENTRY_STATE = Object.freeze({
  STALE_PRICE: "GRID_REENTRY_STALE",
  FAILED: "GRID_REENTRY_FAILED",
});

const GRID_SL_STATE = Object.freeze({
  CLEANUP_PENDING: "GRID_SL_CLEANUP_PENDING",
  OPPOSITE_CRITICAL: "GRID_SL_OPPOSITE_CRITICAL",
});

const GRID_REENTRY_REASON = Object.freeze({
  PRICE_STALE: "GRID_TP_REENTRY_PRICE_STALE",
  SUBMIT_FAILED: "GRID_TP_REENTRY_FAILED",
});

const GRID_SL_REASON = Object.freeze({
  TERMINATED: "GRID_SL_REGIME_TERMINATED",
  CLEANUP_PENDING: "GRID_SL_CLEANUP_PENDING",
  OPPOSITE_CLOSE_REQUIRED: "GRID_SL_OPPOSITE_CLOSE_REQUIRED",
});

const getLegCode = (leg) => String(leg || "").toUpperCase() === "SHORT" ? "S" : "L";

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
  GRID_REENTRY_REASON,
  GRID_REENTRY_STATE,
  GRID_SL_REASON,
  GRID_SL_STATE,
  buildGridReentryClientOrderId,
  buildGridReentryIntentSeed,
  buildGridReentryIntentSuffix,
  getReentryPriceDecision,
  isReentryCriticalState,
  isSlCriticalState,
};
