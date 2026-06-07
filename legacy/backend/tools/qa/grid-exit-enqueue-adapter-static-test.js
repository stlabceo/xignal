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

const payload = {
  eventType: "GRID_EXIT",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT.P",
  timeframe: "10min",
  gridRegimeKey: "REGIME_A",
  signalTime: "2026-06-05T12:10:00",
};
const target = {
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
  previewResult: { targetItems: [target] },
}).candidates[0];
const runtimeSnapshot = {
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
      ownerOpenQty: 8,
      protectionReservations: [
        { reservationId: "TP_L_1", clientOrderId: "TP_L_CID", type: "TP", status: "ACTIVE" },
        { reservationId: "STOP_L_1", clientOrderId: "STOP_L_CID", type: "STOP", status: "ACTIVE" },
      ],
    },
    {
      positionSide: "SHORT",
      entryOrders: [{ clientOrderId: "ENTRY_S_1", orderId: "2002", status: "NEW", role: "ENTRY", open: true }],
    },
  ],
};
const childPlan = queue.buildGridExitChildCancelPlan(parentCandidate, runtimeSnapshot);
const queueJoinPlan = queue.buildGridExitQueueJoinPlan({
  parentCandidate,
  childCancelPlan: childPlan,
  existingIntentRows: [],
  mode: "DRY_RUN",
});

assert.strictEqual(
  JSON.stringify(queue.GRID_EXIT_ENQUEUE_ADAPTER_ALLOWED_MODES),
  JSON.stringify(["OFF", "DRY_RUN", "MOCK_ONLY"]),
  "adapter supports OFF/DRY_RUN/MOCK_ONLY only"
);
for (const rejected of ["ENQUEUE", "LIVE", "DB_WRITE"]) {
  assert.strictEqual(queue.normalizeGridExitEnqueueAdapterMode(rejected).ok, false, `${rejected} rejected`);
}
assert.strictEqual(queue.normalizeGridExitEnqueueAdapterMode().mode, "OFF", "default mode OFF");

const offPlan = queue.buildGridExitEnqueueAdapterPlan({ queueJoinPlan, mode: "OFF" });
assert.strictEqual(offPlan.result, queue.GRID_EXIT_ENQUEUE_ADAPTER_STATE.DISABLED, "OFF disabled");
assert.strictEqual(offPlan.repositoryWritesEnabled, false, "OFF no repo writes");
assert.strictEqual(offPlan.writesPlanned.length, 0, "OFF no writes planned");

const dryPlan = queue.buildGridExitEnqueueAdapterPlan({ queueJoinPlan, mode: "DRY_RUN" });
assert.strictEqual(dryPlan.result, queue.GRID_EXIT_ENQUEUE_ADAPTER_STATE.DRY_RUN_ONLY, "DRY_RUN only");
assert.strictEqual(dryPlan.repositoryWritesEnabled, false, "DRY_RUN no repo writes");
assert.strictEqual(dryPlan.writesPlanned.length, 0, "DRY_RUN no writes planned");
assert.ok(dryPlan.dryRunWritesPlanned.length >= 2, "DRY_RUN can preview rows");

(async () => {
  const repo = queue.createGridExitMockRepository();
  const mockResult = await queue.enqueueGridExitPlanWithRepository({
    queueJoinPlan,
    repository: repo,
    mode: "MOCK_ONLY",
    now: new Date("2026-06-05T12:30:00Z"),
  });
  assert.strictEqual(mockResult.result, queue.GRID_EXIT_ENQUEUE_ADAPTER_STATE.MOCK_COMMITTED, "MOCK_ONLY mock committed");
  assert.ok(mockResult.writes.length >= 2, "MOCK_ONLY writes parent then children");
  assert.strictEqual(mockResult.writes[0].intentType, queue.INTENT_TYPE.GRID_EXIT_REQUEST, "parent first");
  for (const row of mockResult.writes) {
    assert.strictEqual(row.status, queue.STATUS.BLOCKED, "mock row status BLOCKED");
    assert.ok(!/DONE|SUCCESS|CONVERGED/.test(row.status), "mock row not terminal success");
    const resultJson = JSON.parse(row.resultJson);
    assert.strictEqual(resultJson.executable, false, "resultJson non executable");
    assert.strictEqual(resultJson.reason, "GRID_EXIT_ORCHESTRATOR_NOT_IMPLEMENTED", "blocked/not executable reason");
    assert.ok(!/GRID_EXIT_CONVERGED|CLOSE_CONVERGED|SUCCESS/.test(row.resultJson), "resultJson no converged/success");
  }
  assert.strictEqual(
    JSON.stringify(repo.getEvents().slice(0, 2)),
    JSON.stringify(["begin", `insert:${mockResult.writes[0].intentType}:${mockResult.writes[0].intentKey}`]),
    "begin then parent insert"
  );
  assert.strictEqual(repo.getEvents()[repo.getEvents().length - 1], "commit", "commit after all writes succeed");

  const duplicateParentPlan = queue.buildGridExitQueueJoinPlan({
    parentCandidate,
    childCancelPlan: childPlan,
    existingIntentRows: [{
      id: 99,
      intentType: queue.INTENT_TYPE.GRID_EXIT_REQUEST,
      intentKey: parentCandidate.intentKey,
      status: "PENDING",
    }],
  });
  const duplicateParentResult = await queue.enqueueGridExitPlanWithRepository({
    queueJoinPlan: duplicateParentPlan,
    repository: queue.createGridExitMockRepository(),
    mode: "MOCK_ONLY",
  });
  assert.strictEqual(duplicateParentResult.writes.some((row) => row.intentType === queue.INTENT_TYPE.GRID_EXIT_REQUEST), false, "parent duplicate in-flight no new parent write");

  const duplicateConvergedPlan = queue.buildGridExitQueueJoinPlan({
    parentCandidate,
    childCancelPlan: childPlan,
    existingIntentRows: [{
      id: 100,
      intentType: queue.INTENT_TYPE.GRID_EXIT_REQUEST,
      intentKey: parentCandidate.intentKey,
      status: "DONE",
      result: { projectionState: "GRID_EXIT_CONVERGED" },
    }],
  });
  const duplicateConvergedResult = await queue.enqueueGridExitPlanWithRepository({
    queueJoinPlan: duplicateConvergedPlan,
    repository: queue.createGridExitMockRepository(),
    mode: "MOCK_ONLY",
  });
  assert.strictEqual(duplicateConvergedResult.writes.length, 0, "parent duplicate converged no-op no write");

  const duplicateChildPlan = queue.buildGridExitQueueJoinPlan({
    parentCandidate,
    childCancelPlan: childPlan,
    existingIntentRows: [{
      id: 101,
      intentType: queueJoinPlan.childRowCandidates[0].intentType,
      intentKey: queueJoinPlan.childRowCandidates[0].childNaturalKey,
      status: "RUNNING",
    }],
  });
  const duplicateChildResult = await queue.enqueueGridExitPlanWithRepository({
    queueJoinPlan: duplicateChildPlan,
    repository: queue.createGridExitMockRepository(),
    mode: "MOCK_ONLY",
  });
  assert.strictEqual(duplicateChildResult.writes.some((row) => row.intentKey === queueJoinPlan.childRowCandidates[0].childNaturalKey), false, "child duplicate in-flight no new child write");

  const childFailRepo = queue.createGridExitMockRepository({ failOnInsertIndex: 1 });
  const childFail = await queue.enqueueGridExitPlanWithRepository({
    queueJoinPlan,
    repository: childFailRepo,
    mode: "MOCK_ONLY",
  });
  assert.strictEqual(childFail.result, queue.GRID_EXIT_ENQUEUE_ADAPTER_STATE.MOCK_ROLLED_BACK, "child insert failure rollback");
  assert.strictEqual(childFail.writes.length, 0, "rollback leaves writes empty");
  assert.strictEqual(childFailRepo.getEvents().includes("rollback"), true, "rollback event recorded");

  const parentFailRepo = queue.createGridExitMockRepository({ failOnInsertIndex: 0 });
  const parentFail = await queue.enqueueGridExitPlanWithRepository({
    queueJoinPlan,
    repository: parentFailRepo,
    mode: "MOCK_ONLY",
  });
  assert.strictEqual(parentFail.result, queue.GRID_EXIT_ENQUEUE_ADAPTER_STATE.MOCK_ROLLED_BACK, "parent insert failure rollback");
  assert.strictEqual(parentFail.writes.length, 0, "parent rollback leaves writes empty");

  const parentB = queue.buildGridExitParentIntentCandidates({
    payload,
    previewResult: { targetItems: [{ ...target, pid: 502 }] },
  }).candidates[0];
  const planB = queue.buildGridExitQueueJoinPlan({
    parentCandidate: parentB,
    childCancelPlan: queue.buildGridExitChildCancelPlan(parentB, { ...runtimeSnapshot, pid: 502 }),
  });
  const multiA = await queue.enqueueGridExitPlanWithRepository({
    queueJoinPlan,
    repository: queue.createGridExitMockRepository(),
    mode: "MOCK_ONLY",
  });
  const multiB = await queue.enqueueGridExitPlanWithRepository({
    queueJoinPlan: planB,
    repository: queue.createGridExitMockRepository(),
    mode: "MOCK_ONLY",
  });
  assert.notStrictEqual(multiA.writes[0].intentKey, multiB.writes[0].intentKey, "same-key multi-PID separate parent writes");
  assert.notStrictEqual(
    multiA.writes.find((row) => row.intentType !== queue.INTENT_TYPE.GRID_EXIT_REQUEST)?.intentKey,
    multiB.writes.find((row) => row.intentType !== queue.INTENT_TYPE.GRID_EXIT_REQUEST)?.intentKey,
    "same symbol/side different PID not deduped"
  );

  const keylessPreview = queue.buildGridExitParentIntentCandidates({
    payload,
    previewResult: { targetItems: [{ ...target, resultCode: "GRID_EXIT_ROW_KEY_MISSING" }] },
  });
  assert.strictEqual(keylessPreview.requested, 0, "keyless target produces no parent");

  const candlePreview = queue.buildGridExitParentIntentCandidates({
    payload: { ...payload, eventType: "GRID_CANDLE_CLOSE_BREAKOUT" },
    previewResult: { targetItems: [{ ...target, resultCode: "GRID_CANDLE_CLOSE_LEGACY_DISABLED_AUDIT" }] },
  });
  assert.strictEqual(candlePreview.requested, 0, "candle close legacy produces no write");

  const noChildPlan = queue.buildGridExitQueueJoinPlan({
    parentCandidate,
    childCancelPlan: { entryCancelCandidates: [], protectionCancelCandidates: [] },
  });
  const noChild = await queue.enqueueGridExitPlanWithRepository({
    queueJoinPlan: noChildPlan,
    repository: queue.createGridExitMockRepository(),
    mode: "MOCK_ONLY",
  });
  assert.strictEqual(JSON.parse(noChild.writes[0].resultJson).terminalSuccess, false, "no child candidate does not mark parent success");

  assert.ok(routeSource.includes("GRID_EXIT_ENQUEUE_ADAPTER_MODE"), "route has adapter mode flag");
  assert.ok(routeSource.includes("enqueueAdapter"), "route exposes adapter summary");
  assert.ok(routeSource.includes("mockOnlyAllowedInRoute: false"), "live route does not use MOCK_ONLY");
  assert.ok(routeSource.includes("enqueueEnabled: false"), "route default does not enqueue");
  assert.ok(!/enqueueGridExit/i.test(routeSource), "route has no live GRID_EXIT enqueue");

  const parentGuardStart = workerSource.indexOf("const processGridExitRequestIntent");
  const parentGuardEnd = workerSource.indexOf("const processGridExitChildCancelIntent", parentGuardStart);
  const childGuardStart = workerSource.indexOf("const processGridExitChildCancelIntent");
  const childGuardEnd = workerSource.indexOf("const processIntent", childGuardStart);
  assert.ok(parentGuardStart > 0 && parentGuardEnd > parentGuardStart, "worker GRID_EXIT_REQUEST still blocked");
  assert.ok(childGuardStart > 0 && childGuardEnd > childGuardStart, "worker child cancel still blocked");
  const guards = workerSource.slice(parentGuardStart, parentGuardEnd) + workerSource.slice(childGuardStart, childGuardEnd);
  assert.ok(guards.includes("status: orderIntentQueue.STATUS.BLOCKED"), "worker guards block");
  assert.ok(!/cancelGridOrders|closeGridLegMarketOrder|STATUS\.DONE|GRID_EXIT_CONVERGED|CLOSE_CONVERGED|require\(["']\.\/coin["']\)/.test(guards),
    "worker does not call cancel/close/success");

  assert.strictEqual(dbMutation, 0, "no actual DB insert/update/delete");
  assert.strictEqual(binanceWrite, 0, "no Binance write path invoked");

  console.log(JSON.stringify({
    ok: true,
    tests: 32,
    dbMutation,
    binanceWrite,
    modes: queue.GRID_EXIT_ENQUEUE_ADAPTER_ALLOWED_MODES,
  }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
