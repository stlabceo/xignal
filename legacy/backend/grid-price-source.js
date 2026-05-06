"use strict";

const DEFAULT_GRID_PRICE_FRESHNESS_LIMIT_MS = 15000;

const GRID_PRICE_SOURCE = Object.freeze({
  QUOTE_CACHE: "QUOTE_CACHE",
  MARK_PRICE: "MARK_PRICE",
});

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getQuoteFreshness = (price = {}, options = {}) => {
  const nowMs = Number(options.nowMs || Date.now());
  const freshnessLimitMs = Number(options.freshnessLimitMs || DEFAULT_GRID_PRICE_FRESHNESS_LIMIT_MS);
  const bid = toNumber(price.bestBid);
  const ask = toNumber(price.bestAsk);
  const quoteTime = Number(price.quoteTime || 0);
  const quoteAgeMs = quoteTime > 0 ? Math.max(0, nowMs - quoteTime) : Number.POSITIVE_INFINITY;
  const hasFreshQuote =
    Boolean(price?.st) &&
    bid > 0 &&
    ask > 0 &&
    quoteTime > 0 &&
    quoteAgeMs <= freshnessLimitMs;

  let reason = null;
  if (!price?.st) {
    reason = "PRICE_SOURCE_MISSING";
  } else if (!(bid > 0) || !(ask > 0)) {
    reason = "QUOTE_BID_ASK_MISSING";
  } else if (!(quoteTime > 0)) {
    reason = "QUOTE_TIME_MISSING";
  } else if (quoteAgeMs > freshnessLimitMs) {
    reason = "QUOTE_STALE";
  }

  return {
    source: GRID_PRICE_SOURCE.QUOTE_CACHE,
    usable: hasFreshQuote,
    quoteFresh: hasFreshQuote,
    reason,
    bid,
    ask,
    quoteTime,
    quoteAgeMs,
    freshnessLimitMs,
  };
};

const getMarkFreshness = (price = {}, options = {}) => {
  const nowMs = Number(options.nowMs || Date.now());
  const freshnessLimitMs = Number(options.freshnessLimitMs || DEFAULT_GRID_PRICE_FRESHNESS_LIMIT_MS);
  const markPrice = toNumber(price.markPrice);
  const markTime = Number(price.markTime || 0);
  const markAgeMs = markTime > 0 ? Math.max(0, nowMs - markTime) : Number.POSITIVE_INFINITY;
  const usable =
    Boolean(price?.st) &&
    markPrice > 0 &&
    markTime > 0 &&
    markAgeMs <= freshnessLimitMs;

  let reason = null;
  if (!price?.st) {
    reason = "PRICE_SOURCE_MISSING";
  } else if (!(markPrice > 0)) {
    reason = "MARK_PRICE_MISSING";
  } else if (!(markTime > 0)) {
    reason = "MARK_TIME_MISSING";
  } else if (markAgeMs > freshnessLimitMs) {
    reason = "MARK_STALE";
  }

  return {
    source: GRID_PRICE_SOURCE.MARK_PRICE,
    usable,
    markFresh: usable,
    reason,
    markPrice,
    markTime,
    markAgeMs,
    freshnessLimitMs,
  };
};

const requireFreshGridQuote = (price = {}, options = {}) => getQuoteFreshness(price, options);

module.exports = {
  DEFAULT_GRID_PRICE_FRESHNESS_LIMIT_MS,
  GRID_PRICE_SOURCE,
  getMarkFreshness,
  getQuoteFreshness,
  requireFreshGridQuote,
};
