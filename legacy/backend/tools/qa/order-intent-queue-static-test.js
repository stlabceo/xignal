"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const db = require("../../database/connect/config");
const orderIntentQueue = require("../../order-intent-queue");
const orderIntentWorker = require("../../order-intent-worker");
const liveWriteSafetyGate = require("../../live-write-safety-gate");
const binanceWriteGuard = require("../../binance-write-guard");

const LIVE_ENV = {
  BINANCE_LIVE_WRITES_ENABLED: "1",
  BINANCE_WRITE_APPROVAL: binanceWriteGuard.LIVE_WRITE_APPROVAL,
};

const READONLY_ENV = {
  QA_DISABLE_BINANCE_WRITES: "1",
  BINANCE_LIVE_WRITES_ENABLED: "1",
  BINANCE_WRITE_APPROVAL: binanceWriteGuard.LIVE_WRITE_APPROVAL,
};

const buildPreview = ({ uid = 900701, pid = 7001, symbol = "PUMPUSDT", triggerPrice = 1.5 } = {}) => ({
  matched: 1,
  armed: 1,
  ignoredActive: 0,
  ignoredConflict: 0,
  ignoredSignal: 0,
  live: {
    matched: 1,
    armed: 1,
    ignoredActive: 0,
    ignoredConflict: 0,
    ignoredSignal: 0,
  },
  test: {
    matched: 0,
    armed: 0,
    ignoredActive: 0,
    ignoredConflict: 0,
    ignoredSignal: 0,
  },
  targetItems: [
    {
      uid,
      pid,
      strategyCategory: "grid",
      strategyMode: "live",
      strategyName: "SQZ+GRID",
      strategySignal: "SQZ+GRID",
      symbol,
      bunbong: "30MIN",
      resultCode: "GRID_ARM_PREVIEW",
      regimeStatus: "ACTIVE",
      note: `trigger:${triggerPrice}`,
    },
  ],
});

const buildPayload = ({ symbol = "PUMPUSDT", triggerPrice = 1.5, time = "2026-05-06T00:00:00Z" } = {}) => ({
  strategySignal: "SQZ+GRID",
  symbol,
  bunbong: "30MIN",
  supportPrice: 1,
  resistancePrice: 2,
  triggerPrice,
  time,
  signalTime: time,
});

const loadRowsForUid = async (uid) => {
  const [rows] = await db.query(
    `SELECT id, intentKey, fifoKey, uid, pid, intentType, status, attemptCount, lastErrorCode
       FROM order_intent_queue
      WHERE uid = ?
      ORDER BY id ASC`,
    [uid]
  );
  return rows;
};

(async () => {
  const uid = 900701;
  await orderIntentQueue.ensureOrderIntentSchema();
  await orderIntentQueue.deleteQaIntentsByUid(uid);

  const payload = buildPayload();
  const preview = buildPreview({ uid, pid: 7001, triggerPrice: payload.triggerPrice });
  const first = await orderIntentQueue.enqueueGridLiveArmIntents({
    payload,
    previewResult: preview,
    routePath: "qa-order-intent-test",
  });
  assert.strictEqual(first.inserted, 1);
  assert.strictEqual(first.duplicate, 0);

  const duplicate = await orderIntentQueue.enqueueGridLiveArmIntents({
    payload,
    previewResult: preview,
    routePath: "qa-order-intent-test",
  });
  assert.strictEqual(duplicate.inserted, 0);
  assert.strictEqual(duplicate.duplicate, 1);

  let rows = await loadRowsForUid(uid);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, orderIntentQueue.STATUS.PENDING);

  const payload2 = buildPayload({ triggerPrice: 1.6, time: "2026-05-06T00:00:01Z" });
  await orderIntentQueue.enqueueGridLiveArmIntents({
    payload: payload2,
    previewResult: buildPreview({ uid, pid: 7001, triggerPrice: payload2.triggerPrice }),
    routePath: "qa-order-intent-test",
  });
  rows = await loadRowsForUid(uid);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].fifoKey, rows[1].fifoKey);

  const claimed1 = await orderIntentQueue.claimNextIntent({ workerId: "qa-worker" });
  assert.strictEqual(claimed1.id, rows[0].id);
  const blockedByFifo = await orderIntentQueue.claimNextIntent({ workerId: "qa-worker" });
  assert.strictEqual(blockedByFifo, null);
  await orderIntentQueue.completeIntent({
    id: claimed1.id,
    status: orderIntentQueue.STATUS.DONE,
    result: { ok: true, qa: "fifo-first-done" },
  });
  const claimed2 = await orderIntentQueue.claimNextIntent({ workerId: "qa-worker" });
  assert.strictEqual(claimed2.id, rows[1].id);
  await orderIntentQueue.completeIntent({
    id: claimed2.id,
    status: orderIntentQueue.STATUS.DONE,
    result: { ok: true, qa: "fifo-second-done" },
  });

  const redisUid = uid + 1;
  await orderIntentQueue.deleteQaIntentsByUid(redisUid);
  await orderIntentQueue.enqueueGridLiveArmIntents({
    payload: buildPayload({ symbol: "XRPUSDT", triggerPrice: 1.25 }),
    previewResult: buildPreview({ uid: redisUid, pid: 7002, symbol: "XRPUSDT", triggerPrice: 1.25 }),
    routePath: "qa-order-intent-test",
  });
  const redisResult = await orderIntentWorker.processOneIntent({
    workerId: "qa-worker-redis",
    env: LIVE_ENV,
    redisClient: null,
  });
  assert.strictEqual(redisResult.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(redisResult.reason, liveWriteSafetyGate.REASON.REDIS_LOCK_UNAVAILABLE);

  const dispatchBlockedUid = uid + 2;
  await orderIntentQueue.deleteQaIntentsByUid(dispatchBlockedUid);
  await orderIntentQueue.enqueueGridLiveArmIntents({
    payload: buildPayload({ symbol: "SOLUSDT", triggerPrice: 1.35 }),
    previewResult: buildPreview({ uid: dispatchBlockedUid, pid: 7003, symbol: "SOLUSDT", triggerPrice: 1.35 }),
    routePath: "qa-order-intent-test",
  });
  const dispatchBlockedResult = await orderIntentWorker.processOneIntent({
    workerId: "qa-worker-dispatch-blocked",
    env: LIVE_ENV,
    redisClient: { set: () => {}, isOpen: true, isReady: true },
  });
  assert.strictEqual(dispatchBlockedResult.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(dispatchBlockedResult.reason, liveWriteSafetyGate.REASON.QUEUE_REQUIRED_FOR_LIVE_GRID_WRITE);

  const dryRunUid = uid + 3;
  await orderIntentQueue.deleteQaIntentsByUid(dryRunUid);
  await orderIntentQueue.enqueueGridLiveArmIntents({
    payload: buildPayload({ symbol: "DOGEUSDT", triggerPrice: 1.45 }),
    previewResult: buildPreview({ uid: dryRunUid, pid: 7004, symbol: "DOGEUSDT", triggerPrice: 1.45 }),
    routePath: "qa-order-intent-test",
  });
  const dryRunResult = await orderIntentWorker.processOneIntent({
    workerId: "qa-worker-dryrun",
    env: READONLY_ENV,
    redisClient: null,
    dryRun: true,
  });
  assert.strictEqual(dryRunResult.status, orderIntentQueue.STATUS.DONE);

  const routeSource = fs.readFileSync(
    path.join(__dirname, "../../routes/users.js"),
    "utf8"
  );
  assert(!routeSource.includes("primeLiveEntriesForTargetItems"));
  assert(routeSource.includes("enqueueGridLiveArmIntents"));

  const readiness = liveWriteSafetyGate.buildReadinessSnapshot({
    env: LIVE_ENV,
    redisClient: { set: () => {}, isOpen: true, isReady: true },
    orderIntentQueueEnabled: true,
    ownershipEnabled: true,
  });
  assert(!readiness.blockers.some((item) => item.code === liveWriteSafetyGate.REASON.OWNERSHIP_DISABLED));
  assert(!readiness.blockers.some((item) => item.code === liveWriteSafetyGate.REASON.QUEUE_REQUIRED_FOR_LIVE_GRID_WRITE));

  await orderIntentQueue.deleteQaIntentsByUid(uid);
  await orderIntentQueue.deleteQaIntentsByUid(redisUid);
  await orderIntentQueue.deleteQaIntentsByUid(dispatchBlockedUid);
  await orderIntentQueue.deleteQaIntentsByUid(dryRunUid);
  await db.end();
  console.log("order-intent-queue-static-test PASS");
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try {
    await db.end();
  } catch (_) {}
  process.exit(1);
});
