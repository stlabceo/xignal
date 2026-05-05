const assert = require("assert");
const data = require("../../data");
const { getPriceFeedStatus } = require("../../price-feed-status");

const now = Date.now();

data.price.TESTUSDT = {
  symbol: "TESTUSDT",
  bestBid: "10",
  bestAsk: "10.1",
  bestBidQty: "1",
  bestAskQty: "1",
  lastPrice: "0",
  lastQty: "0",
  quoteTime: now,
  lastTradeTime: now - 60_000,
};

const quoteOnly = getPriceFeedStatus(["TESTUSDT"], { nowMs: now });
assert.strictEqual(quoteOnly.status, "QUOTE_ONLY");
assert.strictEqual(quoteOnly.abnormal, false);
assert.strictEqual(quoteOnly.quoteFresh, true);
assert.strictEqual(quoteOnly.tradeFresh, false);

data.price.STALEUSDT = {
  symbol: "STALEUSDT",
  bestBid: "10",
  bestAsk: "10.1",
  quoteTime: now - 60_000,
  lastPrice: "0",
  lastTradeTime: 0,
};

const staleQuote = getPriceFeedStatus(["STALEUSDT"], { nowMs: now });
assert.strictEqual(staleQuote.status, "ABNORMAL");
assert.strictEqual(staleQuote.abnormal, true);
assert.strictEqual(staleQuote.quoteFresh, false);

console.log(JSON.stringify({
  status: "PASS",
  checks: [
    "fresh bid/ask with stale or zero last trade is quote-only, not hard abnormal",
    "stale quote remains abnormal",
  ],
}));
process.exit(0);
