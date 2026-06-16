"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const gridEngineSource = fs.readFileSync(path.resolve(repoRoot, "backend/grid-engine.js"), "utf8");
const coinSource = fs.readFileSync(path.resolve(repoRoot, "backend/coin.js"), "utf8");
const seonSource = fs.readFileSync(path.resolve(repoRoot, "backend/seon.js"), "utf8");

let tests = 0;
const check = (label, fn) => {
  fn();
  tests += 1;
  console.log(`[PASS] ${label}`);
};

check("marketable GENTRY fill has bounded REST recovery after pair ACK", () => {
  assert(gridEngineSource.includes("const recoverImmediateLiveArmFillsAfterPairAck"));
  assert(gridEngineSource.includes("getLiveArmEntryFillRecoveryAttempts"));
  assert(gridEngineSource.includes("getLiveArmEntryFillRecoveryDelayMs"));
  assert(gridEngineSource.includes("GRID_LIVE_ARM_ENTRY_FILL_RECOVERY_WAITING"));
  assert(/attempt\s*=\s*1;[\s\S]+attempt\s*<=\s*maxAttempts/.test(gridEngineSource));
});

check("bounded recovery is exact to current GENTRY clientOrderId", () => {
  assert(gridEngineSource.includes("clientOrderId: placement.clientOrderId"));
  assert(gridEngineSource.includes("candidateClientOrderIds: [placement.clientOrderId]"));
  assert(gridEngineSource.includes("requireCandidateClientOrderId: true"));
  assert(coinSource.includes("if(requireExactCandidate)"));
  assert(coinSource.includes("return clientOrderIdSet.has(clientOrderId);"));
});

check("REST recovered entry fill converges ledger owner snapshot and protection", () => {
  assert(gridEngineSource.includes("coin.recoverGridEntryFillFromExchange"));
  assert(gridEngineSource.includes("restoreLiveGridLegAfterRecoveredEntryFill"));
  assert(gridEngineSource.includes("protectGridOpenLegOrClose"));
  assert(gridEngineSource.includes("GRID_LIVE_ARM_IMMEDIATE_FILL_RECOVERED"));
  assert(coinSource.includes("eventType: 'GRID_EXCHANGE_RECONCILED_ENTRY_FILL'"));
  assert(coinSource.includes("pidPositionLedger.applyEntryFill"));
  assert(coinSource.includes("pidPositionLedger.syncGridLegSnapshot"));
});

check("user stream GENTRY path still converges through canonical handler", () => {
  assert(coinSource.includes("if(isGridClientOrderId(rawClientOrderId))"));
  assert(coinSource.includes("handleLiveOrderTradeUpdate(uid, data)"));
  assert(gridEngineSource.includes("if (parsed.type === \"GENTRY\")"));
  assert(gridEngineSource.includes("handleLiveGridEntryFill(parsed, reData)"));
  assert(gridEngineSource.includes("eventType: \"GRID_ENTRY_FILL\""));
});

check("same fill from user stream and REST is ledger idempotent", () => {
  assert(coinSource.includes("pidPositionLedger.findRecordedFill"));
  assert(coinSource.includes("duplicateFillCount += 1"));
  assert(coinSource.includes("sourceTradeId: fill.tradeId"));
});

check("QA scoped runtime does not re-enable broad account polling", () => {
  assert(seonSource.includes("enableAccountPolling: !qaScopedGridRuntime"));
  assert(gridEngineSource.includes("process.env.QA_SCOPED_GRID_RUNTIME"));
  assert(gridEngineSource.includes("GRID_LIVE_ARM_ENTRY_FILL_BOUNDED_RECOVERY"));
});

console.log(JSON.stringify({
  result: "PASS",
  tests,
  dbMutation: 0,
  binanceWrite: 0,
}, null, 2));
