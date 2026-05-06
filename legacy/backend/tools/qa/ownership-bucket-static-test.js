"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const db = require("../../database/connect/config");
const pidPositionLedger = require("../../pid-position-ledger");
const positionOwnership = require("../../position-ownership");
const liveWriteSafetyGate = require("../../live-write-safety-gate");
const binanceWriteGuard = require("../../binance-write-guard");

const UID = 900830;
const PID_A = 8301;
const PID_B = 8302;
const SYMBOL = "XRPUSDT";
const SIDE = "LONG";

const LIVE_ENV = {
  BINANCE_LIVE_WRITES_ENABLED: "1",
  BINANCE_WRITE_APPROVAL: binanceWriteGuard.LIVE_WRITE_APPROVAL,
};

const cleanup = async () => {
  await db.query("DELETE FROM live_pid_exit_reservation WHERE uid = ?", [UID]);
  await db.query("DELETE FROM live_pid_position_ledger WHERE uid = ?", [UID]);
  await db.query("DELETE FROM live_pid_position_snapshot WHERE uid = ?", [UID]);
  await db.query("DELETE FROM live_position_bucket_owner WHERE uid = ?", [UID]);
};

const loadOwner = async (pid, category = "grid") =>
  positionOwnership.loadPositionBucketOwner({
    uid: UID,
    pid,
    strategyCategory: category,
    symbol: SYMBOL,
    positionSide: SIDE,
  });

const assertQty = (actual, expected, message) => {
  assert(Math.abs(Number(actual || 0) - Number(expected || 0)) < 1e-9, message);
};

(async () => {
  await cleanup();

  const readiness = await positionOwnership.getOwnershipReadiness({ force: true });
  assert.strictEqual(readiness.enabled, true);
  assert.strictEqual(positionOwnership.OWNERSHIP_LEGACY_DISABLED, false);

  const ownershipGate = liveWriteSafetyGate.evaluateOwnershipGuard({
    env: LIVE_ENV,
    uid: UID,
    pid: PID_A,
    strategyCategory: "grid",
    symbol: SYMBOL,
    positionSide: SIDE,
    ownershipEnabled: positionOwnership.isOwnershipEnabled(),
  });
  assert.strictEqual(ownershipGate.allowed, true);

  const firstEntry = await pidPositionLedger.applyEntryFill({
    uid: UID,
    pid: PID_A,
    strategyCategory: "grid",
    symbol: SYMBOL,
    positionSide: SIDE,
    sourceClientOrderId: "GENTRY_L_900830_8301_STATIC",
    sourceOrderId: "1001",
    sourceTradeId: "trade-a-1",
    fillQty: 1.2,
    fillPrice: 2.5,
    tradeTime: "2026-05-06 00:00:00",
    eventType: "QA_ENTRY_FILL",
  });
  assert.strictEqual(firstEntry.ok, true);
  assert.strictEqual(firstEntry.duplicate, false);
  assertQty((await loadOwner(PID_A)).ownedQty, 1.2, "entry fill creates ownership bucket");

  const duplicateEntry = await pidPositionLedger.applyEntryFill({
    uid: UID,
    pid: PID_A,
    strategyCategory: "grid",
    symbol: SYMBOL,
    positionSide: SIDE,
    sourceClientOrderId: "GENTRY_L_900830_8301_STATIC",
    sourceOrderId: "1001",
    sourceTradeId: "trade-a-1",
    fillQty: 1.2,
    fillPrice: 2.5,
    tradeTime: "2026-05-06 00:00:00",
    eventType: "QA_ENTRY_FILL_DUPLICATE",
  });
  assert.strictEqual(duplicateEntry.duplicate, true);
  assertQty((await loadOwner(PID_A)).ownedQty, 1.2, "duplicate fill must not double count");

  await pidPositionLedger.applyEntryFill({
    uid: UID,
    pid: PID_A,
    strategyCategory: "grid",
    symbol: SYMBOL,
    positionSide: SIDE,
    sourceClientOrderId: "GENTRY_L_900830_8301_STATIC",
    sourceOrderId: "1001",
    sourceTradeId: "trade-a-2",
    fillQty: 0.3,
    fillPrice: 2.6,
    tradeTime: "2026-05-06 00:00:01",
    eventType: "QA_ENTRY_PARTIAL_FILL",
  });
  assertQty((await loadOwner(PID_A)).ownedQty, 1.5, "partial fill increments by tradeId");

  await pidPositionLedger.applyEntryFill({
    uid: UID,
    pid: PID_B,
    strategyCategory: "grid",
    symbol: SYMBOL,
    positionSide: SIDE,
    sourceClientOrderId: "GENTRY_L_900830_8302_STATIC",
    sourceOrderId: "2001",
    sourceTradeId: "trade-b-1",
    fillQty: 2,
    fillPrice: 2.4,
    tradeTime: "2026-05-06 00:00:02",
    eventType: "QA_ENTRY_FILL_OTHER_PID",
  });
  assertQty((await loadOwner(PID_B)).ownedQty, 2, "same symbol/side second PID isolated");

  const closeA = await positionOwnership.resolveOwnedCloseQty({
    uid: UID,
    pid: PID_A,
    strategyCategory: "grid",
    symbol: SYMBOL,
    positionSide: SIDE,
    requestedQty: 9,
  });
  assert.strictEqual(closeA.allowed, true);
  assertQty(closeA.finalCloseQty, 1.5, "close qty clamps to PID-owned qty");

  const fullReserve = await positionOwnership.reserveCloseQty({
    uid: UID,
    pid: PID_A,
    strategyCategory: "grid",
    symbol: SYMBOL,
    positionSide: SIDE,
    qty: 1.5,
  });
  assert.strictEqual(fullReserve.ok, true);
  const duplicateReserveBlocked = await positionOwnership.reserveCloseQty({
    uid: UID,
    pid: PID_A,
    strategyCategory: "grid",
    symbol: SYMBOL,
    positionSide: SIDE,
    qty: 0.1,
  });
  assert.strictEqual(duplicateReserveBlocked.ok, false);
  assert.strictEqual(duplicateReserveBlocked.reason, "OWNERSHIP_CLOSE_QTY_RESERVED");
  await positionOwnership.releaseCloseReservation({
    uid: UID,
    pid: PID_A,
    strategyCategory: "grid",
    symbol: SYMBOL,
    positionSide: SIDE,
    qty: 1.5,
  });

  const exitA = await pidPositionLedger.applyExitFill({
    uid: UID,
    pid: PID_A,
    strategyCategory: "grid",
    symbol: SYMBOL,
    positionSide: SIDE,
    sourceClientOrderId: "GTP_L_900830_8301_STATIC",
    sourceOrderId: "3001",
    sourceTradeId: "exit-a-1",
    fillQty: 0.4,
    fillPrice: 2.8,
    realizedPnl: 0.12,
    tradeTime: "2026-05-06 00:00:03",
    eventType: "QA_EXIT_FILL",
  });
  assert.strictEqual(exitA.ok, true);
  assertQty((await loadOwner(PID_A)).ownedQty, 1.1, "exit fill decrements ownership bucket");
  assertQty((await loadOwner(PID_B)).ownedQty, 2, "PID A exit does not reduce PID B");

  const overExit = await pidPositionLedger.applyExitFill({
    uid: UID,
    pid: PID_A,
    strategyCategory: "grid",
    symbol: SYMBOL,
    positionSide: SIDE,
    sourceClientOrderId: "GMANUAL_L_900830_8301_STATIC",
    sourceOrderId: "3002",
    sourceTradeId: "exit-a-over",
    fillQty: 5,
    fillPrice: 2.7,
    realizedPnl: 0.2,
    tradeTime: "2026-05-06 00:00:04",
    eventType: "QA_OVER_EXIT_FILL",
  });
  assert.strictEqual(overExit.ok, true);
  assertQty((await loadOwner(PID_A)).ownedQty, 0, "over-exit cannot make ownership negative");
  assert.strictEqual((await loadOwner(PID_A)).status, "REVIEW");
  assertQty((await loadOwner(PID_B)).ownedQty, 2, "over-exit remains PID scoped");

  const gridEngineSource = fs.readFileSync(path.join(__dirname, "../../grid-engine.js"), "utf8");
  assert(gridEngineSource.includes("positionOwnership.resolveOwnedCloseQty"));
  assert(gridEngineSource.includes("qty: protectionQty"));

  const coinSource = fs.readFileSync(path.join(__dirname, "../../coin.js"), "utf8");
  assert(coinSource.includes("positionOwnership.resolveOwnedCloseQty"));
  assert(coinSource.includes("positionOwnership.reserveCloseQty"));

  await cleanup();
  await db.end();
  console.log("ownership-bucket-static-test PASS");
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try {
    await cleanup();
    await db.end();
  } catch (_) {}
  process.exit(1);
});
