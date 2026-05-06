"use strict";

const assert = require("assert");

const liveWriteSafetyGate = require("../../live-write-safety-gate");
const binanceWriteGuard = require("../../binance-write-guard");
const positionOwnership = require("../../position-ownership");

const LIVE_ENV = {
  BINANCE_LIVE_WRITES_ENABLED: "1",
  BINANCE_WRITE_APPROVAL: binanceWriteGuard.LIVE_WRITE_APPROVAL,
};

const READONLY_ENV = {
  QA_DISABLE_BINANCE_WRITES: "1",
  BINANCE_LIVE_WRITES_ENABLED: "1",
  BINANCE_WRITE_APPROVAL: binanceWriteGuard.LIVE_WRITE_APPROVAL,
};

const assertBlocked = (decision, reason) => {
  assert.strictEqual(decision.allowed, false);
  assert.strictEqual(decision.reason, reason);
};

(() => {
  const decision = liveWriteSafetyGate.evaluateRedisLockReservation({
    redisReserved: true,
    env: LIVE_ENV,
    liveScope: true,
    strategyCategory: "grid",
    scope: "LIVE:ARM:5",
  });
  assert.strictEqual(decision.allowed, true);
})();

(() => {
  const decision = liveWriteSafetyGate.evaluateRedisLockReservation({
    redisReserved: null,
    env: LIVE_ENV,
    liveScope: true,
    strategyCategory: "grid",
    scope: "LIVE:ARM:5",
  });
  assertBlocked(decision, liveWriteSafetyGate.REASON.REDIS_LOCK_UNAVAILABLE);
})();

(() => {
  const decision = liveWriteSafetyGate.evaluateRedisLockReservation({
    redisReserved: null,
    env: READONLY_ENV,
    liveScope: true,
    strategyCategory: "grid",
    scope: "LIVE:ARM:5",
  });
  assert.strictEqual(decision.allowed, true);
})();

(() => {
  const decision = liveWriteSafetyGate.evaluateOwnershipGuard({
    env: LIVE_ENV,
    strategyCategory: "signal",
    pid: 7,
    symbol: "XRPUSDT",
    positionSide: "LONG",
    ownershipEnabled: false,
  });
  assertBlocked(decision, liveWriteSafetyGate.REASON.OWNERSHIP_DISABLED);
})();

(() => {
  const decision = liveWriteSafetyGate.evaluateOwnershipGuard({
    env: LIVE_ENV,
    strategyCategory: "signal",
    pid: 7,
    symbol: "XRPUSDT",
    positionSide: "LONG",
    ownershipEnabled: true,
  });
  assert.strictEqual(decision.allowed, true);
})();

(() => {
  const decision = liveWriteSafetyGate.evaluateGridRequestThreadWrite({
    env: LIVE_ENV,
    liveArmedCount: 1,
    routePath: "/user/api/grid/hook",
    strategyCategory: "grid",
  });
  assertBlocked(decision, liveWriteSafetyGate.REASON.QUEUE_REQUIRED_FOR_LIVE_GRID_WRITE);
})();

(() => {
  const decision = liveWriteSafetyGate.evaluateGridRequestThreadWrite({
    env: LIVE_ENV,
    liveArmedCount: 0,
    routePath: "/user/api/grid/hook",
    strategyCategory: "grid",
  });
  assert.strictEqual(decision.allowed, true);
})();

(() => {
  assert.doesNotThrow(() =>
    binanceWriteGuard.assertBinanceWriteAllowed({
      env: LIVE_ENV,
      uid: 156,
      pid: 7,
      strategyCategory: "signal",
      action: "WRITE_CREATE_ORDER",
      symbol: "XRPUSDT",
      positionSide: "LONG",
      ownershipEnabled: true,
    })
  );
})();

(async () => {
  const qaUid = 900820;
  const db = require("../../database/connect/config");
  await db.query("DELETE FROM live_position_bucket_owner WHERE uid = ?", [qaUid]);
  const reservation = await positionOwnership.acquirePositionBucketOwner({
    env: LIVE_ENV,
    uid: qaUid,
    symbol: "PUMPUSDT",
    positionSide: "LONG",
    ownerPid: 9,
    ownerStrategyCategory: "grid",
  });
  assert.strictEqual(reservation.ok, true);
  assert.strictEqual(reservation.legacyDisabled, false);

  const replayReservation = await positionOwnership.acquirePositionBucketOwner({
    env: READONLY_ENV,
    uid: qaUid,
    symbol: "PUMPUSDT",
    positionSide: "LONG",
    ownerPid: 9,
    ownerStrategyCategory: "grid",
  });
  assert.strictEqual(replayReservation.ok, true);

  const readiness = liveWriteSafetyGate.buildReadinessSnapshot({
    env: LIVE_ENV,
    redisClient: { set: () => {}, isOpen: false, isReady: false },
    orderIntentQueueEnabled: false,
    ownershipEnabled: true,
  });
  assert.strictEqual(readiness.status, "BLOCKED");
  assert(readiness.blockers.some((item) => item.code === liveWriteSafetyGate.REASON.REDIS_LOCK_UNAVAILABLE));
  assert(!readiness.blockers.some((item) => item.code === liveWriteSafetyGate.REASON.OWNERSHIP_DISABLED));
  assert(readiness.blockers.some((item) => item.code === liveWriteSafetyGate.REASON.QUEUE_REQUIRED_FOR_LIVE_GRID_WRITE));

  await db.query("DELETE FROM live_position_bucket_owner WHERE uid = ?", [qaUid]);
  await db.end();
  console.log("live-write-safety-gate-static-test PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
