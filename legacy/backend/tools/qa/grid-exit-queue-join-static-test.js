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
const schemaColumns = [
  "id",
  "intentKey",
  "fifoKey",
  "uid",
  "pid",
  "strategyCategory",
  "intentType",
  "status",
  "priority",
  "attemptCount",
  "maxAttempts",
  "routePath",
  "sourceEventId",
  "payloadHash",
  "payloadJson",
  "resultJson",
];

const payload = {
  eventType: "GRID_EXIT",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT.P",
  timeframe: "10min",
  gridRegimeKey: "REGIME_A",
  signalTime: "2026-06-05T12:10:00",
};
const targetA = {
  uid: 156,
  pid: 501,
  strategyCategory: "grid",
  strategyMode: "live",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT",
  bunbong: "10MIN",
  resultCode: "GRID_EXIT_ALERT_PREVIEW",
};
const parentCandidate = queue.buildGridExitParentIntentCandidates({
  payload,
  previewResult: { targetItems: [targetA] },
}).candidates[0];
const snapshot = {
  uid: 156,
  pid: 501,
  gridRegimeKey: "REGIME_A",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT",
  timeframe: "10MIN",
  enabled: true,
  terminal: false,
  legs: [
    {
      positionSide: "LONG",
      filledQty: 10,
      ownerOpenQty: 10,
      entryOrders: [],
      protectionReservations: [
        { reservationId: "TP_L_1", clientOrderId: "TP_L_CID", type: "TP", status: "ACTIVE" },
        { reservationId: "STOP_L_1", clientOrderId: "STOP_L_CID", type: "STOP", status: "ACTIVE" },
      ],
    },
    {
      positionSide: "SHORT",
      filledQty: 0,
      ownerOpenQty: 0,
      entryOrders: [{ clientOrderId: "ENTRY_S_1", orderId: "2002", status: "NEW", role: "ENTRY", open: true }],
      protectionReservations: [],
    },
  ],
};
const childPlan = queue.buildGridExitChildCancelPlan(parentCandidate, snapshot);
const plan = queue.buildGridExitQueueJoinPlan({
  parentCandidate,
  childCancelPlan: childPlan,
  existingIntentRows: [],
  mode: "DRY_RUN",
  schemaColumns,
});

assert.strictEqual(queue.validateGridExitQueueJoinSchema(schemaColumns).ok, true, "queue schema introspection shape ok");
assert.strictEqual(
  queue.validateGridExitQueueJoinSchema(["intentKey"]).ok,
  false,
  "schema gap handled"
);

assert.strictEqual(plan.parentRowCandidate.intentType, queue.INTENT_TYPE.GRID_EXIT_REQUEST, "parent row GRID_EXIT_REQUEST");
assert.strictEqual(plan.parentRowCandidate.parentNaturalKey, parentCandidate.intentKey, "parent natural key equals Phase 2A contract");
assert.strictEqual(plan.parentRowCandidate.idempotencyKey, parentCandidate.intentKey, "parent idempotency key");
assert.strictEqual(plan.parentRowCandidate.uid, 156, "parent uid present");
assert.strictEqual(plan.parentRowCandidate.pid, 501, "parent pid present");
assert.strictEqual(plan.parentRowCandidate.status, queue.STATUS.BLOCKED, "parent dry-run row not success");
assert.strictEqual(plan.parentRowCandidate.result.terminalSuccess, false, "parent not terminal success");

assert.ok(plan.childRowCandidates.length > 0, "child row candidates exist");
for (const child of plan.childRowCandidates) {
  assert.strictEqual(child.parentNaturalKey, parentCandidate.intentKey, "child preserves parentNaturalKey");
  assert.ok(child.childNaturalKey, "child preserves childNaturalKey");
  assert.strictEqual(child.uid, 156, "child uid present");
  assert.strictEqual(child.pid, 501, "child pid present");
  assert.strictEqual(child.gridRegimeKey, "REGIME_A", "child gridRegimeKey present");
  assert.strictEqual(child.result.terminalSuccess, false, "child not terminal success");
  assert.strictEqual(child.createRow, true, "child row candidate can be represented");
}

const parentB = queue.buildGridExitParentIntentCandidates({
  payload,
  previewResult: { targetItems: [{ ...targetA, pid: 502 }] },
}).candidates[0];
const planB = queue.buildGridExitQueueJoinPlan({
  parentCandidate: parentB,
  childCancelPlan: queue.buildGridExitChildCancelPlan(parentB, { ...snapshot, pid: 502 }),
  existingIntentRows: [],
  schemaColumns,
});
assert.notStrictEqual(plan.parentRowCandidate.parentNaturalKey, planB.parentRowCandidate.parentNaturalKey, "same-key multi-PID separate parent row");
assert.notStrictEqual(plan.childRowCandidates[0].childNaturalKey, planB.childRowCandidates[0].childNaturalKey, "same symbol/side different PID child not deduped");

const duplicateParentInFlight = queue.buildGridExitQueueJoinPlan({
  parentCandidate,
  childCancelPlan: childPlan,
  existingIntentRows: [{ id: 71, intentType: queue.INTENT_TYPE.GRID_EXIT_REQUEST, intentKey: parentCandidate.intentKey, status: "PENDING" }],
  schemaColumns,
});
assert.strictEqual(duplicateParentInFlight.parentRowCandidate.createRow, false, "duplicate parent in-flight no new parent");
assert.strictEqual(duplicateParentInFlight.duplicateParents[0].state, queue.GRID_EXIT_QUEUE_JOIN_STATE.DUPLICATE_IN_FLIGHT_JOINED, "duplicate parent joins existing");

const duplicateParentConverged = queue.buildGridExitQueueJoinPlan({
  parentCandidate,
  childCancelPlan: childPlan,
  existingIntentRows: [{
    id: 72,
    intentType: queue.INTENT_TYPE.GRID_EXIT_REQUEST,
    intentKey: parentCandidate.intentKey,
    status: "DONE",
    result: { projectionState: "GRID_EXIT_CONVERGED" },
  }],
  schemaColumns,
});
assert.strictEqual(duplicateParentConverged.parentRowCandidate.createRow, false, "duplicate parent after converged no new parent");
assert.strictEqual(duplicateParentConverged.duplicateParents[0].state, queue.GRID_EXIT_QUEUE_JOIN_STATE.DUPLICATE_CONVERGED_NOOP, "duplicate converged no-op audit");
assert.strictEqual(duplicateParentConverged.reducerResult.terminalSuccess, false, "duplicate converged no-op is not success result");

const duplicateChild = queue.buildGridExitQueueJoinPlan({
  parentCandidate,
  childCancelPlan: childPlan,
  existingIntentRows: [{
    id: 73,
    intentType: plan.childRowCandidates[0].intentType,
    intentKey: plan.childRowCandidates[0].childNaturalKey,
    status: "RUNNING",
  }],
  schemaColumns,
});
assert.strictEqual(duplicateChild.childRowCandidates[0].createRow, false, "duplicate child in-flight no new child");
assert.strictEqual(duplicateChild.duplicateChildren.length, 1, "duplicate child recorded");

const wrongKeyPreview = queue.buildGridExitParentIntentCandidates({
  payload,
  previewResult: { targetItems: [{ ...targetA, resultCode: "GRID_EXIT_KEY_MISMATCH" }] },
});
assert.strictEqual(wrongKeyPreview.requested, 0, "wrong gridRegimeKey no parent");
const keylessPreview = queue.buildGridExitParentIntentCandidates({
  payload,
  previewResult: { targetItems: [{ ...targetA, resultCode: "GRID_EXIT_ROW_KEY_MISSING" }] },
});
assert.strictEqual(keylessPreview.requested, 0, "keyless target no parent rows");
assert.strictEqual(keylessPreview.userActionRequired, 1, "keyless user action required");
const candlePreview = queue.buildGridExitParentIntentCandidates({
  payload: { ...payload, eventType: "GRID_CANDLE_CLOSE_BREAKOUT" },
  previewResult: { targetItems: [{ ...targetA, resultCode: "GRID_CANDLE_CLOSE_LEGACY_DISABLED_AUDIT" }] },
});
assert.strictEqual(candlePreview.requested, 0, "candle close no parent/child rows");

const entryOnlyPlan = queue.buildGridExitQueueJoinPlan({
  parentCandidate,
  childCancelPlan: queue.buildGridExitChildCancelPlan(parentCandidate, {
    ...snapshot,
    legs: [{ positionSide: "LONG", entryOrders: [{ clientOrderId: "ENTRY_L_ONLY", status: "NEW", role: "ENTRY", open: true }] }],
  }),
  schemaColumns,
});
assert.strictEqual(entryOnlyPlan.childRowCandidates.filter((item) => item.intentType === queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL).length, 1, "resting entry creates entry cancel row");
assert.strictEqual(entryOnlyPlan.childRowCandidates.filter((item) => item.intentType === queue.INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL).length, 0, "entry-only no protection row");

const longProtectionPlan = queue.buildGridExitQueueJoinPlan({
  parentCandidate,
  childCancelPlan: queue.buildGridExitChildCancelPlan(parentCandidate, {
    ...snapshot,
    legs: [{
      positionSide: "LONG",
      ownerOpenQty: 10,
      protectionReservations: [
        { reservationId: "TP_L_ONLY", type: "TP", status: "ACTIVE" },
        { reservationId: "STOP_L_ONLY", type: "STOP", status: "ACTIVE" },
      ],
    }],
  }),
  schemaColumns,
});
assert.strictEqual(longProtectionPlan.childRowCandidates.length, 2, "filled LONG + TP/STOP creates protection rows");

const shortProtectionPlan = queue.buildGridExitQueueJoinPlan({
  parentCandidate,
  childCancelPlan: queue.buildGridExitChildCancelPlan(parentCandidate, {
    ...snapshot,
    legs: [{
      positionSide: "SHORT",
      ownerOpenQty: 10,
      protectionReservations: [
        { reservationId: "TP_S_ONLY", type: "TP", status: "ACTIVE" },
        { reservationId: "STOP_S_ONLY", type: "STOP", status: "ACTIVE" },
      ],
    }],
  }),
  schemaColumns,
});
assert.strictEqual(shortProtectionPlan.childRowCandidates.length, 2, "filled SHORT + TP/STOP creates protection rows");
assert.strictEqual(shortProtectionPlan.forbidden.marketClose, false, "ownerOpenQty does not create market close child");
assert.strictEqual(shortProtectionPlan.childRowCandidates.some((item) => /MARKET_CLOSE/i.test(item.intentType)), false, "no market close child type");

assert.strictEqual(plan.reducerResult.state, queue.GRID_EXIT_QUEUE_JOIN_STATE.WAITING_CHILD_CANCEL_NOT_IMPLEMENTED, "reducer with children waits/not implemented");
assert.strictEqual(plan.reducerResult.terminalSuccess, false, "reducer with children not success");
const noChildPlan = queue.buildGridExitQueueJoinPlan({
  parentCandidate,
  childCancelPlan: { entryCancelCandidates: [], protectionCancelCandidates: [] },
  schemaColumns,
});
assert.strictEqual(noChildPlan.reducerResult.state, queue.GRID_EXIT_QUEUE_JOIN_STATE.NO_CHILD_CANCEL_REQUIRED_DRY_RUN, "reducer no child dry-run");
assert.strictEqual(noChildPlan.reducerResult.terminalSuccess, false, "reducer no child not success");
for (const state of [
  plan.reducerResult.state,
  noChildPlan.reducerResult.state,
  duplicateParentConverged.reducerResult.state,
]) {
  assert.ok(!/GRID_EXIT_CONVERGED|CLOSE_CONVERGED|DONE_NORMAL|DONE_CLOSE_SUCCESS/.test(state), "reducer never returns forbidden success state");
}

const cancelAckReducer = queue.reduceGridExitParentQueueJoinState(plan.parentRowCandidate, plan.childRowCandidates, [{
  role: "ENTRY",
  status: "CANCELED",
  executionType: "CANCELED",
}]);
assert.strictEqual(cancelAckReducer.terminalSuccess, false, "reducer CANCEL ACK observation not terminal");
const partialReducer = queue.reduceGridExitParentQueueJoinState(plan.parentRowCandidate, plan.childRowCandidates, [{
  role: "ENTRY",
  status: "PARTIALLY_FILLED",
  executedQty: 0.2,
}]);
assert.strictEqual(partialReducer.terminalSuccess, false, "reducer PARTIALLY_FILLED observation not terminal");

const parentGuardStart = workerSource.indexOf("const processGridExitRequestIntent");
const parentGuardEnd = workerSource.indexOf("const processGridExitChildCancelIntent", parentGuardStart);
assert.ok(parentGuardStart > 0 && parentGuardEnd > parentGuardStart, "worker GRID_EXIT_REQUEST guard exists");
const parentGuard = workerSource.slice(parentGuardStart, parentGuardEnd);
assert.ok(parentGuard.includes("status: orderIntentQueue.STATUS.BLOCKED"), "worker parent remains blocked");

const childGuardStart = workerSource.indexOf("const processGridExitChildCancelIntent");
const childGuardEnd = workerSource.indexOf("const processIntent", childGuardStart);
assert.ok(childGuardStart > 0 && childGuardEnd > childGuardStart, "worker child guard exists");
const childGuard = workerSource.slice(childGuardStart, childGuardEnd);
assert.ok(childGuard.includes("status: orderIntentQueue.STATUS.BLOCKED"), "worker child remains blocked");
assert.ok(!/cancelGridOrders|closeGridLegMarketOrder|STATUS\.DONE|GRID_EXIT_CONVERGED|CLOSE_CONVERGED|require\(["']\.\/coin["']\)/.test(parentGuard + childGuard),
  "worker guards do not call cancel/close/success");

assert.ok(routeSource.includes("GRID_EXIT_QUEUE_JOIN_MODE"), "route has queue join dry-run flag");
assert.ok(routeSource.includes("queueJoin"), "route exposes queue join summary");
assert.ok(routeSource.includes("enqueueEnabled: false"), "route default does not enqueue");
assert.ok(routeSource.includes("dbInsertEnabled: false"), "route dry-run summary does not insert");
assert.ok(!/enqueueGridExit/i.test(routeSource), "route has no GRID_EXIT enqueue mode");

assert.strictEqual(plan.forbidden.dbInsert, false, "no actual DB insert");
assert.strictEqual(plan.forbidden.dbUpdate, false, "no actual DB update");
assert.strictEqual(plan.forbidden.dbDelete, false, "no actual DB delete");
assert.strictEqual(plan.forbidden.binanceWrite, false, "no Binance write");
assert.strictEqual(dbMutation, 0, "no DB mutation invoked");
assert.strictEqual(binanceWrite, 0, "no Binance write path invoked");

console.log(JSON.stringify({
  ok: true,
  tests: 36,
  dbMutation,
  binanceWrite,
  parentType: queue.INTENT_TYPE.GRID_EXIT_REQUEST,
  childTypes: [queue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL, queue.INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL],
}));
