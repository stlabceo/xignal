const data = require("./data");

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeSymbol = (value) => String(value || "").trim().toUpperCase();

const uniq = (items = []) => [...new Set(items.filter(Boolean))];

const getPriceFeedStatus = (symbols, options = {}) => {
  const uniqueSymbols = uniq((symbols || []).map(normalizeSymbol));
  const currentTime = Number(options.nowMs || Date.now());
  const freshnessLimitMs = Number(options.freshnessLimitMs || 15000);

  if (!uniqueSymbols.length) {
    return {
      status: "UNKNOWN",
      label: "UNKNOWN",
      abnormal: false,
      detail: "No symbols selected.",
      quoteFresh: false,
      tradeFresh: false,
    };
  }

  const missingSymbols = [];
  const staleQuoteSymbols = [];
  const quoteOnlySymbols = [];
  const staleTradeSymbols = [];

  uniqueSymbols.forEach((symbol) => {
    const item = data.getPrice(symbol);
    const bestBid = toNumber(item?.bestBid, 0);
    const bestAsk = toNumber(item?.bestAsk, 0);
    const hasQuote = bestBid > 0 || bestAsk > 0;
    if (!item?.st && !hasQuote) {
      missingSymbols.push(symbol);
      return;
    }

    const quoteTime = Number(item.quoteTime || item.lastTradeTime || 0);
    const quoteFreshnessMs = quoteTime > 0 ? Math.max(0, currentTime - quoteTime) : Number.POSITIVE_INFINITY;
    if (!hasQuote || quoteFreshnessMs > freshnessLimitMs) {
      staleQuoteSymbols.push(symbol);
      return;
    }

    const lastPrice = toNumber(item?.lastPrice, 0);
    const tradeTime = Number(item.lastTradeTime || 0);
    const tradeFreshnessMs = tradeTime > 0 ? Math.max(0, currentTime - tradeTime) : Number.POSITIVE_INFINITY;
    if (!(lastPrice > 0) || tradeFreshnessMs > freshnessLimitMs) {
      quoteOnlySymbols.push(symbol);
      if (tradeTime > 0 && tradeFreshnessMs > freshnessLimitMs) {
        staleTradeSymbols.push(symbol);
      }
    }
  });

  if (!missingSymbols.length && !staleQuoteSymbols.length && !quoteOnlySymbols.length) {
    return {
      status: "NORMAL",
      label: "NORMAL",
      abnormal: false,
      detail: `${uniqueSymbols.length} symbols have fresh trade and quote data.`,
      quoteFresh: true,
      tradeFresh: true,
    };
  }

  if (!missingSymbols.length && !staleQuoteSymbols.length) {
    return {
      status: "QUOTE_ONLY",
      label: "Quote fresh / trade delayed",
      abnormal: false,
      detail: `Quote usable for ${uniqueSymbols.length} symbols; delayed or zero last trade: ${quoteOnlySymbols.join(", ")}`,
      quoteFresh: true,
      tradeFresh: false,
      quoteOnlySymbols,
      staleTradeSymbols,
    };
  }

  return {
    status: "ABNORMAL",
    label: "ABNORMAL",
    abnormal: true,
    detail: [
      missingSymbols.length ? `missing: ${missingSymbols.join(", ")}` : null,
      staleQuoteSymbols.length ? `quote stale: ${staleQuoteSymbols.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" / "),
    quoteFresh: false,
    tradeFresh: false,
    quoteOnlySymbols,
    staleTradeSymbols,
  };
};

module.exports = {
  getPriceFeedStatus,
};
