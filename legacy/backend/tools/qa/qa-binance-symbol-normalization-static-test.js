"use strict";

const assert = require("assert");
const qaBinance = require("./qa-binance");

assert.strictEqual(
  qaBinance.normalizeFuturesSymbol("AVAXUSDT.P"),
  "AVAXUSDT",
  "Binance futures REST boundary must strip .P"
);
assert.strictEqual(
  qaBinance.normalizeFuturesSymbol("AVAXUSDT"),
  "AVAXUSDT",
  "native futures symbols must stay unchanged"
);
assert.strictEqual(
  qaBinance.normalizeFuturesSymbol(" hbarusdt.p "),
  "HBARUSDT",
  "symbol normalization must trim, uppercase, and strip .P"
);

console.log("qa-binance-symbol-normalization-static-test PASS");
setTimeout(() => process.exit(0), 100);
