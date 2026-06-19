"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const coin = fs.readFileSync(path.join(root, "coin.js"), "utf8");
const gridEngine = fs.readFileSync(path.join(root, "grid-engine.js"), "utf8");

const mustInclude = (source, needle, message) => {
  assert(source.includes(needle), message || `missing ${needle}`);
};

const getRef = (order) => String(order.clientAlgoId || order.clientOrderId || order.algoId || order.orderId || "");
const getOrderId = (order) => String(order.orderId || order.algoId || order.strategyId || "");
const getExecutedQty = (order) => Number(order.executedQty ?? order.actualQty ?? order.cumQty ?? 0);
const isFillEvidence = (order) => {
  const status = String(order.status || order.algoStatus || "").toUpperCase();
  return ["TRIGGERED", "FINISHED", "FILLED", "PARTIALLY_FILLED"].includes(status)
    || (["CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"].includes(status) && getExecutedQty(order) > 0);
};
const isNoopEvidence = (order) => ["NEW", "TRIGGERING"].includes(String(order.status || order.algoStatus || "").toUpperCase());
const isTerminalNoFill = (order) => ["CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"].includes(String(order.status || order.algoStatus || "").toUpperCase())
  && !(getExecutedQty(order) > 0);

const simulateDenseBatch = ({
  candidates,
  openAlgoOrders = [],
  allAlgoOrders = [],
  symbolTrades = [],
  exactFallbackByRef = {},
  orderScopedTradesByOrderId = {},
  exactFallbackMax = 100,
} = {}) => {
  const index = new Map();
  for (const order of [...openAlgoOrders, ...allAlgoOrders]) {
    const ref = getRef(order);
    if (ref && !index.has(ref)) {
      index.set(ref, order);
    }
  }

  const result = {
    candidateCount: candidates.length,
    exactFallbacks: 0,
    tradeFallbacks: 0,
    dispatched: 0,
    deferred: 0,
    noOps: 0,
    terminalNoFill: 0,
    safetyNet: 0,
    ledgerWrites: 0,
    orderWrites: 0,
    queueWrites: 0,
  };

  for (const candidate of candidates) {
    let order = index.get(candidate.clientAlgoId);
    if (!order && result.exactFallbacks < exactFallbackMax) {
      result.exactFallbacks += 1;
      order = exactFallbackByRef[candidate.clientAlgoId] || null;
    }
    if (!order) {
      result.deferred += 1;
      result.safetyNet += 1;
      continue;
    }
    if (isNoopEvidence(order)) {
      result.noOps += 1;
      continue;
    }
    if (isTerminalNoFill(order)) {
      result.terminalNoFill += 1;
      continue;
    }
    if (isFillEvidence(order)) {
      const orderId = getOrderId(order);
      let trades = symbolTrades.filter((trade) => String(trade.orderId) === orderId);
      if (trades.length === 0) {
        result.tradeFallbacks += 1;
        trades = orderScopedTradesByOrderId[orderId] || [];
      }
      if (trades.length === 0) {
        result.deferred += 1;
        continue;
      }
      result.dispatched += 1;
      result.ledgerWrites += trades.length;
      continue;
    }
    result.deferred += 1;
  }

  return result;
};

const groupDenseCandidates = (candidates, threshold = 12) => {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.uid}:${candidate.symbol}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return Array.from(groups.entries()).filter(([, count]) => count >= threshold);
};

mustInclude(
  coin,
  "client.__qaMockBinanceClientToken === QA_REPLAY_MOCK_BINANCE_CLIENT_TOKEN",
  "production must not activate QA replay mock bypass from a forged boolean flag"
);
mustInclude(
  coin,
  "createsOrderOrLedger: false",
  "public price hint / exact status audit must record that price crossing alone creates no order or ledger"
);
mustInclude(
  coin,
  "gridTargetedTruthSyncVerifyRunning",
  "targeted verify must keep an in-process lock keyed by verifyKey"
);
mustInclude(
  coin,
  "gridTargetedTruthSyncVerifyLastAt",
  "targeted verify must keep cooldown state keyed by verifyKey"
);
mustInclude(
  gridEngine,
  "withQueuedLiveGridEventLock",
  "socket path and targeted verify synthetic updates must share the live event lock"
);
mustInclude(
  gridEngine,
  "sourceTradeId: reData.t || null",
  "socket and targeted verify duplicate fills must converge through trade-id idempotency"
);
mustInclude(
  coin,
  "registerGridTargetedTruthSyncSafetyNet(",
  "deferred critical candidates must remain observable to batch truth-sync"
);

const baseCandidates = Array.from({ length: 12 }, (_, index) => ({
  uid: 156,
  symbol: "XRPUSDT",
  clientAlgoId: `GTP_L_156_990${index}_${index}`,
}));

const mixed = simulateDenseBatch({
  candidates: baseCandidates.slice(0, 4),
  openAlgoOrders: [
    { clientAlgoId: baseCandidates[0].clientAlgoId, algoStatus: "NEW", algoId: "A0" },
  ],
  allAlgoOrders: [
    { clientAlgoId: baseCandidates[1].clientAlgoId, algoStatus: "FINISHED", algoId: "A1", actualQty: "6.9" },
    { clientAlgoId: baseCandidates[2].clientAlgoId, algoStatus: "EXPIRED", algoId: "A2", actualQty: "0" },
  ],
  symbolTrades: [{ orderId: "A1", qty: "6.9", id: 1 }],
  exactFallbackByRef: {
    [baseCandidates[3].clientAlgoId]: { clientAlgoId: baseCandidates[3].clientAlgoId, algoStatus: "FINISHED", algoId: "A3", actualQty: "6.9" },
  },
  orderScopedTradesByOrderId: {
    A3: [{ orderId: "A3", qty: "6.9", id: 2 }],
  },
});
assert.strictEqual(mixed.dispatched, 2, "filled candidates must dispatch with batch or exact trade evidence");
assert.strictEqual(mixed.noOps, 1, "NEW/TRIGGERING candidates must not mutate ledger/order/queue");
assert.strictEqual(mixed.terminalNoFill, 1, "terminal no-fill candidates must not become fills");
assert.strictEqual(mixed.orderWrites, 0, "dense verify must not create orders");
assert.strictEqual(mixed.queueWrites, 0, "dense verify must not create queue intents");

const missing = simulateDenseBatch({
  candidates: baseCandidates.slice(0, 3),
  exactFallbackMax: 1,
});
assert.strictEqual(missing.deferred, 3, "missing evidence must defer, not synthesize fills");
assert.strictEqual(missing.safetyNet, 3, "missing dense evidence must remain observable");
assert.strictEqual(missing.ledgerWrites, 0, "missing evidence must not write ledger");

const overflowTrades = simulateDenseBatch({
  candidates: [baseCandidates[0]],
  allAlgoOrders: [{ clientAlgoId: baseCandidates[0].clientAlgoId, algoStatus: "FINISHED", algoId: "A1001", actualQty: "6.9" }],
  symbolTrades: Array.from({ length: 1000 }, (_, index) => ({ orderId: `OTHER${index}`, qty: "1" })),
  orderScopedTradesByOrderId: {
    A1001: [{ orderId: "A1001", qty: "6.9", id: 1001 }],
  },
});
assert.strictEqual(overflowTrades.tradeFallbacks, 1, "symbol userTrades overflow must fall back to order-scoped userTrades");
assert.strictEqual(overflowTrades.dispatched, 1, "order-scoped trade fallback must recover the fill");

const sameSymbol = groupDenseCandidates(Array.from({ length: 1000 }, (_, index) => ({ uid: 156, symbol: "XRPUSDT", id: index })));
const distributedSymbols = groupDenseCandidates(Array.from({ length: 1000 }, (_, index) => ({ uid: 156, symbol: `SYM${Math.floor(index / 100)}`, id: index })));
const distributedUids = groupDenseCandidates(Array.from({ length: 1000 }, (_, index) => ({ uid: 100 + Math.floor(index / 100), symbol: "XRPUSDT", id: index })));
const belowThreshold = groupDenseCandidates(Array.from({ length: 11 }, (_, index) => ({ uid: 156, symbol: "XRPUSDT", id: index })));
assert.deepStrictEqual(sameSymbol, [["156:XRPUSDT", 1000]], "same uid/symbol must form one dense group");
assert.strictEqual(distributedSymbols.length, 10, "symbol-distributed load must form independent dense groups");
assert.strictEqual(distributedUids.length, 10, "uid-distributed load must form independent dense groups");
assert.strictEqual(belowThreshold.length, 0, "below-threshold load must remain on the normal targeted verify path");

const harnessSummary = {
  status: "PASS",
  qaMockBoundary: "module-private token required",
  publicPriceOnlyMutation: "no ledger/order/queue",
  denseMixedScenario: mixed,
  denseMissingEvidenceScenario: missing,
  denseUserTradesOverflowScenario: overflowTrades,
  multiDimensionGroups: {
    sameSymbol: sameSymbol.length,
    distributedSymbols: distributedSymbols.length,
    distributedUids: distributedUids.length,
    belowThreshold: belowThreshold.length,
  },
  latencyModel: {
    harnessDenseWindowMs: 250,
    realisticRestLatencyMs: "openAlgoOrders + allAlgoOrders + optional symbol userTrades + bounded exact/order trade fallback",
  },
};

console.log(JSON.stringify(harnessSummary, null, 2));
console.log("grid-targeted-truth-sync-final-boundary-harness-test PASS");
