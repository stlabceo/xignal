"use strict";

const assert = require("assert");

const db = require("../../database/connect/config");
const pidPositionLedger = require("../../pid-position-ledger");
const orderIntentQueue = require("../../order-intent-queue");
const orderIntentWorker = require("../../order-intent-worker");
const binanceWriteGuard = require("../../binance-write-guard");
const signalEntryConvergence = require("../../signal-entry-convergence");

const UID = 901721;
const PID = 9721;
const SYMBOL = "XRPUSDT";
const ENTRY_ORDER_ID = "QA_SIGNAL_ENTRY_ORDER_9721";
const ENTRY_CLIENT_ORDER_ID = `NEW_${UID}_${PID}`;
const redisReady = { set: () => {}, isOpen: true, isReady: true };

const LIVE_ENV = {
  ORDER_INTENT_WORKER_ACTUAL_DISPATCH_ENABLED: "1",
  BINANCE_LIVE_WRITES_ENABLED: "1",
  BINANCE_WRITE_APPROVAL: binanceWriteGuard.LIVE_WRITE_APPROVAL,
};

const cleanup = async () => {
  await orderIntentQueue.deleteQaIntentsByUid(UID);
  await db.query("DELETE FROM live_pid_exit_reservation WHERE uid = ?", [UID]);
  await db.query("DELETE FROM live_pid_position_snapshot WHERE uid = ?", [UID]);
  await db.query("DELETE FROM live_pid_position_ledger WHERE uid = ?", [UID]);
  await db.query("DELETE FROM live_position_bucket_owner WHERE uid = ?", [UID]);
};

const loadIntents = async () => {
  const [rows] = await db.query(
    `SELECT id, intentType, status, resultJson, lastErrorCode, lastErrorMessage
       FROM order_intent_queue
      WHERE uid = ?
      ORDER BY id ASC`,
    [UID]
  );
  return rows.map((row) => ({
    ...row,
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
  }));
};

const enqueueEntry = async () => orderIntentQueue.enqueueSignalMarketEntryIntent({
  routePath: "qa-signal-live-dispatch-replay",
  payload: {
    uid: UID,
    pid: PID,
    symbol: SYMBOL,
    side: "BUY",
    positionSide: "LONG",
    strategyRuntimeCode: "ATF+VIXFIX",
    timeframe: "15MIN",
    sourceRuntimeTid: "qa-live-dispatch-entry",
    signalPrice: 1.2,
    signalTime: "2026-06-21 14:20:00",
    margin: 7,
    leverage: 1,
    limitST: "N",
  },
});

const seedOpenSignalPosition = async () => {
  await pidPositionLedger.applyEntryFill({
    uid: UID,
    pid: PID,
    strategyCategory: "signal",
    symbol: SYMBOL,
    positionSide: "LONG",
    sourceClientOrderId: ENTRY_CLIENT_ORDER_ID,
    sourceOrderId: ENTRY_ORDER_ID,
    sourceTradeId: "QA_SIGNAL_ENTRY_TRADE_9721",
    eventType: "QA_SIGNAL_ENTRY_FILL",
    fillQty: 6.1,
    fillPrice: 1.1444,
    tradeTime: "2026-06-21 14:20:03",
  });
};

(async () => {
  await cleanup();
  await orderIntentQueue.ensureOrderIntentSchema();

  const enqueuedEntry = await enqueueEntry();
  assert.strictEqual(enqueuedEntry.inserted, 1, "entry intent must be queued");
  await seedOpenSignalPosition();

  const entryResult = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-live-entry-parent",
    env: LIVE_ENV,
    redisClient: redisReady,
    ownershipReadiness: { enabled: true, status: "OK", legacyDisabled: false },
    mock: true,
    now: "2026-06-21 14:20:04",
    mockSignalEntryResult: {
      orderId: ENTRY_ORDER_ID,
      clientOrderId: ENTRY_CLIENT_ORDER_ID,
      ownerRowId: 1,
      convergence: {
        ok: false,
        state: signalEntryConvergence.ENTRY_STATE.ENTRY_LIFECYCLE_COMPLETE,
        reason: signalEntryConvergence.ENTRY_STATE.PROTECTION_INTENT_CREATED,
        fillConfirmed: true,
        ledgerApplied: true,
        ownershipOpen: true,
        snapshotOpen: true,
        protectionChildState: signalEntryConvergence.ENTRY_STATE.PROTECTION_INTENT_CREATED,
      },
    },
  });
  assert.strictEqual(entryResult.status, orderIntentQueue.STATUS.BLOCKED, "parent waits for protection child");

  const [parent] = await loadIntents();
  assert(parent, "parent intent exists");
  assert.strictEqual(parent.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(parent.result.convergence.fillConfirmed, true);

  const protectionPayload = {
    uid: UID,
    pid: PID,
    symbol: SYMBOL,
    side: "BUY",
    positionSide: "LONG",
    qty: 6.1,
    ownedQty: 6.1,
    entryOrderId: ENTRY_ORDER_ID,
    entryPrice: 1.1444,
    takeProfitPrice: 1.1558,
    stopPrice: 1.133,
    splitStageQty: 0,
    splitStageIndex: 0,
    boundType: "PROFIT",
    entryIntentId: parent.id,
    ownerRowId: 1,
    reason: "SIGNAL_PROTECTION_CREATE",
  };
  const enqueuedProtection = await orderIntentQueue.enqueueSignalProtectionIntent({
    payload: protectionPayload,
    routePath: "qa-signal-live-dispatch-replay",
  });
  assert.strictEqual(enqueuedProtection.inserted, 1, "protection intent must be queued");

  const protectionResult = await orderIntentWorker.processOneIntent({
    workerId: "qa-signal-live-protection-child",
    env: LIVE_ENV,
    redisClient: redisReady,
    ownershipReadiness: { enabled: true, status: "OK", legacyDisabled: false },
    dbEvaluation: { ok: true, fingerprint: { databaseName: "quantu_local" }, failures: [] },
    queueReady: true,
    readGuardSnapshot: { globalBlocked: false, uidBlocks: [] },
    timeSyncReady: true,
    signalProtectionDispatcher: async ({ payload, qty }) => ({
      takeProfit: {
        clientOrderId: `PROFIT_${payload.uid}_${payload.pid}_${payload.entryOrderId}`,
        orderId: "QA_TP_ORDER_9721",
        sourceOrderId: "QA_TP_ORDER_9721",
        quantity: qty,
      },
      stop: {
        clientOrderId: `STOP_${payload.uid}_${payload.pid}_${payload.entryOrderId}`,
        orderId: "QA_STOP_ORDER_9721",
        sourceOrderId: "QA_STOP_ORDER_9721",
        quantity: qty,
      },
    }),
  });
  assert.strictEqual(protectionResult.status, orderIntentQueue.STATUS.DONE, "protection child must finish DONE");

  const rows = await loadIntents();
  const parentAfter = rows.find((row) => row.id === parent.id);
  const childAfter = rows.find((row) => row.intentType === orderIntentQueue.INTENT_TYPE.SIGNAL_PROTECTION_CREATE);
  assert.strictEqual(childAfter.status, orderIntentQueue.STATUS.DONE);
  assert.strictEqual(parentAfter.status, orderIntentQueue.STATUS.DONE, "parent entry must be promoted to DONE by child success");
  assert.strictEqual(parentAfter.lastErrorCode, null);
  assert.strictEqual(parentAfter.result.protectionChildState, signalEntryConvergence.ENTRY_STATE.ENTRY_PROTECTED_ACKED);
  assert.strictEqual(parentAfter.result.projectionState, "ENTRY_LIFECYCLE_COMPLETE");

  await cleanup();
  await db.end();
  console.log("signal-live-market-entry-protection-dispatch-replay-test PASS");
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try {
    await cleanup();
    await db.end();
  } catch (_) {}
  process.exit(1);
});
