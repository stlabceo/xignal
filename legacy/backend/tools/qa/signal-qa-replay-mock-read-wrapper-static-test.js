"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const coin = fs.readFileSync(path.join(root, "coin.js"), "utf8");
const loader = fs.readFileSync(path.join(root, "tools/qa/qa-runtime-loader.js"), "utf8");

const mustInclude = (source, needle, message) => {
  assert(source.includes(needle), message || `missing ${needle}`);
};

mustInclude(
  loader,
  "const __qaBinanceProxy = new Proxy(binance",
  "QA runtime loader must mark injected Binance clients"
);
mustInclude(
  loader,
  "markQaReplayMockBinanceClient(value)",
  "QA runtime loader must mark assigned mock clients through the module-private marker helper"
);
mustInclude(
  loader,
  "binance: __qaBinanceProxy",
  "QA module must expose the proxy, not the raw binance map"
);
mustInclude(
  coin,
  "const QA_REPLAY_MOCK_BINANCE_CLIENT_TOKEN = Symbol('qaReplayMockBinanceClient')",
  "QA mock bypass must require a module-private token, not only a writable boolean property"
);
mustInclude(
  coin,
  "client.__qaMockBinanceClientToken === QA_REPLAY_MOCK_BINANCE_CLIENT_TOKEN",
  "QA mock bypass must fail closed for forged production client flags"
);
mustInclude(
  coin,
  "const callQaReplayMockFuturesRead = async",
  "read wrappers must preserve QA replay mock adapters"
);
mustInclude(
  coin,
  "if(!isQaReplayMockBinanceClient(uid))",
  "mock read bypass must be restricted to explicitly marked QA clients"
);
mustInclude(
  coin,
  "callQaReplayMockFuturesRead(uid, 'futuresAllOrders'",
  "allOrders replay reads must use QA mock client when injected"
);
mustInclude(
  coin,
  "callQaReplayMockFuturesRead(uid, 'futuresUserTrades'",
  "userTrades replay reads must use QA mock client when injected"
);
mustInclude(
  coin,
  "callQaReplayMockFuturesRead(uid, 'futuresPositionRisk'",
  "positionRisk replay reads must use QA mock client when injected"
);
mustInclude(
  coin,
  "privateFuturesSignedRequest(uid, '/fapi/v1/userTrades'",
  "production userTrades reads must still use signed read guard"
);

console.log("signal-qa-replay-mock-read-wrapper-static-test PASS");
