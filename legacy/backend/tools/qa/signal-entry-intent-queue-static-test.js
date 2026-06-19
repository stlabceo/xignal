"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const db = require("../../database/connect/config");
const orderIntentQueue = require("../../order-intent-queue");
const orderIntentWorker = require("../../order-intent-worker");
const liveWriteSafetyGate = require("../../live-write-safety-gate");
const binanceWriteGuard = require("../../binance-write-guard");
const orderIntentDispatchGate = require("../../order-intent-dispatch-gate");

const BASE_UID = 901401;
const LIVE_ENV = {
  BINANCE_LIVE_WRITES_ENABLED: "1",
  BINANCE_WRITE_APPROVAL: binanceWriteGuard.LIVE_WRITE_APPROVAL,
};
const redisReady = { set: () => {}, isOpen: true, isReady: true };

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

const buildPayload = ({
  uid = BASE_UID,
  pid = 9401,
  symbol = "PUMPUSDT",
  side = "BUY",
  signalTime = "2026-05-06 00:00:00",
  signalPrice = 1.25,
  sourceRuntimeTid = "qa-signal-entry-1",
} = {}) => ({
  uid,
  pid,
  symbol,
  side,
  positionSide: side === "SELL" ? "SHORT" : "LONG",
  strategyRuntimeCode: "SQZGBRK",
  timeframe: "30MIN",
  sourceRuntimeTid,
  signalPrice,
  signalTime,
  margin: 10,
  leverage: 1,
  limitST: "N",
});

const enqueue = (payload) =>
  orderIntentQueue.enqueueSignalMarketEntryIntent({
    payload,
    routePath: "qa-signal-entry-intent-test",
  });

const loadRowsForUid = async (uid) => {
  const [rows] = await db.query(
    `SELECT id, intentKey, fifoKey, uid, pid, intentType, status, resultJson, lastErrorCode
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

  const buyPayload = buildPayload({ uid: BASE_UID, pid: 9401, side: "BUY", sourceRuntimeTid: "buy-1" });
  const buy = await enqueue(buyPayload);
  assert.strictEqual(buy.inserted, 1, "Signal BUY webhook enqueues market entry intent");
  assert.strictEqual(buy.intent.intentType, orderIntentQueue.INTENT_TYPE.SIGNAL_MARKET_ENTRY);
  assert.strictEqual(buy.intent.clientOrderId, "NEW_901401_9401");

  const duplicate = await enqueue(buyPayload);
  assert.strictEqual(duplicate.inserted, 0, "duplicate Signal webhook creates one intent");

  const sellUid = BASE_UID + 1;
  const sell = await enqueue(buildPayload({
    uid: sellUid,
    pid: 9402,
    symbol: "XRPUSDT",
    side: "SELL",
    sourceRuntimeTid: "sell-1",
  }));
  assert.strictEqual(sell.inserted, 1, "Signal SELL webhook enqueues market entry intent");

  await cleanupUid(BASE_UID);
  await cleanupUid(sellUid);

  const fifoUid = BASE_UID + 2;
  await enqueue(buildPayload({ uid: fifoUid, pid: 9403, sourceRuntimeTid: "fifo-1", signalTime: "2026-05-06 00:00:01" }));
  await enqueue(buildPayload({ uid: fifoUid, pid: 9403, sourceRuntimeTid: "fifo-2", signalTime: "2026-05-06 00:00:02" }));
  let rows = await loadRowsForUid(fifoUid);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].fifoKey, rows[1].fifoKey, "same UID/PID Signal intents share FIFO key");
  const claimed = await orderIntentQueue.claimNextIntent({ workerId: "qa-signal-fifo" });
  assert.strictEqual(claimed.id, rows[0].id);
  const blockedByFifo = await orderIntentQueue.claimNextIntent({ workerId: "qa-signal-fifo" });
  assert.strictEqual(blockedByFifo, null, "second Signal intent waits for first FIFO item");
  await orderIntentQueue.completeIntent({
    id: claimed.id,
    status: orderIntentQueue.STATUS.DONE,
    result: { ok: true, qa: "fifo-first-done" },
  });
  const second = await orderIntentQueue.claimNextIntent({ workerId: "qa-signal-fifo" });
  assert.strictEqual(second.id, rows[1].id);
  await orderIntentQueue.completeIntent({
    id: second.id,
    status: orderIntentQueue.STATUS.DONE,
    result: { ok: true, qa: "fifo-second-done" },
  });

  const mockUid = BASE_UID + 3;
  await enqueue(buildPayload({ uid: mockUid, pid: 9404, sourceRuntimeTid: "mock-success" }));
  const mockSuccess = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-entry-success",
    env: LIVE_ENV,
    redisClient: redisReady,
    ownershipReadiness: { enabled: true, status: "OK", legacyDisabled: false },
    mock: true,
    now: "2026-05-06 00:00:05",
    mockSignalEntryResult: {
      orderId: "MOCK_SIGNAL_ORDER",
      convergence: {
        ok: true,
        state: orderIntentWorker.SIGNAL_ENTRY_QUEUE_STATE.ENTRY_LIFECYCLE_COMPLETE,
        reason: orderIntentWorker.SIGNAL_ENTRY_QUEUE_STATE.ENTRY_LIFECYCLE_COMPLETE,
        protectionChildState: "PROTECTION_ACTIVE",
      },
    },
  });
  assert.strictEqual(mockSuccess.status, orderIntentQueue.STATUS.DONE);
  rows = await loadRowsForUid(mockUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.SIGNAL_ENTRY_QUEUE_STATE.ENTRY_LIFECYCLE_COMPLETE);

  const redisUid = BASE_UID + 4;
  await enqueue(buildPayload({ uid: redisUid, pid: 9405, sourceRuntimeTid: "redis-block" }));
  const redisBlocked = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-entry-redis",
    env: LIVE_ENV,
    redisClient: null,
    ownershipReadiness: { enabled: true, status: "OK", legacyDisabled: false },
    mock: true,
  });
  assert.strictEqual(redisBlocked.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(redisBlocked.reason, liveWriteSafetyGate.REASON.REDIS_LOCK_UNAVAILABLE);

  const ownershipUid = BASE_UID + 5;
  await enqueue(buildPayload({ uid: ownershipUid, pid: 9406, sourceRuntimeTid: "ownership-block" }));
  const ownershipBlocked = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-entry-ownership",
    env: LIVE_ENV,
    redisClient: redisReady,
    ownershipReadiness: { enabled: false, status: "BLOCKED", legacyDisabled: true },
    mock: true,
  });
  assert.strictEqual(ownershipBlocked.status, orderIntentQueue.STATUS.BLOCKED);
  rows = await loadRowsForUid(ownershipUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.SIGNAL_ENTRY_QUEUE_STATE.BLOCKED_OWNERSHIP);

  const dispatchUid = BASE_UID + 6;
  await enqueue(buildPayload({ uid: dispatchUid, pid: 9407, sourceRuntimeTid: "dispatch-disabled" }));
  const dispatchBlocked = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-entry-dispatch",
    env: LIVE_ENV,
    redisClient: redisReady,
    ownershipReadiness: { enabled: true, status: "OK", legacyDisabled: false },
    dbEvaluation: { ok: true, fingerprint: { databaseName: "quantu_local" }, failures: [] },
    queueReady: true,
    readGuardSnapshot: { globalBlocked: false, uidBlocks: [] },
    timeSyncReady: true,
    now: "2026-05-06 00:00:05",
  });
  assert.strictEqual(dispatchBlocked.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(dispatchBlocked.reason, orderIntentDispatchGate.GATE_REASON.ACTUAL_DISPATCH_DISABLED);

  const staleUid = BASE_UID + 7;
  await enqueue(buildPayload({
    uid: staleUid,
    pid: 9408,
    sourceRuntimeTid: "stale-signal",
    signalTime: "2026-05-06 00:00:00",
  }));
  const staleBlocked = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-entry-stale",
    env: LIVE_ENV,
    redisClient: redisReady,
    ownershipReadiness: { enabled: true, status: "OK", legacyDisabled: false },
    mock: true,
    now: "2026-05-06 00:01:00",
  });
  assert.strictEqual(staleBlocked.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(staleBlocked.reason, orderIntentWorker.SIGNAL_ENTRY_QUEUE_STATE.STALE);

  const failUid = BASE_UID + 8;
  await enqueue(buildPayload({ uid: failUid, pid: 9409, sourceRuntimeTid: "submit-fail" }));
  const submitFail = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-entry-fail",
    env: LIVE_ENV,
    redisClient: redisReady,
    ownershipReadiness: { enabled: true, status: "OK", legacyDisabled: false },
    mock: true,
    now: "2026-05-06 00:00:05",
    mockSignalEntryResult: { ok: false, reason: "MOCK_SIGNAL_ENTRY_FAILED" },
  });
  assert.strictEqual(submitFail.status, orderIntentQueue.STATUS.FAILED);
  rows = await loadRowsForUid(failUid);
  assert.strictEqual(rows[0].result.projectionState, orderIntentWorker.SIGNAL_ENTRY_QUEUE_STATE.FAILED);

  const seonSource = fs.readFileSync(path.join(__dirname, "../../seon.js"), "utf8");
  assert(seonSource.includes("enqueueSignalMarketEntryIntent"), "Signal runtime enqueues market entry intents");
  assert(!seonSource.includes("coin.sendEnter("), "Signal runtime does not directly call market entry write");

  const coinSource = fs.readFileSync(path.join(__dirname, "../../coin.js"), "utf8");
  assert(coinSource.includes("syncLiveBoundExitOrders"), "Signal protection direct path remains for P0-11B audit");
  assert(coinSource.includes("exports.sendForcing"), "Signal forced close direct path remains for P0-11B audit");
  assert(coinSource.includes("cancelFuturesOrder"), "Signal cancel direct helper remains for P0-11B audit");

  await cleanupAll();
  await db.end();
  console.log("signal-entry-intent-queue-static-test PASS");
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try {
    await cleanupAll();
    await db.end();
  } catch (_) {}
  process.exit(1);
});
