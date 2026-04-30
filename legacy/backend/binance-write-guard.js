const LIVE_WRITE_APPROVAL = "APPROVE_PRODUCTION_BINANCE_WRITES";
const LIVE_EXECUTION_APPROVAL_PREFIX = "APPROVE_LIVE_ORDER_EXECUTION";

const truthy = (value) =>
  ["1", "true", "y", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const isQaReplayMode = (env = process.env) =>
  truthy(env.QA_REPLAY_MODE) ||
  truthy(env.QA_DATA_REPLAY_MODE) ||
  truthy(env.QA_DISABLE_BINANCE_WRITES);

const isQaSmokeMode = (env = process.env) =>
  truthy(env.QA_SMOKE_MODE) ||
  truthy(env.SMOKE_TEST_MODE);

const isLiveExecutionQaMode = (env = process.env) =>
  truthy(env.QA_LIVE_EXECUTION_MODE) ||
  truthy(env.LIVE_EXECUTION_QA_MODE);

const getApproval = (context = {}, env = process.env) =>
  String(context.explicitApproval || env.BINANCE_WRITE_APPROVAL || env.LIVE_ORDER_APPROVAL || "").trim();

const normalizeAction = (action) => String(action || "BINANCE_WRITE").trim().toUpperCase();

const evaluateBinanceWriteAllowed = (context = {}) => {
  const env = context.env || process.env;
  const action = normalizeAction(context.action);
  const approval = getApproval(context, env);
  const clientIsMock = context.clientIsMock === true || context.mock === true;

  if (clientIsMock && context.allowMockClient !== false) {
    return {
      allowed: true,
      reason: "QA_MOCK_CLIENT_ALLOWED",
      action,
      approval: "MOCK",
    };
  }

  if (isQaReplayMode(env) || context.isReplay === true || context.isDataReplay === true) {
    return {
      allowed: false,
      reason: truthy(env.QA_DISABLE_BINANCE_WRITES)
        ? "QA_DISABLE_BINANCE_WRITES_BLOCKED"
        : "QA_REPLAY_MODE_BINANCE_WRITE_BLOCKED",
      action,
      approval,
    };
  }

  if (isQaSmokeMode(env) || context.isSmoke === true) {
    return {
      allowed: false,
      reason: "QA_SMOKE_BINANCE_WRITE_BLOCKED",
      action,
      approval,
    };
  }

  if (isLiveExecutionQaMode(env) || context.isLiveExecutionQa === true) {
    if (!approval.startsWith(LIVE_EXECUTION_APPROVAL_PREFIX)) {
      return {
        allowed: false,
        reason: "LIVE_EXECUTION_QA_APPROVAL_MISSING",
        action,
        approval,
      };
    }
  }

  const liveWritesEnabled =
    context.allowLiveOrders === true ||
    truthy(env.BINANCE_LIVE_WRITES_ENABLED) ||
    truthy(env.ALLOW_BINANCE_LIVE_WRITES);

  if (!liveWritesEnabled) {
    return {
      allowed: false,
      reason: "BINANCE_LIVE_WRITES_NOT_ENABLED",
      action,
      approval,
    };
  }

  if (approval !== LIVE_WRITE_APPROVAL && !approval.startsWith(LIVE_EXECUTION_APPROVAL_PREFIX)) {
    return {
      allowed: false,
      reason: "EXPLICIT_BINANCE_WRITE_APPROVAL_MISSING",
      action,
      approval,
    };
  }

  return {
    allowed: true,
    reason: "BINANCE_WRITE_ALLOWED",
    action,
    approval,
  };
};

const buildGuardError = (decision, context = {}) => {
  const error = new Error(`BINANCE_WRITE_BLOCKED_BY_GUARD:${decision.reason}`);
  error.code = "BINANCE_WRITE_BLOCKED_BY_GUARD";
  error.guardReason = decision.reason;
  error.guardDecision = decision;
  error.guardContext = {
    uid: context.uid == null ? null : Number(context.uid),
    pid: context.pid == null ? null : Number(context.pid),
    strategyCategory: context.strategyCategory || null,
    action: normalizeAction(context.action),
    symbol: context.symbol || null,
    side: context.side || null,
    positionSide: context.positionSide || null,
    clientOrderId: context.clientOrderId || null,
    orderId: context.orderId || null,
    caller: context.caller || null,
  };
  return error;
};

const assertBinanceWriteAllowed = (context = {}) => {
  const decision = evaluateBinanceWriteAllowed(context);
  if (!decision.allowed) {
    throw buildGuardError(decision, context);
  }
  return decision;
};

const isBinanceWriteGuardError = (error) =>
  error?.code === "BINANCE_WRITE_BLOCKED_BY_GUARD" ||
  String(error?.message || "").startsWith("BINANCE_WRITE_BLOCKED_BY_GUARD:");

module.exports = {
  LIVE_WRITE_APPROVAL,
  LIVE_EXECUTION_APPROVAL_PREFIX,
  truthy,
  isQaReplayMode,
  isQaSmokeMode,
  isLiveExecutionQaMode,
  evaluateBinanceWriteAllowed,
  assertBinanceWriteAllowed,
  isBinanceWriteGuardError,
};
