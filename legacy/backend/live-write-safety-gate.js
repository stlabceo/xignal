"use strict";

const LIVE_WRITE_APPROVAL = "APPROVE_PRODUCTION_BINANCE_WRITES";
const LIVE_EXECUTION_APPROVAL_PREFIX = "APPROVE_LIVE_ORDER_EXECUTION";

const REASON = Object.freeze({
  REDIS_LOCK_UNAVAILABLE: "REDIS_LOCK_UNAVAILABLE",
  OWNERSHIP_DISABLED: "OWNERSHIP_DISABLED",
  QUEUE_REQUIRED_FOR_LIVE_GRID_WRITE: "QUEUE_REQUIRED_FOR_LIVE_GRID_WRITE",
  MEMORY_FALLBACK_NOT_ALLOWED_LIVE: "MEMORY_FALLBACK_NOT_ALLOWED_LIVE",
  LIVE_WRITE_BLOCKED_BY_SAFETY_GATE: "LIVE_WRITE_BLOCKED_BY_SAFETY_GATE",
});

const truthy = (value) =>
  ["1", "true", "y", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const getEnv = (context = {}) => context.env || process.env;

const getApproval = (context = {}, env = getEnv(context)) =>
  String(context.explicitApproval || env.BINANCE_WRITE_APPROVAL || env.LIVE_ORDER_APPROVAL || "").trim();

const isReplayOrReadOnlyMode = (context = {}, env = getEnv(context)) =>
  context.clientIsMock === true ||
  context.mock === true ||
  context.isReplay === true ||
  context.isDataReplay === true ||
  context.isSmoke === true ||
  truthy(env.QA_DISABLE_BINANCE_WRITES) ||
  truthy(env.QA_REPLAY_MODE) ||
  truthy(env.QA_DATA_REPLAY_MODE) ||
  truthy(env.QA_SMOKE_MODE) ||
  truthy(env.SMOKE_TEST_MODE);

const isLiveWriteConfigured = (context = {}, env = getEnv(context)) => {
  const approval = getApproval(context, env);
  return (
    context.allowLiveOrders === true ||
    truthy(env.BINANCE_LIVE_WRITES_ENABLED) ||
    truthy(env.ALLOW_BINANCE_LIVE_WRITES) ||
    approval === LIVE_WRITE_APPROVAL ||
    approval.startsWith(LIVE_EXECUTION_APPROVAL_PREFIX)
  );
};

const shouldEnforceLiveWriteSafety = (context = {}) => {
  const env = getEnv(context);
  return isLiveWriteConfigured(context, env) && !isReplayOrReadOnlyMode(context, env);
};

const decision = ({ allowed, reason = null, context = {}, details = {} }) => ({
  allowed: Boolean(allowed),
  reason,
  code: allowed ? "LIVE_WRITE_SAFETY_GATE_OK" : REASON.LIVE_WRITE_BLOCKED_BY_SAFETY_GATE,
  enforceLiveWriteSafety: shouldEnforceLiveWriteSafety(context),
  details,
});

const allow = (context = {}, details = {}) =>
  decision({
    allowed: true,
    context,
    details,
  });

const block = (reason, context = {}, details = {}) =>
  decision({
    allowed: false,
    reason,
    context,
    details,
  });

const evaluateRedisLockUnavailable = (context = {}) => {
  if (!shouldEnforceLiveWriteSafety(context) || context.liveScope === false) {
    return allow(context, { bypass: "not-live-write" });
  }

  return block(REASON.REDIS_LOCK_UNAVAILABLE, context, {
    lockKey: context.lockKey || null,
    scope: context.scope || null,
    strategyCategory: context.strategyCategory || null,
    note: REASON.MEMORY_FALLBACK_NOT_ALLOWED_LIVE,
  });
};

const evaluateRedisLockReservation = ({ redisReserved, ...context } = {}) => {
  if (redisReserved === null || redisReserved === undefined) {
    return evaluateRedisLockUnavailable(context);
  }

  return allow(context, {
    redisReserved,
  });
};

const evaluateOwnershipGuard = (context = {}) => {
  if (!shouldEnforceLiveWriteSafety(context)) {
    return allow(context, { bypass: "not-live-write" });
  }

  if (context.ownershipEnabled === true) {
    return allow(context, { ownershipEnabled: true });
  }

  return block(REASON.OWNERSHIP_DISABLED, context, {
    strategyCategory: context.strategyCategory || context.ownerStrategyCategory || null,
    ownerPid: context.ownerPid || context.pid || null,
    symbol: context.symbol || null,
    positionSide: context.positionSide || null,
  });
};

const evaluateGridRequestThreadWrite = (context = {}) => {
  const liveArmedCount = Number(context.liveArmedCount || 0);
  if (!shouldEnforceLiveWriteSafety(context) || liveArmedCount <= 0) {
    return allow(context, { liveArmedCount });
  }

  return block(REASON.QUEUE_REQUIRED_FOR_LIVE_GRID_WRITE, context, {
    routePath: context.routePath || "/user/api/grid/hook",
    liveArmedCount,
    note: "durable queue/worker is required before request-thread live grid priming",
  });
};

const buildGuardError = (gate, context = {}) => {
  const reason = gate?.reason || REASON.LIVE_WRITE_BLOCKED_BY_SAFETY_GATE;
  const error = new Error(`LIVE_WRITE_SAFETY_GATE_BLOCKED:${reason}`);
  error.code = "LIVE_WRITE_SAFETY_GATE_BLOCKED";
  error.safetyReason = reason;
  error.safetyGate = gate;
  error.guardReason = reason;
  error.guardContext = {
    uid: context.uid == null ? null : Number(context.uid),
    pid: context.pid == null ? null : Number(context.pid),
    strategyCategory: context.strategyCategory || context.ownerStrategyCategory || null,
    action: context.action || null,
    symbol: context.symbol || null,
    positionSide: context.positionSide || null,
    clientOrderId: context.clientOrderId || context.sourceClientOrderId || null,
    caller: context.caller || null,
  };
  return error;
};

const isSafetyGateError = (error) =>
  error?.code === "LIVE_WRITE_SAFETY_GATE_BLOCKED" ||
  String(error?.message || "").startsWith("LIVE_WRITE_SAFETY_GATE_BLOCKED:");

const assertGateAllowed = (gate, context = {}) => {
  if (!gate?.allowed) {
    throw buildGuardError(gate, context);
  }
  return gate;
};

const isRedisClientReady = (redisClient) =>
  Boolean(redisClient) &&
  typeof redisClient.set === "function" &&
  redisClient.isOpen !== false &&
  redisClient.isReady !== false;

const buildReadinessSnapshot = ({
  env = process.env,
  redisClient = null,
  orderIntentQueueEnabled = true,
  ownershipEnabled = false,
} = {}) => {
  const context = { env };
  const liveWriteSafetyEnforced = shouldEnforceLiveWriteSafety(context);
  const redisReady = isRedisClientReady(redisClient);
  const blockers = [];

  if (liveWriteSafetyEnforced && !redisReady) {
    blockers.push({
      code: REASON.REDIS_LOCK_UNAVAILABLE,
      severity: "CRITICAL",
      action: "Redis lock must be reachable before live writes are allowed.",
    });
  }

  if (liveWriteSafetyEnforced && ownershipEnabled !== true) {
    blockers.push({
      code: REASON.OWNERSHIP_DISABLED,
      severity: "CRITICAL",
      action: "DB-backed UID/PID ownership guard must be implemented before live writes are allowed.",
    });
  }

  if (liveWriteSafetyEnforced) {
    if (orderIntentQueueEnabled === false) {
      blockers.push({
        code: REASON.QUEUE_REQUIRED_FOR_LIVE_GRID_WRITE,
        severity: "CRITICAL",
        action: "Durable order queue/worker must be implemented before live grid request-thread writes are allowed.",
      });
    }
  }

  return {
    liveWriteSafetyEnforced,
    redisReady,
    ownershipEnabled: ownershipEnabled === true,
    orderIntentQueueEnabled: orderIntentQueueEnabled !== false,
    blockers,
    status: blockers.length > 0 ? "BLOCKED" : "OK",
  };
};

module.exports = {
  REASON,
  truthy,
  isReplayOrReadOnlyMode,
  isLiveWriteConfigured,
  shouldEnforceLiveWriteSafety,
  evaluateRedisLockUnavailable,
  evaluateRedisLockReservation,
  evaluateOwnershipGuard,
  evaluateGridRequestThreadWrite,
  buildGuardError,
  isSafetyGateError,
  assertGateAllowed,
  isRedisClientReady,
  buildReadinessSnapshot,
};
