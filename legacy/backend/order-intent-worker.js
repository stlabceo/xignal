"use strict";

const orderIntentQueue = require("./order-intent-queue");
const liveWriteSafetyGate = require("./live-write-safety-gate");
const positionOwnership = require("./position-ownership");
const redisClient = require("./util/redis.util");

const DEFAULT_POLL_MS = 500;
const DEFAULT_STALE_SECONDS = 90;

let workerTimer = null;
let workerRunning = false;
let workerOwnerLabel = null;

const getWorkerId = (ownerLabel = null) =>
  `order-intent:${ownerLabel || "runtime"}:${process.pid || "local"}`;

const buildBlockResult = (reason, extra = {}) => ({
  ok: false,
  blocked: true,
  reason,
  ...extra,
});

const processGridLiveArmIntent = async (intent, options = {}) => {
  const env = options.env || process.env;
  const lockRedisClient = Object.prototype.hasOwnProperty.call(options, "redisClient")
    ? options.redisClient
    : redisClient;
  const redisGate = liveWriteSafetyGate.evaluateRedisLockUnavailable({
    env,
    liveScope: true,
    strategyCategory: "grid",
    scope: "ORDER_INTENT_WORKER",
    lockKey: "order-intent-worker:grid-live-arm",
  });

  if (!liveWriteSafetyGate.isRedisClientReady(lockRedisClient) && !redisGate.allowed) {
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(redisGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
      }),
      errorCode: redisGate.reason,
      errorMessage: "Redis lock unavailable; live grid worker write blocked.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: redisGate.reason };
  }

  const ownershipReadiness = await positionOwnership.getOwnershipReadiness().catch((error) => ({
    enabled: false,
    error: error?.message || String(error),
  }));
  const ownershipGate = liveWriteSafetyGate.evaluateOwnershipGuard({
    env,
    strategyCategory: "grid",
    uid: intent.uid,
    pid: intent.pid,
    ownershipEnabled: ownershipReadiness.enabled === true,
  });

  if (!ownershipGate.allowed) {
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(ownershipGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
      }),
      errorCode: ownershipGate.reason,
      errorMessage: `DB-backed PID ownership unavailable; live grid worker write blocked. status:${ownershipReadiness.status || "UNKNOWN"}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: ownershipGate.reason };
  }

  if (options.dryRun === true || options.mock === true) {
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.DONE,
      result: {
        ok: true,
        dryRun: true,
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
      },
    });
    return { processed: true, status: orderIntentQueue.STATUS.DONE, reason: "DRY_RUN" };
  }

  await orderIntentQueue.completeIntent({
    id: intent.id,
    status: orderIntentQueue.STATUS.BLOCKED,
    result: buildBlockResult(liveWriteSafetyGate.REASON.QUEUE_REQUIRED_FOR_LIVE_GRID_WRITE, {
      intentType: intent.intentType,
      fifoKey: intent.fifoKey,
      note: "worker dispatch to Binance is intentionally disabled until durable protection/re-entry/cancel intents are covered",
    }),
    errorCode: liveWriteSafetyGate.REASON.QUEUE_REQUIRED_FOR_LIVE_GRID_WRITE,
    errorMessage: "Grid live arm worker dispatch intentionally blocked.",
  });
  return {
    processed: true,
    status: orderIntentQueue.STATUS.BLOCKED,
    reason: liveWriteSafetyGate.REASON.QUEUE_REQUIRED_FOR_LIVE_GRID_WRITE,
  };
};

const processIntent = async (intent, options = {}) => {
  if (!intent) {
    return { processed: false, reason: "NO_INTENT" };
  }

  if (intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_LIVE_ARM) {
    return await processGridLiveArmIntent(intent, options);
  }

  await orderIntentQueue.completeIntent({
    id: intent.id,
    status: orderIntentQueue.STATUS.FAILED,
    result: { ok: false, reason: "UNKNOWN_INTENT_TYPE", intentType: intent.intentType },
    errorCode: "UNKNOWN_INTENT_TYPE",
    errorMessage: `unknown intent type:${intent.intentType}`,
  });
  return { processed: true, status: orderIntentQueue.STATUS.FAILED, reason: "UNKNOWN_INTENT_TYPE" };
};

const processOneIntent = async (options = {}) => {
  const workerId = options.workerId || getWorkerId(options.ownerLabel || workerOwnerLabel);
  await orderIntentQueue.recoverStaleRunningIntents({
    staleSeconds: options.staleSeconds || DEFAULT_STALE_SECONDS,
  });
  const intent = await orderIntentQueue.claimNextIntent({ workerId });
  if (!intent) {
    return { processed: false, reason: "NO_PENDING_INTENT" };
  }
  return await processIntent(intent, options);
};

const startOrderIntentWorker = ({ ownerLabel = null, pollMs = DEFAULT_POLL_MS } = {}) => {
  if (workerTimer) {
    return { started: true, reused: true, ownerLabel: workerOwnerLabel };
  }

  workerOwnerLabel = ownerLabel || "runtime";
  workerTimer = setInterval(async () => {
    if (workerRunning) {
      return;
    }
    workerRunning = true;
    try {
      await processOneIntent({ ownerLabel: workerOwnerLabel });
    } catch (error) {
      console.log("[ORDER_INTENT_WORKER_ERROR]", error?.message || error);
    } finally {
      workerRunning = false;
    }
  }, Math.max(100, Number(pollMs || DEFAULT_POLL_MS)));

  if (typeof workerTimer.unref === "function") {
    workerTimer.unref();
  }

  return { started: true, ownerLabel: workerOwnerLabel };
};

const stopOrderIntentWorker = () => {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  workerRunning = false;
  return true;
};

const getOrderIntentWorkerHealth = () => ({
  running: Boolean(workerTimer),
  busy: workerRunning,
  ownerLabel: workerOwnerLabel,
});

module.exports = {
  processOneIntent,
  processIntent,
  startOrderIntentWorker,
  stopOrderIntentWorker,
  getOrderIntentWorkerHealth,
};
