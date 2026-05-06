"use strict";

const db = require("./database/connect/config");
const dbFingerprintGuard = require("./database/db-fingerprint-guard");
const orderIntentQueue = require("./order-intent-queue");
const liveWriteSafetyGate = require("./live-write-safety-gate");
const positionOwnership = require("./position-ownership");
const binanceWriteGuard = require("./binance-write-guard");
const binanceReadGuard = require("./binance-read-guard");
const binanceTimeSync = require("./binance-write-time-sync");

const ACTUAL_DISPATCH_ENV = "ORDER_INTENT_WORKER_ACTUAL_DISPATCH_ENABLED";

const GATE_REASON = Object.freeze({
  ACTUAL_DISPATCH_DISABLED: "ORDER_INTENT_ACTUAL_DISPATCH_DISABLED",
  QUANTU_DB_GUARD_FAILED: "ORDER_INTENT_QUANTU_DB_GUARD_FAILED",
  REDIS_UNAVAILABLE: "ORDER_INTENT_REDIS_UNAVAILABLE",
  OWNERSHIP_NOT_READY: "ORDER_INTENT_OWNERSHIP_NOT_READY",
  QUEUE_NOT_READY: "ORDER_INTENT_QUEUE_NOT_READY",
  ACTION_NOT_COVERED: "ORDER_INTENT_ACTION_NOT_COVERED",
  TIME_SYNC_NOT_READY: "ORDER_INTENT_TIME_SYNC_NOT_READY",
  PRIVATE_READ_GUARD_OPEN: "ORDER_INTENT_PRIVATE_READ_GUARD_OPEN",
  BINANCE_WRITE_GUARD_BLOCKED: "ORDER_INTENT_BINANCE_WRITE_GUARD_BLOCKED",
  REPLAY_OR_MOCK_MODE: "ORDER_INTENT_REPLAY_OR_MOCK_MODE",
});

const GRID_ACTION_COVERAGE = Object.freeze([
  orderIntentQueue.INTENT_TYPE.GRID_LIVE_ARM,
  orderIntentQueue.INTENT_TYPE.GRID_PROTECTION_CREATE,
  orderIntentQueue.INTENT_TYPE.GRID_REENTRY_CREATE,
  orderIntentQueue.INTENT_TYPE.GRID_CANCEL_ORDER,
  orderIntentQueue.INTENT_TYPE.GRID_CANCEL_ALL_FOR_REGIME,
  orderIntentQueue.INTENT_TYPE.GRID_REGIME_CLEANUP_CANCEL,
  orderIntentQueue.INTENT_TYPE.GRID_GMANUAL_CLOSE,
  orderIntentQueue.INTENT_TYPE.GRID_CONTROLLED_CLOSE,
  orderIntentQueue.INTENT_TYPE.SIGNAL_MARKET_ENTRY,
]);

const truthy = (value) =>
  ["1", "true", "y", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const normalizeIntentType = (intent = {}, context = {}) =>
  String(context.intentType || intent.intentType || "").trim().toUpperCase();

const normalizeUid = (intent = {}, context = {}) =>
  Number(context.uid || intent.uid || intent.payload?.uid || 0);

const addGate = (gates, gate, passed, reason = null, details = {}) => {
  gates.push({
    gate,
    passed: Boolean(passed),
    reason: passed ? null : reason,
    details,
  });
};

const firstFailedGate = (gates) => gates.find((gate) => gate.passed !== true) || null;

const evaluateDbGuard = async ({ env = process.env, dbFingerprint = null, dbEvaluation = null } = {}) => {
  if (dbEvaluation) {
    return dbEvaluation;
  }

  if (dbFingerprint) {
    const databaseName = String(dbFingerprint.databaseName || dbFingerprint.database || "").trim();
    return {
      ok: databaseName === "quantu_local",
      fingerprint: dbFingerprint,
      failures: databaseName === "quantu_local" ? [] : [`unexpected database:${databaseName || "UNKNOWN"}`],
    };
  }

  const fingerprint = await dbFingerprintGuard.readDatabaseFingerprint(db);
  const evaluation = dbFingerprintGuard.evaluateDbTarget(
    {
      host: env.MYSQL_HOST || env.DB_HOST,
      port: String(fingerprint?.port || env.MYSQL_PORT || env.DB_PORT || ""),
      database: fingerprint?.databaseName || env.MYSQL_DB || env.DB_NAME,
      user: fingerprint?.currentUser || env.MYSQL_USER || env.DB_USER,
    },
    { context: "order-intent-worker-dispatch-gate" }
  );
  return {
    ...evaluation,
    ok: evaluation.ok && fingerprint?.databaseName === "quantu_local",
    failures: [
      ...(evaluation.failures || []),
      ...(fingerprint?.databaseName === "quantu_local" ? [] : [`unexpected database:${fingerprint?.databaseName || "UNKNOWN"}`]),
    ],
    fingerprint,
  };
};

const evaluateReadGuard = ({ uid, readGuardSnapshot = null } = {}) => {
  const snapshot = readGuardSnapshot || binanceReadGuard.getStateSnapshot();
  const uidBlock = (snapshot.uidBlocks || []).find((item) => Number(item.uid) === Number(uid) && item.blocked);
  if (snapshot.globalBlocked || uidBlock) {
    return {
      ok: false,
      reason: snapshot.globalBlocked
        ? (snapshot.globalBlockReason || "BINANCE_PRIVATE_READ_GLOBAL_BLOCKED")
        : (uidBlock.reason || "BINANCE_PRIVATE_READ_UID_BLOCKED"),
      snapshot,
    };
  }
  return { ok: true, snapshot };
};

const evaluateTimeSyncReady = (timeSyncModule = binanceTimeSync) => ({
  ok:
    typeof timeSyncModule.runWithTimestampRetry === "function" &&
    typeof timeSyncModule.syncNodeBinanceFuturesClientTime === "function",
});

const evaluateWorkerActualDispatchGate = async ({ intent = {}, env = process.env, redisClient = null, ...context } = {}) => {
  const gates = [];
  const intentType = normalizeIntentType(intent, context);
  const uid = normalizeUid(intent, context);

  const replayOrMock =
    context.mock === true ||
    context.dryRun === true ||
    context.isReplay === true ||
    context.isDataReplay === true ||
    context.isSmoke === true ||
    liveWriteSafetyGate.isReplayOrReadOnlyMode({ ...context, env }, env);
  addGate(gates, "replay/mock guard", !replayOrMock, GATE_REASON.REPLAY_OR_MOCK_MODE, {
    mock: context.mock === true,
    dryRun: context.dryRun === true,
  });

  addGate(
    gates,
    "actual dispatch env",
    truthy(env[ACTUAL_DISPATCH_ENV]),
    GATE_REASON.ACTUAL_DISPATCH_DISABLED,
    { env: ACTUAL_DISPATCH_ENV }
  );

  const dbEvaluation = await evaluateDbGuard({
    env,
    dbFingerprint: context.dbFingerprint,
    dbEvaluation: context.dbEvaluation,
  }).catch((error) => ({
    ok: false,
    failures: [error?.message || String(error)],
  }));
  addGate(gates, "QUANTU DB guard", dbEvaluation.ok === true, GATE_REASON.QUANTU_DB_GUARD_FAILED, {
    failures: dbEvaluation.failures || [],
    databaseName: dbEvaluation.fingerprint?.databaseName || null,
  });

  const redisReady = context.redisReady != null
    ? Boolean(context.redisReady)
    : liveWriteSafetyGate.isRedisClientReady(redisClient);
  addGate(gates, "Redis guard", redisReady, GATE_REASON.REDIS_UNAVAILABLE);

  const ownershipReadiness = context.ownershipReadiness || await positionOwnership.getOwnershipReadiness().catch((error) => ({
    enabled: false,
    status: "ERROR",
    error: error?.message || String(error),
  }));
  addGate(gates, "ownership guard", ownershipReadiness.enabled === true, GATE_REASON.OWNERSHIP_NOT_READY, {
    status: ownershipReadiness.status || null,
    legacyDisabled: ownershipReadiness.legacyDisabled === true,
  });

  const queueReady = context.queueReady != null
    ? Boolean(context.queueReady)
    : await orderIntentQueue.ensureOrderIntentSchema().then(() => true).catch(() => false);
  addGate(gates, "order_intent_queue guard", queueReady, GATE_REASON.QUEUE_NOT_READY);

  const actionCovered = GRID_ACTION_COVERAGE.includes(intentType);
  addGate(gates, "action coverage guard", actionCovered, GATE_REASON.ACTION_NOT_COVERED, { intentType });

  const timeSyncReady = context.timeSyncReady != null
    ? Boolean(context.timeSyncReady)
    : evaluateTimeSyncReady(context.timeSyncModule).ok;
  addGate(gates, "Binance time sync guard", timeSyncReady, GATE_REASON.TIME_SYNC_NOT_READY);

  const readGuard = evaluateReadGuard({ uid, readGuardSnapshot: context.readGuardSnapshot });
  addGate(gates, "private read guard", readGuard.ok === true, GATE_REASON.PRIVATE_READ_GUARD_OPEN, {
    reason: readGuard.reason || null,
  });

  const writeDecision = binanceWriteGuard.evaluateBinanceWriteAllowed({
    env,
    uid,
    pid: context.pid || intent.pid,
    strategyCategory: context.strategyCategory || intent.strategyCategory || "grid",
    action: intentType || "ORDER_INTENT_WORKER_DISPATCH",
    mock: false,
    clientIsMock: false,
    isReplay: false,
    isDataReplay: false,
    isSmoke: false,
  });
  addGate(gates, "env approval guard", writeDecision.allowed === true, GATE_REASON.BINANCE_WRITE_GUARD_BLOCKED, {
    reason: writeDecision.reason,
  });

  const failed = firstFailedGate(gates);
  return {
    eligible: !failed,
    allowed: !failed,
    reason: failed?.reason || "ORDER_INTENT_ACTUAL_DISPATCH_ELIGIBLE",
    intentType,
    uid,
    gates,
  };
};

module.exports = {
  ACTUAL_DISPATCH_ENV,
  GATE_REASON,
  GRID_ACTION_COVERAGE,
  evaluateDbGuard,
  evaluateReadGuard,
  evaluateTimeSyncReady,
  evaluateWorkerActualDispatchGate,
};
