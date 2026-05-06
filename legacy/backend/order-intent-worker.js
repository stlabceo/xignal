"use strict";

const orderIntentQueue = require("./order-intent-queue");
const liveWriteSafetyGate = require("./live-write-safety-gate");
const positionOwnership = require("./position-ownership");
const redisClient = require("./util/redis.util");
const db = require("./database/connect/config");
const gridProtectionGuarantee = require("./grid-protection-guarantee");
const pidPositionLedger = require("./pid-position-ledger");
const gridReentrySlPolicy = require("./grid-reentry-sl-policy");
const orderIntentDispatchGate = require("./order-intent-dispatch-gate");
const cancelVerificationPolicy = require("./cancel-verification-policy");

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

const PROTECTION_QUEUE_STATE = Object.freeze({
  PENDING: "PROTECTION_INTENT_PENDING",
  RUNNING: "PROTECTION_CREATE_RUNNING",
  PARTIAL: "PROTECTION_PARTIAL",
  FAILED: "PROTECTION_FAILED",
  BLOCKED_OWNERSHIP: "PROTECTION_BLOCKED_OWNERSHIP",
  BLOCKED_REDIS: "PROTECTION_BLOCKED_REDIS",
  PROTECTED: "PROTECTION_PROTECTED",
});

const REENTRY_QUEUE_STATE = Object.freeze({
  INTENT_PENDING: "REENTRY_INTENT_PENDING",
  RUNNING: "REENTRY_CREATE_RUNNING",
  PENDING: "REENTRY_PENDING",
  FAILED: "REENTRY_FAILED",
  BLOCKED_PRICE_STALE: "REENTRY_BLOCKED_PRICE_STALE",
  BLOCKED_OWNERSHIP: "REENTRY_BLOCKED_OWNERSHIP",
  BLOCKED_REDIS: "REENTRY_BLOCKED_REDIS",
});

const CANCEL_QUEUE_STATE = Object.freeze({
  INTENT_PENDING: "CANCEL_INTENT_PENDING",
  RUNNING: "CANCEL_RUNNING",
  VERIFY_PENDING: "CANCEL_VERIFY_PENDING",
  FAILED_ACTIVE_ORDER_REMAINS: "CANCEL_FAILED_ACTIVE_ORDER_REMAINS",
  VERIFIED_GONE: "CANCEL_VERIFIED_GONE",
  BLOCKED_429: "CANCEL_BLOCKED_429",
  BLOCKED_418: "CANCEL_BLOCKED_418",
  BLOCKED_REDIS: "CANCEL_BLOCKED_REDIS",
});

const CLOSE_QUEUE_STATE = Object.freeze({
  INTENT_PENDING: "CLOSE_INTENT_PENDING",
  RUNNING: "CLOSE_RUNNING",
  FAILED: "CLOSE_FAILED",
  BLOCKED_OWNERSHIP: "CLOSE_BLOCKED_OWNERSHIP",
  RESERVED_DUPLICATE: "CLOSE_RESERVED_DUPLICATE",
  GMANUAL_QUEUED: "GMANUAL_QUEUED",
  CONTROLLED_QUEUED: "CONTROLLED_CLOSE_QUEUED",
  BLOCKED_REDIS: "CLOSE_BLOCKED_REDIS",
});

const getLegPrefix = (leg) => (String(leg || "").toUpperCase() === "SHORT" ? "short" : "long");

const blockIntentByActualDispatchGate = async ({
  intent,
  payload = {},
  options = {},
  projectionUpdater = null,
  projectionState = null,
  defaultProjectionState = null,
  defaultReason = "ORDER_INTENT_ACTUAL_DISPATCH_BLOCKED",
  errorMessage = "Order intent actual dispatch blocked by final worker gate.",
} = {}) => {
  const gate = await orderIntentDispatchGate.evaluateWorkerActualDispatchGate({
    intent,
    env: options.env || process.env,
    redisClient: Object.prototype.hasOwnProperty.call(options, "redisClient")
      ? options.redisClient
      : redisClient,
    mock: options.mock === true,
    dryRun: options.dryRun === true,
    isReplay: options.isReplay === true,
    isDataReplay: options.isDataReplay === true,
    isSmoke: options.isSmoke === true,
    dbFingerprint: options.dbFingerprint,
    dbEvaluation: options.dbEvaluation,
    ownershipReadiness: options.ownershipReadiness,
    queueReady: options.queueReady,
    redisReady: options.redisReady,
    readGuardSnapshot: options.readGuardSnapshot,
    timeSyncReady: options.timeSyncReady,
  });

  const reason = gate.allowed ? defaultReason : gate.reason;
  const state = projectionState || defaultProjectionState || reason;
  if (typeof projectionUpdater === "function") {
    await projectionUpdater({ payload, state, reason }).catch(() => {});
  }
  await orderIntentQueue.completeIntent({
    id: intent.id,
    status: orderIntentQueue.STATUS.BLOCKED,
    result: buildBlockResult(reason, {
      intentType: intent.intentType,
      fifoKey: intent.fifoKey,
      projectionState: state,
      actualDispatchGate: gate,
    }),
    errorCode: reason,
    errorMessage,
  });
  return {
    processed: true,
    status: orderIntentQueue.STATUS.BLOCKED,
    reason,
    actualDispatchGate: gate,
  };
};

const loadFreshGridDecisionPriceForWorker = async (symbol, options = {}) => {
  const coin = require("./coin");
  if (typeof coin.ensurePublicMarketPrice === "function") {
    return await coin.ensurePublicMarketPrice(symbol, options);
  }
  return require("./data").getPrice(symbol);
};

const deriveFallbackProtectionClientOrderId = ({ payload = {}, prefix }) => {
  const derived = gridProtectionGuarantee.deriveProtectionClientOrderId({
    entryClientOrderId: payload.entryOrderId || null,
    prefix,
  });
  if (derived) {
    return derived;
  }
  const sideCode = String(payload.positionSide || "").toUpperCase() === "SHORT" ? "S" : "L";
  const seed = String(payload.entryOrderId || payload.sourceOrderId || payload.sourceTradeId || `${payload.uid}_${payload.pid}`);
  let suffix = 0;
  for (const char of seed) {
    suffix = (suffix * 31 + char.charCodeAt(0)) % 100000000;
  }
  return `${prefix}_${sideCode}_${Number(payload.uid || 0)}_${Number(payload.pid || 0)}_${String(suffix).padStart(8, "0")}`;
};

const normalizeProtectionMockOrder = ({ payload, kind, mockOrder }) => {
  if (mockOrder === false) {
    return { errorCode: "MOCK_PROTECTION_REJECTED", errorMessage: `${kind} rejected by mock` };
  }
  if (mockOrder && typeof mockOrder === "object") {
    return mockOrder;
  }
  const prefix = kind === "TP" ? "GTP" : "GSTOP";
  return {
    clientOrderId: deriveFallbackProtectionClientOrderId({ payload, prefix }),
    orderId: `MOCK_${deriveFallbackProtectionClientOrderId({ payload, prefix })}`,
  };
};

const buildProtectionResultState = (outcome) => {
  if (outcome.protected) {
    return PROTECTION_QUEUE_STATE.PROTECTED;
  }
  return outcome.partial ? PROTECTION_QUEUE_STATE.PARTIAL : PROTECTION_QUEUE_STATE.FAILED;
};

const updateGridProtectionProjection = async ({ payload = {}, outcome = {}, state, result = {} } = {}) => {
  const rowId = Number(payload.gridRowId || payload.regimeId || payload.pid || 0);
  if (!(rowId > 0)) {
    return false;
  }

  const leg = String(payload.positionSide || payload.leg || "").toUpperCase();
  const prefix = getLegPrefix(leg);
  const protectionQty = Number(payload.ownedQty || payload.qty || 0);
  const patch = {
    [`${prefix}LegStatus`]: "OPEN",
    [`${prefix}EntryOrderId`]: payload.entryOrderId || null,
    [`${prefix}Qty`]: protectionQty,
    [`${prefix}EntryPrice`]: Number(payload.entryPrice || 0) || null,
    [`${prefix}TakeProfitPrice`]: Number(payload.takeProfitPrice || 0) || null,
    [`${prefix}StopPrice`]: Number(payload.stopPrice || 0) || null,
    [`${prefix}ExitOrderId`]: result.takeProfit?.clientOrderId || null,
    [`${prefix}StopOrderId`]: result.stop?.clientOrderId || null,
    regimeStatus: outcome.protected
      ? (payload.oneLegEmergency ? "PAIR_ONE_LEG_PROTECTED" : "ACTIVE")
      : state,
    regimeEndReason: outcome.protected
      ? (payload.oneLegEmergency ? "PAIR_ONE_LEG_PROTECTED" : null)
      : outcome.reason || state,
  };

  const assignments = Object.keys(patch).map((key) => `${key} = ?`).join(", ");
  await db.query(
    `UPDATE live_grid_strategy_list
        SET ${assignments},
            updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
        AND uid = ?`,
    [...Object.values(patch), rowId, Number(payload.uid || 0)]
  );
  return true;
};

const syncProtectionReservationsForIntent = async ({ payload = {}, result = {}, qty = 0 } = {}) => {
  const reservations = [];
  if (result.takeProfit?.clientOrderId) {
    reservations.push({
      clientOrderId: result.takeProfit.clientOrderId,
      sourceOrderId: result.takeProfit.sourceOrderId || result.takeProfit.orderId || null,
      actualOrderId: result.takeProfit.orderId || null,
      reservationKind: "GRID_TP",
      reservedQty: qty,
      note: "grid protection intent take-profit",
    });
  }
  if (result.stop?.clientOrderId) {
    reservations.push({
      clientOrderId: result.stop.clientOrderId,
      sourceOrderId: result.stop.sourceOrderId || result.stop.orderId || null,
      actualOrderId: result.stop.orderId || null,
      reservationKind: "GRID_STOP",
      reservedQty: qty,
      note: "grid protection intent stop-loss",
    });
  }

  return await pidPositionLedger.replaceExitReservations({
    uid: payload.uid,
    pid: payload.pid,
    strategyCategory: "grid",
    symbol: payload.symbol,
    positionSide: payload.positionSide,
    reservations,
  });
};

const updateGridReentryProjection = async ({ payload = {}, state, clientOrderId = null, reason = null } = {}) => {
  const rowId = Number(payload.gridRowId || payload.regimeId || payload.pid || 0);
  if (!(rowId > 0)) {
    return false;
  }

  const leg = String(payload.positionSide || payload.leg || "").toUpperCase();
  const prefix = getLegPrefix(leg);
  const patch = {
    [`${prefix}LegStatus`]: state === REENTRY_QUEUE_STATE.PENDING ? "ENTRY_ARMED" : "IDLE",
    [`${prefix}EntryOrderId`]: state === REENTRY_QUEUE_STATE.PENDING ? clientOrderId : null,
    [`${prefix}ExitOrderId`]: null,
    [`${prefix}StopOrderId`]: null,
    [`${prefix}Qty`]: 0,
    [`${prefix}EntryPrice`]: null,
    [`${prefix}TakeProfitPrice`]: null,
    [`${prefix}StopPrice`]: null,
    regimeStatus: state === REENTRY_QUEUE_STATE.PENDING ? "ACTIVE" : state,
    regimeEndReason: state === REENTRY_QUEUE_STATE.PENDING ? null : reason || state,
  };

  const assignments = Object.keys(patch).map((key) => `${key} = ?`).join(", ");
  await db.query(
    `UPDATE live_grid_strategy_list
        SET ${assignments},
            updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
        AND uid = ?`,
    [...Object.values(patch), rowId, Number(payload.uid || 0)]
  );
  return true;
};

const updateGridCancelProjection = async ({ payload = {}, state, reason = null } = {}) => {
  const rowId = Number(payload.gridRowId || payload.regimeId || payload.pid || 0);
  if (!(rowId > 0) || !payload.uid) {
    return false;
  }
  await db.query(
    `UPDATE live_grid_strategy_list
        SET regimeStatus = ?,
            regimeEndReason = ?,
            updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
        AND uid = ?`,
    [state, reason || state, rowId, Number(payload.uid || 0)]
  );
  return true;
};

const updateGridCloseProjection = async ({ payload = {}, state, reason = null } = {}) => {
  const rowId = Number(payload.gridRowId || payload.regimeId || payload.pid || 0);
  if (!(rowId > 0) || !payload.uid) {
    return false;
  }
  await db.query(
    `UPDATE live_grid_strategy_list
        SET regimeStatus = ?,
            regimeEndReason = ?,
            updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
        AND uid = ?`,
    [state, reason || state, rowId, Number(payload.uid || 0)]
  );
  return true;
};

const processGridCancelIntent = async (intent, options = {}) => {
  const env = options.env || process.env;
  const payload = intent?.payload?.cancel || intent?.payload || {};
  const lockRedisClient = Object.prototype.hasOwnProperty.call(options, "redisClient")
    ? options.redisClient
    : redisClient;
  const redisGate = liveWriteSafetyGate.evaluateRedisLockUnavailable({
    env,
    liveScope: true,
    strategyCategory: "grid",
    scope: "ORDER_INTENT_WORKER",
    lockKey: `order-intent-worker:grid-cancel:${intent.fifoKey || intent.id}`,
  });

  if (!liveWriteSafetyGate.isRedisClientReady(lockRedisClient) && !redisGate.allowed) {
    await updateGridCancelProjection({
      payload,
      state: CANCEL_QUEUE_STATE.BLOCKED_REDIS,
      reason: redisGate.reason,
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(redisGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: CANCEL_QUEUE_STATE.BLOCKED_REDIS,
      }),
      errorCode: redisGate.reason,
      errorMessage: "Redis lock unavailable; live grid cancel worker write blocked.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: redisGate.reason };
  }

  if (options.dryRun === true || options.mock === true) {
    const mock = options.mockCancelResult || {};
    const target = {
      targetOrderId: payload.targetOrderId || null,
      targetClientOrderId: payload.targetClientOrderId || null,
    };
    let cancelResponse = { ok: mock.ok !== false, notFound: mock.notFound === true };
    let readResult = { openOrders: [] };
    let verifyError = null;
    let staleRead = mock.staleRead === true;
    if (mock.timeout === true || mock.verifyPending === true) {
      readResult = null;
    } else if (mock.httpStatus === 429 || mock.httpStatus === 418) {
      verifyError = { response: { status: mock.httpStatus, headers: mock.retryAfter ? { "retry-after": mock.retryAfter } : {} } };
    } else if (mock.openOrderStillPresent === true || mock.ok === false) {
      readResult = {
        openOrders: [
          {
            orderId: payload.targetOrderId || "MOCK_ACTIVE_ORDER",
            clientOrderId: payload.targetClientOrderId || "MOCK_ACTIVE_CLIENT_ORDER",
            status: "NEW",
          },
        ],
      };
      cancelResponse = { ...cancelResponse, ok: false };
    }
    const verification = cancelVerificationPolicy.classifyCancelVerification({
      cancelResponse,
      readResult,
      target,
      error: verifyError,
      attemptCount: mock.timeout || mock.verifyPending ? 2 : 1,
      maxAttempts: 2,
      staleRead,
    });
    const status = verification.ok && verification.terminal
      ? orderIntentQueue.STATUS.DONE
      : orderIntentQueue.STATUS.BLOCKED;
    const projectionState = verification.state;
    const reason = mock.reason || verification.reason;

    await updateGridCancelProjection({ payload, state: projectionState, reason }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status,
      result: {
        ok: status === orderIntentQueue.STATUS.DONE,
        dryRun: options.dryRun === true,
        mock: options.mock === true,
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState,
        reason,
        verification,
        targetType: payload.targetType || null,
        targetClientOrderId: payload.targetClientOrderId || null,
      },
      errorCode: status === orderIntentQueue.STATUS.DONE ? null : reason,
      errorMessage: status === orderIntentQueue.STATUS.DONE ? null : `Grid cancel not verified:${reason}`,
    });
    return { processed: true, status, reason, projectionState };
  }

  return await blockIntentByActualDispatchGate({
    intent,
    payload,
    options,
    projectionUpdater: updateGridCancelProjection,
    defaultProjectionState: CANCEL_QUEUE_STATE.RUNNING,
    defaultReason: "CANCEL_ACTUAL_DISPATCH_GATE_PASSED_HANDLER_NOT_ENABLED",
    errorMessage: "Grid cancel worker actual dispatch blocked by final gate.",
  });
};

const processGridCloseIntent = async (intent, options = {}) => {
  const env = options.env || process.env;
  const payload = intent?.payload?.close || intent?.payload || {};
  const lockRedisClient = Object.prototype.hasOwnProperty.call(options, "redisClient")
    ? options.redisClient
    : redisClient;
  const redisGate = liveWriteSafetyGate.evaluateRedisLockUnavailable({
    env,
    liveScope: true,
    strategyCategory: "grid",
    scope: "ORDER_INTENT_WORKER",
    lockKey: `order-intent-worker:grid-close:${intent.fifoKey || intent.id}`,
  });

  if (!liveWriteSafetyGate.isRedisClientReady(lockRedisClient) && !redisGate.allowed) {
    await updateGridCloseProjection({
      payload,
      state: CLOSE_QUEUE_STATE.BLOCKED_REDIS,
      reason: redisGate.reason,
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(redisGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: CLOSE_QUEUE_STATE.BLOCKED_REDIS,
      }),
      errorCode: redisGate.reason,
      errorMessage: "Redis lock unavailable; live grid close worker write blocked.",
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
    symbol: payload.symbol || null,
    positionSide: payload.positionSide || null,
    ownershipEnabled: ownershipReadiness.enabled === true,
  });
  if (!ownershipGate.allowed) {
    await updateGridCloseProjection({
      payload,
      state: CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP,
      reason: ownershipGate.reason,
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(ownershipGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP,
      }),
      errorCode: ownershipGate.reason,
      errorMessage: `DB-backed PID ownership unavailable; live grid close worker write blocked. status:${ownershipReadiness.status || "UNKNOWN"}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: ownershipGate.reason };
  }

  const requestedQty = Number(payload.qty || payload.ownedQtyBasis || 0);
  const ownershipQty = await positionOwnership.resolveOwnedCloseQty({
    uid: intent.uid,
    pid: intent.pid,
    strategyCategory: "grid",
    symbol: payload.symbol,
    positionSide: payload.positionSide,
    requestedQty,
  });
  const closeQty = Number(ownershipQty.finalCloseQty || 0);
  if (!ownershipQty.allowed || !(closeQty > 0)) {
    const projectionState = ownershipQty.reason === "OWNERSHIP_CLOSE_QTY_RESERVED"
      ? CLOSE_QUEUE_STATE.RESERVED_DUPLICATE
      : CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP;
    await updateGridCloseProjection({
      payload,
      state: projectionState,
      reason: ownershipQty.reason || "OWNERSHIP_BLOCKED",
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(ownershipQty.reason || "OWNERSHIP_BLOCKED", {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState,
        ownership: ownershipQty,
      }),
      errorCode: ownershipQty.reason || "OWNERSHIP_BLOCKED",
      errorMessage: "Grid close worker blocked by PID-owned qty guard.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: ownershipQty.reason || "OWNERSHIP_BLOCKED" };
  }

  if (ownershipQty.overRequested || requestedQty > closeQty + 1e-9) {
    await updateGridCloseProjection({
      payload,
      state: CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP,
      reason: "CLOSE_OVER_OWNED_QTY_BLOCKED",
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult("CLOSE_OVER_OWNED_QTY_BLOCKED", {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP,
        requestedQty,
        closeQty,
        ownership: ownershipQty,
      }),
      errorCode: "CLOSE_OVER_OWNED_QTY_BLOCKED",
      errorMessage: "Grid close requested qty exceeds PID-owned available qty.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: "CLOSE_OVER_OWNED_QTY_BLOCKED" };
  }

  if (options.dryRun === true || options.mock === true) {
    const mock = options.mockCloseResult || {};
    if (mock.ok === false) {
      const reason = mock.reason || "CLOSE_SUBMIT_FAILED";
      await updateGridCloseProjection({ payload, state: CLOSE_QUEUE_STATE.FAILED, reason }).catch(() => {});
      await orderIntentQueue.completeIntent({
        id: intent.id,
        status: orderIntentQueue.STATUS.FAILED,
        result: {
          ok: false,
          dryRun: options.dryRun === true,
          mock: options.mock === true,
          intentType: intent.intentType,
          fifoKey: intent.fifoKey,
          projectionState: CLOSE_QUEUE_STATE.FAILED,
          closeClientOrderId: payload.closeClientOrderId || null,
          reason,
        },
        errorCode: reason,
        errorMessage: `Grid close failed:${reason}`,
      });
      return { processed: true, status: orderIntentQueue.STATUS.FAILED, reason };
    }

    await updateGridCloseProjection({ payload, state: CLOSE_QUEUE_STATE.RUNNING, reason: payload.reason || "CLOSE_RUNNING" }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.DONE,
      result: {
        ok: true,
        dryRun: options.dryRun === true,
        mock: options.mock === true,
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: CLOSE_QUEUE_STATE.RUNNING,
        closeClientOrderId: payload.closeClientOrderId || null,
        closeQty,
        ownership: ownershipQty,
      },
    });
    return { processed: true, status: orderIntentQueue.STATUS.DONE, reason: CLOSE_QUEUE_STATE.RUNNING };
  }

  return await blockIntentByActualDispatchGate({
    intent,
    payload,
    options,
    projectionUpdater: updateGridCloseProjection,
    defaultProjectionState: CLOSE_QUEUE_STATE.RUNNING,
    defaultReason: "CLOSE_ACTUAL_DISPATCH_GATE_PASSED_HANDLER_NOT_ENABLED",
    errorMessage: "Grid close worker actual dispatch blocked by final gate.",
  });
};

const loadActiveCloseReservationCount = async (payload = {}) => {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt
       FROM live_pid_exit_reservation
      WHERE uid = ?
        AND pid = ?
        AND strategyCategory = 'grid'
        AND symbol = ?
        AND positionSide = ?
        AND status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')`,
    [
      Number(payload.uid || 0),
      Number(payload.pid || 0),
      String(payload.symbol || "").toUpperCase(),
      String(payload.positionSide || "").toUpperCase(),
    ]
  );
  return Number(rows?.[0]?.cnt || 0);
};

const getReentryPriceDecisionForIntent = async (payload = {}, options = {}) => {
  if (options.mockPriceDecision) {
    return options.mockPriceDecision;
  }
  if (payload.priceFreshnessEvidence && typeof payload.priceFreshnessEvidence === "object") {
    return payload.priceFreshnessEvidence;
  }
  const price = await loadFreshGridDecisionPriceForWorker(payload.symbol);
  return gridReentrySlPolicy.getReentryPriceDecision(price);
};

const deriveReentryClientOrderId = (payload = {}) => {
  if (payload.reentryClientOrderId) {
    return payload.reentryClientOrderId;
  }
  return gridReentrySlPolicy.buildGridReentryClientOrderId(
    {
      uid: payload.uid,
      id: payload.pid,
      symbol: payload.symbol,
      bunbong: payload.timeframe,
      triggerPrice: payload.triggerPrice,
      regimeReceivedAt: payload.regimeReceivedAt || null,
      signalTime: payload.signalTime || null,
      updatedAt: payload.updatedAt || null,
    },
    payload.positionSide,
    {
      takeProfitClientOrderId: payload.sourceTakeProfitClientOrderId,
      orderId: payload.sourceOrderId,
      tradeId: payload.sourceTradeId,
      tradeTime: payload.tradeTime,
    }
  );
};

const processGridReentryCreateIntent = async (intent, options = {}) => {
  const env = options.env || process.env;
  const payload = intent?.payload?.reentry || intent?.payload || {};
  const lockRedisClient = Object.prototype.hasOwnProperty.call(options, "redisClient")
    ? options.redisClient
    : redisClient;
  const redisGate = liveWriteSafetyGate.evaluateRedisLockUnavailable({
    env,
    liveScope: true,
    strategyCategory: "grid",
    scope: "ORDER_INTENT_WORKER",
    lockKey: `order-intent-worker:grid-reentry:${intent.fifoKey || intent.id}`,
  });

  if (!liveWriteSafetyGate.isRedisClientReady(lockRedisClient) && !redisGate.allowed) {
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(redisGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: REENTRY_QUEUE_STATE.BLOCKED_REDIS,
      }),
      errorCode: redisGate.reason,
      errorMessage: "Redis lock unavailable; live grid re-entry worker write blocked.",
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
    symbol: payload.symbol || null,
    positionSide: payload.positionSide || null,
    ownershipEnabled: ownershipReadiness.enabled === true,
  });
  if (!ownershipGate.allowed) {
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(ownershipGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: REENTRY_QUEUE_STATE.BLOCKED_OWNERSHIP,
      }),
      errorCode: ownershipGate.reason,
      errorMessage: `DB-backed PID ownership unavailable; live grid re-entry worker write blocked. status:${ownershipReadiness.status || "UNKNOWN"}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: ownershipGate.reason };
  }

  const priceDecision = await getReentryPriceDecisionForIntent(payload, options).catch((error) => ({
    usable: false,
    source: "ERROR",
    reason: error?.message || String(error),
  }));
  if (!priceDecision.usable) {
    await updateGridReentryProjection({
      payload,
      state: REENTRY_QUEUE_STATE.BLOCKED_PRICE_STALE,
      reason: priceDecision.reason || "PRICE_STALE",
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult("REENTRY_PRICE_STALE", {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: REENTRY_QUEUE_STATE.BLOCKED_PRICE_STALE,
        priceDecision,
      }),
      errorCode: REENTRY_QUEUE_STATE.BLOCKED_PRICE_STALE,
      errorMessage: `Grid re-entry blocked by stale price:${priceDecision.reason || "UNKNOWN"}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: REENTRY_QUEUE_STATE.BLOCKED_PRICE_STALE };
  }

  const reentryQty = Number(payload.reentryQty || payload.qty || 0);
  const ownedQtyBasis = Number(payload.ownedQtyBasis || payload.closedQty || payload.fillQty || 0);
  const activeCloseReservations = await loadActiveCloseReservationCount(payload);
  if (!(reentryQty > 0) || !(ownedQtyBasis > 0) || activeCloseReservations > 0) {
    const reason = activeCloseReservations > 0
      ? "REENTRY_BLOCKED_CLOSE_RESERVATION_ACTIVE"
      : "REENTRY_BLOCKED_OWNERSHIP_QTY_BASIS";
    await updateGridReentryProjection({
      payload,
      state: REENTRY_QUEUE_STATE.BLOCKED_OWNERSHIP,
      reason,
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: REENTRY_QUEUE_STATE.BLOCKED_OWNERSHIP,
        reentryQty,
        ownedQtyBasis,
        activeCloseReservations,
      }),
      errorCode: REENTRY_QUEUE_STATE.BLOCKED_OWNERSHIP,
      errorMessage: `Grid re-entry blocked by ownership/reservation guard:${reason}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason };
  }

  const clientOrderId = deriveReentryClientOrderId(payload);
  if (options.dryRun === true || options.mock === true) {
    const mockResult = options.mockReentryResult;
    if (mockResult === false || mockResult?.ok === false) {
      const reason = mockResult?.reason || "REENTRY_SUBMIT_FAILED";
      await updateGridReentryProjection({
        payload,
        state: REENTRY_QUEUE_STATE.FAILED,
        clientOrderId,
        reason,
      }).catch(() => {});
      await orderIntentQueue.completeIntent({
        id: intent.id,
        status: orderIntentQueue.STATUS.FAILED,
        result: {
          ok: false,
          mock: options.mock === true,
          dryRun: options.dryRun === true,
          intentType: intent.intentType,
          fifoKey: intent.fifoKey,
          projectionState: REENTRY_QUEUE_STATE.FAILED,
          reason,
          clientOrderId,
        },
        errorCode: REENTRY_QUEUE_STATE.FAILED,
        errorMessage: `Grid re-entry failed:${reason}`,
      });
      return { processed: true, status: orderIntentQueue.STATUS.FAILED, reason: REENTRY_QUEUE_STATE.FAILED };
    }

    const result = {
      ok: true,
      mock: options.mock === true,
      dryRun: options.dryRun === true,
      intentType: intent.intentType,
      fifoKey: intent.fifoKey,
      projectionState: REENTRY_QUEUE_STATE.PENDING,
      clientOrderId: mockResult?.clientOrderId || clientOrderId,
      orderId: mockResult?.orderId || null,
      reentryQty,
      triggerPrice: payload.triggerPrice,
      priceDecision,
    };
    await updateGridReentryProjection({
      payload,
      state: REENTRY_QUEUE_STATE.PENDING,
      clientOrderId: result.clientOrderId,
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.DONE,
      result,
    });
    return { processed: true, status: orderIntentQueue.STATUS.DONE, reason: REENTRY_QUEUE_STATE.PENDING };
  }

  return await blockIntentByActualDispatchGate({
    intent,
    payload,
    options,
    projectionUpdater: updateGridReentryProjection,
    defaultProjectionState: REENTRY_QUEUE_STATE.RUNNING,
    defaultReason: "REENTRY_ACTUAL_DISPATCH_GATE_PASSED_HANDLER_NOT_ENABLED",
    errorMessage: "Grid re-entry worker actual dispatch blocked by final gate.",
  });
};

const processGridProtectionCreateIntent = async (intent, options = {}) => {
  const env = options.env || process.env;
  const payload = intent?.payload?.protection || intent?.payload || {};
  const lockRedisClient = Object.prototype.hasOwnProperty.call(options, "redisClient")
    ? options.redisClient
    : redisClient;
  const redisGate = liveWriteSafetyGate.evaluateRedisLockUnavailable({
    env,
    liveScope: true,
    strategyCategory: "grid",
    scope: "ORDER_INTENT_WORKER",
    lockKey: `order-intent-worker:grid-protection:${intent.fifoKey || intent.id}`,
  });

  if (!liveWriteSafetyGate.isRedisClientReady(lockRedisClient) && !redisGate.allowed) {
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(redisGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: PROTECTION_QUEUE_STATE.BLOCKED_REDIS,
      }),
      errorCode: redisGate.reason,
      errorMessage: "Redis lock unavailable; live grid protection worker write blocked.",
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
    symbol: payload.symbol || null,
    positionSide: payload.positionSide || null,
    ownershipEnabled: ownershipReadiness.enabled === true,
  });

  if (!ownershipGate.allowed) {
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(ownershipGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: PROTECTION_QUEUE_STATE.BLOCKED_OWNERSHIP,
      }),
      errorCode: ownershipGate.reason,
      errorMessage: `DB-backed PID ownership unavailable; live grid protection worker write blocked. status:${ownershipReadiness.status || "UNKNOWN"}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: ownershipGate.reason };
  }

  const ownershipQty = await positionOwnership.resolveOwnedCloseQty({
    uid: intent.uid,
    pid: intent.pid,
    strategyCategory: "grid",
    symbol: payload.symbol,
    positionSide: payload.positionSide,
    requestedQty: payload.ownedQty || payload.qty,
  });
  if (!ownershipQty.allowed || !(Number(ownershipQty.finalCloseQty || 0) > 0)) {
    await updateGridProtectionProjection({
      payload,
      state: PROTECTION_QUEUE_STATE.BLOCKED_OWNERSHIP,
      outcome: { protected: false, partial: false, reason: ownershipQty.reason || "OWNERSHIP_BLOCKED" },
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(ownershipQty.reason || "OWNERSHIP_BLOCKED", {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: PROTECTION_QUEUE_STATE.BLOCKED_OWNERSHIP,
        ownership: ownershipQty,
      }),
      errorCode: ownershipQty.reason || "OWNERSHIP_BLOCKED",
      errorMessage: "Grid protection worker blocked by PID-owned qty guard.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: ownershipQty.reason || "OWNERSHIP_BLOCKED" };
  }

  if (options.dryRun === true || options.mock === true) {
    const mock = options.mockProtectionResult || {};
    const takeProfit = normalizeProtectionMockOrder({
      payload,
      kind: "TP",
      mockOrder: Object.prototype.hasOwnProperty.call(mock, "takeProfit") ? mock.takeProfit : undefined,
    });
    const stop = normalizeProtectionMockOrder({
      payload,
      kind: "STOP",
      mockOrder: Object.prototype.hasOwnProperty.call(mock, "stop") ? mock.stop : undefined,
    });
    const outcome = gridProtectionGuarantee.classifyProtectionOutcome({
      takeProfit,
      stop,
      oneLegEmergency: payload.oneLegEmergency === true,
    });
    const projectionState = buildProtectionResultState(outcome);
    const result = {
      ok: outcome.protected,
      dryRun: options.dryRun === true,
      mock: options.mock === true,
      intentType: intent.intentType,
      fifoKey: intent.fifoKey,
      projectionState,
      protectionState: outcome.state,
      protectionReason: outcome.reason,
      missingProtection: outcome.missing,
      protectionQty: ownershipQty.finalCloseQty,
      takeProfit,
      stop,
    };
    await syncProtectionReservationsForIntent({
      payload,
      result,
      qty: ownershipQty.finalCloseQty,
    }).catch(() => {});
    await updateGridProtectionProjection({ payload, outcome, state: projectionState, result }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: outcome.protected ? orderIntentQueue.STATUS.DONE : orderIntentQueue.STATUS.BLOCKED,
      result,
      errorCode: outcome.protected ? null : outcome.reason,
      errorMessage: outcome.protected ? null : `Grid protection critical:${outcome.reason}`,
    });
    return {
      processed: true,
      status: outcome.protected ? orderIntentQueue.STATUS.DONE : orderIntentQueue.STATUS.BLOCKED,
      reason: outcome.protected ? "PROTECTION_PROTECTED" : outcome.reason,
      projectionState,
    };
  }

  return await blockIntentByActualDispatchGate({
    intent,
    payload,
    options,
    projectionUpdater: async ({ payload: projectionPayload, state, reason }) =>
      updateGridProtectionProjection({
        payload: projectionPayload,
        state,
        outcome: { protected: false, partial: false, reason },
      }),
    defaultProjectionState: PROTECTION_QUEUE_STATE.RUNNING,
    defaultReason: "PROTECTION_ACTUAL_DISPATCH_GATE_PASSED_HANDLER_NOT_ENABLED",
    errorMessage: "Grid protection worker actual dispatch blocked by final gate.",
  });
};

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

  return await blockIntentByActualDispatchGate({
    intent,
    payload: intent?.payload || {},
    options,
    defaultProjectionState: "GRID_LIVE_ARM_RUNNING",
    defaultReason: "GRID_LIVE_ARM_ACTUAL_DISPATCH_GATE_PASSED_HANDLER_NOT_ENABLED",
    errorMessage: "Grid live arm worker actual dispatch blocked by final gate.",
  });
};

const processIntent = async (intent, options = {}) => {
  if (!intent) {
    return { processed: false, reason: "NO_INTENT" };
  }

  if (intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_LIVE_ARM) {
    return await processGridLiveArmIntent(intent, options);
  }

  if (intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_PROTECTION_CREATE) {
    return await processGridProtectionCreateIntent(intent, options);
  }

  if (intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_REENTRY_CREATE) {
    return await processGridReentryCreateIntent(intent, options);
  }

  if (
    intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_CANCEL_ORDER ||
    intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_CANCEL_ALL_FOR_REGIME ||
    intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_REGIME_CLEANUP_CANCEL
  ) {
    return await processGridCancelIntent(intent, options);
  }

  if (
    intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_GMANUAL_CLOSE ||
    intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_CONTROLLED_CLOSE
  ) {
    return await processGridCloseIntent(intent, options);
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
  processGridProtectionCreateIntent,
  processGridReentryCreateIntent,
  processGridCancelIntent,
  processGridCloseIntent,
  PROTECTION_QUEUE_STATE,
  REENTRY_QUEUE_STATE,
  CANCEL_QUEUE_STATE,
  CLOSE_QUEUE_STATE,
  startOrderIntentWorker,
  stopOrderIntentWorker,
  getOrderIntentWorkerHealth,
};
