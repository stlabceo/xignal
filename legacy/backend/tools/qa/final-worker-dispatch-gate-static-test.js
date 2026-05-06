"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const db = require("../../database/connect/config");
const orderIntentQueue = require("../../order-intent-queue");
const orderIntentWorker = require("../../order-intent-worker");
const orderIntentDispatchGate = require("../../order-intent-dispatch-gate");
const cancelVerificationPolicy = require("../../cancel-verification-policy");
const binanceWriteGuard = require("../../binance-write-guard");
const binanceReadGuard = require("../../binance-read-guard");

const BASE_UID = 901301;
const redisReady = { set: () => {}, isOpen: true, isReady: true };
const LIVE_ENV = {
  BINANCE_LIVE_WRITES_ENABLED: "1",
  BINANCE_WRITE_APPROVAL: binanceWriteGuard.LIVE_WRITE_APPROVAL,
};
const FULL_DISPATCH_ENV = {
  ...LIVE_ENV,
  [orderIntentDispatchGate.ACTUAL_DISPATCH_ENV]: "1",
};

const buildIntent = (overrides = {}) => ({
  id: 1,
  uid: BASE_UID,
  pid: 9301,
  strategyCategory: "grid",
  intentType: orderIntentQueue.INTENT_TYPE.GRID_CANCEL_ORDER,
  fifoKey: `${BASE_UID}:grid:9301:regime:9301`,
  payload: {},
  ...overrides,
});

const buildGateContext = (overrides = {}) => ({
  intent: buildIntent(overrides.intent || {}),
  env: FULL_DISPATCH_ENV,
  redisClient: redisReady,
  dbEvaluation: { ok: true, fingerprint: { databaseName: "quantu_local" }, failures: [] },
  ownershipReadiness: { enabled: true, status: "OK", legacyDisabled: false },
  queueReady: true,
  readGuardSnapshot: { globalBlocked: false, uidBlocks: [] },
  timeSyncReady: true,
  ...overrides,
});

const buildPreview = ({ uid = BASE_UID, pid = 9301, symbol = "PUMPUSDT" } = {}) => ({
  targetItems: [
    {
      uid,
      pid,
      strategyCategory: "grid",
      strategyMode: "live",
      strategySignal: "SQZ+GRID",
      symbol,
      bunbong: "30MIN",
      resultCode: "GRID_ARM_PREVIEW",
    },
  ],
});

const buildPayload = () => ({
  strategySignal: "SQZ+GRID",
  symbol: "PUMPUSDT",
  bunbong: "30MIN",
  supportPrice: 1,
  resistancePrice: 2,
  triggerPrice: 1.5,
  signalTime: "2026-05-06T00:00:00Z",
});

(async () => {
  await orderIntentQueue.ensureOrderIntentSchema();
  await orderIntentQueue.deleteQaIntentsByUid(BASE_UID);
  binanceReadGuard.resetForTest();

  let gate = await orderIntentDispatchGate.evaluateWorkerActualDispatchGate({
    ...buildGateContext({ env: LIVE_ENV }),
  });
  assert.strictEqual(gate.allowed, false, "worker actual dispatch defaults fail-closed");
  assert.strictEqual(gate.reason, orderIntentDispatchGate.GATE_REASON.ACTUAL_DISPATCH_DISABLED);

  gate = await orderIntentDispatchGate.evaluateWorkerActualDispatchGate(buildGateContext());
  assert.strictEqual(gate.allowed, true, "all gates pass with explicit env/approval and mocked dependencies");

  gate = await orderIntentDispatchGate.evaluateWorkerActualDispatchGate(buildGateContext({ redisClient: null, redisReady: false }));
  assert.strictEqual(gate.allowed, false, "missing Redis blocks dispatch");
  assert.strictEqual(gate.reason, orderIntentDispatchGate.GATE_REASON.REDIS_UNAVAILABLE);

  gate = await orderIntentDispatchGate.evaluateWorkerActualDispatchGate(buildGateContext({
    ownershipReadiness: { enabled: false, status: "DISABLED", legacyDisabled: true },
  }));
  assert.strictEqual(gate.allowed, false, "missing ownership blocks dispatch");
  assert.strictEqual(gate.reason, orderIntentDispatchGate.GATE_REASON.OWNERSHIP_NOT_READY);

  gate = await orderIntentDispatchGate.evaluateWorkerActualDispatchGate(buildGateContext({
    env: { [orderIntentDispatchGate.ACTUAL_DISPATCH_ENV]: "1", BINANCE_LIVE_WRITES_ENABLED: "1" },
  }));
  assert.strictEqual(gate.allowed, false, "missing env approval blocks dispatch");
  assert.strictEqual(gate.reason, orderIntentDispatchGate.GATE_REASON.BINANCE_WRITE_GUARD_BLOCKED);

  const cancelVerified = cancelVerificationPolicy.classifyCancelVerification({
    cancelResponse: { ok: true },
    readResult: { openOrders: [] },
    target: { targetClientOrderId: "GENTRY_L_QA" },
  });
  assert.strictEqual(cancelVerified.state, cancelVerificationPolicy.CANCEL_VERIFY_STATE.VERIFIED_GONE);

  const cancel404Active = cancelVerificationPolicy.classifyCancelVerification({
    cancelResponse: { notFound: true },
    readResult: { openOrders: [{ clientOrderId: "GENTRY_L_QA", status: "NEW" }] },
    target: { targetClientOrderId: "GENTRY_L_QA" },
  });
  assert.strictEqual(cancel404Active.state, cancelVerificationPolicy.CANCEL_VERIFY_STATE.FAILED_ACTIVE_ORDER_REMAINS);

  const cancelAllActive = cancelVerificationPolicy.classifyCancelVerification({
    cancelResponse: { ok: true },
    readResult: { openOrders: [{ clientOrderId: "GENTRY_L_QA_ALL", status: "NEW" }] },
    target: {},
  });
  assert.strictEqual(cancelAllActive.state, cancelVerificationPolicy.CANCEL_VERIFY_STATE.FAILED_ACTIVE_ORDER_REMAINS);

  const staleCancel = cancelVerificationPolicy.classifyCancelVerification({
    cancelResponse: { ok: true },
    readResult: { openOrders: [] },
    target: { targetClientOrderId: "GENTRY_L_QA" },
    staleRead: true,
  });
  assert.strictEqual(staleCancel.state, cancelVerificationPolicy.CANCEL_VERIFY_STATE.VERIFY_PENDING);

  const makeError = (status) => ({ response: { status, headers: { "retry-after": "1" } } });
  const cancel429 = cancelVerificationPolicy.classifyCancelVerification({
    error: makeError(429),
  });
  assert.strictEqual(cancel429.state, cancelVerificationPolicy.CANCEL_VERIFY_STATE.BLOCKED_429);
  const cancel418 = cancelVerificationPolicy.classifyCancelVerification({
    error: makeError(418),
  });
  assert.strictEqual(cancel418.state, cancelVerificationPolicy.CANCEL_VERIFY_STATE.BLOCKED_418);

  binanceReadGuard.recordPrivateRequestFailure({
    uid: BASE_UID,
    endpoint: "/fapi/v1/openOrders",
    error: makeError(429),
  });
  gate = await orderIntentDispatchGate.evaluateWorkerActualDispatchGate(buildGateContext({
    readGuardSnapshot: binanceReadGuard.getStateSnapshot(),
  }));
  assert.strictEqual(gate.allowed, false, "429/418 read guard blocks dispatch");
  assert.strictEqual(gate.reason, orderIntentDispatchGate.GATE_REASON.PRIVATE_READ_GUARD_OPEN);
  binanceReadGuard.resetForTest();

  const covered = new Set(orderIntentDispatchGate.GRID_ACTION_COVERAGE);
  [
    orderIntentQueue.INTENT_TYPE.GRID_LIVE_ARM,
    orderIntentQueue.INTENT_TYPE.GRID_PROTECTION_CREATE,
    orderIntentQueue.INTENT_TYPE.GRID_REENTRY_CREATE,
    orderIntentQueue.INTENT_TYPE.GRID_CANCEL_ORDER,
    orderIntentQueue.INTENT_TYPE.GRID_CANCEL_ALL_FOR_REGIME,
    orderIntentQueue.INTENT_TYPE.GRID_REGIME_CLEANUP_CANCEL,
    orderIntentQueue.INTENT_TYPE.GRID_GMANUAL_CLOSE,
    orderIntentQueue.INTENT_TYPE.GRID_CONTROLLED_CLOSE,
  ].forEach((intentType) => assert(covered.has(intentType), `Grid action coverage missing:${intentType}`));

  await orderIntentQueue.enqueueGridLiveArmIntents({
    payload: buildPayload(),
    previewResult: buildPreview(),
    routePath: "qa-final-dispatch-gate-test",
  });
  const workerResult = await orderIntentWorker.processOneIntent({
    workerId: "qa-final-dispatch-default",
    env: LIVE_ENV,
    redisClient: redisReady,
    dbEvaluation: { ok: true, fingerprint: { databaseName: "quantu_local" }, failures: [] },
    ownershipReadiness: { enabled: true, status: "OK", legacyDisabled: false },
    queueReady: true,
    readGuardSnapshot: { globalBlocked: false, uidBlocks: [] },
    timeSyncReady: true,
  });
  assert.strictEqual(workerResult.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(workerResult.reason, orderIntentDispatchGate.GATE_REASON.ACTUAL_DISPATCH_DISABLED);

  const seonSource = fs.readFileSync(path.join(__dirname, "../../seon.js"), "utf8");
  const coinSource = fs.readFileSync(path.join(__dirname, "../../coin.js"), "utf8");
  const gridSource = fs.readFileSync(path.join(__dirname, "../../grid-engine.js"), "utf8");
  assert(gridSource.includes("enqueueLiveGridArmIntentForRuntimeRow"), "Grid runtime arm uses order_intent queue");
  assert(gridSource.includes("grid-runtime-live-cycle"), "Grid live runtime queue route is explicit");
  assert(seonSource.includes("withPlayRuntimeLock"), "Signal path uses runtime lock");
  assert(coinSource.includes("assertBinanceWriteAllowedOrLog"), "Signal write path uses central write guard");
  assert(coinSource.includes("runBinanceWriteWithTimeSync"), "Signal write path uses time-sync guarded Binance helper");

  await orderIntentQueue.deleteQaIntentsByUid(BASE_UID);
  await db.end();
  console.log("final-worker-dispatch-gate-static-test PASS");
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try {
    await orderIntentQueue.deleteQaIntentsByUid(BASE_UID);
    await db.end();
  } catch (_) {}
  process.exit(1);
});
