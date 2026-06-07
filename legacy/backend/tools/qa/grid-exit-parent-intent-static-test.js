"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "../../..");
const queueSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-queue.js"), "utf8");
const workerSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-worker.js"), "utf8");
const routeSource = fs.readFileSync(path.resolve(repoRoot, "backend/routes/users.js"), "utf8");

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
      if (request === "crypto") {
        return require("crypto");
      }
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

const payload = {
  eventType: "GRID_EXIT",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT.P",
  timeframe: "10min",
  gridRegimeKey: "GRIDREGIME|v1|MEAN_REVERT_GRID|ADAUSDT|10MIN|1.1987|1.2345|1.2166|2026-06-05T12:00:00",
  signalTime: "2026-06-05T12:10:00",
};
const targetA = {
  uid: 156,
  pid: 5,
  strategyCategory: "grid",
  strategyMode: "live",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT",
  bunbong: "10MIN",
  resultCode: "GRID_EXIT_ALERT_PREVIEW",
};
const targetB = { ...targetA, pid: 6 };

assert.strictEqual(queue.INTENT_TYPE.GRID_EXIT_REQUEST, "GRID_EXIT_REQUEST", "GRID_EXIT_REQUEST type exists");

const keyA = queue.buildGridExitParentIntentKey({ payload, targetItem: targetA });
assert.ok(keyA.includes("GRID_EXIT_REQUEST"), "key includes intent type");
assert.ok(keyA.includes("156"), "key includes uid");
assert.ok(keyA.includes("5"), "key includes pid");
assert.ok(keyA.includes("MEAN_REVERT_GRID"), "key includes strategySignal");
assert.ok(keyA.includes("ADAUSDT"), "key includes symbol");
assert.ok(keyA.includes("10MIN"), "key includes timeframe");
assert.ok(keyA.includes(payload.gridRegimeKey), "key includes gridRegimeKey");

const multiPid = queue.buildGridExitParentIntentCandidates({
  payload,
  previewResult: { targetItems: [targetA, targetB] },
});
assert.strictEqual(multiPid.requested, 2, "same key multi-PID creates two parent candidates");
assert.notStrictEqual(multiPid.candidates[0].intentKey, multiPid.candidates[1].intentKey, "PID separates parent key");

const duplicateInFlight = queue.evaluateGridExitParentDuplicate({
  candidate: multiPid.candidates[0],
  existingIntent: { id: 11, status: "PENDING" },
});
assert.strictEqual(duplicateInFlight.createParent, false, "in-flight duplicate does not create parent");
assert.strictEqual(duplicateInFlight.duplicateState, queue.GRID_EXIT_PARENT_STATE.DUPLICATE_IN_FLIGHT);

const duplicateConverged = queue.evaluateGridExitParentDuplicate({
  candidate: multiPid.candidates[0],
  existingIntent: { id: 12, status: "DONE", result: { projectionState: "GRID_EXIT_CONVERGED" } },
});
assert.strictEqual(duplicateConverged.createParent, false, "converged duplicate no-op");
assert.strictEqual(duplicateConverged.duplicateState, queue.GRID_EXIT_PARENT_STATE.DUPLICATE_CONVERGED_NOOP);

const wrongKey = queue.buildGridExitParentIntentCandidates({
  payload,
  previewResult: { targetItems: [{ ...targetA, resultCode: "GRID_EXIT_KEY_MISMATCH" }] },
});
assert.strictEqual(wrongKey.requested, 0, "same symbol/side wrong key creates no parent");

const wrongSignal = queue.buildGridExitParentIntentCandidates({
  payload,
  previewResult: { targetItems: [{ ...targetA, resultCode: "GRID_EXIT_SIGNAL_MISMATCH" }] },
});
assert.strictEqual(wrongSignal.requested, 0, "wrong strategySignal creates no parent");

const terminalDisabled = queue.buildGridExitParentIntentCandidates({
  payload,
  previewResult: { targetItems: [{ ...targetA, resultCode: "GRID_EXIT_NO_ACTIVE_REGIME" }] },
});
assert.strictEqual(terminalDisabled.requested, 0, "terminal/disabled target excluded from parent creation");

const keyless = queue.buildGridExitParentIntentCandidates({
  payload,
  previewResult: { targetItems: [{ ...targetA, resultCode: "GRID_EXIT_ROW_KEY_MISSING" }] },
});
assert.strictEqual(keyless.requested, 0, "keyless target creates no broad fallback parent");
assert.strictEqual(keyless.userActionRequired, 1, "keyless active regime is user-action-required candidate");
assert.strictEqual(keyless.candidates[0].parentState, queue.GRID_EXIT_PARENT_STATE.USER_ACTION_REQUIRED);

const candleClose = queue.buildGridExitParentIntentCandidates({
  payload: { ...payload, eventType: "GRID_CANDLE_CLOSE_BREAKOUT" },
  previewResult: { targetItems: [{ ...targetA, resultCode: "GRID_CANDLE_CLOSE_LEGACY_DISABLED_AUDIT" }] },
});
assert.strictEqual(candleClose.requested, 0, "GRID_CANDLE_CLOSE_BREAKOUT does not create parent");

assert.ok(
  routeSource.includes("CANDLE_CLOSE_AUDIT_NO_PARENT"),
  "route keeps legacy candle close parent-enqueue disabled"
);
assert.ok(
  routeSource.includes("buildGridExitParentIntentCandidates"),
  "route exposes dry-run parent candidate summary"
);
assert.ok(!/enqueueGridExit/i.test(routeSource), "route does not contain live GRID_EXIT parent enqueue");

const guardStart = workerSource.indexOf("const processGridExitRequestIntent");
const guardEnd = workerSource.indexOf("const processIntent", guardStart);
assert.ok(guardStart > 0 && guardEnd > guardStart, "worker GRID_EXIT_REQUEST guard exists");
const guardSource = workerSource.slice(guardStart, guardEnd);
assert.ok(
  guardSource.includes("GRID_EXIT_PARENT_QUEUE_STATE.ORCHESTRATOR_DISABLED") &&
    workerSource.includes('ORCHESTRATOR_DISABLED: "GRID_EXIT_ORCHESTRATOR_DISABLED"'),
  "orchestrator disabled guard present"
);
assert.ok(
  guardSource.includes("GRID_EXIT_PARENT_QUEUE_STATE.BLOCKED_NOT_IMPLEMENTED") &&
    workerSource.includes('BLOCKED_NOT_IMPLEMENTED: "GRID_EXIT_PARENT_BLOCKED_NOT_IMPLEMENTED"'),
  "not-implemented guard present"
);
assert.ok(guardSource.includes("status: orderIntentQueue.STATUS.BLOCKED"), "worker blocks parent intent");
assert.ok(guardSource.includes("childIntentCreated: false"), "worker reports no child intent");
assert.ok(guardSource.includes("marketCloseCalled: false"), "worker reports no market close");
assert.ok(guardSource.includes("closeConverged: false"), "worker does not report close convergence");
assert.ok(!/STATUS\.DONE|cancelGridOrders|closeGridLegMarketOrder|enqueueGridCancelIntent|enqueueGridCloseIntent|require\(["']\.\/coin["']\)/.test(guardSource),
  "worker guard does not call cancel/close/child/DONE success");

assert.strictEqual(dbMutation, 0, "no DB mutation invoked");
assert.strictEqual(binanceWrite, 0, "no Binance write path invoked");

console.log(JSON.stringify({
  ok: true,
  tests: 22,
  dbMutation,
  binanceWrite,
  intentType: queue.INTENT_TYPE.GRID_EXIT_REQUEST,
}));
