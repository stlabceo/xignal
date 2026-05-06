"use strict";

const gridPriceSource = require("./grid-price-source");

const GRID_PROTECTION_STATE = Object.freeze({
  FULL: "GRID_PROTECTED",
  PARTIAL: "GRID_PARTIAL_PROTECTION",
  NONE: "GRID_UNPROTECTED",
  ONE_LEG_PROTECTED: "PAIR_ONE_LEG_PROTECTED",
  ONE_LEG_UNPROTECTED: "PAIR_ONE_LEG_UNPROTECTED",
});

const PROTECTION_REJECTION_CODE = Object.freeze({
  PRICE_SOURCE_STALE: "PRICE_SOURCE_STALE",
  LOCAL_IMMEDIATE_TRIGGER: "LOCAL_IMMEDIATE_TRIGGER",
  BINANCE_IMMEDIATE_TRIGGER: -2021,
});

const PROTECTION_CRITICAL_STATES = new Set([
  GRID_PROTECTION_STATE.PARTIAL,
  GRID_PROTECTION_STATE.NONE,
  GRID_PROTECTION_STATE.ONE_LEG_PROTECTED,
  GRID_PROTECTION_STATE.ONE_LEG_UNPROTECTED,
]);

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeProtectionResult = (order, kind) => ({
  kind,
  ok: Boolean(order?.clientOrderId),
  clientOrderId: order?.clientOrderId || null,
  sourceOrderId: order?.orderId || null,
  errorCode: order?.errorCode || null,
  errorMessage: order?.errorMessage || null,
  immediateTrigger: Boolean(
    order?.immediateTrigger ||
    Number(order?.errorCode) === PROTECTION_REJECTION_CODE.BINANCE_IMMEDIATE_TRIGGER
  ),
  priceSourceStale: order?.errorCode === PROTECTION_REJECTION_CODE.PRICE_SOURCE_STALE,
});

const classifyProtectionOutcome = ({
  takeProfit = {},
  stop = {},
  oneLegEmergency = false,
} = {}) => {
  const tp = normalizeProtectionResult(takeProfit, "TP");
  const sl = normalizeProtectionResult(stop, "STOP");
  const missing = [];
  if (!tp.ok) missing.push("TP");
  if (!sl.ok) missing.push("STOP");

  if (missing.length === 0) {
    return {
      protected: true,
      partial: false,
      state: oneLegEmergency ? GRID_PROTECTION_STATE.ONE_LEG_PROTECTED : GRID_PROTECTION_STATE.FULL,
      reason: oneLegEmergency ? "PAIR_ONE_LEG_PROTECTED" : "GRID_PROTECTED",
      missing,
      takeProfit: tp,
      stop: sl,
    };
  }

  const immediateTrigger = tp.immediateTrigger || sl.immediateTrigger;
  const priceSourceStale = tp.priceSourceStale || sl.priceSourceStale;
  const reason = priceSourceStale
    ? "PROTECTION_PRICE_SOURCE_STALE"
    : immediateTrigger
      ? "PROTECTION_IMMEDIATE_TRIGGER_REJECTED"
      : missing.length === 2
        ? "PROTECTION_BOTH_MISSING"
        : "PROTECTION_PARTIAL_MISSING";

  return {
    protected: false,
    partial: missing.length === 1,
    state: oneLegEmergency
      ? GRID_PROTECTION_STATE.ONE_LEG_UNPROTECTED
      : missing.length === 1
        ? GRID_PROTECTION_STATE.PARTIAL
        : GRID_PROTECTION_STATE.NONE,
    reason,
    missing,
    takeProfit: tp,
    stop: sl,
  };
};

const getProtectionImmediateTriggerRisk = ({
  leg,
  boundType,
  triggerPrice,
  price,
} = {}) => {
  const trigger = toNumber(triggerPrice);
  if (!(trigger > 0)) {
    return {
      blocked: true,
      code: "INVALID_TRIGGER_PRICE",
      reason: "invalid trigger price",
    };
  }

  const markFreshness = gridPriceSource.getMarkFreshness(price);
  const quoteFreshness = gridPriceSource.requireFreshGridQuote(price);
  if (!markFreshness.usable && !quoteFreshness.usable) {
    return {
      blocked: true,
      code: PROTECTION_REJECTION_CODE.PRICE_SOURCE_STALE,
      reason: markFreshness.reason && markFreshness.reason !== "MARK_PRICE_MISSING"
        ? markFreshness.reason
        : quoteFreshness.reason || "price source is stale",
    };
  }

  const normalizedLeg = String(leg || "").toUpperCase();
  const normalizedBound = String(boundType || "").toUpperCase();
  let immediate = false;
  let bid = quoteFreshness.bid;
  let ask = quoteFreshness.ask;
  const markPrice = markFreshness.markPrice;

  if (markFreshness.usable) {
    if (normalizedBound === "GTP") {
      immediate = normalizedLeg === "LONG"
        ? markPrice >= trigger
        : markPrice <= trigger;
    } else {
      immediate = normalizedLeg === "LONG"
        ? markPrice <= trigger
        : markPrice >= trigger;
    }
  } else {
    if (normalizedBound === "GTP") {
      immediate = normalizedLeg === "LONG"
        ? bid >= trigger
        : ask <= trigger;
    } else {
      immediate = normalizedLeg === "LONG"
        ? bid <= trigger
        : ask >= trigger;
    }
  }

  return {
    blocked: immediate,
    code: immediate ? PROTECTION_REJECTION_CODE.LOCAL_IMMEDIATE_TRIGGER : null,
    reason: immediate ? "trigger would immediately execute" : null,
    bid,
    ask,
    markPrice: markFreshness.usable ? markPrice : null,
    source: markFreshness.usable ? gridPriceSource.GRID_PRICE_SOURCE.MARK_PRICE : gridPriceSource.GRID_PRICE_SOURCE.QUOTE_CACHE,
    trigger,
  };
};

const deriveProtectionClientOrderId = ({
  entryClientOrderId,
  prefix,
  fallbackClientOrderId,
} = {}) => {
  const raw = String(entryClientOrderId || "").trim();
  if (/^GENTRY_[LS]_\d+_\d+_\d+$/.test(raw)) {
    return raw.replace(/^GENTRY_/, `${prefix}_`);
  }
  return fallbackClientOrderId || null;
};

const isProtectionCriticalState = (row = {}) =>
  PROTECTION_CRITICAL_STATES.has(String(row.regimeStatus || "").trim().toUpperCase());

module.exports = {
  GRID_PROTECTION_STATE,
  PROTECTION_REJECTION_CODE,
  classifyProtectionOutcome,
  deriveProtectionClientOrderId,
  getProtectionImmediateTriggerRisk,
  isProtectionCriticalState,
  normalizeProtectionResult,
};
