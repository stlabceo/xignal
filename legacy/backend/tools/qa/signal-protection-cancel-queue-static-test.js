"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const db = require("../../database/connect/config");
const pidPositionLedger = require("../../pid-position-ledger");
const positionOwnership = require("../../position-ownership");
const orderIntentQueue = require("../../order-intent-queue");
const orderIntentWorker = require("../../order-intent-worker");
const liveWriteSafetyGate = require("../../live-write-safety-gate");
const binanceWriteGuard = require("../../binance-write-guard");

const LIVE_ENV = {
  BINANCE_LIVE_WRITES_ENABLED: "1",
  BINANCE_WRITE_APPROVAL: binanceWriteGuard.LIVE_WRITE_APPROVAL,
};

const BASE_UID = 901501;
const redisReady = { set: () => {}, isOpen: true, isReady: true };

const cleanupUid = async (uid) => {
  await orderIntentQueue.deleteQaIntentsByUid(uid);
  await db.query("DELETE FROM live_pid_exit_reservation WHERE uid = ?", [uid]);
  await db.query("DELETE FROM live_pid_position_snapshot WHERE uid = ?", [uid]);
  await db.query("DELETE FROM live_pid_position_ledger WHERE uid = ?", [uid]);
  await db.query("DELETE FROM live_position_bucket_owner WHERE uid = ?", [uid]);
};

const cleanupAll = async () => {
  for (let uid = BASE_UID; uid < BASE_UID + 30; uid += 1) {
    await cleanupUid(uid);
  }
};

const seedSignalOwnership = async ({
  uid,
  pid = 9501,
  symbol = "XRPUSDT",
  positionSide = "LONG",
  side = "BUY",
  qty = 1,
} = {}) => {
  await pidPositionLedger.applyEntryFill({
    uid,
    pid,
    strategyCategory: "signal",
    symbol,
    positionSide,
    sourceClientOrderId: `NEW_${uid}_${pid}`,
    sourceOrderId: `entry-${uid}-${pid}`,
    sourceTradeId: `entry-trade-${uid}-${pid}`,
    eventType: "QA_SIGNAL_ENTRY_FILL",
    fillQty: qty,
    fillPrice: 2.5,
    tradeTime: "2026-05-06 00:00:00",
  });
  return { uid, pid, symbol, positionSide, side, qty };
};

const buildProtectionPayload = ({
  uid = BASE_UID,
  pid = 9501,
  symbol = "XRPUSDT",
  side = "BUY",
  positionSide = "LONG",
  qty = 1,
  sourceTradeId = "signal-protection-fill-1",
  boundType = "PROFIT",
} = {}) => ({
  uid,
  pid,
  symbol,
  side,
  positionSide,
  qty,
  ownedQty: qty,
  entryOrderId: `NEW_${uid}_${pid}`,
  sourceOrderId: `entry-${uid}-${pid}`,
  sourceTradeId,
  entryPrice: 2.5,
  takeProfitPrice: 2.7,
  stopPrice: 2.3,
  splitStageQty: boundType === "SPLITTP" ? 0.5 : 0,
  splitStageIndex: boundType === "SPLITTP" ? 1 : 0,
  boundType,
});

const buildCancelPayload = ({
  uid = BASE_UID + 10,
  pid = 9510,
  symbol = "XRPUSDT",
  targetClientOrderId = "PROFIT_901511_9510_NEW_901511_9510",
} = {}) => ({
  uid,
  pid,
  symbol,
  positionSide: "LONG",
  targetType: "PROTECTION",
  targetClientOrderId,
  reason: "SIGNAL_PROTECTION_CANCEL",
});

const buildClosePayload = ({
  uid = BASE_UID + 20,
  pid = 9520,
  symbol = "XRPUSDT",
  side = "BUY",
  positionSide = "LONG",
  qty = 1,
  reason = "MANUAL",
} = {}) => ({
  uid,
  pid,
  symbol,
  side,
  positionSide,
  qty,
  ownedQtyBasis: qty,
  reason,
  rTid: `entry-${uid}-${pid}`,
});

const loadRowsForUid = async (uid) => {
  const [rows] = await db.query(
    `SELECT id, intentKey, fifoKey, uid, pid, intentType, status, resultJson, lastErrorCode, lastErrorMessage
       FROM order_intent_queue
      WHERE uid = ?
      ORDER BY id ASC`,
    [uid]
  );
  return rows.map((row) => ({
    ...row,
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
  }));
};

(async () => {
  await cleanupAll();
  await orderIntentQueue.ensureOrderIntentSchema();

  const protectionUid = BASE_UID;
  await seedSignalOwnership({ uid: protectionUid, pid: 9501, qty: 1 });
  const protectionPayload = buildProtectionPayload({ uid: protectionUid, pid: 9501, sourceTradeId: "protect-1" });
  const protectionFirst = await orderIntentQueue.enqueueSignalProtectionIntent({
    payload: protectionPayload,
    routePath: "qa-signal-protection-test",
  });
  assert.strictEqual(protectionFirst.inserted, 1, "Signal entry fill enqueues protection intent");
  const protectionDuplicate = await orderIntentQueue.enqueueSignalProtectionIntent({
    payload: protectionPayload,
    routePath: "qa-signal-protection-test",
  });
  assert.strictEqual(protectionDuplicate.inserted, 0, "duplicate fill enqueues one protection intent");

  const protectionDone = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-protection-done",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(protectionDone.status, orderIntentQueue.STATUS.DONE);
  let rows = await loadRowsForUid(protectionUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.SIGNAL_PROTECTION_QUEUE_STATE.PROTECTED);

  const splitUid = BASE_UID + 1;
  await cleanupUid(splitUid);
  await seedSignalOwnership({ uid: splitUid, pid: 9502, qty: 1 });
  const splitPayload = buildProtectionPayload({ uid: splitUid, pid: 9502, sourceTradeId: "split-1", boundType: "SPLITTP" });
  const splitFirst = await orderIntentQueue.enqueueSignalProtectionIntent({
    intentType: orderIntentQueue.INTENT_TYPE.SIGNAL_SPLIT_TP_CREATE,
    payload: splitPayload,
    routePath: "qa-signal-split-test",
  });
  assert.strictEqual(splitFirst.inserted, 1, "Signal split TP intent enqueued");
  const splitDuplicate = await orderIntentQueue.enqueueSignalProtectionIntent({
    intentType: orderIntentQueue.INTENT_TYPE.SIGNAL_SPLIT_TP_CREATE,
    payload: splitPayload,
    routePath: "qa-signal-split-test",
  });
  assert.strictEqual(splitDuplicate.inserted, 0, "Signal split TP intent idempotency");
  await cleanupUid(splitUid);

  const cancelUid = BASE_UID + 10;
  await cleanupUid(cancelUid);
  const cancelPayload = buildCancelPayload({ uid: cancelUid, pid: 9510 });
  const cancelFirst = await orderIntentQueue.enqueueSignalCancelIntent({
    payload: cancelPayload,
    routePath: "qa-signal-cancel-test",
  });
  assert.strictEqual(cancelFirst.inserted, 1, "Signal protection cancel intent queued");
  const cancelResult = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-cancel",
    env: LIVE_ENV,
    redisClient: redisReady,
    ownershipReadiness: { enabled: true, status: "OK", legacyDisabled: false },
    mock: true,
    mockSignalCancelResult: { timeout: true },
  });
  assert.strictEqual(cancelResult.status, orderIntentQueue.STATUS.BLOCKED);
  rows = await loadRowsForUid(cancelUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.SIGNAL_CANCEL_QUEUE_STATE.VERIFY_PENDING);

  const closeUid = BASE_UID + 20;
  await cleanupUid(closeUid);
  await seedSignalOwnership({ uid: closeUid, pid: 9520, qty: 1 });
  const closePayload = buildClosePayload({ uid: closeUid, pid: 9520, qty: 1, reason: "MANUAL" });
  const closeFirst = await orderIntentQueue.enqueueSignalCloseIntent({
    payload: closePayload,
    routePath: "qa-signal-close-test",
  });
  assert.strictEqual(closeFirst.inserted, 1, "Signal forced close intent queued");
  const closeDuplicate = await orderIntentQueue.enqueueSignalCloseIntent({
    payload: closePayload,
    routePath: "qa-signal-close-test",
  });
  assert.strictEqual(closeDuplicate.inserted, 0, "duplicate Signal close intent idempotency");
  const closeResult = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-close",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(closeResult.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(closeResult.reason, orderIntentWorker.SIGNAL_CLOSE_QUEUE_STATE.ACCEPTED_NOT_CONVERGED);
  rows = await loadRowsForUid(closeUid);
  assert.strictEqual(Number(rows[0].result.closeQty), 1, "Signal close qty uses ownership bucket");

  const timeUid = BASE_UID + 21;
  await cleanupUid(timeUid);
  await seedSignalOwnership({ uid: timeUid, pid: 9521, qty: 1 });
  const timeExit = await orderIntentQueue.enqueueSignalCloseIntent({
    intentType: orderIntentQueue.INTENT_TYPE.SIGNAL_STOP_TIME_EXIT,
    payload: buildClosePayload({ uid: timeUid, pid: 9521, qty: 1, reason: "TIME" }),
    routePath: "qa-signal-time-exit-test",
  });
  assert.strictEqual(timeExit.inserted, 1, "Signal stop/time exit intent queued");
  rows = await loadRowsForUid(timeUid);
  await orderIntentQueue.completeIntent({
    id: rows[0].id,
    status: orderIntentQueue.STATUS.FAILED,
    result: { ok: false, reason: "SIGNAL_CLOSE_FAILED" },
    errorCode: "SIGNAL_CLOSE_FAILED",
    errorMessage: "Signal close failed:coin.dispatchSignalCloseFromIntent handler is unavailable",
  });
  const timeExitRequeue = await orderIntentQueue.enqueueSignalCloseIntent({
    intentType: orderIntentQueue.INTENT_TYPE.SIGNAL_STOP_TIME_EXIT,
    payload: buildClosePayload({ uid: timeUid, pid: 9521, qty: 1, reason: "TIME" }),
    routePath: "qa-signal-time-exit-test",
  });
  assert.strictEqual(timeExitRequeue.requeued, 1, "recoverable handler-missing Signal time exit failure must requeue");
  rows = await loadRowsForUid(timeUid);
  assert.strictEqual(rows[0].status, orderIntentQueue.STATUS.PENDING);
  assert.strictEqual(rows[0].lastErrorCode, null);
  await cleanupUid(timeUid);

  const overUid = BASE_UID + 22;
  await cleanupUid(overUid);
  await seedSignalOwnership({ uid: overUid, pid: 9522, qty: 1 });
  await orderIntentQueue.enqueueSignalCloseIntent({
    payload: buildClosePayload({ uid: overUid, pid: 9522, qty: 2, reason: "CONTROLLED_CLOSE" }),
    routePath: "qa-signal-over-close-test",
  });
  const overClose = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-over-close",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(overClose.status, orderIntentQueue.STATUS.BLOCKED);
  rows = await loadRowsForUid(overUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.SIGNAL_CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP);

  const redisUid = BASE_UID + 23;
  await cleanupUid(redisUid);
  await seedSignalOwnership({ uid: redisUid, pid: 9523, qty: 1 });
  await orderIntentQueue.enqueueSignalCloseIntent({
    payload: buildClosePayload({ uid: redisUid, pid: 9523, qty: 1, reason: "MANUAL" }),
    routePath: "qa-signal-redis-block-test",
  });
  const redisBlocked = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-close-redis",
    env: LIVE_ENV,
    redisClient: null,
    mock: true,
  });
  assert.strictEqual(redisBlocked.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(redisBlocked.reason, liveWriteSafetyGate.REASON.REDIS_LOCK_UNAVAILABLE);

  const missingUid = BASE_UID + 24;
  await cleanupUid(missingUid);
  await orderIntentQueue.enqueueSignalCloseIntent({
    payload: buildClosePayload({ uid: missingUid, pid: 9524, qty: 1, reason: "MANUAL" }),
    routePath: "qa-signal-missing-owner-test",
  });
  const missing = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-close-missing",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(missing.status, orderIntentQueue.STATUS.BLOCKED);

  const disabledUid = BASE_UID + 25;
  await cleanupUid(disabledUid);
  await seedSignalOwnership({ uid: disabledUid, pid: 9525, qty: 1 });
  await orderIntentQueue.enqueueSignalCloseIntent({
    payload: buildClosePayload({ uid: disabledUid, pid: 9525, qty: 1, reason: "MANUAL" }),
    routePath: "qa-signal-dispatch-disabled-test",
  });
  const dispatchBlocked = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-close-dispatch-disabled",
    env: LIVE_ENV,
    redisClient: redisReady,
    dbEvaluation: { ok: true, fingerprint: { databaseName: "quantu_local" }, failures: [] },
    ownershipReadiness: { enabled: true, status: "OK", legacyDisabled: false },
    queueReady: true,
    readGuardSnapshot: { globalBlocked: false, uidBlocks: [] },
    timeSyncReady: true,
  });
  assert.strictEqual(dispatchBlocked.status, orderIntentQueue.STATUS.BLOCKED);

  const failUid = BASE_UID + 26;
  await cleanupUid(failUid);
  await seedSignalOwnership({ uid: failUid, pid: 9526, qty: 1 });
  await orderIntentQueue.enqueueSignalCloseIntent({
    payload: buildClosePayload({ uid: failUid, pid: 9526, qty: 1, reason: "MANUAL" }),
    routePath: "qa-signal-close-fail-test",
  });
  const closeFail = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-close-fail",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
    mockSignalCloseResult: { ok: false, reason: "MOCK_SIGNAL_CLOSE_FAILED" },
  });
  assert.strictEqual(closeFail.status, orderIntentQueue.STATUS.FAILED);
  rows = await loadRowsForUid(failUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.SIGNAL_CLOSE_QUEUE_STATE.FAILED);

  const coinSource = fs.readFileSync(path.join(__dirname, "../../coin.js"), "utf8");
  assert(coinSource.includes("enqueueSignalProtectionIntent"), "Signal protection uses durable queue");
  assert(coinSource.includes("enqueueSignalCancelIntent"), "Signal cancel uses durable queue");
  assert(coinSource.includes("enqueueSignalCloseIntent"), "Signal close uses durable queue");
  assert(coinSource.includes("ALLOW_LEGACY_SIGNAL_DIRECT_WRITE"), "legacy direct Signal write remains fail-closed behind disabled env override");
  assert(coinSource.includes("SIGNAL_CANCEL_DIRECT_DISABLED"), "legacy cancelOrderAll2 direct cancel is blocked");

  await cleanupAll();
  await db.end();
  console.log("signal-protection-cancel-queue-static-test PASS");
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try {
    await cleanupAll();
    await db.end();
  } catch (_) {}
  process.exit(1);
});
