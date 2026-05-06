"use strict";

const binanceReadGuard = require("./binance-read-guard");

const CANCEL_VERIFY_STATE = Object.freeze({
  VERIFIED_GONE: "CANCEL_VERIFIED_GONE",
  VERIFY_PENDING: "CANCEL_VERIFY_PENDING",
  FAILED_ACTIVE_ORDER_REMAINS: "CANCEL_FAILED_ACTIVE_ORDER_REMAINS",
  BLOCKED_429: "CANCEL_BLOCKED_429",
  BLOCKED_418: "CANCEL_BLOCKED_418",
});

const DEFAULT_POLICY = Object.freeze({
  maxAttempts: 2,
  timeoutMs: 1500,
  backoffMs: 500,
  endpoint: "/fapi/v1/openOrders",
});

const getHttpStatus = (error) => Number(error?.response?.status || error?.status || error?.httpStatus || 0);

const isActiveOrder = (order = {}) => {
  const status = String(order.status || order.orderStatus || "").trim().toUpperCase();
  if (!status) {
    return true;
  }
  return !["CANCELED", "CANCELLED", "EXPIRED", "REJECTED", "FILLED"].includes(status);
};

const orderMatchesTarget = (order = {}, target = {}) => {
  const clientOrderId = String(order.clientOrderId || order.origClientOrderId || "").trim();
  const orderId = String(order.orderId || "").trim();
  const targetClientOrderId = String(target.targetClientOrderId || target.clientOrderId || "").trim();
  const targetOrderId = String(target.targetOrderId || target.orderId || "").trim();
  if (!targetClientOrderId && !targetOrderId) {
    return true;
  }
  return (
    (targetClientOrderId && clientOrderId === targetClientOrderId) ||
    (targetOrderId && orderId === targetOrderId)
  );
};

const classifyCancelVerification = ({
  cancelResponse = null,
  readResult = null,
  target = {},
  error = null,
  attemptCount = 0,
  maxAttempts = DEFAULT_POLICY.maxAttempts,
  staleRead = false,
} = {}) => {
  const httpStatus = getHttpStatus(error);
  if (httpStatus === 418) {
    return {
      terminal: false,
      ok: false,
      state: CANCEL_VERIFY_STATE.BLOCKED_418,
      reason: "BINANCE_IP_BANNED_418",
    };
  }
  if (httpStatus === 429) {
    return {
      terminal: false,
      ok: false,
      state: CANCEL_VERIFY_STATE.BLOCKED_429,
      reason: "BINANCE_RATE_LIMIT_429",
    };
  }

  if (error) {
    return {
      terminal: false,
      ok: false,
      state: CANCEL_VERIFY_STATE.VERIFY_PENDING,
      reason: "CANCEL_VERIFY_READ_ERROR",
    };
  }

  if (staleRead) {
    return {
      terminal: false,
      ok: false,
      state: CANCEL_VERIFY_STATE.VERIFY_PENDING,
      reason: "CANCEL_VERIFY_STALE_READ",
    };
  }

  const activeOrders = Array.isArray(readResult?.openOrders)
    ? readResult.openOrders.filter((order) => orderMatchesTarget(order, target) && isActiveOrder(order))
    : [];
  if (activeOrders.length > 0) {
    return {
      terminal: false,
      ok: false,
      state: CANCEL_VERIFY_STATE.FAILED_ACTIVE_ORDER_REMAINS,
      reason: cancelResponse?.notFound ? "CANCEL_404_ACTIVE_ORDER_REMAINS" : "CANCEL_ACTIVE_ORDER_REMAINS",
      activeOrders,
    };
  }

  if (Array.isArray(readResult?.openOrders)) {
    return {
      terminal: true,
      ok: true,
      state: CANCEL_VERIFY_STATE.VERIFIED_GONE,
      reason: cancelResponse?.notFound ? "CANCEL_404_VERIFIED_GONE" : "CANCEL_VERIFIED_GONE",
    };
  }

  if (Number(attemptCount || 0) >= Number(maxAttempts || DEFAULT_POLICY.maxAttempts)) {
    return {
      terminal: false,
      ok: false,
      state: CANCEL_VERIFY_STATE.VERIFY_PENDING,
      reason: "CANCEL_VERIFY_MAX_ATTEMPTS_EXCEEDED",
    };
  }

  return {
    terminal: false,
    ok: false,
    state: CANCEL_VERIFY_STATE.VERIFY_PENDING,
    reason: "CANCEL_VERIFY_READ_REQUIRED",
  };
};

const verifyCancelWithBoundedRead = async ({
  uid,
  target = {},
  cancelResponse = null,
  readOpenOrders,
  policy = {},
} = {}) => {
  const mergedPolicy = {
    ...DEFAULT_POLICY,
    ...policy,
  };
  const endpoint = mergedPolicy.endpoint;
  let lastResult = null;

  for (let attempt = 1; attempt <= Number(mergedPolicy.maxAttempts || DEFAULT_POLICY.maxAttempts); attempt += 1) {
    try {
      binanceReadGuard.assertPrivateRequestAllowed({ uid, endpoint, method: "GET" });
      if (typeof readOpenOrders !== "function") {
        return classifyCancelVerification({
          cancelResponse,
          target,
          attemptCount: attempt,
          maxAttempts: mergedPolicy.maxAttempts,
        });
      }
      const readResult = await readOpenOrders({ uid, target, attempt, policy: mergedPolicy });
      binanceReadGuard.recordPrivateRequestSuccess({ uid, endpoint, method: "GET" });
      lastResult = classifyCancelVerification({
        cancelResponse,
        readResult,
        target,
        attemptCount: attempt,
        maxAttempts: mergedPolicy.maxAttempts,
        staleRead: readResult?.stale === true,
      });
      if (lastResult.terminal || lastResult.state === CANCEL_VERIFY_STATE.FAILED_ACTIVE_ORDER_REMAINS) {
        return lastResult;
      }
    } catch (error) {
      binanceReadGuard.recordPrivateRequestFailure({ uid, endpoint, method: "GET", error });
      const classified = classifyCancelVerification({
        cancelResponse,
        target,
        error,
        attemptCount: attempt,
        maxAttempts: mergedPolicy.maxAttempts,
      });
      if (classified.state === CANCEL_VERIFY_STATE.BLOCKED_429 || classified.state === CANCEL_VERIFY_STATE.BLOCKED_418) {
        return classified;
      }
      lastResult = classified;
    }
  }

  return lastResult || classifyCancelVerification({
    cancelResponse,
    target,
    attemptCount: mergedPolicy.maxAttempts,
    maxAttempts: mergedPolicy.maxAttempts,
  });
};

module.exports = {
  CANCEL_VERIFY_STATE,
  DEFAULT_POLICY,
  classifyCancelVerification,
  verifyCancelWithBoundedRead,
};
