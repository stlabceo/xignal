const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const coinSource = fs.readFileSync(path.join(repoRoot, "backend/coin.js"), "utf8");
const gridEngineSource = fs.readFileSync(path.join(repoRoot, "backend/grid-engine.js"), "utf8");

assert(
  /const normalizedRowSymbol = normalizeBinanceFuturesSymbol\(row\.symbol\);[\s\S]+REPLACE\(UPPER\(symbol\), '\.P', ''\) = \?[\s\S]+\[uid, normalizedRowSymbol, normalizedLeg\]/.test(coinSource),
  "recoverGridExternalManualCloseFromExchange must match owners by normalized futures symbol"
);

assert(
  /const normalizeGridExchangeSymbol = \(value = ""\) =>[\s\S]+replace\(\/\\\.P\$\/i, ""\);/.test(gridEngineSource),
  "grid-engine must define a futures-symbol normalizer for exchange-flat owner matching"
);

assert(
  /const normalizedCurrentSymbol = normalizeGridExchangeSymbol\(current\.symbol\);[\s\S]+REPLACE\(UPPER\(symbol\), '\.P', ''\) = \?[\s\S]+\[current\.uid, normalizedCurrentSymbol, leg\]/.test(gridEngineSource),
  "convergeLiveGridLegToExchangeFlat must match owners by normalized futures symbol"
);

const normalize = (value = "") =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_]+:/, "")
    .replace(/\.P$/i, "");

assert.strictEqual(normalize("XRPUSDT.P"), "XRPUSDT");
assert.strictEqual(normalize("BINANCE:XRPUSDT.P"), "XRPUSDT");
assert.strictEqual(normalize("XRPUSDT"), "XRPUSDT");

console.log("grid-external-close-symbol-normalization-static-test PASS");
