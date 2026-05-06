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

const redisReady = { set: () => {}, isOpen: true, isReady: true };
const BASE_UID = 901101;

const cleanupUid = async (uid) => {
  await orderIntentQueue.deleteQaIntentsByUid(uid);
  await db.query("DELETE FROM live_pid_exit_reservation WHERE uid = ?", [uid]);
  await db.query("DELETE FROM live_pid_position_snapshot WHERE uid = ?", [uid]);
  await db.query("DELETE FROM live_pid_position_ledger WHERE uid = ?", [uid]);
  await db.query("DELETE FROM live_position_bucket_owner WHERE uid = ?", [uid]);
};

const cleanupAll = async () => {
  for (let uid = BASE_UID; uid < BASE_UID + 20; uid += 1) {
    await cleanupUid(uid);
  }
};

const buildCancelPayload = ({
  uid = BASE_UID,
  pid = 9101,
  symbol = "PUMPUSDT",
  targetType = "ALL_FOR_REGIME",
  reason = "SL_TERMINATION",
  targetClientOrderId = null,
} = {}) => ({
  uid,
  pid,
  gridRowId: pid,
  regimeId: pid,
  symbol,
  targetType,
  targetClientOrderId,
  includeEntries: true,
  includeExits: true,
  reason,
  sourceReason: reason,
});

const buildClosePayload = ({
  uid = BASE_UID + 5,
  pid = 9201,
  symbol = "XRPUSDT",
  positionSide = "LONG",
  qty = 1,
  reason = "GMANUAL",
  sourceTradeId = "qa-close-source-1",
} = {}) => ({
  uid,
  pid,
  gridRowId: pid,
  regimeId: pid,
  symbol,
  positionSide,
  qty,
  ownedQtyBasis: qty,
  reason,
  sourceTradeId,
  sourceClientOrderId: `GMANUAL_${positionSide === "SHORT" ? "S" : "L"}_${uid}_${pid}_SOURCE`,
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

const seedOwnership = async ({ uid, pid, symbol = "XRPUSDT", positionSide = "LONG", qty = 1 } = {}) => {
  await pidPositionLedger.applyEntryFill({
    uid,
    pid,
    strategyCategory: "grid",
    symbol,
    positionSide,
    sourceClientOrderId: `GENTRY_${positionSide === "SHORT" ? "S" : "L"}_${uid}_${pid}_STATIC`,
    sourceOrderId: `entry-${uid}-${pid}`,
    sourceTradeId: `entry-trade-${uid}-${pid}`,
    fillQty: qty,
    fillPrice: 2.5,
    tradeTime: "2026-05-06 00:00:00",
    eventType: "QA_CLOSE_INTENT_ENTRY_FILL",
  });
};

(async () => {
  await cleanupAll();
  await orderIntentQueue.ensureOrderIntentSchema();

  const cancelUid = BASE_UID;
  const cancelPayload = buildCancelPayload({ uid: cancelUid });
  const cancelFirst = await orderIntentQueue.enqueueGridCancelIntent({
    payload: cancelPayload,
    routePath: "qa-cancel-close-intent-test",
  });
  assert.strictEqual(cancelFirst.inserted, 1, "SL termination enqueues cancel-all intent");
  const cancelDuplicate = await orderIntentQueue.enqueueGridCancelIntent({
    payload: cancelPayload,
    routePath: "qa-cancel-close-intent-test",
  });
  assert.strictEqual(cancelDuplicate.inserted, 0, "duplicate cancel creates one intent");

  const cancelTimeout = await orderIntentWorker.processOneIntent({
    workerId: "qa-cancel-timeout",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
    mockCancelResult: { timeout: true },
  });
  assert.strictEqual(cancelTimeout.status, orderIntentQueue.STATUS.BLOCKED);
  let rows = await loadRowsForUid(cancelUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.CANCEL_QUEUE_STATE.VERIFY_PENDING);

  const cancel404Uid = BASE_UID + 1;
  await cleanupUid(cancel404Uid);
  await orderIntentQueue.enqueueGridCancelIntent({
    payload: buildCancelPayload({ uid: cancel404Uid, targetClientOrderId: "GENTRY_L_901102_9101_11111111" }),
    routePath: "qa-cancel-close-intent-test",
  });
  const cancel404 = await orderIntentWorker.processOneIntent({
    workerId: "qa-cancel-404-gone",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
    mockCancelResult: { notFound: true },
  });
  assert.strictEqual(cancel404.status, orderIntentQueue.STATUS.DONE);
  rows = await loadRowsForUid(cancel404Uid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.CANCEL_QUEUE_STATE.VERIFIED_GONE);

  const cancel404ActiveUid = BASE_UID + 2;
  await cleanupUid(cancel404ActiveUid);
  await orderIntentQueue.enqueueGridCancelIntent({
    payload: buildCancelPayload({ uid: cancel404ActiveUid, targetClientOrderId: "GENTRY_L_901103_9101_22222222" }),
    routePath: "qa-cancel-close-intent-test",
  });
  const cancel404Active = await orderIntentWorker.processOneIntent({
    workerId: "qa-cancel-404-active",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
    mockCancelResult: { notFound: true, openOrderStillPresent: true },
  });
  assert.strictEqual(cancel404Active.status, orderIntentQueue.STATUS.BLOCKED);
  rows = await loadRowsForUid(cancel404ActiveUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.CANCEL_QUEUE_STATE.FAILED_ACTIVE_ORDER_REMAINS);

  const manualUid = BASE_UID + 5;
  await cleanupUid(manualUid);
  await seedOwnership({ uid: manualUid, pid: 9201, qty: 1 });
  const manualPayload = buildClosePayload({ uid: manualUid, pid: 9201, qty: 1, reason: "GMANUAL" });
  const manualFirst = await orderIntentQueue.enqueueGridCloseIntent({
    payload: manualPayload,
    routePath: "qa-cancel-close-intent-test",
  });
  assert.strictEqual(manualFirst.inserted, 1, "GMANUAL close enqueues close intent");
  const manualDuplicate = await orderIntentQueue.enqueueGridCloseIntent({
    payload: manualPayload,
    routePath: "qa-cancel-close-intent-test",
  });
  assert.strictEqual(manualDuplicate.inserted, 0, "duplicate GMANUAL close creates one intent");
  assert(/^GMANUAL_L_901106_9201_\d{8}$/.test(manualFirst.intent.closeClientOrderId), "GMANUAL close clientOrderId is deterministic");

  const closeSuccess = await orderIntentWorker.processOneIntent({
    workerId: "qa-close-success",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(closeSuccess.status, orderIntentQueue.STATUS.DONE);
  rows = await loadRowsForUid(manualUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.CLOSE_QUEUE_STATE.RUNNING);
  assert.strictEqual(Number(rows[0].result.closeQty), 1, "close qty uses ownership bucket");

  const overCloseUid = BASE_UID + 6;
  await cleanupUid(overCloseUid);
  await seedOwnership({ uid: overCloseUid, pid: 9202, qty: 1 });
  await orderIntentQueue.enqueueGridCloseIntent({
    payload: buildClosePayload({ uid: overCloseUid, pid: 9202, qty: 2, reason: "CONTROLLED_CLOSE" }),
    routePath: "qa-cancel-close-intent-test",
  });
  const overClose = await orderIntentWorker.processOneIntent({
    workerId: "qa-close-over-owned",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(overClose.status, orderIntentQueue.STATUS.BLOCKED);
  rows = await loadRowsForUid(overCloseUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP);

  const reservedUid = BASE_UID + 7;
  await cleanupUid(reservedUid);
  await seedOwnership({ uid: reservedUid, pid: 9203, qty: 1 });
  await positionOwnership.reserveCloseQty({
    uid: reservedUid,
    ownerPid: 9203,
    ownerStrategyCategory: "grid",
    symbol: "XRPUSDT",
    positionSide: "LONG",
    qty: 1,
  });
  await orderIntentQueue.enqueueGridCloseIntent({
    payload: buildClosePayload({ uid: reservedUid, pid: 9203, qty: 1, reason: "CONTROLLED_CLOSE" }),
    routePath: "qa-cancel-close-intent-test",
  });
  const reserved = await orderIntentWorker.processOneIntent({
    workerId: "qa-close-reserved",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(reserved.status, orderIntentQueue.STATUS.BLOCKED);
  rows = await loadRowsForUid(reservedUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.CLOSE_QUEUE_STATE.RESERVED_DUPLICATE);

  const missingUid = BASE_UID + 8;
  await cleanupUid(missingUid);
  await orderIntentQueue.enqueueGridCloseIntent({
    payload: buildClosePayload({ uid: missingUid, pid: 9204, qty: 1, reason: "CONTROLLED_CLOSE" }),
    routePath: "qa-cancel-close-intent-test",
  });
  const missing = await orderIntentWorker.processOneIntent({
    workerId: "qa-close-missing-owner",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(missing.status, orderIntentQueue.STATUS.BLOCKED);
  rows = await loadRowsForUid(missingUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP);

  const redisUid = BASE_UID + 9;
  await cleanupUid(redisUid);
  await orderIntentQueue.enqueueGridCancelIntent({
    payload: buildCancelPayload({ uid: redisUid }),
    routePath: "qa-cancel-close-intent-test",
  });
  const redisBlocked = await orderIntentWorker.processOneIntent({
    workerId: "qa-cancel-redis",
    env: LIVE_ENV,
    redisClient: null,
    mock: true,
  });
  assert.strictEqual(redisBlocked.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(redisBlocked.reason, liveWriteSafetyGate.REASON.REDIS_LOCK_UNAVAILABLE);

  const failUid = BASE_UID + 10;
  await cleanupUid(failUid);
  await seedOwnership({ uid: failUid, pid: 9205, qty: 1 });
  await orderIntentQueue.enqueueGridCloseIntent({
    payload: buildClosePayload({ uid: failUid, pid: 9205, qty: 1, reason: "CONTROLLED_CLOSE" }),
    routePath: "qa-cancel-close-intent-test",
  });
  const closeFail = await orderIntentWorker.processOneIntent({
    workerId: "qa-close-fail",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
    mockCloseResult: { ok: false, reason: "MOCK_CLOSE_FAILED" },
  });
  assert.strictEqual(closeFail.status, orderIntentQueue.STATUS.FAILED);
  rows = await loadRowsForUid(failUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.CLOSE_QUEUE_STATE.FAILED);

  const gridSource = fs.readFileSync(path.join(__dirname, "../../grid-engine.js"), "utf8");
  assert(gridSource.includes("enqueueGridCancelIntent"), "grid engine enqueues cancel intents");
  assert(gridSource.includes("enqueueGridCloseIntent"), "grid engine enqueues close intents");
  assert(!gridSource.includes("closeGridLegMarketOrder"), "event thread does not directly close grid legs");
  assert(!gridSource.includes("cancelGridOrders"), "event thread does not directly cancel grid orders");
  assert(!/buildGridClientOrderId\(\"GMANUAL\"/.test(gridSource), "live path does not use Date.now GMANUAL clientOrderId");

  await cleanupAll();
  await db.end();
  console.log("cancel-close-intent-queue-static-test PASS");
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try {
    await cleanupAll();
    await db.end();
  } catch (_) {}
  process.exit(1);
});
