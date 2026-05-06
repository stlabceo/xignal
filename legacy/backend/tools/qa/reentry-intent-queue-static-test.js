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

const redisReady = { set: () => {}, isOpen: true, isReady: true };

const buildPayload = ({
  uid = 901001,
  pid = 8101,
  symbol = "PUMPUSDT",
  positionSide = "LONG",
  sourceTradeId = "qa-tp-trade-1",
  sourceTakeProfitClientOrderId = "GTP_L_901001_8101_11111111",
} = {}) => ({
  uid,
  pid,
  gridRowId: pid,
  regimeId: pid,
  symbol,
  timeframe: "30MIN",
  positionSide,
  triggerPrice: 1.25,
  reentryQty: 7,
  ownedQtyBasis: 7,
  sourceTakeProfitClientOrderId,
  sourceOrderId: "qa-tp-order",
  sourceTradeId,
  tradeTime: "2026-05-06T00:00:00Z",
  reentryClientOrderId: `GENTRY_${positionSide === "SHORT" ? "S" : "L"}_${uid}_${pid}_11111111`,
  priceFreshnessEvidence: {
    usable: true,
    source: "QA_FRESH_QUOTE",
    quoteAgeMs: 5,
    reason: null,
  },
});

const cleanupUid = async (uid) => {
  await orderIntentQueue.deleteQaIntentsByUid(uid);
  await db.query("DELETE FROM live_pid_exit_reservation WHERE uid = ?", [uid]);
  await db.query("DELETE FROM live_pid_position_snapshot WHERE uid = ?", [uid]);
  await db.query("DELETE FROM live_pid_position_ledger WHERE uid = ?", [uid]);
  await db.query("DELETE FROM live_position_bucket_owner WHERE uid = ?", [uid]);
};

const enqueue = async (payload) =>
  await orderIntentQueue.enqueueGridReentryCreateIntent({
    payload,
    routePath: "qa-reentry-intent-test",
  });

const loadRowsForUid = async (uid) => {
  const [rows] = await db.query(
    `SELECT id, intentKey, fifoKey, uid, pid, intentType, status, attemptCount, lastErrorCode, resultJson
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
  await orderIntentQueue.ensureOrderIntentSchema();

  const uid = 901001;
  await cleanupUid(uid);
  const payload = buildPayload({ uid });

  const first = await enqueue(payload);
  assert.strictEqual(first.inserted, 1, "LONG TP fill enqueues one re-entry intent");
  assert.strictEqual(first.intent.status, orderIntentQueue.STATUS.PENDING);

  const duplicate = await enqueue(payload);
  assert.strictEqual(duplicate.inserted, 0, "duplicate TP fill does not create a second re-entry intent");
  assert.strictEqual(duplicate.duplicate, 1);

  const secondPayload = buildPayload({
    uid,
    sourceTradeId: "qa-tp-trade-2",
    sourceTakeProfitClientOrderId: "GTP_L_901001_8101_22222222",
  });
  await enqueue(secondPayload);
  let rows = await loadRowsForUid(uid);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].fifoKey, rows[1].fifoKey, "same PID/regime re-entry uses same FIFO key");

  const claimed1 = await orderIntentQueue.claimNextIntent({ workerId: "qa-reentry-fifo" });
  assert.strictEqual(claimed1.id, rows[0].id);
  const blockedByFifo = await orderIntentQueue.claimNextIntent({ workerId: "qa-reentry-fifo" });
  assert.strictEqual(blockedByFifo, null, "second re-entry intent waits for first FIFO item");
  await orderIntentQueue.completeIntent({
    id: claimed1.id,
    status: orderIntentQueue.STATUS.DONE,
    result: { ok: true, qa: "fifo-first-done" },
  });
  const claimed2 = await orderIntentQueue.claimNextIntent({ workerId: "qa-reentry-fifo" });
  assert.strictEqual(claimed2.id, rows[1].id);
  await orderIntentQueue.completeIntent({
    id: claimed2.id,
    status: orderIntentQueue.STATUS.DONE,
    result: { ok: true, qa: "fifo-second-done" },
  });

  await cleanupUid(uid);
  await enqueue(payload);
  const success = await orderIntentWorker.processOneIntent({
    workerId: "qa-reentry-worker",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(success.status, orderIntentQueue.STATUS.DONE);
  rows = await loadRowsForUid(uid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.REENTRY_QUEUE_STATE.PENDING);

  const staleUid = uid + 1;
  const stalePayload = buildPayload({
    uid: staleUid,
    pid: 8102,
    sourceTradeId: "stale-price",
  });
  stalePayload.priceFreshnessEvidence = {
    usable: false,
    source: "QA_STALE_QUOTE",
    reason: "QUOTE_STALE",
    quoteAgeMs: 999999,
  };
  await cleanupUid(staleUid);
  await enqueue(stalePayload);
  const stale = await orderIntentWorker.processOneIntent({
    workerId: "qa-reentry-stale",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(stale.status, orderIntentQueue.STATUS.BLOCKED);
  rows = await loadRowsForUid(staleUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.REENTRY_QUEUE_STATE.BLOCKED_PRICE_STALE);

  const ownershipUid = uid + 2;
  const ownershipPayload = buildPayload({
    uid: ownershipUid,
    pid: 8103,
    sourceTradeId: "ownership-zero",
  });
  ownershipPayload.ownedQtyBasis = 0;
  await cleanupUid(ownershipUid);
  await enqueue(ownershipPayload);
  const ownership = await orderIntentWorker.processOneIntent({
    workerId: "qa-reentry-ownership",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(ownership.status, orderIntentQueue.STATUS.BLOCKED);
  rows = await loadRowsForUid(ownershipUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.REENTRY_QUEUE_STATE.BLOCKED_OWNERSHIP);

  const redisUid = uid + 3;
  const redisPayload = buildPayload({
    uid: redisUid,
    pid: 8104,
    sourceTradeId: "redis-block",
  });
  await cleanupUid(redisUid);
  await enqueue(redisPayload);
  const redis = await orderIntentWorker.processOneIntent({
    workerId: "qa-reentry-redis",
    env: LIVE_ENV,
    redisClient: null,
    mock: true,
  });
  assert.strictEqual(redis.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(redis.reason, liveWriteSafetyGate.REASON.REDIS_LOCK_UNAVAILABLE);

  const failUid = uid + 4;
  const failPayload = buildPayload({
    uid: failUid,
    pid: 8105,
    sourceTradeId: "submit-fail",
  });
  await cleanupUid(failUid);
  await enqueue(failPayload);
  const fail = await orderIntentWorker.processOneIntent({
    workerId: "qa-reentry-fail",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
    mockReentryResult: { ok: false, reason: "MOCK_REENTRY_SUBMIT_FAILED" },
  });
  assert.strictEqual(fail.status, orderIntentQueue.STATUS.FAILED);
  rows = await loadRowsForUid(failUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.REENTRY_QUEUE_STATE.FAILED);

  const gridSource = fs.readFileSync(path.join(__dirname, "../../grid-engine.js"), "utf8");
  assert(gridSource.includes("enqueueGridReentryCreateIntent"), "grid engine enqueues re-entry intents");
  assert(gridSource.includes("TAKE_PROFIT_REENTRY_INTENT_PENDING"), "TP fill records re-entry pending projection");
  assert(!gridSource.includes("const reentry = await armLiveReentryAfterTakeProfit"), "TP fill event thread no longer calls direct re-entry arm");
  const directCallCount = (gridSource.match(/armLiveReentryAfterTakeProfit\(/g) || []).length;
  assert.strictEqual(directCallCount, 0, "direct re-entry arm helper is not invoked by event thread");

  await cleanupUid(uid);
  await cleanupUid(staleUid);
  await cleanupUid(ownershipUid);
  await cleanupUid(redisUid);
  await cleanupUid(failUid);
  await db.end();
  console.log("reentry-intent-queue-static-test PASS");
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try {
    await cleanupUid(901001);
    await cleanupUid(901002);
    await cleanupUid(901003);
    await cleanupUid(901004);
    await cleanupUid(901005);
    await db.end();
  } catch (_) {}
  process.exit(1);
});
