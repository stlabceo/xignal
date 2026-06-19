"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const coinSource = fs.readFileSync(path.resolve(repoRoot, "backend/coin.js"), "utf8");
const gridEngineSource = fs.readFileSync(path.resolve(repoRoot, "backend/grid-engine.js"), "utf8");

let tests = 0;
const check = (name, fn) => {
  fn();
  tests += 1;
  console.log(`[PASS] ${name}`);
};

const requiredCoinStages = [
  "GRID_PRIVATE_SOCKET_RAW_ORDER_TRADE_UPDATE_INGRESS",
  "GRID_PRIVATE_SOCKET_ORDER_TRADE_UPDATE_PARSED",
  "GRID_PRIVATE_SOCKET_ORDER_TRADE_UPDATE_DISPATCH_ROUTE",
  "GRID_PRIVATE_SOCKET_GRID_HANDLER_RESULT",
  "GRID_PRIVATE_SOCKET_LATENCY",
  "GRID_REST_TRUTH_SYNC_RUN_START",
  "GRID_REST_TRUTH_SYNC_RUN_SKIP",
  "GRID_REST_TRUTH_SYNC_SCAN_SET",
  "GRID_REST_TRUTH_SYNC_RECOVERY_SCAN_START",
  "GRID_REST_TRUTH_SYNC_RECOVERY_MATCHED",
  "GRID_REST_TRUTH_SYNC_RECOVERY_NO_MATCH",
  "GRID_REST_TRUTH_SYNC_LATENCY",
  "GRID_PUBLIC_PRICE_HINT_PUBLIC_PRICE_INGRESS",
  "GRID_PUBLIC_PRICE_HINT_PRICE_CROSS_HINT_CHECK",
  "GRID_PUBLIC_PRICE_HINT_ENTRY_PRICE_CROSS_HINT",
  "GRID_PUBLIC_PRICE_HINT_TP_PRICE_CROSS_HINT",
  "GRID_PUBLIC_PRICE_HINT_STOP_PRICE_CROSS_HINT",
  "GRID_PUBLIC_PRICE_HINT_PRICE_CROSS_HINT_SKIP",
  "GRID_PUBLIC_PRICE_HINT_TARGETED_VERIFY_QUEUED",
  "GRID_PUBLIC_PRICE_HINT_TARGETED_VERIFY_START",
  "GRID_PUBLIC_PRICE_HINT_TARGETED_VERIFY_DONE",
  "GRID_PUBLIC_PRICE_HINT_TARGETED_VERIFY_SKIP",
];

const requiredGridEngineStages = [
  "GRID_PRIVATE_SOCKET_GRID_HANDLER_ENTER",
  "GRID_PRIVATE_SOCKET_GRID_HANDLER_SKIP",
  "GRID_PRIVATE_SOCKET_GRID_HANDLER_APPLIED",
  "GRID_REST_TRUTH_SYNC_ROW_START",
  "GRID_REST_TRUTH_SYNC_ROW_SKIP",
  "GRID_REST_TRUTH_SYNC_LATENCY",
  "GRID_FILL_TO_PROTECTION_LATENCY",
];

check("observability namespaces are separated in coin runtime", () => {
  for (const stage of requiredCoinStages) {
    assert(coinSource.includes(stage), `missing ${stage}`);
  }
});

check("observability namespaces are separated in grid engine runtime", () => {
  for (const stage of requiredGridEngineStages) {
    assert(gridEngineSource.includes(stage), `missing ${stage}`);
  }
});

check("public price hint remains non-canonical and does not create orders or ledger rows", () => {
  const start = coinSource.indexOf("const auditGridPublicPriceCrossingHints");
  const end = coinSource.indexOf("const logGridPublicPriceIngress", start);
  assert(start > 0 && end > start, "public price hint audit function block not found");
  const block = coinSource.slice(start, end);

  assert(block.includes("directFillConfirmation: false"), "public hint must declare no direct fill confirmation");
  assert(block.includes("createsOrderOrLedger: false"), "public hint must declare no order/ledger creation");
  assert(!/pidPositionLedger|orderIntentQueue|enqueue|applyGridEntryFillConvergence|applyExitFill|futures(Order|AllOrders|UserTrades)|privateFuturesSignedRequest|binance\[/.test(block), "public hint audit must not write ledger, enqueue, or call Binance private/write APIs");
  assert(!/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(block), "public hint audit must not mutate DB");
});

check("REST truth-sync still documents private canonical evidence only", () => {
  assert(coinSource.includes("futuresPositionRisk"), "positionRisk evidence missing");
  assert(coinSource.includes("futuresAllOrders"), "allOrders evidence missing");
  assert(coinSource.includes("futuresUserTrades"), "userTrades evidence missing");
  assert(coinSource.includes("canonicalEvidence: ['futuresAllOrders', 'futuresUserTrades']"), "recovery evidence audit missing");
});

check("private socket audit emits before dedupe and protects listenKey", () => {
  const ingressIndex = coinSource.indexOf("GRID_PRIVATE_SOCKET_RAW_ORDER_TRADE_UPDATE_INGRESS");
  const dedupeIndex = coinSource.indexOf("shouldSkipDuplicateOrderRuntimeEvent(uid, data)");
  assert(ingressIndex > 0 && dedupeIndex > ingressIndex, "raw private socket audit must be before dedupe");
  assert(coinSource.includes("listenKeyMasked: maskApiKey(listenKey)"), "listenKey must be masked in user stream logs");
  assert(!coinSource.includes("END initAPI ID:${uid} ::: ${listenKey}"), "initAPI log must not print raw listenKey");
});

check("public price hint is wired from public streams only as an audit hint", () => {
  assert(coinSource.includes("binance.futuresBookTickerStream"), "bookTicker public stream missing");
  assert(coinSource.includes("binance.futuresAggTradeStream"), "aggTrade public stream missing");
  assert(coinSource.includes("auditGridPublicPriceCrossingHints({"), "public price crossing hint audit is not wired");
  assert(coinSource.includes("scheduleGridTargetedTruthSyncVerify({"), "public price crossing hint must schedule targeted verify");
  assert(coinSource.includes("source: 'bookTicker'"), "bookTicker audit source missing");
  assert(coinSource.includes("source: 'aggTrade'"), "aggTrade audit source missing");
});

console.log(`[RESULT] grid observability separation static checks passed (${tests})`);
