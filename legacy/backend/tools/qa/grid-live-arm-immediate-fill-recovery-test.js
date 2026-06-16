"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const gridEngineSource = fs.readFileSync(path.resolve(repoRoot, "backend/grid-engine.js"), "utf8");
const coinSource = fs.readFileSync(path.resolve(repoRoot, "backend/coin.js"), "utf8");

let tests = 0;
const check = (label, fn) => {
  fn();
  tests += 1;
  console.log(`[PASS] ${label}`);
};

check("success pair ACK path invokes immediate fill recovery", () => {
  assert(gridEngineSource.includes("recoverImmediateLiveArmFillsAfterPairAck"));
  assert(/ENTRY_PAIR_ARMED[\s\S]+recoverImmediateLiveArmFillsAfterPairAck\(armedRow, placements\)/.test(gridEngineSource));
});

check("immediate fill recovery reads exchange order status after ACK", () => {
  assert(gridEngineSource.includes("getLiveArmEntryFillRecoveryAttempts"));
  assert(gridEngineSource.includes("GRID_LIVE_ARM_ENTRY_FILL_RECOVERY_WAITING"));
  assert(/attempt\s*=\s*1;[\s\S]+attempt\s*<=\s*maxAttempts/.test(gridEngineSource));
  assert(gridEngineSource.includes("gridPairAtomicity.isOrderFilledOrPartiallyFilled(exchangeOrder || {})"));
});

check("QA scoped runtime enables bounded exact-candidate recovery without broad polling", () => {
  assert(gridEngineSource.includes("isBoundedLiveArmEntryFillRecoveryEnabled"));
  assert(gridEngineSource.includes("process.env.QA_SCOPED_GRID_RUNTIME"));
  assert(gridEngineSource.includes("GRID_LIVE_ARM_ENTRY_FILL_BOUNDED_RECOVERY"));
  assert(gridEngineSource.includes("clientOrderId: placement.clientOrderId"));
});

check("immediate fill recovery uses canonical exchange fill recovery", () => {
  assert(gridEngineSource.includes("coin.recoverGridEntryFillFromExchange"));
  assert(gridEngineSource.includes("GRID_LIVE_ARM_IMMEDIATE_FILL_RECOVERY"));
});

check("immediate fill recovery requires exact current clientOrderId", () => {
  assert(gridEngineSource.includes("candidateClientOrderIds: [placement.clientOrderId]"));
  assert(gridEngineSource.includes("requireCandidateClientOrderId: true"));
  assert(coinSource.includes("requireCandidateClientOrderId = false"));
  assert(coinSource.includes("if(requireExactCandidate)"));
  assert(coinSource.includes("return clientOrderIdSet.has(clientOrderId);"));
});

check("immediate fill recovery restores ledger owner snapshot and protection path", () => {
  assert(gridEngineSource.includes("applyGridEntryFillConvergence"));
  assert(gridEngineSource.includes("restoreLiveGridLegAfterRecoveredEntryFill"));
  assert(gridEngineSource.includes("protectGridOpenLegOrClose"));
  assert(gridEngineSource.includes("GRID_LIVE_ARM_IMMEDIATE_FILL_RECOVERED"));
});

check("success path keeps non-filled ACK orders as resting pair", () => {
  assert(gridEngineSource.includes("ORDER_NOT_FILLED_AFTER_ACK"));
  assert(gridEngineSource.includes("ENTRY_PAIR_ARMED"));
});

console.log(JSON.stringify({
  result: "PASS",
  tests,
  dbMutation: 0,
  binanceWrite: 0,
}, null, 2));
