"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "../../..");
const queueSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-queue.js"), "utf8");
const workerSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-worker.js"), "utf8");

let dbMutation = 0;
let binanceWrite = 0;
const queueModule = { exports: {} };

vm.runInNewContext(
  queueSource,
  {
    module: queueModule,
    exports: queueModule.exports,
    process: { env: {} },
    require: (request) => {
      if (request === "crypto") return require("crypto");
      if (request === "./database/connect/config") {
        return {
          query: async (sql) => {
            if (!/^\s*SELECT\b/i.test(String(sql || ""))) {
              dbMutation += 1;
              throw new Error(`unexpected DB write:${sql}`);
            }
            return [[]];
          },
        };
      }
      if (request === "./signal-market-entry-idempotency") {
        return {
          buildSignalEntryClientOrderId: () => "STATIC_SIGNAL_CLIENT_ID",
          normalizeSignalMarketEntryIntentPayload: (payload = {}) => payload,
          buildSignalMarketEntryIntentPayloadHash: () => "STATIC_SIGNAL_HASH",
          buildSignalMarketEntryIntentKey: () => "STATIC_SIGNAL_KEY",
          buildSignalMarketEntryFifoKey: () => "STATIC_SIGNAL_FIFO",
        };
      }
      if (/binance|coin/i.test(request)) {
        binanceWrite += 1;
        throw new Error(`unexpected trading dependency:${request}`);
      }
      return require(request);
    },
  },
  { filename: "order-intent-queue.js" }
);

const queue = queueModule.exports;
const parentCandidate = {
  createParent: true,
  parentState: queue.GRID_EXIT_PARENT_STATE.ACCEPTED,
  intentKey: "GRID_EXIT_REQUEST:v1:156:501:MEAN_REVERT_GRID:ADAUSDT:10MIN:REGIME_A",
  uid: 156,
  pid: 501,
  gridRegimeKey: "REGIME_A",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT.P",
  timeframe: "10min",
  reason: "GRID_EXIT_ALERT_PREVIEW",
};

const baseSnapshot = {
  uid: 156,
  pid: 501,
  gridRegimeKey: "REGIME_A",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT",
  timeframe: "10MIN",
  enabled: true,
  terminal: false,
  legs: [],
};

assert.strictEqual(queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, "GRID_EXIT_ENTRY_CANCEL", "entry cancel type exists");
assert.strictEqual(queue.INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL, "GRID_EXIT_PROTECTION_CANCEL", "protection cancel type exists");

const noFilledRestingEntriesSnapshot = {
  ...baseSnapshot,
  legs: [
    {
      positionSide: "LONG",
      filledQty: 0,
      ownerOpenQty: 0,
      entryOrders: [{ clientOrderId: "ENTRY_L_1", orderId: "1001", status: "NEW", role: "ENTRY", open: true }],
      protectionReservations: [],
    },
    {
      positionSide: "SHORT",
      filledQty: 0,
      ownerOpenQty: 0,
      entryOrders: [{ clientOrderId: "ENTRY_S_1", orderId: "1002", status: "NEW", role: "ENTRY", open: true }],
      protectionReservations: [],
    },
  ],
};
const noFilledRestingEntries = queue.buildGridExitChildCancelPlan(parentCandidate, noFilledRestingEntriesSnapshot);
assert.strictEqual(noFilledRestingEntries.entryCancelCandidates.length, 2, "resting entries create entry cancel candidates");
assert.strictEqual(noFilledRestingEntries.protectionCancelCandidates.length, 0, "no filled leg protection candidates");
assert.strictEqual(noFilledRestingEntries.forbidden.marketClose, false, "market close forbidden flag remains false");

const longProtection = queue.buildGridExitChildCancelPlan(parentCandidate, {
  ...baseSnapshot,
  legs: [
    {
      positionSide: "LONG",
      filledQty: 12,
      ownerOpenQty: 12,
      entryOrders: [],
      protectionReservations: [
        { reservationId: "TP_L_1", clientOrderId: "TP_L_CID", type: "TP", status: "ACTIVE" },
        { reservationId: "STOP_L_1", clientOrderId: "STOP_L_CID", type: "STOP", status: "ACTIVE" },
      ],
    },
  ],
});
assert.strictEqual(longProtection.entryCancelCandidates.length, 0, "long filled without resting entry has no entry cancel");
assert.strictEqual(longProtection.protectionCancelCandidates.length, 2, "long filled active TP/STOP protection cancel");

const shortProtection = queue.buildGridExitChildCancelPlan(parentCandidate, {
  ...baseSnapshot,
  legs: [
    {
      positionSide: "SHORT",
      filledQty: 9,
      ownerOpenQty: 9,
      entryOrders: [],
      protectionReservations: [
        { reservationId: "TP_S_1", clientOrderId: "TP_S_CID", type: "TP", status: "ACTIVE" },
        { reservationId: "STOP_S_1", clientOrderId: "STOP_S_CID", type: "STOP", status: "ACTIVE" },
      ],
    },
  ],
});
assert.strictEqual(shortProtection.protectionCancelCandidates.length, 2, "short filled active TP/STOP protection cancel");

const mixed = queue.buildGridExitChildCancelPlan(parentCandidate, {
  ...baseSnapshot,
  legs: [
    {
      positionSide: "LONG",
      filledQty: 12,
      ownerOpenQty: 12,
      entryOrders: [],
      protectionReservations: [{ reservationId: "TP_L_2", type: "TP", status: "ACTIVE" }],
    },
    {
      positionSide: "SHORT",
      filledQty: 0,
      ownerOpenQty: 0,
      entryOrders: [{ clientOrderId: "ENTRY_S_2", status: "NEW", role: "ENTRY", open: true }],
      protectionReservations: [],
    },
  ],
});
assert.strictEqual(mixed.entryCancelCandidates.length, 1, "filled leg + resting opposite entry creates entry cancel");
assert.strictEqual(mixed.protectionCancelCandidates.length, 1, "filled leg + resting opposite entry creates protection cancel");

const dualSide = queue.buildGridExitChildCancelPlan(parentCandidate, {
  ...baseSnapshot,
  legs: [
    {
      positionSide: "LONG",
      ownerOpenQty: 10,
      protectionReservations: [
        { reservationId: "TP_L_3", type: "TP", status: "ACTIVE" },
        { reservationId: "STOP_L_3", type: "STOP", status: "ACTIVE" },
      ],
    },
    {
      positionSide: "SHORT",
      ownerOpenQty: 10,
      protectionReservations: [
        { reservationId: "TP_S_3", type: "TP", status: "ACTIVE" },
        { reservationId: "STOP_S_3", type: "STOP", status: "ACTIVE" },
      ],
    },
  ],
});
assert.strictEqual(dualSide.protectionCancelCandidates.length, 4, "dual-side filled creates per-leg protection cancel");
assert.strictEqual(dualSide.marketCloseCandidates.length, 0, "ownerOpenQty does not create market close candidate");

const keyless = queue.buildGridExitChildCancelPlan(
  { ...parentCandidate, gridRegimeKey: "", parentState: queue.GRID_EXIT_PARENT_STATE.USER_ACTION_REQUIRED },
  baseSnapshot
);
assert.strictEqual(keyless.entryCancelCandidates.length, 0, "keyless no entry child");
assert.strictEqual(keyless.protectionCancelCandidates.length, 0, "keyless no protection child");
assert.strictEqual(keyless.userActionRequired.length, 1, "keyless user-action-required");

const terminal = queue.buildGridExitChildCancelPlan(parentCandidate, { ...baseSnapshot, terminal: true });
assert.strictEqual(terminal.entryCancelCandidates.length + terminal.protectionCancelCandidates.length, 0, "terminal no child");
const disabled = queue.buildGridExitChildCancelPlan(parentCandidate, { ...baseSnapshot, enabled: false });
assert.strictEqual(disabled.entryCancelCandidates.length + disabled.protectionCancelCandidates.length, 0, "disabled no child");
const candleClose = queue.buildGridExitChildCancelPlan(
  { ...parentCandidate, reason: "GRID_CANDLE_CLOSE_LEGACY_DISABLED_AUDIT" },
  noFilledRestingEntriesSnapshot
);
assert.strictEqual(candleClose.entryCancelCandidates.length + candleClose.protectionCancelCandidates.length, 0, "candle close no child");

const pidA = queue.buildGridExitChildCancelPlan(parentCandidate, noFilledRestingEntriesSnapshot);
const pidB = queue.buildGridExitChildCancelPlan({ ...parentCandidate, pid: 502 }, { ...noFilledRestingEntriesSnapshot, pid: 502 });
assert.notStrictEqual(pidA.entryCancelCandidates[0].intentKey, pidB.entryCancelCandidates[0].intentKey, "same key multi-PID separate plans");

const wrongKey = queue.buildGridExitChildCancelPlan(
  { ...parentCandidate, reason: "GRID_EXIT_KEY_MISMATCH" },
  noFilledRestingEntries
);
assert.strictEqual(wrongKey.entryCancelCandidates.length, 0, "same symbol wrong key untouched");

const childKey = mixed.entryCancelCandidates[0].intentKey;
for (const token of [
  queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL,
  parentCandidate.intentKey,
  "156",
  "501",
  "REGIME_A",
  "MEAN_REVERT_GRID",
  "ADAUSDT",
  "10MIN",
  "SHORT",
  "ENTRY",
  "ENTRY_S_2",
]) {
  assert.ok(childKey.includes(token), `child key includes ${token}`);
}

const duplicatePlan = queue.buildGridExitChildCancelPlan(parentCandidate, {
  ...baseSnapshot,
  legs: [
    {
      positionSide: "LONG",
      entryOrders: [
        { clientOrderId: "DUP_ENTRY", status: "NEW", role: "ENTRY", open: true },
        { clientOrderId: "DUP_ENTRY", status: "OPEN", role: "ENTRY", open: true },
      ],
    },
  ],
});
assert.strictEqual(duplicatePlan.entryCancelCandidates.length, 1, "duplicate child candidate deduped by natural key");

const entryCancelCandidate = mixed.entryCancelCandidates[0];
const protectionTpCandidate = longProtection.protectionCancelCandidates.find((item) => item.orderRole === "TP");
const protectionStopCandidate = longProtection.protectionCancelCandidates.find((item) => item.orderRole === "STOP");

assert.deepStrictEqual(
  queue.classifyGridExitCancelRaceEvent(entryCancelCandidate, {
    role: "ENTRY",
    status: "CANCELED",
    executionType: "CANCELED",
  }).raceType,
  "CANCEL_ACK_ONLY_NOT_TERMINAL",
  "cancel ack only not terminal"
);
assert.strictEqual(
  queue.classifyGridExitCancelRaceEvent(entryCancelCandidate, {
    role: "ENTRY",
    status: "FILLED",
    executionType: "TRADE",
    executedQty: 1,
    tradeId: "TRADE_ENTRY",
  }).raceType,
  "ENTRY_FILL_DURING_CANCEL",
  "entry fill during cancel race detected"
);
assert.strictEqual(
  queue.classifyGridExitCancelRaceEvent(protectionTpCandidate, {
    role: "TP",
    status: "FILLED",
    executionType: "TRADE",
    executedQty: 1,
  }).raceType,
  "TP_FILL_DURING_PROTECTION_CANCEL",
  "TP fill during protection cancel race detected"
);
assert.strictEqual(
  queue.classifyGridExitCancelRaceEvent(protectionStopCandidate, {
    role: "STOP",
    status: "FILLED",
    executionType: "TRADE",
    executedQty: 1,
  }).raceType,
  "STOP_FILL_DURING_PROTECTION_CANCEL",
  "STOP fill during protection cancel race detected"
);
const partial = queue.classifyGridExitCancelRaceEvent(entryCancelCandidate, {
  role: "ENTRY",
  status: "PARTIALLY_FILLED",
  executedQty: 0.5,
  sourceTradeId: "SOURCE_TRADE_PARTIAL",
});
assert.strictEqual(partial.raceType, "PARTIAL_FILL_NOT_TERMINAL", "partial fill not terminal");
assert.strictEqual(partial.terminal, false, "partial fill terminal false");
assert.strictEqual(partial.ledgerMutation, false, "race detector does not mutate ledger");
assert.strictEqual(partial.sourceTradeId, "SOURCE_TRADE_PARTIAL", "sourceTradeId preserved");

const guardStart = workerSource.indexOf("const processGridExitChildCancelIntent");
const guardEnd = workerSource.indexOf("const processIntent", guardStart);
assert.ok(guardStart > 0 && guardEnd > guardStart, "worker child cancel guard exists");
const guardSource = workerSource.slice(guardStart, guardEnd);
assert.ok(
  guardSource.includes("GRID_EXIT_CHILD_CANCEL_QUEUE_STATE.BLOCKED_NOT_IMPLEMENTED") &&
    workerSource.includes('BLOCKED_NOT_IMPLEMENTED: "GRID_EXIT_CHILD_CANCEL_WORKER_BLOCKED_NOT_IMPLEMENTED"'),
  "child guard blocked-not-implemented"
);
assert.ok(guardSource.includes("status: orderIntentQueue.STATUS.BLOCKED"), "child guard blocks");
assert.ok(guardSource.includes("cancelCalled: false"), "child guard reports no cancel");
assert.ok(guardSource.includes("closeCalled: false"), "child guard reports no close");
assert.ok(guardSource.includes("marketCloseIntentCreated: false"), "child guard reports no market close child");
assert.ok(!/STATUS\.DONE|cancelGridOrders|closeGridLegMarketOrder|enqueueGridCancelIntent|enqueueGridCloseIntent|GRID_EXIT_CONVERGED|CLOSE_CONVERGED|require\(["']\.\/coin["']\)/.test(guardSource),
  "worker child guard does not call cancel/close/child/DONE/converged");

assert.strictEqual(dbMutation, 0, "no DB mutation invoked");
assert.strictEqual(binanceWrite, 0, "no Binance write path invoked");

console.log(JSON.stringify({
  ok: true,
  tests: 31,
  dbMutation,
  binanceWrite,
  entryType: queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL,
  protectionType: queue.INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL,
}));
