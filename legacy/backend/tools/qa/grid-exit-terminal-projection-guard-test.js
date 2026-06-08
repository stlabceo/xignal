"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });

const db = require("../../database/connect/config");
const orderIntentQueue = require("../../order-intent-queue");
const orderIntentWorker = require("../../order-intent-worker");
const binanceWriteGuard = require("../../binance-write-guard");

const LIVE_ENV = {
  BINANCE_LIVE_WRITES_ENABLED: "1",
  BINANCE_WRITE_APPROVAL: binanceWriteGuard.LIVE_WRITE_APPROVAL,
};

const redisReady = { set: () => {}, isOpen: true, isReady: true };

const UID = 901204;
const PID = 990204;

const cleanup = async () => {
  await orderIntentQueue.deleteQaIntentsByUid(UID);
  await db.query("DELETE FROM live_grid_strategy_list WHERE uid = ?", [UID]);
};

const seedTerminalGridRow = async () => {
  await cleanup();
  await db.query(
    `INSERT INTO live_grid_strategy_list
       (
         id, uid, a_name, strategySignal, symbol, bunbong,
         marginType, margin, leverage, profit, tradeValue, st, autoST,
         enabled, regimeStatus, regimeEndReason,
         longLegStatus, shortLegStatus, longQty, shortQty
       )
     VALUES
       (?, ?, 'QA_TERMINAL_PROJECTION_GUARD', 'SQZ+GRID', 'PUMPUSDT', '30MIN',
        'isolated', 0, 1, 0, 5, NULL, NULL,
        'N', 'ENDED', 'EXPLICIT_GRID_EXIT',
        'IDLE', 'IDLE', 0, 0)`,
    [PID, UID]
  );
};

const loadRow = async () => {
  const [rows] = await db.query(
    `SELECT enabled, regimeStatus, regimeEndReason,
            longLegStatus, shortLegStatus, longQty, shortQty,
            longEntryOrderId, shortEntryOrderId
       FROM live_grid_strategy_list
      WHERE uid = ?
        AND id = ?`,
    [UID, PID]
  );
  return rows[0] || null;
};

const assertTerminalProjectionPreserved = async (label) => {
  const row = await loadRow();
  assert(row, `${label}: row exists`);
  assert.strictEqual(row.enabled, "N", `${label}: enabled remains N`);
  assert.strictEqual(row.regimeStatus, "ENDED", `${label}: regime remains ENDED`);
  assert.strictEqual(row.regimeEndReason, "EXPLICIT_GRID_EXIT", `${label}: end reason preserved`);
  assert.strictEqual(row.longLegStatus, "IDLE", `${label}: long leg remains IDLE`);
  assert.strictEqual(row.shortLegStatus, "IDLE", `${label}: short leg remains IDLE`);
  assert.strictEqual(Number(row.longQty), 0, `${label}: long qty remains 0`);
  assert.strictEqual(Number(row.shortQty), 0, `${label}: short qty remains 0`);
  assert.strictEqual(row.longEntryOrderId, null, `${label}: long entry ref remains null`);
  assert.strictEqual(row.shortEntryOrderId, null, `${label}: short entry ref remains null`);
};

const enqueueStaleProtection = async () =>
  await orderIntentQueue.enqueueGridProtectionCreateIntent({
    routePath: "qa-terminal-projection-guard",
    payload: {
      uid: UID,
      pid: PID,
      gridRowId: PID,
      regimeId: PID,
      symbol: "PUMPUSDT",
      positionSide: "LONG",
      qty: 3773,
      ownedQty: 3773,
      entryPrice: 0.00159,
      entryOrderId: "GENTRY_L_901204_990204_STALE",
      sourceOrderId: "qa-stale-entry",
      sourceTradeId: "qa-stale-trade",
      takeProfitPrice: 0.0016,
      stopPrice: 0.00155,
    },
  });

const enqueueStaleCancel = async () =>
  await orderIntentQueue.enqueueGridCancelIntent({
    routePath: "qa-terminal-projection-guard",
    intentType: orderIntentQueue.INTENT_TYPE.GRID_CANCEL_ALL_FOR_REGIME,
    payload: {
      uid: UID,
      pid: PID,
      gridRowId: PID,
      regimeId: PID,
      symbol: "PUMPUSDT",
      targetType: "PROTECTION",
      includeEntries: false,
      includeExits: true,
      reason: "GRID_CANCEL_NO_LOCAL_ORDER_REFS",
    },
  });

(async () => {
  await orderIntentQueue.ensureOrderIntentSchema();

  await seedTerminalGridRow();
  await enqueueStaleProtection();
  const staleProtection = await orderIntentWorker.processOneIntent({
    workerId: "qa-terminal-projection-protection",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
  });
  assert.strictEqual(staleProtection.status, orderIntentQueue.STATUS.BLOCKED);
  assert.strictEqual(staleProtection.reason, "OWNERSHIP_BUCKET_MISSING_OR_ZERO");
  await assertTerminalProjectionPreserved("stale protection blocked");

  await enqueueStaleCancel();
  const staleCancel = await orderIntentWorker.processOneIntent({
    workerId: "qa-terminal-projection-cancel",
    env: LIVE_ENV,
    redisClient: redisReady,
    mock: true,
    mockCancelResult: {
      verifyPending: true,
      reason: "GRID_CANCEL_NO_LOCAL_ORDER_REFS",
    },
  });
  assert.strictEqual(staleCancel.status, orderIntentQueue.STATUS.BLOCKED);
  await assertTerminalProjectionPreserved("stale cancel blocked");

  const workerSource = fs.readFileSync(path.join(__dirname, "../../order-intent-worker.js"), "utf8");
  assert(
    workerSource.includes('projectionType: "GRID_PROTECTION_PROJECTION"'),
    "stale protection projection preserves terminal Grid rows"
  );
  assert(
    workerSource.includes('projectionType: "GRID_CANCEL_PROJECTION"'),
    "stale cancel projection preserves terminal Grid rows"
  );

  const gridEngineSource = fs.readFileSync(path.join(__dirname, "../../grid-engine.js"), "utf8");
  assert(
    gridEngineSource.includes("GRID_ROW_PROJECTION_STALE_FLATTENED"),
    "truth sync can flatten row-projection-only stale Grid state"
  );
  assert(
    gridEngineSource.includes("ROW_PROJECTION_ONLY_STALE"),
    "row projection stale correction is explicitly reported"
  );

  await cleanup();
  await db.end();
  console.log("grid-exit-terminal-projection-guard-test PASS");
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try {
    await cleanup();
    await db.end();
  } catch (_) {}
  process.exit(1);
});
