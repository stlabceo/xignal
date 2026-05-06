"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const db = require("../../database/connect/config");
const orderIntentQueue = require("../../order-intent-queue");
const orderIntentWorker = require("../../order-intent-worker");
const positionOwnership = require("../../position-ownership");
const liveWriteSafetyGate = require("../../live-write-safety-gate");
const binanceWriteGuard = require("../../binance-write-guard");

const LIVE_ENV = {
  BINANCE_LIVE_WRITES_ENABLED: "1",
  BINANCE_WRITE_APPROVAL: binanceWriteGuard.LIVE_WRITE_APPROVAL,
};

const redisReady = { set: () => {}, isOpen: true, isReady: true };

const buildPayload = ({
  uid = 900901,
  pid = 7901,
  symbol = "PUMPUSDT",
  positionSide = "LONG",
  sourceTradeId = "qa-trade-1",
  entryOrderId = "GENTRY_L_900901_7901_11111111",
} = {}) => ({
  uid,
  pid,
  gridRowId: pid,
  regimeId: pid,
  symbol,
  positionSide,
  qty: 3,
  ownedQty: 3,
  entryPrice: 1.25,
  entryOrderId,
  sourceOrderId: "qa-entry-order",
  sourceTradeId,
  takeProfitPrice: positionSide === "LONG" ? 1.35 : 1.15,
  stopPrice: positionSide === "LONG" ? 1.05 : 1.45,
});

const cleanupUid = async (uid) => {
  await orderIntentQueue.deleteQaIntentsByUid(uid);
  await db.query("DELETE FROM live_pid_exit_reservation WHERE uid = ?", [uid]);
  await db.query("DELETE FROM live_pid_position_snapshot WHERE uid = ?", [uid]);
  await db.query("DELETE FROM live_pid_position_ledger WHERE uid = ?", [uid]);
  await db.query("DELETE FROM live_position_bucket_owner WHERE uid = ?", [uid]);
};

const seedOwnership = async (payload) => {
  await positionOwnership.applyEntryFill({
    uid: payload.uid,
    ownerPid: payload.pid,
    ownerStrategyCategory: "grid",
    symbol: payload.symbol,
    positionSide: payload.positionSide,
    fillQty: payload.ownedQty,
    ownerState: "OPEN",
    sourceClientOrderId: payload.entryOrderId,
    sourceOrderId: payload.sourceOrderId,
    note: "qa protection intent ownership seed",
  });
};

const enqueue = async (payload) =>
  await orderIntentQueue.enqueueGridProtectionCreateIntent({
    payload,
    routePath: "qa-protection-intent-test",
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

  const uid = 900901;
  await cleanupUid(uid);
  const payload = buildPayload({ uid });
  await seedOwnership(payload);

  const first = await enqueue(payload);
  assert.strictEqual(first.inserted, 1, "LONG fill enqueues one protection intent");
  assert.strictEqual(first.intent.status, orderIntentQueue.STATUS.PENDING);

  const duplicate = await enqueue(payload);
  assert.strictEqual(duplicate.inserted, 0, "duplicate fill does not create a second protection intent");
  assert.strictEqual(duplicate.duplicate, 1);

  const secondPayload = buildPayload({
    uid,
    sourceTradeId: "qa-trade-2",
    entryOrderId: "GENTRY_L_900901_7901_22222222",
  });
  await enqueue(secondPayload);
  let rows = await loadRowsForUid(uid);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].fifoKey, rows[1].fifoKey, "same PID/regime protection uses same FIFO key");

  const claimed1 = await orderIntentQueue.claimNextIntent({ workerId: "qa-protection-fifo" });
  assert.strictEqual(claimed1.id, rows[0].id);
  const blockedByFifo = await orderIntentQueue.claimNextIntent({ workerId: "qa-protection-fifo" });
  assert.strictEqual(blockedByFifo, null, "second protection intent waits for first FIFO item");
  await orderIntentQueue.completeIntent({
    id: claimed1.id,
    status: orderIntentQueue.STATUS.DONE,
    result: { ok: true, qa: "fifo-first-done" },
  });
  const claimed2 = await orderIntentQueue.claimNextIntent({ workerId: "qa-protection-fifo" });
  assert.strictEqual(claimed2.id, rows[1].id);
  await orderIntentQueue.completeIntent({
    id: claimed2.id,
    status: orderIntentQueue.STATUS.DONE,
    result: { ok: true, qa: "fifo-second-done" },
  });

  await cleanupUid(uid);
  await seedOwnership(payload);
  await enqueue(payload);
  const protectedResult = await orderIntentWorker.processOneIntent({
    workerId: "qa-protection-worker",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(protectedResult.status, orderIntentQueue.STATUS.DONE);
  rows = await loadRowsForUid(uid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.PROTECTION_QUEUE_STATE.PROTECTED);

  const partialUid = uid + 1;
  const partialPayload = buildPayload({ uid: partialUid, pid: 7902, sourceTradeId: "partial" });
  await cleanupUid(partialUid);
  await seedOwnership(partialPayload);
  await enqueue(partialPayload);
  const partialResult = await orderIntentWorker.processOneIntent({
    workerId: "qa-protection-partial",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
    mockProtectionResult: {
      takeProfit: { clientOrderId: "GTP_L_900902_7902_11111111" },
      stop: { errorCode: -2019, errorMessage: "mock stop rejected" },
    },
  });
  assert.strictEqual(partialResult.status, orderIntentQueue.STATUS.BLOCKED);
  rows = await loadRowsForUid(partialUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.PROTECTION_QUEUE_STATE.PARTIAL);

  const rejectUid = uid + 2;
  const rejectPayload = buildPayload({ uid: rejectUid, pid: 7903, sourceTradeId: "reject2021" });
  await cleanupUid(rejectUid);
  await seedOwnership(rejectPayload);
  await enqueue(rejectPayload);
  await orderIntentWorker.processOneIntent({
    workerId: "qa-protection-2021",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
    mockProtectionResult: {
      takeProfit: { errorCode: -2021, errorMessage: "Order would immediately trigger.", immediateTrigger: true },
      stop: { clientOrderId: "GSTOP_L_900903_7903_11111111" },
    },
  });
  rows = await loadRowsForUid(rejectUid);
  assert.strictEqual(rows[0].status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(rows[0].result.protectionReason, "PROTECTION_IMMEDIATE_TRIGGER_REJECTED");

  const missingUid = uid + 3;
  const missingPayload = buildPayload({ uid: missingUid, pid: 7904, sourceTradeId: "missing-owner" });
  await cleanupUid(missingUid);
  await enqueue(missingPayload);
  const missingResult = await orderIntentWorker.processOneIntent({
    workerId: "qa-protection-missing-owner",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(missingResult.status, orderIntentQueue.STATUS.BLOCKED);
  rows = await loadRowsForUid(missingUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.PROTECTION_QUEUE_STATE.BLOCKED_OWNERSHIP);

  const redisUid = uid + 4;
  const redisPayload = buildPayload({ uid: redisUid, pid: 7905, sourceTradeId: "redis-block" });
  await cleanupUid(redisUid);
  await seedOwnership(redisPayload);
  await enqueue(redisPayload);
  const redisResult = await orderIntentWorker.processOneIntent({
    workerId: "qa-protection-redis",
    env: LIVE_ENV,
    redisClient: null,
    mock: true,
  });
  assert.strictEqual(redisResult.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(redisResult.reason, liveWriteSafetyGate.REASON.REDIS_LOCK_UNAVAILABLE);

  const gridSource = fs.readFileSync(path.join(__dirname, "../../grid-engine.js"), "utf8");
  assert(gridSource.includes("enqueueGridProtectionCreateIntent"), "grid engine enqueues protection intents");
  assert(gridSource.includes("PROTECTION_INTENT_PENDING"), "pending protection state is projection-visible");
  const directCallCount = (gridSource.match(/placeLiveExitOrdersForLeg\(/g) || []).length;
  assert.strictEqual(directCallCount, 1, "direct protection write helper is only called behind the queue guard");
  assert(gridSource.includes("useDurableProtectionQueue !== false"), "direct helper requires explicit non-default override");

  await cleanupUid(uid);
  await cleanupUid(partialUid);
  await cleanupUid(rejectUid);
  await cleanupUid(missingUid);
  await cleanupUid(redisUid);
  await db.end();
  console.log("protection-intent-queue-static-test PASS");
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try {
    await cleanupUid(900901);
    await cleanupUid(900902);
    await cleanupUid(900903);
    await cleanupUid(900904);
    await cleanupUid(900905);
    await db.end();
  } catch (_) {}
  process.exit(1);
});
