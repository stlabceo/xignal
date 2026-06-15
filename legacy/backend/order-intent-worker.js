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
const signalStaleTime = require("./signal-stale-time");
const gridLiveArmHydration = require("./grid-live-arm-hydration");
const gridIntentHandlerGuards = require("./grid-intent-handler-guards");
const signalEntryConvergence = require("./signal-entry-convergence");
const gridExitSafeExchangeAdapter = require("./grid-exit-safe-exchange-adapter");

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

const parseIntentJsonSafe = (value, fallback = {}) => {
  if (!value) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

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

const SIGNAL_ENTRY_QUEUE_STATE = Object.freeze({
  INTENT_PENDING: "SIGNAL_ENTRY_INTENT_PENDING",
  RUNNING: "SIGNAL_ENTRY_RUNNING",
  BLOCKED_REDIS: "SIGNAL_ENTRY_BLOCKED_REDIS",
  BLOCKED_OWNERSHIP: "SIGNAL_ENTRY_BLOCKED_OWNERSHIP",
  BLOCKED_DISPATCH_GATE: "SIGNAL_ENTRY_BLOCKED_DISPATCH_GATE",
  FAILED: "SIGNAL_ENTRY_FAILED",
  SUBMITTED: "SIGNAL_ENTRY_SUBMITTED",
  STALE: "SIGNAL_ENTRY_STALE",
  ORDER_ACCEPTED: signalEntryConvergence.ENTRY_STATE.ORDER_ACCEPTED,
  FILL_PENDING: signalEntryConvergence.ENTRY_STATE.FILL_PENDING,
  ENTRY_LIFECYCLE_COMPLETE: signalEntryConvergence.ENTRY_STATE.ENTRY_LIFECYCLE_COMPLETE,
  ORDER_ACCEPTED_FILL_UNCONFIRMED_P0: signalEntryConvergence.ENTRY_STATE.ORDER_ACCEPTED_FILL_UNCONFIRMED_P0,
  ENTRY_RECOVERY_BLOCKED: signalEntryConvergence.ENTRY_STATE.ENTRY_RECOVERY_BLOCKED,
  ENTRY_FAILED_NO_ORDER: signalEntryConvergence.ENTRY_STATE.ENTRY_FAILED_NO_ORDER,
  ENTRY_FAILED_REJECTED: signalEntryConvergence.ENTRY_STATE.ENTRY_FAILED_REJECTED,
});

const SIGNAL_PROTECTION_QUEUE_STATE = Object.freeze({
  PENDING: "SIGNAL_PROTECTION_INTENT_PENDING",
  RUNNING: "SIGNAL_PROTECTION_RUNNING",
  PROTECTED: "SIGNAL_PROTECTION_PROTECTED",
  VERIFY_PENDING: signalEntryConvergence.ENTRY_STATE.PROTECTION_VERIFY_PENDING,
  RETRY_PENDING: signalEntryConvergence.ENTRY_STATE.PROTECTION_RETRY_PENDING,
  FAILED_P0: signalEntryConvergence.ENTRY_STATE.PROTECTION_FAILED_P0,
  UNPROTECTED_OPEN_P0: signalEntryConvergence.ENTRY_STATE.UNPROTECTED_OPEN_P0,
  PARTIAL: "SIGNAL_PROTECTION_PARTIAL",
  FAILED: "SIGNAL_PROTECTION_FAILED",
  BLOCKED_OWNERSHIP: "SIGNAL_PROTECTION_BLOCKED_OWNERSHIP",
  BLOCKED_REDIS: "SIGNAL_PROTECTION_BLOCKED_REDIS",
});

const SIGNAL_CANCEL_QUEUE_STATE = Object.freeze({
  PENDING: "SIGNAL_CANCEL_INTENT_PENDING",
  RUNNING: "SIGNAL_CANCEL_RUNNING",
  VERIFY_PENDING: "SIGNAL_CANCEL_VERIFY_PENDING",
  FAILED_ACTIVE_ORDER_REMAINS: "SIGNAL_CANCEL_FAILED_ACTIVE_ORDER_REMAINS",
  VERIFIED_GONE: "SIGNAL_CANCEL_VERIFIED_GONE",
  BLOCKED_429: "SIGNAL_CANCEL_BLOCKED_429",
  BLOCKED_418: "SIGNAL_CANCEL_BLOCKED_418",
  BLOCKED_REDIS: "SIGNAL_CANCEL_BLOCKED_REDIS",
});

const SIGNAL_CLOSE_QUEUE_STATE = Object.freeze({
  PENDING: "SIGNAL_CLOSE_INTENT_PENDING",
  RUNNING: "SIGNAL_CLOSE_RUNNING",
  ACCEPTED_NOT_CONVERGED: "SIGNAL_CLOSE_ACCEPTED_NOT_CONVERGED",
  CONVERGED: "SIGNAL_CLOSE_CONVERGED",
  FAILED: "SIGNAL_CLOSE_FAILED",
  BLOCKED_OWNERSHIP: "SIGNAL_CLOSE_BLOCKED_OWNERSHIP",
  RESERVED_DUPLICATE: "SIGNAL_CLOSE_RESERVED_DUPLICATE",
  BLOCKED_REDIS: "SIGNAL_CLOSE_BLOCKED_REDIS",
});

const GRID_LIVE_ARM_QUEUE_STATE = Object.freeze({
  RUNNING: "GRID_LIVE_ARM_RUNNING",
  DISPATCH_ENTERED: "GRID_LIVE_ARM_DISPATCH_ENTERED",
  DISPATCHED: "GRID_LIVE_ARM_DISPATCHED",
  BLOCKED_TARGET: "GRID_LIVE_ARM_TARGET_MISSING",
  BLOCKED_PAYLOAD: "GRID_LIVE_ARM_INVALID_PAYLOAD",
  BLOCKED_NO_PAIR: "GRID_LIVE_ARM_NO_PAIR_PRIMED",
  FAILED: "GRID_LIVE_ARM_DISPATCH_FAILED",
});

const GRID_EXIT_PARENT_QUEUE_STATE = Object.freeze({
  INTENT_PENDING: "GRID_EXIT_PARENT_INTENT_PENDING",
  ORCHESTRATOR_DISABLED: "GRID_EXIT_ORCHESTRATOR_DISABLED",
  BLOCKED_NOT_IMPLEMENTED: "GRID_EXIT_PARENT_BLOCKED_NOT_IMPLEMENTED",
});

const GRID_EXIT_CHILD_CANCEL_QUEUE_STATE = Object.freeze({
  BLOCKED_NOT_IMPLEMENTED: "GRID_EXIT_CHILD_CANCEL_WORKER_BLOCKED_NOT_IMPLEMENTED",
  EXECUTOR_DISABLED: "GRID_EXIT_CANCEL_EXECUTOR_DISABLED",
  DRY_RUN_READY: "GRID_EXIT_CANCEL_REQUEST_DRY_RUN_READY",
  MOCK_REQUEST_RECORDED: "GRID_EXIT_CANCEL_MOCK_REQUEST_RECORDED",
  EXECUTOR_BLOCKED: "GRID_EXIT_CANCEL_EXECUTOR_BLOCKED_NOT_IMPLEMENTED",
  RUNTIME_DISABLED: "GRID_EXIT_RUNTIME_DISABLED_CANCEL_RECORDED",
});

const GRID_EXIT_MARKET_CLOSE_PLAN_QUEUE_STATE = Object.freeze({
  BLOCKED_NOT_EXECUTABLE: "GRID_EXIT_MARKET_CLOSE_PLAN_WORKER_BLOCKED_NOT_EXECUTABLE",
});

const getLegPrefix = (leg) => (String(leg || "").toUpperCase() === "SHORT" ? "short" : "long");

const evaluateActualDispatchGateForIntent = async ({ intent, options = {} } = {}) =>
  await orderIntentDispatchGate.evaluateWorkerActualDispatchGate({
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
  const gate = await evaluateActualDispatchGateForIntent({ intent, options });

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
  const terminalGuard = await shouldPreserveTerminalGridProjection({
    payload,
    projectionType: "GRID_PROTECTION_PROJECTION",
  });
  if (terminalGuard.preserve) {
    return {
      skipped: true,
      reason: terminalGuard.reason,
      current: terminalGuard.current,
    };
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

const loadLiveGridProjectionRow = async (payload = {}) => {
  const rowId = Number(payload.gridRowId || payload.regimeId || payload.pid || 0);
  const uid = Number(payload.uid || 0);
  if (!(rowId > 0) || !(uid > 0)) {
    return null;
  }
  const [rows] = await db.query(
    `SELECT id, uid, enabled, regimeStatus, regimeEndReason,
            longLegStatus, shortLegStatus, longQty, shortQty,
            longEntryOrderId, shortEntryOrderId, longExitOrderId, shortExitOrderId,
            longStopOrderId, shortStopOrderId
       FROM live_grid_strategy_list
      WHERE id = ?
        AND uid = ?
      LIMIT 1`,
    [rowId, uid]
  );
  return rows?.[0] || null;
};

const shouldPreserveTerminalGridProjection = async ({ payload = {}, projectionType = "GRID_PROJECTION" } = {}) => {
  const current = await loadLiveGridProjectionRow(payload).catch(() => null);
  if (!current) {
    return { preserve: false, current: null };
  }
  const regimeStatus = String(current.regimeStatus || "").trim().toUpperCase();
  if (regimeStatus !== "ENDED") {
    return { preserve: false, current };
  }
  return {
    preserve: true,
    current,
    reason: `${projectionType}_TERMINAL_ROW_PRESERVED`,
  };
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
  const terminalGuard = await shouldPreserveTerminalGridProjection({
    payload,
    projectionType: "GRID_CANCEL_PROJECTION",
  });
  if (terminalGuard.preserve) {
    return {
      skipped: true,
      reason: terminalGuard.reason,
      current: terminalGuard.current,
    };
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

const updateSignalEntryProjection = async ({ payload = {}, state, reason = null } = {}) => {
  const pid = Number(payload.pid || payload.id || 0);
  return {
    state,
    reason,
    uid: Number(payload.uid || 0),
    pid,
  };
};

const getSignalEntryStaleInfoForIntent = (payload = {}, options = {}) =>
  signalStaleTime.getSignalEntryPendingStaleInfo(
    {
      status: "EXACT_WAIT",
      r_signalTime: payload.signalTime || payload.r_signalTime || null,
    },
    {
      staleSeconds: options.signalStaleSeconds || process.env.SIGNAL_ENTRY_PENDING_STALE_SECONDS || 30,
      now: options.now,
    }
  );

const completeSignalMarketEntryIntent = async ({ intent, status, reason, result = {}, errorMessage = null } = {}) => {
  await orderIntentQueue.completeIntent({
    id: intent.id,
    status,
    result: {
      intentType: intent.intentType,
      fifoKey: intent.fifoKey,
      ...result,
    },
    errorCode: status === orderIntentQueue.STATUS.DONE ? null : reason,
    errorMessage,
  });
  return { processed: true, status, reason, result };
};

const getSignalMarketEntryDispatcher = (options = {}) =>
  typeof options.signalMarketEntryDispatcher === "function"
    ? options.signalMarketEntryDispatcher
    : async ({ intent = {}, payload = {} } = {}) => {
        const coin = require("./coin");
        if (typeof coin.sendEnter !== "function") {
          throw new Error("coin.sendEnter handler is unavailable");
        }
        const entryContext = signalEntryConvergence.buildSignalEntryDispatcherContext({ intent, payload });
        return await coin.sendEnter(
          payload.symbol,
          payload.side,
          payload.leverage,
          payload.margin,
          payload.uid,
          payload.pid,
          payload.limitST || "N",
          payload.signalPrice || null,
          {
            entryContext,
          }
        );
      };

const confirmSignalEntryConvergenceAfterAccepted = async ({
  intent,
  payload = {},
  sendData = {},
  accepted = {},
  options = {},
} = {}) => {
  if (typeof options.signalEntryConvergenceChecker === "function") {
    return await options.signalEntryConvergenceChecker({ intent, payload, sendData, accepted, options });
  }

  const coin = require("./coin");
  if (typeof coin.confirmSignalMarketEntryAfterAccepted !== "function") {
    return signalEntryConvergence.buildUnconfirmedP0Result({
      payload,
      accepted,
      reason: "SIGNAL_ENTRY_CONVERGENCE_HANDLER_MISSING",
    });
  }

  try {
    return await coin.confirmSignalMarketEntryAfterAccepted({
      uid: accepted.uid,
      pid: accepted.pid,
      symbol: accepted.symbol,
      side: accepted.side,
      positionSide: accepted.positionSide,
      orderId: accepted.orderId,
      clientOrderId: accepted.clientOrderId,
      acceptedAt: accepted.acceptedAt,
      ownerRowId: accepted.ownerRowId,
      sourceWebhookEventId: accepted.sourceWebhookEventId,
      sourceWebhookTargetId: accepted.sourceWebhookTargetId,
      intentId: accepted.intentId,
      signalTime: accepted.signalTime,
      wsWaitMs: options.signalEntryWsWaitMs,
      maxUnconfirmedMs: options.signalEntryMaxUnconfirmedMs,
    });
  } catch (error) {
    if (
      error?.code === "BINANCE_PRIVATE_READ_CIRCUIT_OPEN" ||
      error?.code === "BINANCE_UID_PRIVATE_READ_BACKOFF" ||
      error?.code === "BINANCE_READ_BUDGET_EXHAUSTED"
    ) {
      return signalEntryConvergence.buildRecoveryBlockedResult({ payload, accepted, error });
    }
    throw error;
  }
};

const dispatchSignalMarketEntryIntent = async ({ intent, payload = {}, options = {}, actualDispatchGate = null } = {}) => {
  if (options.dryRun === true || options.mock === true) {
    const mockResult = options.mockSignalEntryResult;
    if (mockResult === false || mockResult?.ok === false) {
      const reason = mockResult?.reason || "SIGNAL_ENTRY_SUBMIT_FAILED";
      await updateSignalEntryProjection({
        payload,
        state: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
        reason,
      }).catch(() => {});
      return await completeSignalMarketEntryIntent({
        intent,
        status: orderIntentQueue.STATUS.FAILED,
        reason: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
        result: {
          ok: false,
          dryRun: options.dryRun === true,
          mock: options.mock === true,
          dispatchEntered: true,
          projectionState: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
          reason,
          clientOrderId: payload.clientOrderId || null,
          actualDispatchGate,
        },
        errorMessage: `Signal market entry failed:${reason}`,
      });
    }

    await updateSignalEntryProjection({
      payload,
      state: SIGNAL_ENTRY_QUEUE_STATE.FILL_PENDING,
      reason: SIGNAL_ENTRY_QUEUE_STATE.FILL_PENDING,
    }).catch(() => {});
    const accepted = signalEntryConvergence.buildAcceptedOrderPersistence({
      intent,
      payload,
      sendData: {
        ok: true,
        orderId: mockResult?.orderId || null,
        clientOrderId: mockResult?.clientOrderId || payload.clientOrderId || null,
        acceptedAt: mockResult?.acceptedAt || new Date().toISOString(),
        ownerRowId: mockResult?.ownerRowId || null,
      },
    });
    const convergence = mockResult?.convergence || {
      ok: mockResult?.entryLifecycleComplete === true,
      state: mockResult?.entryLifecycleComplete === true
        ? SIGNAL_ENTRY_QUEUE_STATE.ENTRY_LIFECYCLE_COMPLETE
        : SIGNAL_ENTRY_QUEUE_STATE.ORDER_ACCEPTED_FILL_UNCONFIRMED_P0,
      reason: mockResult?.entryLifecycleComplete === true
        ? SIGNAL_ENTRY_QUEUE_STATE.ENTRY_LIFECYCLE_COMPLETE
        : SIGNAL_ENTRY_QUEUE_STATE.ORDER_ACCEPTED_FILL_UNCONFIRMED_P0,
    };
    if (convergence.safeNoExposure === true) {
      return await completeSignalMarketEntryIntent({
        intent,
        status: orderIntentQueue.STATUS.FAILED,
        reason: convergence.state || SIGNAL_ENTRY_QUEUE_STATE.ENTRY_FAILED_REJECTED,
        result: {
          ok: false,
          safeNoExposure: true,
          dryRun: options.dryRun === true,
          mock: options.mock === true,
          dispatchEntered: true,
          projectionState: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
          accepted,
          convergence,
          clientOrderId: accepted.clientOrderId,
          orderId: accepted.orderId,
          side: payload.side || null,
          positionSide: payload.positionSide || null,
          actualDispatchGate,
        },
        errorMessage: "Signal market entry ended without exchange exposure.",
      });
    }
    if (!signalEntryConvergence.isDoneAllowed(convergence)) {
      return await completeSignalMarketEntryIntent({
        intent,
        status: orderIntentQueue.STATUS.BLOCKED,
        reason: convergence.reason || convergence.state || SIGNAL_ENTRY_QUEUE_STATE.ORDER_ACCEPTED_FILL_UNCONFIRMED_P0,
        result: {
          ok: false,
          dryRun: options.dryRun === true,
          mock: options.mock === true,
          dispatchEntered: true,
          projectionState: SIGNAL_ENTRY_QUEUE_STATE.FILL_PENDING,
          accepted,
          convergence,
          clientOrderId: accepted.clientOrderId,
          orderId: accepted.orderId,
          side: payload.side || null,
          positionSide: payload.positionSide || null,
          actualDispatchGate,
        },
        errorMessage: "Signal market entry accepted but fill convergence was not confirmed.",
      });
    }
    return await completeSignalMarketEntryIntent({
      intent,
      status: orderIntentQueue.STATUS.DONE,
      reason: SIGNAL_ENTRY_QUEUE_STATE.ENTRY_LIFECYCLE_COMPLETE,
      result: {
        ok: true,
        dryRun: options.dryRun === true,
        mock: options.mock === true,
        dispatchEntered: true,
        projectionState: SIGNAL_ENTRY_QUEUE_STATE.ENTRY_LIFECYCLE_COMPLETE,
        accepted,
        convergence,
        clientOrderId: accepted.clientOrderId,
        orderId: accepted.orderId,
        side: payload.side || null,
        positionSide: payload.positionSide || null,
        actualDispatchGate,
      },
    });
  }

  const dispatcher = getSignalMarketEntryDispatcher(options);
  try {
    const sendData = await dispatcher({ intent, payload, options, actualDispatchGate });
    if (sendData?.status === true || sendData?.ok === true) {
      const accepted = signalEntryConvergence.buildAcceptedOrderPersistence({
        intent,
        payload,
        sendData,
      });
      await updateSignalEntryProjection({
        payload,
        state: SIGNAL_ENTRY_QUEUE_STATE.FILL_PENDING,
        reason: SIGNAL_ENTRY_QUEUE_STATE.FILL_PENDING,
      }).catch(() => {});
      const convergence = await confirmSignalEntryConvergenceAfterAccepted({
        intent,
        payload,
        sendData,
        accepted,
        options,
      });
      if (convergence?.safeNoExposure === true) {
        await updateSignalEntryProjection({
          payload,
          state: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
          reason: convergence.state || SIGNAL_ENTRY_QUEUE_STATE.ENTRY_FAILED_REJECTED,
        }).catch(() => {});
        return await completeSignalMarketEntryIntent({
          intent,
          status: orderIntentQueue.STATUS.FAILED,
          reason: convergence.state || SIGNAL_ENTRY_QUEUE_STATE.ENTRY_FAILED_REJECTED,
          result: {
            ok: false,
            safeNoExposure: true,
            dispatchEntered: true,
            projectionState: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
            accepted,
            convergence,
            clientOrderId: accepted.clientOrderId,
            orderId: accepted.orderId,
            side: payload.side || null,
            positionSide: payload.positionSide || null,
            actualDispatchGate,
          },
          errorMessage: "Signal market entry ended without exchange exposure.",
        });
      }
      if (!signalEntryConvergence.isDoneAllowed(convergence)) {
        const reason = convergence?.reason || convergence?.state || SIGNAL_ENTRY_QUEUE_STATE.ORDER_ACCEPTED_FILL_UNCONFIRMED_P0;
        await updateSignalEntryProjection({
          payload,
          state: reason === SIGNAL_ENTRY_QUEUE_STATE.ENTRY_RECOVERY_BLOCKED
            ? SIGNAL_ENTRY_QUEUE_STATE.ENTRY_RECOVERY_BLOCKED
            : SIGNAL_ENTRY_QUEUE_STATE.ORDER_ACCEPTED_FILL_UNCONFIRMED_P0,
          reason,
        }).catch(() => {});
        return await completeSignalMarketEntryIntent({
          intent,
          status: orderIntentQueue.STATUS.BLOCKED,
          reason,
          result: {
            ok: false,
            dispatchEntered: true,
            projectionState: SIGNAL_ENTRY_QUEUE_STATE.FILL_PENDING,
            accepted,
            convergence,
            clientOrderId: accepted.clientOrderId,
            orderId: accepted.orderId,
            side: payload.side || null,
            positionSide: payload.positionSide || null,
            actualDispatchGate,
          },
          errorMessage: `Signal market entry accepted but fill convergence was not confirmed:${reason}`,
        });
      }
      await updateSignalEntryProjection({
        payload,
        state: SIGNAL_ENTRY_QUEUE_STATE.ENTRY_LIFECYCLE_COMPLETE,
        reason: SIGNAL_ENTRY_QUEUE_STATE.ENTRY_LIFECYCLE_COMPLETE,
      }).catch(() => {});
      return await completeSignalMarketEntryIntent({
        intent,
        status: orderIntentQueue.STATUS.DONE,
        reason: SIGNAL_ENTRY_QUEUE_STATE.ENTRY_LIFECYCLE_COMPLETE,
        result: {
          ok: true,
          dispatchEntered: true,
          projectionState: SIGNAL_ENTRY_QUEUE_STATE.ENTRY_LIFECYCLE_COMPLETE,
          accepted,
          convergence,
          clientOrderId: accepted.clientOrderId,
          orderId: accepted.orderId,
          side: payload.side || null,
          positionSide: payload.positionSide || null,
          actualDispatchGate,
        },
      });
    }

    const reason = sendData?.errAction || sendData?.reason || "SIGNAL_ENTRY_SUBMIT_FAILED";
    await updateSignalEntryProjection({
      payload,
      state: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
      reason,
    }).catch(() => {});
    return await completeSignalMarketEntryIntent({
      intent,
      status: orderIntentQueue.STATUS.FAILED,
      reason: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
      result: {
        ok: false,
        dispatchEntered: true,
        projectionState: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
        reason,
        errCode: sendData?.errCode || null,
        errAction: sendData?.errAction || null,
        errMsg: sendData?.errMsg || null,
        clientOrderId: payload.clientOrderId || null,
        actualDispatchGate,
      },
      errorMessage: `Signal market entry failed:${reason}`,
    });
  } catch (error) {
    const reason = error?.code || error?.guardReason || "SIGNAL_ENTRY_SUBMIT_FAILED";
    await updateSignalEntryProjection({
      payload,
      state: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
      reason,
    }).catch(() => {});
    return await completeSignalMarketEntryIntent({
      intent,
      status: orderIntentQueue.STATUS.FAILED,
      reason: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
      result: {
        ok: false,
        dispatchEntered: true,
        projectionState: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
        reason,
        error: error?.message || String(error),
        clientOrderId: payload.clientOrderId || null,
        actualDispatchGate,
      },
      errorMessage: error?.message || "Signal market entry dispatch failed.",
    });
  }
};

const processSignalMarketEntryIntent = async (intent, options = {}) => {
  const env = options.env || process.env;
  const payload = intent?.payload?.signalEntry || intent?.payload || {};
  const lockRedisClient = Object.prototype.hasOwnProperty.call(options, "redisClient")
    ? options.redisClient
    : redisClient;
  const redisGate = liveWriteSafetyGate.evaluateRedisLockUnavailable({
    env,
    liveScope: true,
    strategyCategory: "signal",
    scope: "ORDER_INTENT_WORKER",
    lockKey: `order-intent-worker:signal-entry:${intent.fifoKey || intent.id}`,
  });

  if (!liveWriteSafetyGate.isRedisClientReady(lockRedisClient) && !redisGate.allowed) {
    await updateSignalEntryProjection({
      payload,
      state: SIGNAL_ENTRY_QUEUE_STATE.BLOCKED_REDIS,
      reason: redisGate.reason,
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(redisGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_ENTRY_QUEUE_STATE.BLOCKED_REDIS,
      }),
      errorCode: redisGate.reason,
      errorMessage: "Redis lock unavailable; live signal market entry worker write blocked.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: redisGate.reason };
  }

  const ownershipReadiness = options.ownershipReadiness || await positionOwnership.getOwnershipReadiness().catch((error) => ({
    enabled: false,
    error: error?.message || String(error),
  }));
  const ownershipGate = liveWriteSafetyGate.evaluateOwnershipGuard({
    env,
    strategyCategory: "signal",
    uid: intent.uid,
    pid: intent.pid,
    symbol: payload.symbol || null,
    positionSide: payload.positionSide || null,
    ownershipEnabled: ownershipReadiness.enabled === true,
  });
  if (!ownershipGate.allowed) {
    await updateSignalEntryProjection({
      payload,
      state: SIGNAL_ENTRY_QUEUE_STATE.BLOCKED_OWNERSHIP,
      reason: ownershipGate.reason,
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(ownershipGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_ENTRY_QUEUE_STATE.BLOCKED_OWNERSHIP,
      }),
      errorCode: ownershipGate.reason,
      errorMessage: `DB-backed PID ownership unavailable; live signal market entry worker write blocked. status:${ownershipReadiness.status || "UNKNOWN"}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: ownershipGate.reason };
  }

  const staleInfo = getSignalEntryStaleInfoForIntent(payload, options);
  if (staleInfo.stale) {
    const reason = staleInfo.reason || "SIGNAL_ENTRY_STALE";
    await updateSignalEntryProjection({
      payload,
      state: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
      reason,
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_ENTRY_QUEUE_STATE.FAILED,
        staleInfo: {
          stale: staleInfo.stale,
          ageSeconds: staleInfo.ageSeconds,
          reason: staleInfo.reason,
        },
      }),
      errorCode: SIGNAL_ENTRY_QUEUE_STATE.STALE,
      errorMessage: `Signal market entry blocked by stale pending signal:${reason}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: SIGNAL_ENTRY_QUEUE_STATE.STALE };
  }

  if (options.dryRun === true || options.mock === true) {
    return await dispatchSignalMarketEntryIntent({
      intent,
      payload,
      options,
      actualDispatchGate: {
        allowed: false,
        reason: options.mock === true ? "MOCK_SIGNAL_MARKET_ENTRY_DISPATCH" : "DRY_RUN_SIGNAL_MARKET_ENTRY_DISPATCH",
      },
    });
  }

  const actualDispatchGate = await evaluateActualDispatchGateForIntent({ intent, options });
  if (actualDispatchGate.allowed) {
    return await dispatchSignalMarketEntryIntent({ intent, payload, options, actualDispatchGate });
  }

  return await blockIntentByActualDispatchGate({
    intent,
    payload,
    options,
    projectionUpdater: updateSignalEntryProjection,
    defaultProjectionState: SIGNAL_ENTRY_QUEUE_STATE.BLOCKED_DISPATCH_GATE,
    defaultReason: "SIGNAL_ENTRY_ACTUAL_DISPATCH_BLOCKED",
    errorMessage: "Signal market entry worker actual dispatch blocked by final gate.",
  });
};

const updateSignalQueueProjection = async ({ payload = {}, state, reason = null } = {}) => ({
  state,
  reason,
  uid: Number(payload.uid || 0),
  pid: Number(payload.pid || payload.id || 0),
  symbol: payload.symbol || null,
  positionSide: payload.positionSide || null,
});

const deriveSignalProtectionClientOrderId = ({ payload = {}, boundType = "PROFIT" } = {}) => {
  const normalizedBoundType = String(boundType || "PROFIT").trim().toUpperCase();
  const entryIdentity = payload.entryOrderId || payload.entryClientOrderId || payload.sourceOrderId || payload.sourceTradeId || "BOUND";
  return `${normalizedBoundType}_${Number(payload.uid || 0)}_${Number(payload.pid || 0)}_${entryIdentity}`;
};

const normalizeSignalProtectionMockOrder = ({ payload, kind, mockOrder }) => {
  if (mockOrder === false) {
    return { errorCode: "MOCK_SIGNAL_PROTECTION_REJECTED", errorMessage: `${kind} rejected by mock` };
  }
  if (mockOrder && typeof mockOrder === "object") {
    return mockOrder;
  }
  const boundType = kind === "TP"
    ? (String(payload.boundType || "").toUpperCase() === "SPLITTP" ? "SPLITTP" : "PROFIT")
    : "STOP";
  const clientOrderId = deriveSignalProtectionClientOrderId({ payload, boundType });
  return {
    clientOrderId,
    orderId: `MOCK_${clientOrderId}`,
  };
};

const buildSignalProtectionResultState = (outcome) => {
  if (outcome.protected) {
    return SIGNAL_PROTECTION_QUEUE_STATE.PROTECTED;
  }
  return outcome.partial ? SIGNAL_PROTECTION_QUEUE_STATE.PARTIAL : SIGNAL_PROTECTION_QUEUE_STATE.FAILED;
};

const getSignalProtectionStaleInfoForIntent = (payload = {}, options = {}) => {
  const sourceTime = payload.tradeTime || payload.fillTime || payload.entryFillTime || payload.signalTime || null;
  if (!sourceTime) {
    return { stale: false, reason: null, ageSeconds: 0, skipped: true };
  }

  const parsed = signalStaleTime.parseDatabaseUtcDateTime(sourceTime);
  if (!parsed) {
    return { stale: true, reason: "invalid-protection-time", ageSeconds: null };
  }

  const now = signalStaleTime.parseDatabaseUtcDateTime(options.now || new Date()) || signalStaleTime.parseDatabaseUtcDateTime(new Date());
  const ageSeconds = Math.max(0, now.diff(parsed, "second", true));
  const staleSeconds = Math.max(10, Number(options.signalProtectionStaleSeconds || process.env.SIGNAL_PROTECTION_STALE_SECONDS || 300));
  return {
    stale: ageSeconds >= staleSeconds,
    reason: ageSeconds >= staleSeconds ? "signal-protection-stale" : null,
    ageSeconds,
    signalTime: parsed.toDate().toISOString(),
  };
};

const validateSignalProtectionIntentPayload = ({ intent = {}, payload = {}, qty = 0 } = {}) => {
  const boundType = String(
    payload.boundType ||
    (intent.intentType === orderIntentQueue.INTENT_TYPE.SIGNAL_SPLIT_TP_CREATE ? "SPLITTP" : "PROFIT")
  ).trim().toUpperCase();
  const requiredIdentity = payload.entryOrderId || payload.entryClientOrderId || payload.sourceOrderId || payload.sourceTradeId || null;
  const takeProfitPrice = Number(payload.takeProfitPrice || 0);
  const stopPrice = Number(payload.stopPrice || 0);
  const splitStageQty = Number(payload.splitStageQty || 0);
  const closeQty = Number(qty || payload.ownedQty || payload.qty || 0);

  if (!payload.uid || !payload.pid || !payload.symbol || !payload.side || !payload.positionSide || !requiredIdentity) {
    return { ok: false, reason: "SIGNAL_PROTECTION_INVALID_PAYLOAD", boundType };
  }
  if (!(closeQty > 0)) {
    return { ok: false, reason: "SIGNAL_PROTECTION_QTY_INVALID", boundType };
  }
  if (boundType === "SPLITTP") {
    if (!(takeProfitPrice > 0) || !(splitStageQty > 0) || !(stopPrice > 0)) {
      return { ok: false, reason: "SIGNAL_SPLIT_TP_INVALID_PAYLOAD", boundType };
    }
    return { ok: true, boundType };
  }
  if (!(takeProfitPrice > 0) || !(stopPrice > 0)) {
    return { ok: false, reason: "SIGNAL_PROTECTION_INVALID_TP_SL_PAYLOAD", boundType };
  }
  return { ok: true, boundType };
};

const completeSignalProtectionIntent = async ({ intent, status, reason, result = {}, errorMessage = null } = {}) => {
  const completedResult = {
    intentType: intent.intentType,
    fifoKey: intent.fifoKey,
    ...result,
  };
  await orderIntentQueue.completeIntent({
    id: intent.id,
    status,
    result: completedResult,
    errorCode: status === orderIntentQueue.STATUS.DONE ? null : reason,
    errorMessage,
  });
  const payload = intent?.payload?.protection || intent?.payload || {};
  const entryIntentId = payload.entryIntentId || completedResult.entryIntentId || null;
  if (entryIntentId) {
    const childState = completedResult.protectionChildState ||
      signalEntryConvergence.normalizeProtectionChildState(
        status === orderIntentQueue.STATUS.DONE
          ? signalEntryConvergence.ENTRY_STATE.ENTRY_PROTECTED_ACKED
          : (completedResult.reason || reason)
      );
    await orderIntentQueue.updateSignalEntryProtectionChildState({
      entryIntentId,
      protectionIntentId: intent.id,
      childState,
      reason: completedResult.reason || reason,
      childStatus: status,
      childResult: completedResult,
    }).catch(() => {});
  }
  return { processed: true, status, reason, result, projectionState: result.projectionState || null };
};

const normalizeSignalProtectionDispatchOrder = (order) => {
  if (!order) {
    return null;
  }
  return {
    ...order,
    clientOrderId: order.clientOrderId || order.clientAlgoId || order.origClientOrderId || null,
    orderId: order.orderId || order.strategyId || order.algoId || order.sourceOrderId || null,
    sourceOrderId: order.sourceOrderId || order.orderId || order.strategyId || order.algoId || null,
    errorCode: order.errorCode || null,
    errorMessage: order.errorMessage || null,
  };
};

const getSignalProtectionDispatcher = (options = {}) =>
  typeof options.signalProtectionDispatcher === "function"
    ? options.signalProtectionDispatcher
    : async ({ payload, qty }) => {
        const coin = require("./coin");
        if (typeof coin.dispatchSignalProtectionOrdersFromIntent !== "function") {
          throw new Error("coin.dispatchSignalProtectionOrdersFromIntent handler is unavailable");
        }
        return await coin.dispatchSignalProtectionOrdersFromIntent({
          ...payload,
          qty,
        });
      };

const buildSignalProtectionDispatchResult = ({ intent, payload, ownershipQty, takeProfit, stop, options, actualDispatchGate }) => {
  const outcome = gridProtectionGuarantee.classifyProtectionOutcome({ takeProfit, stop });
  const projectionState = buildSignalProtectionResultState(outcome);
  return {
    ok: outcome.protected,
    dryRun: options.dryRun === true,
    mock: options.mock === true,
    dispatchEntered: true,
    intentType: intent.intentType,
    fifoKey: intent.fifoKey,
    projectionState,
    protectionState: outcome.state,
    protectionChildState: outcome.protected
      ? signalEntryConvergence.ENTRY_STATE.ENTRY_PROTECTED_ACKED
      : signalEntryConvergence.ENTRY_STATE.UNPROTECTED_OPEN_P0,
    protectionReason: outcome.reason,
    missingProtection: outcome.missing,
    protectionQty: ownershipQty.finalCloseQty,
    splitStageQty: String(payload.boundType || "").toUpperCase() === "SPLITTP"
      ? Number(payload.splitStageQty || ownershipQty.finalCloseQty || 0)
      : null,
    takeProfit,
    stop,
    entryIntentId: payload.entryIntentId || null,
    ownerRowId: payload.ownerRowId || null,
    protectionIdempotencyKey: signalEntryConvergence.buildProtectionChildIdempotencyKey({
      uid: payload.uid,
      pid: payload.pid,
      symbol: payload.symbol,
      side: payload.side,
      positionSide: payload.positionSide,
      ownerRowId: payload.ownerRowId,
      entryOrderId: payload.entryOrderId || payload.sourceOrderId,
      boundType: payload.boundType,
    }),
    actualDispatchGate,
  };
};

const buildSignalProtectionBlockedResult = ({ payload = {}, reason, projectionState, protectionChildState, extra = {} } = {}) => {
  const normalizedProtectionChildState = signalEntryConvergence.normalizeProtectionChildState(
    protectionChildState || reason
  );
  return buildBlockResult(reason, {
    projectionState,
    protectionChildState: normalizedProtectionChildState,
    entryIntentId: payload.entryIntentId || null,
    ownerRowId: payload.ownerRowId || null,
    protectionIdempotencyKey: signalEntryConvergence.buildProtectionChildIdempotencyKey({
      uid: payload.uid,
      pid: payload.pid,
      symbol: payload.symbol,
      side: payload.side,
      positionSide: payload.positionSide,
      ownerRowId: payload.ownerRowId,
      entryOrderId: payload.entryOrderId || payload.sourceOrderId,
      boundType: payload.boundType,
    }),
    ...extra,
  });
};

const dispatchSignalProtectionIntent = async ({ intent, payload = {}, ownershipQty = {}, options = {}, actualDispatchGate = null } = {}) => {
  const qty = Number(ownershipQty.finalCloseQty || payload.ownedQty || payload.qty || 0);
  const payloadValidation = validateSignalProtectionIntentPayload({ intent, payload, qty });
  if (!payloadValidation.ok) {
    await updateSignalQueueProjection({
      payload,
      state: SIGNAL_PROTECTION_QUEUE_STATE.FAILED,
      reason: payloadValidation.reason,
    }).catch(() => {});
    return await completeSignalProtectionIntent({
      intent,
      status: orderIntentQueue.STATUS.BLOCKED,
      reason: payloadValidation.reason,
      result: buildSignalProtectionBlockedResult({
        payload,
        reason: payloadValidation.reason,
        projectionState: SIGNAL_PROTECTION_QUEUE_STATE.FAILED,
        protectionChildState: signalEntryConvergence.ENTRY_STATE.PROTECTION_FAILED_P0,
        extra: {
        dispatchEntered: false,
        actualDispatchGate,
        },
      }),
      errorMessage: `Signal protection invalid payload:${payloadValidation.reason}`,
    });
  }

  if (options.dryRun === true || options.mock === true) {
    const mock = options.mockSignalProtectionResult || options.mockProtectionResult || {};
    const takeProfit = normalizeSignalProtectionMockOrder({
      payload,
      kind: "TP",
      mockOrder: Object.prototype.hasOwnProperty.call(mock, "takeProfit") ? mock.takeProfit : undefined,
    });
    const stop = normalizeSignalProtectionMockOrder({
      payload,
      kind: "STOP",
      mockOrder: Object.prototype.hasOwnProperty.call(mock, "stop") ? mock.stop : undefined,
    });
    const result = buildSignalProtectionDispatchResult({
      intent,
      payload,
      ownershipQty,
      takeProfit,
      stop,
      options,
      actualDispatchGate,
    });
    const outcomeProtected = result.projectionState === SIGNAL_PROTECTION_QUEUE_STATE.PROTECTED;
    await syncSignalProtectionReservationsForIntent({ payload, result, qty }).catch(() => {});
    await updateSignalQueueProjection({ payload, state: result.projectionState, reason: result.protectionReason }).catch(() => {});
    return await completeSignalProtectionIntent({
      intent,
      status: outcomeProtected ? orderIntentQueue.STATUS.DONE : orderIntentQueue.STATUS.BLOCKED,
      reason: outcomeProtected ? SIGNAL_PROTECTION_QUEUE_STATE.PROTECTED : result.protectionReason,
      result,
      errorMessage: outcomeProtected ? null : `Signal protection critical:${result.protectionReason}`,
    });
  }

  const dispatcher = getSignalProtectionDispatcher(options);
  try {
    const dispatchResult = await dispatcher({ intent, payload, qty, options, actualDispatchGate });
    const takeProfit = normalizeSignalProtectionDispatchOrder(dispatchResult?.takeProfit || dispatchResult?.tp || dispatchResult?.profit);
    const stop = normalizeSignalProtectionDispatchOrder(dispatchResult?.stop || dispatchResult?.stopLoss || dispatchResult?.sl);
    const result = buildSignalProtectionDispatchResult({
      intent,
      payload,
      ownershipQty,
      takeProfit,
      stop,
      options,
      actualDispatchGate,
    });
    const outcomeProtected = result.projectionState === SIGNAL_PROTECTION_QUEUE_STATE.PROTECTED;
    await syncSignalProtectionReservationsForIntent({ payload, result, qty }).catch(() => {});
    await updateSignalQueueProjection({ payload, state: result.projectionState, reason: result.protectionReason }).catch(() => {});
    return await completeSignalProtectionIntent({
      intent,
      status: outcomeProtected ? orderIntentQueue.STATUS.DONE : orderIntentQueue.STATUS.BLOCKED,
      reason: outcomeProtected ? SIGNAL_PROTECTION_QUEUE_STATE.PROTECTED : result.protectionReason,
      result,
      errorMessage: outcomeProtected ? null : `Signal protection critical:${result.protectionReason}`,
    });
  } catch (error) {
    const reason = error?.code || error?.guardReason || "SIGNAL_PROTECTION_SUBMIT_FAILED";
    const protectionChildState = signalEntryConvergence.normalizeProtectionChildState(reason);
    const retryPending = signalEntryConvergence.isProtectionRetryPending(protectionChildState);
    await updateSignalQueueProjection({
      payload,
      state: retryPending ? SIGNAL_PROTECTION_QUEUE_STATE.RETRY_PENDING : SIGNAL_PROTECTION_QUEUE_STATE.FAILED_P0,
      reason,
    }).catch(() => {});
    return await completeSignalProtectionIntent({
      intent,
      status: retryPending ? orderIntentQueue.STATUS.BLOCKED : orderIntentQueue.STATUS.FAILED,
      reason: protectionChildState,
      result: {
        ok: false,
        dispatchEntered: true,
        projectionState: retryPending ? SIGNAL_PROTECTION_QUEUE_STATE.RETRY_PENDING : SIGNAL_PROTECTION_QUEUE_STATE.FAILED_P0,
        protectionChildState,
        reason,
        error: error?.message || String(error),
        entryIntentId: payload.entryIntentId || null,
        ownerRowId: payload.ownerRowId || null,
        protectionIdempotencyKey: signalEntryConvergence.buildProtectionChildIdempotencyKey({
          uid: payload.uid,
          pid: payload.pid,
          symbol: payload.symbol,
          side: payload.side,
          positionSide: payload.positionSide,
          ownerRowId: payload.ownerRowId,
          entryOrderId: payload.entryOrderId || payload.sourceOrderId,
          boundType: payload.boundType,
        }),
        actualDispatchGate,
      },
      errorMessage: error?.message || "Signal protection dispatch failed.",
    });
  }
};

const syncSignalProtectionReservationsForIntent = async ({ payload = {}, result = {}, qty = 0 } = {}) => {
  const reservations = [];
  if (result.takeProfit?.clientOrderId) {
    reservations.push({
      clientOrderId: result.takeProfit.clientOrderId,
      sourceOrderId: result.takeProfit.sourceOrderId || result.takeProfit.orderId || null,
      actualOrderId: result.takeProfit.orderId || null,
      reservationKind: String(payload.boundType || "").toUpperCase() === "SPLITTP" ? "BOUND_SPLIT_TP" : "BOUND_PROFIT",
      reservedQty: String(payload.boundType || "").toUpperCase() === "SPLITTP"
        ? Number(payload.splitStageQty || qty || 0)
        : qty,
      note: "signal protection intent take-profit",
    });
  }
  if (result.stop?.clientOrderId) {
    reservations.push({
      clientOrderId: result.stop.clientOrderId,
      sourceOrderId: result.stop.sourceOrderId || result.stop.orderId || null,
      actualOrderId: result.stop.orderId || null,
      reservationKind: "BOUND_STOP",
      reservedQty: qty,
      note: "signal protection intent stop-loss",
    });
  }

  return await pidPositionLedger.replaceExitReservations({
    uid: payload.uid,
    pid: payload.pid,
    strategyCategory: "signal",
    symbol: payload.symbol,
    positionSide: payload.positionSide,
    reservations,
  });
};

const buildSignalCancelTargetForIntent = (payload = {}) => ({
  targetOrderId: payload.targetOrderId == null || payload.targetOrderId === ""
    ? null
    : String(payload.targetOrderId),
  targetClientOrderId: payload.targetClientOrderId || payload.clientOrderId || null,
});

const getSignalCancelStaleInfoForIntent = (payload = {}, options = {}) => {
  const sourceTime = payload.cancelRequestedAt || payload.requestedAt || payload.createdAt || payload.sourceTime || null;
  if (!sourceTime) {
    return { stale: false, reason: null, ageSeconds: 0, skipped: true };
  }

  const parsed = signalStaleTime.parseDatabaseUtcDateTime(sourceTime);
  if (!parsed) {
    return { stale: true, reason: "invalid-cancel-time", ageSeconds: null };
  }

  const now = signalStaleTime.parseDatabaseUtcDateTime(options.now || new Date()) || signalStaleTime.parseDatabaseUtcDateTime(new Date());
  const ageSeconds = Math.max(0, now.diff(parsed, "second", true));
  const staleSeconds = Math.max(10, Number(options.signalCancelStaleSeconds || process.env.SIGNAL_CANCEL_STALE_SECONDS || 300));
  return {
    stale: ageSeconds >= staleSeconds,
    reason: ageSeconds >= staleSeconds ? "signal-cancel-stale" : null,
    ageSeconds,
    signalTime: parsed.toDate().toISOString(),
  };
};

const validateSignalCancelIntentPayload = (payload = {}) => {
  if (!payload.uid || !payload.pid || !payload.symbol) {
    return { ok: false, reason: "SIGNAL_CANCEL_INVALID_PAYLOAD" };
  }
  const targetType = String(payload.targetType || "PROTECTION").trim().toUpperCase();
  if (targetType !== "PROTECTION") {
    return { ok: false, reason: "SIGNAL_CANCEL_UNSUPPORTED_TARGET" };
  }
  return { ok: true };
};

const mapSignalCancelProjectionState = (state) => {
  if (state === cancelVerificationPolicy.CANCEL_VERIFY_STATE.VERIFIED_GONE) {
    return SIGNAL_CANCEL_QUEUE_STATE.VERIFIED_GONE;
  }
  if (state === cancelVerificationPolicy.CANCEL_VERIFY_STATE.FAILED_ACTIVE_ORDER_REMAINS) {
    return SIGNAL_CANCEL_QUEUE_STATE.FAILED_ACTIVE_ORDER_REMAINS;
  }
  if (state === cancelVerificationPolicy.CANCEL_VERIFY_STATE.BLOCKED_429) {
    return SIGNAL_CANCEL_QUEUE_STATE.BLOCKED_429;
  }
  if (state === cancelVerificationPolicy.CANCEL_VERIFY_STATE.BLOCKED_418) {
    return SIGNAL_CANCEL_QUEUE_STATE.BLOCKED_418;
  }
  return SIGNAL_CANCEL_QUEUE_STATE.VERIFY_PENDING;
};

const completeSignalCancelDispatch = async ({
  intent,
  payload,
  status,
  reason,
  projectionState,
  result,
  errorMessage = null,
} = {}) => {
  await updateSignalQueueProjection({ payload, state: projectionState, reason }).catch(() => {});
  await orderIntentQueue.completeIntent({
    id: intent.id,
    status,
    result,
    errorCode: status === orderIntentQueue.STATUS.DONE ? null : reason,
    errorMessage: status === orderIntentQueue.STATUS.DONE ? null : errorMessage,
  });
  return { processed: true, status, reason, projectionState, result };
};

const getSignalCancelDispatcher = (options = {}) =>
  typeof options.signalCancelDispatcher === "function"
    ? options.signalCancelDispatcher
    : async ({ payload, target }) => {
        const coin = require("./coin");
        if (typeof coin.dispatchSignalProtectionCancelFromIntent !== "function") {
          throw new Error("coin.dispatchSignalProtectionCancelFromIntent handler is unavailable");
        }
        return await coin.dispatchSignalProtectionCancelFromIntent({
          uid: payload.uid,
          symbol: payload.symbol,
          pid: payload.pid,
          excludeType: payload.excludeType || null,
          targetOrderId: target.targetOrderId || null,
          targetClientOrderId: target.targetClientOrderId || null,
        });
      };

const getSignalCancelReadOpenOrders = (options = {}) =>
  typeof options.signalCancelReadOpenOrders === "function"
    ? options.signalCancelReadOpenOrders
    : async ({ payload, target }) => {
        const coin = require("./coin");
        if (typeof coin.listSignalProtectionCancelOpenOrders !== "function") {
          return { stale: true };
        }
        const openOrders = await coin.listSignalProtectionCancelOpenOrders({
          uid: payload.uid,
          symbol: payload.symbol,
          pid: payload.pid,
          excludeType: payload.excludeType || null,
          targetOrderId: target.targetOrderId || null,
          targetClientOrderId: target.targetClientOrderId || null,
        });
        return { openOrders };
      };

const buildSignalCancelHttpBlockState = (error) => {
  const httpStatus = Number(error?.response?.status || error?.status || error?.httpStatus || 0);
  if (httpStatus === 418) {
    return { state: SIGNAL_CANCEL_QUEUE_STATE.BLOCKED_418, reason: "BINANCE_IP_BANNED_418" };
  }
  if (httpStatus === 429) {
    return { state: SIGNAL_CANCEL_QUEUE_STATE.BLOCKED_429, reason: "BINANCE_RATE_LIMIT_429" };
  }
  return null;
};

const dispatchSignalCancelIntent = async ({ intent, payload = {}, options = {}, actualDispatchGate = null } = {}) => {
  const target = buildSignalCancelTargetForIntent(payload);
  const mock = options.mock === true || options.dryRun === true
    ? (options.mockSignalCancelResult || options.mockCancelResult || {})
    : null;

  await updateSignalQueueProjection({
    payload,
    state: SIGNAL_CANCEL_QUEUE_STATE.RUNNING,
    reason: "SIGNAL_CANCEL_DISPATCH_ENTERED",
  }).catch(() => {});

  let cancelResponse = null;
  let cancelError = null;
  let readOpenOrders = null;
  if (mock) {
    cancelResponse = { ok: mock.ok !== false, notFound: mock.notFound === true };
    readOpenOrders = async () => {
      if (mock.timeout === true || mock.verifyPending === true) {
        return null;
      }
      if (mock.httpStatus === 429 || mock.httpStatus === 418) {
        const error = new Error(`mock HTTP ${mock.httpStatus}`);
        error.response = {
          status: mock.httpStatus,
          headers: mock.retryAfter ? { "retry-after": mock.retryAfter } : {},
        };
        throw error;
      }
      if (mock.staleRead === true) {
        return { stale: true };
      }
      if (mock.openOrderStillPresent === true || mock.ok === false) {
        cancelResponse = { ...cancelResponse, ok: false };
        return {
          openOrders: [
            {
              orderId: target.targetOrderId || "MOCK_SIGNAL_ACTIVE_ORDER",
              clientOrderId: target.targetClientOrderId || "MOCK_SIGNAL_ACTIVE_CLIENT_ORDER",
              status: "NEW",
            },
          ],
        };
      }
      return { openOrders: [] };
    };
  } else {
    const dispatcher = getSignalCancelDispatcher(options);
    const readOpenOrdersForIntent = getSignalCancelReadOpenOrders(options);
    readOpenOrders = (readContext) => readOpenOrdersForIntent({
      ...readContext,
      intent,
      payload,
      target,
      options,
      actualDispatchGate,
      cancelResponse,
      cancelError,
    });
    try {
      cancelResponse = await dispatcher({ intent, payload, target, options, actualDispatchGate });
    } catch (error) {
      cancelError = error;
      const httpBlock = buildSignalCancelHttpBlockState(error);
      if (httpBlock) {
        return await completeSignalCancelDispatch({
          intent,
          payload,
          status: orderIntentQueue.STATUS.BLOCKED,
          reason: httpBlock.reason,
          projectionState: httpBlock.state,
          result: buildBlockResult(httpBlock.reason, {
            intentType: intent.intentType,
            fifoKey: intent.fifoKey,
            dispatchEntered: true,
            projectionState: httpBlock.state,
            target,
            targetType: payload.targetType || null,
            actualDispatchGate,
          }),
          errorMessage: `Signal protection cancel write blocked:${httpBlock.reason}`,
        });
      }
      cancelResponse = {
        ok: false,
        notFound: isCancelOrderNotFoundError(error),
        error: error?.message || String(error),
      };
    }
  }

  const verification = await cancelVerificationPolicy.verifyCancelWithBoundedRead({
    uid: payload.uid || intent.uid,
    target,
    cancelResponse,
    readOpenOrders,
    policy: options.cancelVerificationPolicy || {},
  });
  const status = verification.ok && verification.terminal
    ? orderIntentQueue.STATUS.DONE
    : orderIntentQueue.STATUS.BLOCKED;
  const projectionState = mapSignalCancelProjectionState(verification.state);
  const reason = mock?.reason || verification.reason || (status === orderIntentQueue.STATUS.DONE
    ? SIGNAL_CANCEL_QUEUE_STATE.VERIFIED_GONE
    : SIGNAL_CANCEL_QUEUE_STATE.VERIFY_PENDING);

  return await completeSignalCancelDispatch({
    intent,
    payload,
    status,
    reason,
    projectionState,
    result: {
      ok: status === orderIntentQueue.STATUS.DONE,
      dryRun: options.dryRun === true,
      mock: options.mock === true,
      intentType: intent.intentType,
      fifoKey: intent.fifoKey,
      dispatchEntered: true,
      projectionState,
      reason,
      verification,
      cancelResponse,
      target,
      targetType: payload.targetType || null,
      targetClientOrderId: target.targetClientOrderId || null,
      actualDispatchGate,
    },
    errorMessage: status === orderIntentQueue.STATUS.DONE ? null : `Signal protection cancel not verified:${reason}`,
  });
};

const processSignalProtectionIntent = async (intent, options = {}) => {
  const env = options.env || process.env;
  const payload = intent?.payload?.protection || intent?.payload || {};
  const lockRedisClient = Object.prototype.hasOwnProperty.call(options, "redisClient")
    ? options.redisClient
    : redisClient;
  const redisGate = liveWriteSafetyGate.evaluateRedisLockUnavailable({
    env,
    liveScope: true,
    strategyCategory: "signal",
    scope: "ORDER_INTENT_WORKER",
    lockKey: `order-intent-worker:signal-protection:${intent.fifoKey || intent.id}`,
  });

  if (!liveWriteSafetyGate.isRedisClientReady(lockRedisClient) && !redisGate.allowed) {
    await updateSignalQueueProjection({ payload, state: SIGNAL_PROTECTION_QUEUE_STATE.BLOCKED_REDIS, reason: redisGate.reason }).catch(() => {});
    await completeSignalProtectionIntent({
      intent,
      status: orderIntentQueue.STATUS.BLOCKED,
      reason: redisGate.reason,
      result: buildSignalProtectionBlockedResult({
        payload,
        reason: redisGate.reason,
        projectionState: SIGNAL_PROTECTION_QUEUE_STATE.BLOCKED_REDIS,
        protectionChildState: signalEntryConvergence.ENTRY_STATE.PROTECTION_RETRY_PENDING,
        extra: {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        },
      }),
      errorMessage: "Redis lock unavailable; live signal protection worker write blocked.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: redisGate.reason };
  }

  const ownershipReadiness = options.ownershipReadiness || await positionOwnership.getOwnershipReadiness().catch((error) => ({
    enabled: false,
    error: error?.message || String(error),
  }));
  const ownershipGate = liveWriteSafetyGate.evaluateOwnershipGuard({
    env,
    strategyCategory: "signal",
    uid: intent.uid,
    pid: intent.pid,
    symbol: payload.symbol || null,
    positionSide: payload.positionSide || null,
    ownershipEnabled: ownershipReadiness.enabled === true,
  });
  if (!ownershipGate.allowed) {
    await updateSignalQueueProjection({ payload, state: SIGNAL_PROTECTION_QUEUE_STATE.BLOCKED_OWNERSHIP, reason: ownershipGate.reason }).catch(() => {});
    await completeSignalProtectionIntent({
      intent,
      status: orderIntentQueue.STATUS.BLOCKED,
      reason: ownershipGate.reason,
      result: buildSignalProtectionBlockedResult({
        payload,
        reason: ownershipGate.reason,
        projectionState: SIGNAL_PROTECTION_QUEUE_STATE.BLOCKED_OWNERSHIP,
        protectionChildState: signalEntryConvergence.ENTRY_STATE.PROTECTION_RETRY_PENDING,
        extra: {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        },
      }),
      errorMessage: `DB-backed PID ownership unavailable; live signal protection worker write blocked. status:${ownershipReadiness.status || "UNKNOWN"}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: ownershipGate.reason };
  }

  const ownershipQty = await positionOwnership.resolveOwnedCloseQty({
    uid: intent.uid,
    pid: intent.pid,
    strategyCategory: "signal",
    symbol: payload.symbol,
    positionSide: payload.positionSide,
    requestedQty: payload.ownedQty || payload.qty,
  });
  if (!ownershipQty.allowed || !(Number(ownershipQty.finalCloseQty || 0) > 0)) {
    const reason = ownershipQty.reason || "OWNERSHIP_BLOCKED";
    await updateSignalQueueProjection({ payload, state: SIGNAL_PROTECTION_QUEUE_STATE.BLOCKED_OWNERSHIP, reason }).catch(() => {});
    await completeSignalProtectionIntent({
      intent,
      status: orderIntentQueue.STATUS.BLOCKED,
      reason,
      result: buildSignalProtectionBlockedResult({
        payload,
        reason,
        projectionState: SIGNAL_PROTECTION_QUEUE_STATE.BLOCKED_OWNERSHIP,
        protectionChildState: signalEntryConvergence.ENTRY_STATE.UNPROTECTED_OPEN_P0,
        extra: {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        ownership: ownershipQty,
        },
      }),
      errorMessage: "Signal protection worker blocked by PID-owned qty guard.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason };
  }

  const staleInfo = getSignalProtectionStaleInfoForIntent(payload, options);
  if (staleInfo.stale) {
    const reason = staleInfo.reason || "SIGNAL_PROTECTION_STALE";
    await updateSignalQueueProjection({ payload, state: SIGNAL_PROTECTION_QUEUE_STATE.FAILED, reason }).catch(() => {});
    await completeSignalProtectionIntent({
      intent,
      status: orderIntentQueue.STATUS.BLOCKED,
      reason,
      result: buildSignalProtectionBlockedResult({
        payload,
        reason,
        projectionState: SIGNAL_PROTECTION_QUEUE_STATE.FAILED,
        protectionChildState: signalEntryConvergence.ENTRY_STATE.PROTECTION_FAILED_P0,
        extra: {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        staleInfo,
        },
      }),
      errorMessage: `Signal protection blocked by stale fill evidence:${reason}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: "SIGNAL_PROTECTION_STALE" };
  }

  if (options.dryRun === true || options.mock === true) {
    return await dispatchSignalProtectionIntent({
      intent,
      payload,
      ownershipQty,
      options,
      actualDispatchGate: {
        allowed: false,
        reason: options.mock === true ? "MOCK_SIGNAL_PROTECTION_DISPATCH" : "DRY_RUN_SIGNAL_PROTECTION_DISPATCH",
      },
    });
  }

  const actualDispatchGate = await evaluateActualDispatchGateForIntent({ intent, options });
  if (actualDispatchGate.allowed) {
    return await dispatchSignalProtectionIntent({ intent, payload, ownershipQty, options, actualDispatchGate });
  }

  const reason = actualDispatchGate.reason || "SIGNAL_PROTECTION_ACTUAL_DISPATCH_BLOCKED";
  await updateSignalQueueProjection({
    payload,
    state: SIGNAL_PROTECTION_QUEUE_STATE.RETRY_PENDING,
    reason,
  }).catch(() => {});
  return await completeSignalProtectionIntent({
    intent,
    status: orderIntentQueue.STATUS.BLOCKED,
    reason,
    result: buildSignalProtectionBlockedResult({
      payload,
      reason,
      projectionState: SIGNAL_PROTECTION_QUEUE_STATE.RETRY_PENDING,
      protectionChildState: signalEntryConvergence.ENTRY_STATE.PROTECTION_RETRY_PENDING,
      extra: {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        actualDispatchGate,
      },
    }),
    errorMessage: "Signal protection worker actual dispatch blocked by final gate.",
  });
};

const processSignalCancelIntent = async (intent, options = {}) => {
  const env = options.env || process.env;
  const payload = intent?.payload?.cancel || intent?.payload || {};
  const lockRedisClient = Object.prototype.hasOwnProperty.call(options, "redisClient")
    ? options.redisClient
    : redisClient;
  const redisGate = liveWriteSafetyGate.evaluateRedisLockUnavailable({
    env,
    liveScope: true,
    strategyCategory: "signal",
    scope: "ORDER_INTENT_WORKER",
    lockKey: `order-intent-worker:signal-cancel:${intent.fifoKey || intent.id}`,
  });

  if (!liveWriteSafetyGate.isRedisClientReady(lockRedisClient) && !redisGate.allowed) {
    await updateSignalQueueProjection({ payload, state: SIGNAL_CANCEL_QUEUE_STATE.BLOCKED_REDIS, reason: redisGate.reason }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(redisGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_CANCEL_QUEUE_STATE.BLOCKED_REDIS,
      }),
      errorCode: redisGate.reason,
      errorMessage: "Redis lock unavailable; live signal cancel worker write blocked.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: redisGate.reason };
  }

  const payloadValidation = validateSignalCancelIntentPayload(payload);
  if (!payloadValidation.ok) {
    const reason = payloadValidation.reason;
    await updateSignalQueueProjection({ payload, state: SIGNAL_CANCEL_QUEUE_STATE.VERIFY_PENDING, reason }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_CANCEL_QUEUE_STATE.VERIFY_PENDING,
      }),
      errorCode: reason,
      errorMessage: `Signal protection cancel invalid payload:${reason}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason };
  }

  const cancelStaleInfo = getSignalCancelStaleInfoForIntent(payload, options);
  if (cancelStaleInfo.stale) {
    const reason = cancelStaleInfo.reason || "SIGNAL_CANCEL_STALE";
    await updateSignalQueueProjection({ payload, state: SIGNAL_CANCEL_QUEUE_STATE.VERIFY_PENDING, reason }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_CANCEL_QUEUE_STATE.VERIFY_PENDING,
        staleInfo: cancelStaleInfo,
      }),
      errorCode: "SIGNAL_CANCEL_STALE",
      errorMessage: `Signal protection cancel blocked by stale evidence:${reason}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: "SIGNAL_CANCEL_STALE" };
  }

  const ownershipReadiness = options.ownershipReadiness || await positionOwnership.getOwnershipReadiness().catch((error) => ({
    enabled: false,
    error: error?.message || String(error),
  }));
  const ownershipGate = liveWriteSafetyGate.evaluateOwnershipGuard({
    env,
    strategyCategory: "signal",
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
        projectionState: SIGNAL_CANCEL_QUEUE_STATE.VERIFY_PENDING,
      }),
      errorCode: ownershipGate.reason,
      errorMessage: "DB-backed PID ownership unavailable; live signal cancel worker write blocked.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: ownershipGate.reason };
  }

  if (options.dryRun === true || options.mock === true) {
    return await dispatchSignalCancelIntent({
      intent,
      payload,
      options,
      actualDispatchGate: {
        allowed: false,
        reason: options.mock === true ? "MOCK_SIGNAL_CANCEL_DISPATCH" : "DRY_RUN_SIGNAL_CANCEL_DISPATCH",
      },
    });
  }

  const actualDispatchGate = await evaluateActualDispatchGateForIntent({ intent, options });
  if (actualDispatchGate.allowed) {
  return await dispatchSignalCancelIntent({ intent, payload, options, actualDispatchGate });
  }

  return await blockIntentByActualDispatchGate({
    intent,
    payload,
    options,
    projectionUpdater: updateSignalQueueProjection,
    defaultProjectionState: SIGNAL_CANCEL_QUEUE_STATE.VERIFY_PENDING,
    defaultReason: "SIGNAL_CANCEL_ACTUAL_DISPATCH_BLOCKED",
    errorMessage: "Signal cancel worker actual dispatch blocked by final gate.",
  });
};

const getSignalCloseStaleInfoForIntent = (payload = {}, options = {}) => {
  const sourceTime = payload.closeRequestedAt
    || payload.requestedAt
    || payload.createdAt
    || payload.sourceTime
    || payload.signalTime
    || null;
  if (!sourceTime) {
    return { stale: false, reason: null, ageSeconds: 0, skipped: true };
  }

  const parsed = signalStaleTime.parseDatabaseUtcDateTime(sourceTime);
  if (!parsed) {
    return { stale: true, reason: "invalid-close-time", ageSeconds: null };
  }

  const now = signalStaleTime.parseDatabaseUtcDateTime(options.now || new Date()) || signalStaleTime.parseDatabaseUtcDateTime(new Date());
  const ageSeconds = Math.max(0, now.diff(parsed, "second", true));
  const staleSeconds = Math.max(10, Number(options.signalCloseStaleSeconds || process.env.SIGNAL_CLOSE_STALE_SECONDS || 300));
  return {
    stale: ageSeconds >= staleSeconds,
    reason: ageSeconds >= staleSeconds ? "signal-close-stale" : null,
    ageSeconds,
    signalTime: parsed.toDate().toISOString(),
  };
};

const validateSignalCloseIntentPayload = (payload = {}, closeQty = 0) => {
  if (!payload.uid || !payload.pid || !payload.symbol || !payload.side || !payload.positionSide) {
    return { ok: false, reason: "SIGNAL_CLOSE_INVALID_PAYLOAD" };
  }
  if (!payload.closeClientOrderId) {
    return { ok: false, reason: "SIGNAL_CLOSE_CLIENT_ORDER_ID_MISSING" };
  }
  if (!(Number(closeQty) > 0)) {
    return { ok: false, reason: "SIGNAL_CLOSE_QTY_ZERO" };
  }
  return { ok: true };
};

const getSignalCloseDispatcher = (options = {}) =>
  typeof options.signalCloseDispatcher === "function"
    ? options.signalCloseDispatcher
    : async ({ intent, payload, closeQty, actualDispatchGate }) => {
        const coin = require("./coin");
        if (typeof coin.dispatchSignalCloseFromIntent !== "function") {
          throw new Error("coin.dispatchSignalCloseFromIntent handler is unavailable");
        }
        return await coin.dispatchSignalCloseFromIntent({
          intent,
          payload,
          closeQty,
          actualDispatchGate,
        });
      };

const dispatchSignalCloseIntent = async ({ intent, payload = {}, closeQty = 0, ownershipQty = {}, options = {}, actualDispatchGate = null } = {}) => {
  const payloadValidation = validateSignalCloseIntentPayload(payload, closeQty);
  if (!payloadValidation.ok) {
    await updateSignalQueueProjection({ payload, state: SIGNAL_CLOSE_QUEUE_STATE.FAILED, reason: payloadValidation.reason }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(payloadValidation.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        dispatchEntered: false,
        projectionState: SIGNAL_CLOSE_QUEUE_STATE.FAILED,
        closeQty,
      }),
      errorCode: payloadValidation.reason,
      errorMessage: `Signal close invalid payload:${payloadValidation.reason}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: payloadValidation.reason };
  }

  await updateSignalQueueProjection({ payload, state: SIGNAL_CLOSE_QUEUE_STATE.RUNNING, reason: "SIGNAL_CLOSE_DISPATCH_ENTERED" }).catch(() => {});

  if (options.dryRun === true || options.mock === true) {
    const mock = options.mockSignalCloseResult || options.mockCloseResult || {};
    if (mock.ok === false) {
      const reason = mock.reason || "SIGNAL_CLOSE_SUBMIT_FAILED";
      await updateSignalQueueProjection({ payload, state: SIGNAL_CLOSE_QUEUE_STATE.FAILED, reason }).catch(() => {});
      await orderIntentQueue.completeIntent({
        id: intent.id,
        status: orderIntentQueue.STATUS.FAILED,
        result: {
          ok: false,
          dryRun: options.dryRun === true,
          mock: options.mock === true,
          dispatchEntered: true,
          intentType: intent.intentType,
          fifoKey: intent.fifoKey,
          projectionState: SIGNAL_CLOSE_QUEUE_STATE.FAILED,
          closeClientOrderId: payload.closeClientOrderId || null,
          closeQty,
          qtyBasis: "PID_OWNED",
          reduceOnly: true,
          positionSide: payload.positionSide || null,
          ownership: ownershipQty,
          reason,
          actualDispatchGate,
        },
        errorCode: SIGNAL_CLOSE_QUEUE_STATE.FAILED,
        errorMessage: `Signal close failed:${reason}`,
      });
      return { processed: true, status: orderIntentQueue.STATUS.FAILED, reason };
    }

    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: {
        ok: true,
        dryRun: options.dryRun === true,
        mock: options.mock === true,
        dispatchEntered: true,
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_CLOSE_QUEUE_STATE.ACCEPTED_NOT_CONVERGED,
        closeConverged: false,
        reason: SIGNAL_CLOSE_QUEUE_STATE.ACCEPTED_NOT_CONVERGED,
        closeClientOrderId: mock.closeClientOrderId || payload.closeClientOrderId || null,
        orderId: mock.orderId || null,
        closeQty,
        qtyBasis: "PID_OWNED",
        reduceOnly: true,
        positionSide: payload.positionSide || null,
        ownership: ownershipQty,
        actualDispatchGate,
      },
      errorCode: SIGNAL_CLOSE_QUEUE_STATE.ACCEPTED_NOT_CONVERGED,
      errorMessage: "Signal close accepted but close fill/ledger/owner/snapshot/reservation convergence is not complete.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: SIGNAL_CLOSE_QUEUE_STATE.ACCEPTED_NOT_CONVERGED };
  }

  const dispatcher = getSignalCloseDispatcher(options);
  try {
    const dispatchResult = await dispatcher({ intent, payload, closeQty, ownershipQty, options, actualDispatchGate });
    if (dispatchResult?.ok === false) {
      const reason = dispatchResult.reason || "SIGNAL_CLOSE_SUBMIT_FAILED";
      await updateSignalQueueProjection({ payload, state: SIGNAL_CLOSE_QUEUE_STATE.FAILED, reason }).catch(() => {});
      await orderIntentQueue.completeIntent({
        id: intent.id,
        status: orderIntentQueue.STATUS.FAILED,
        result: {
          ok: false,
          dispatchEntered: true,
          intentType: intent.intentType,
          fifoKey: intent.fifoKey,
          projectionState: SIGNAL_CLOSE_QUEUE_STATE.FAILED,
          closeClientOrderId: payload.closeClientOrderId || null,
          closeQty,
          qtyBasis: "PID_OWNED",
          reduceOnly: true,
          positionSide: payload.positionSide || null,
          ownership: ownershipQty,
          reason,
          dispatchResult,
          actualDispatchGate,
        },
        errorCode: SIGNAL_CLOSE_QUEUE_STATE.FAILED,
        errorMessage: `Signal close failed:${reason}`,
      });
      return { processed: true, status: orderIntentQueue.STATUS.FAILED, reason };
    }

    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: {
        ok: true,
        dispatchEntered: true,
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_CLOSE_QUEUE_STATE.ACCEPTED_NOT_CONVERGED,
        closeConverged: false,
        reason: SIGNAL_CLOSE_QUEUE_STATE.ACCEPTED_NOT_CONVERGED,
        closeClientOrderId: dispatchResult?.closeClientOrderId || payload.closeClientOrderId || null,
        orderId: dispatchResult?.orderId || dispatchResult?.order?.orderId || null,
        closeQty: Number(dispatchResult?.closeQty || closeQty),
        qtyBasis: "PID_OWNED",
        reduceOnly: dispatchResult?.reduceOnly !== false,
        positionSide: dispatchResult?.positionSide || payload.positionSide || null,
        side: dispatchResult?.side || null,
        ownership: ownershipQty,
        dispatchResult,
        actualDispatchGate,
      },
      errorCode: SIGNAL_CLOSE_QUEUE_STATE.ACCEPTED_NOT_CONVERGED,
      errorMessage: "Signal close accepted but close fill/ledger/owner/snapshot/reservation convergence is not complete.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: SIGNAL_CLOSE_QUEUE_STATE.ACCEPTED_NOT_CONVERGED };
  } catch (error) {
    const reason = error?.code || error?.errCode || "SIGNAL_CLOSE_SUBMIT_FAILED";
    await updateSignalQueueProjection({ payload, state: SIGNAL_CLOSE_QUEUE_STATE.FAILED, reason }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.FAILED,
      result: {
        ok: false,
        dispatchEntered: true,
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_CLOSE_QUEUE_STATE.FAILED,
        closeClientOrderId: payload.closeClientOrderId || null,
        closeQty,
        qtyBasis: "PID_OWNED",
        reduceOnly: true,
        positionSide: payload.positionSide || null,
        ownership: ownershipQty,
        reason,
        errorMessage: error?.message || String(error),
        actualDispatchGate,
      },
      errorCode: SIGNAL_CLOSE_QUEUE_STATE.FAILED,
      errorMessage: `Signal close failed:${error?.message || String(error)}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.FAILED, reason };
  }
};

const processSignalCloseIntent = async (intent, options = {}) => {
  const env = options.env || process.env;
  const payload = intent?.payload?.close || intent?.payload || {};
  const lockRedisClient = Object.prototype.hasOwnProperty.call(options, "redisClient")
    ? options.redisClient
    : redisClient;
  const redisGate = liveWriteSafetyGate.evaluateRedisLockUnavailable({
    env,
    liveScope: true,
    strategyCategory: "signal",
    scope: "ORDER_INTENT_WORKER",
    lockKey: `order-intent-worker:signal-close:${intent.fifoKey || intent.id}`,
  });

  if (!liveWriteSafetyGate.isRedisClientReady(lockRedisClient) && !redisGate.allowed) {
    await updateSignalQueueProjection({ payload, state: SIGNAL_CLOSE_QUEUE_STATE.BLOCKED_REDIS, reason: redisGate.reason }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(redisGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_CLOSE_QUEUE_STATE.BLOCKED_REDIS,
      }),
      errorCode: redisGate.reason,
      errorMessage: "Redis lock unavailable; live signal close worker write blocked.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: redisGate.reason };
  }

  const ownershipReadiness = options.ownershipReadiness || await positionOwnership.getOwnershipReadiness().catch((error) => ({
    enabled: false,
    error: error?.message || String(error),
  }));
  const ownershipGate = liveWriteSafetyGate.evaluateOwnershipGuard({
    env,
    strategyCategory: "signal",
    uid: intent.uid,
    pid: intent.pid,
    symbol: payload.symbol || null,
    positionSide: payload.positionSide || null,
    ownershipEnabled: ownershipReadiness.enabled === true,
  });
  if (!ownershipGate.allowed) {
    await updateSignalQueueProjection({ payload, state: SIGNAL_CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP, reason: ownershipGate.reason }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(ownershipGate.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP,
      }),
      errorCode: ownershipGate.reason,
      errorMessage: `DB-backed PID ownership unavailable; live signal close worker write blocked. status:${ownershipReadiness.status || "UNKNOWN"}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: ownershipGate.reason };
  }

  const payloadShapeValidation = validateSignalCloseIntentPayload(payload, 1);
  if (!payloadShapeValidation.ok) {
    await updateSignalQueueProjection({ payload, state: SIGNAL_CLOSE_QUEUE_STATE.FAILED, reason: payloadShapeValidation.reason }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(payloadShapeValidation.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_CLOSE_QUEUE_STATE.FAILED,
      }),
      errorCode: payloadShapeValidation.reason,
      errorMessage: `Signal close invalid payload:${payloadShapeValidation.reason}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: payloadShapeValidation.reason };
  }

  const requestedQty = Number(payload.qty || payload.ownedQtyBasis || 0);
  const ownershipQty = await positionOwnership.resolveOwnedCloseQty({
    uid: intent.uid,
    pid: intent.pid,
    strategyCategory: "signal",
    symbol: payload.symbol,
    positionSide: payload.positionSide,
    requestedQty,
  });
  const closeQty = Number(ownershipQty.finalCloseQty || 0);
  if (!ownershipQty.allowed || !(closeQty > 0)) {
    const projectionState = ownershipQty.reason === "OWNERSHIP_CLOSE_QTY_RESERVED"
      ? SIGNAL_CLOSE_QUEUE_STATE.RESERVED_DUPLICATE
      : SIGNAL_CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP;
    await updateSignalQueueProjection({ payload, state: projectionState, reason: ownershipQty.reason || "OWNERSHIP_BLOCKED" }).catch(() => {});
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
      errorMessage: "Signal close worker blocked by PID-owned qty guard.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: ownershipQty.reason || "OWNERSHIP_BLOCKED" };
  }

  if (ownershipQty.overRequested || requestedQty > closeQty + 1e-9) {
    await updateSignalQueueProjection({ payload, state: SIGNAL_CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP, reason: "SIGNAL_CLOSE_OVER_OWNED_QTY_BLOCKED" }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult("SIGNAL_CLOSE_OVER_OWNED_QTY_BLOCKED", {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP,
        requestedQty,
        closeQty,
        ownership: ownershipQty,
      }),
      errorCode: "SIGNAL_CLOSE_OVER_OWNED_QTY_BLOCKED",
      errorMessage: "Signal close requested qty exceeds PID-owned available qty.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: "SIGNAL_CLOSE_OVER_OWNED_QTY_BLOCKED" };
  }

  const closeStaleInfo = getSignalCloseStaleInfoForIntent(payload, options);
  if (closeStaleInfo.stale) {
    const reason = closeStaleInfo.reason || "SIGNAL_CLOSE_STALE";
    await updateSignalQueueProjection({ payload, state: SIGNAL_CLOSE_QUEUE_STATE.FAILED, reason }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        projectionState: SIGNAL_CLOSE_QUEUE_STATE.FAILED,
        closeQty,
        staleInfo: closeStaleInfo,
      }),
      errorCode: "SIGNAL_CLOSE_STALE",
      errorMessage: `Signal close blocked by stale evidence:${reason}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: "SIGNAL_CLOSE_STALE" };
  }

  if (options.dryRun === true || options.mock === true) {
    return await dispatchSignalCloseIntent({
      intent,
      payload,
      closeQty,
      ownershipQty,
      options,
      actualDispatchGate: {
        allowed: false,
        reason: options.mock === true ? "MOCK_SIGNAL_CLOSE_DISPATCH" : "DRY_RUN_SIGNAL_CLOSE_DISPATCH",
      },
    });
  }

  const actualDispatchGate = await evaluateActualDispatchGateForIntent({ intent, options });
  if (actualDispatchGate.allowed) {
    return await dispatchSignalCloseIntent({ intent, payload, closeQty, ownershipQty, options, actualDispatchGate });
  }

  return await blockIntentByActualDispatchGate({
    intent,
    payload,
    options,
    projectionUpdater: updateSignalQueueProjection,
    defaultProjectionState: SIGNAL_CLOSE_QUEUE_STATE.RUNNING,
    defaultReason: "SIGNAL_CLOSE_ACTUAL_DISPATCH_BLOCKED",
    errorMessage: "Signal close worker actual dispatch blocked by final gate.",
  });
};

const buildGridCancelTargetForIntent = (payload = {}) => ({
  targetOrderId: payload.targetOrderId == null || payload.targetOrderId === ""
    ? null
    : String(payload.targetOrderId),
  targetClientOrderId: payload.targetClientOrderId || payload.clientOrderId || null,
});

const getCancelErrorHttpStatus = (error) =>
  Number(error?.response?.status || error?.status || error?.httpStatus || 0);

const isCancelOrderNotFoundError = (error) => {
  const code = Number(error?.response?.data?.code || error?.code || error?.errCode || 0);
  return code === -2011 || code === -2013;
};

const buildCancelBlockStateFromHttpStatus = (httpStatus) => {
  if (Number(httpStatus) === 418) {
    return {
      state: CANCEL_QUEUE_STATE.BLOCKED_418,
      reason: "BINANCE_IP_BANNED_418",
    };
  }
  if (Number(httpStatus) === 429) {
    return {
      state: CANCEL_QUEUE_STATE.BLOCKED_429,
      reason: "BINANCE_RATE_LIMIT_429",
    };
  }
  return null;
};

const getGridCancelDispatcher = (options = {}) =>
  typeof options.gridCancelDispatcher === "function"
    ? options.gridCancelDispatcher
    : async ({ payload, target }) => {
        const coin = require("./coin");
        if (typeof coin.cancelGridOrders !== "function") {
          throw new Error("coin.cancelGridOrders handler is unavailable");
        }
        const canceledCount = await coin.cancelGridOrders({
          uid: payload.uid,
          symbol: payload.symbol,
          pid: payload.pid,
          leg: payload.positionSide || null,
          includeEntries: payload.includeEntries !== false,
          includeExits: payload.includeExits !== false,
          targetOrderId: target.targetOrderId || null,
          targetClientOrderId: target.targetClientOrderId || null,
        });
        return {
          ok: true,
          canceledCount: Number(canceledCount || 0),
        };
      };

const getGridCancelReadOpenOrders = (options = {}) =>
  typeof options.gridCancelReadOpenOrders === "function"
    ? options.gridCancelReadOpenOrders
    : async ({ uid, payload }) => {
        const coin = require("./coin");
        if (typeof coin.listOpenGridOrders !== "function") {
          return { stale: true };
        }
        const openOrders = await coin.listOpenGridOrders(
          uid,
          payload.symbol,
          payload.pid,
          payload.positionSide || null
        );
        return { openOrders };
      };

const completeGridCancelDispatch = async ({
  intent,
  payload,
  status,
  reason,
  projectionState,
  result,
  errorMessage = null,
} = {}) => {
  await updateGridCancelProjection({ payload, state: projectionState, reason }).catch(() => {});
  await orderIntentQueue.completeIntent({
    id: intent.id,
    status,
    result,
    errorCode: status === orderIntentQueue.STATUS.DONE ? null : reason,
    errorMessage: status === orderIntentQueue.STATUS.DONE ? null : errorMessage,
  });
  return { processed: true, status, reason, projectionState, result };
};

const dispatchGridCancelIntent = async ({ intent, payload = {}, options = {}, actualDispatchGate = null } = {}) => {
  const target = buildGridCancelTargetForIntent(payload);
  const dispatcher = getGridCancelDispatcher(options);
  const readOpenOrders = getGridCancelReadOpenOrders(options);

  await updateGridCancelProjection({
    payload,
    state: CANCEL_QUEUE_STATE.RUNNING,
    reason: "GRID_CANCEL_DISPATCH_ENTERED",
  }).catch(() => {});

  let cancelResponse = null;
  let cancelError = null;
  try {
    cancelResponse = await dispatcher({ intent, payload, target, options, actualDispatchGate });
  } catch (error) {
    cancelError = error;
    const httpBlock = buildCancelBlockStateFromHttpStatus(getCancelErrorHttpStatus(error));
    if (httpBlock) {
      return await completeGridCancelDispatch({
        intent,
        payload,
        status: orderIntentQueue.STATUS.BLOCKED,
        reason: httpBlock.reason,
        projectionState: httpBlock.state,
        result: buildBlockResult(httpBlock.reason, {
          intentType: intent.intentType,
          fifoKey: intent.fifoKey,
          dispatchEntered: true,
          projectionState: httpBlock.state,
          target,
          targetType: payload.targetType || null,
          actualDispatchGate,
        }),
        errorMessage: `Grid cancel write blocked:${httpBlock.reason}`,
      });
    }
    cancelResponse = {
      ok: false,
      notFound: isCancelOrderNotFoundError(error),
      error: error?.message || String(error),
    };
  }

  const verification = await cancelVerificationPolicy.verifyCancelWithBoundedRead({
    uid: payload.uid || intent.uid,
    target,
    cancelResponse,
    readOpenOrders: (readContext) => readOpenOrders({
      ...readContext,
      intent,
      payload,
      target,
      options,
      actualDispatchGate,
      cancelResponse,
      cancelError,
    }),
    policy: options.cancelVerificationPolicy || {},
  });
  const status = verification.ok && verification.terminal
    ? orderIntentQueue.STATUS.DONE
    : orderIntentQueue.STATUS.BLOCKED;
  const projectionState = verification.state;
  const cancelScopeDiagnostic = gridIntentHandlerGuards.buildGridCancelScopeDiagnostic({
    payload,
    target,
    cancelResponse,
    verification,
  });
  const reason = cancelScopeDiagnostic.noopReason || verification.reason || (status === orderIntentQueue.STATUS.DONE
    ? CANCEL_QUEUE_STATE.VERIFIED_GONE
    : CANCEL_QUEUE_STATE.VERIFY_PENDING);

  return await completeGridCancelDispatch({
    intent,
    payload,
    status,
    reason,
    projectionState,
    result: {
      ok: status === orderIntentQueue.STATUS.DONE,
      intentType: intent.intentType,
      fifoKey: intent.fifoKey,
      dispatchEntered: true,
      projectionState,
      reason,
      verification,
      cancelScopeDiagnostic,
      cancelResponse,
      target,
      targetType: payload.targetType || null,
      includeEntries: payload.includeEntries !== false,
      includeExits: payload.includeExits !== false,
      actualDispatchGate,
    },
    errorMessage: status === orderIntentQueue.STATUS.DONE ? null : `Grid cancel not verified:${reason}`,
  });
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
    const cancelScopeDiagnostic = gridIntentHandlerGuards.buildGridCancelScopeDiagnostic({
      payload,
      target,
      cancelResponse,
      verification,
    });
    const reason = mock.reason || cancelScopeDiagnostic.noopReason || verification.reason;

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
        cancelScopeDiagnostic,
        targetType: payload.targetType || null,
        targetClientOrderId: payload.targetClientOrderId || null,
      },
      errorCode: status === orderIntentQueue.STATUS.DONE ? null : reason,
      errorMessage: status === orderIntentQueue.STATUS.DONE ? null : `Grid cancel not verified:${reason}`,
    });
    return { processed: true, status, reason, projectionState };
  }

  const actualDispatchGate = await evaluateActualDispatchGateForIntent({ intent, options });
  if (actualDispatchGate.allowed) {
    return await dispatchGridCancelIntent({ intent, payload, options, actualDispatchGate });
  }

  return await blockIntentByActualDispatchGate({
    intent,
    payload,
    options,
    projectionUpdater: updateGridCancelProjection,
    defaultProjectionState: CANCEL_QUEUE_STATE.RUNNING,
    defaultReason: "CANCEL_ACTUAL_DISPATCH_BLOCKED",
    errorMessage: "Grid cancel worker actual dispatch blocked by final gate.",
  });
};

const getGridCloseDispatcher = (options = {}) =>
  typeof options.gridCloseDispatcher === "function"
    ? options.gridCloseDispatcher
    : async ({ payload, closeQty, actualDispatchGate }) => {
        const coin = require("./coin");
        if (typeof coin.closeGridLegMarketOrder !== "function") {
          throw new Error("coin.closeGridLegMarketOrder handler is unavailable");
        }
        return await coin.closeGridLegMarketOrder({
          uid: payload.uid,
          pid: payload.pid,
          symbol: payload.symbol,
          leg: payload.positionSide || payload.leg,
          qty: closeQty,
          actualDispatchGate,
          gridRegimeKey: payload.gridRegimeKey || payload.regimeKey || null,
        });
      };

const dispatchGridCloseIntent = async ({
  intent,
  payload = {},
  closeQty = 0,
  ownershipQty = {},
  options = {},
  actualDispatchGate = null,
} = {}) => {
  const closePlan = gridIntentHandlerGuards.buildGridManualCloseDispatchPlan({
    payload,
    ownershipQty,
    requestedQty: payload.qty || payload.ownedQtyBasis || closeQty,
  });
  if (!closePlan.allowed) {
    const projectionState = closePlan.reason === "GRID_CLOSE_OVER_OWNED_QTY_BLOCKED"
      ? CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP
      : CLOSE_QUEUE_STATE.BLOCKED_OWNERSHIP;
    await updateGridCloseProjection({ payload, state: projectionState, reason: closePlan.reason }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(closePlan.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        dispatchEntered: false,
        projectionState,
        closePlan,
        ownership: ownershipQty,
        actualDispatchGate,
      }),
      errorCode: closePlan.reason,
      errorMessage: `Grid close blocked by PID-owned qty guard:${closePlan.reason}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: closePlan.reason };
  }

  await updateGridCloseProjection({
    payload,
    state: CLOSE_QUEUE_STATE.RUNNING,
    reason: "GRID_CLOSE_DISPATCH_ENTERED",
  }).catch(() => {});

  if (options.dryRun === true || options.mock === true) {
    const mock = options.mockCloseResult || {};
    if (mock.ok === false) {
      const reason = mock.reason || "GRID_CLOSE_SUBMIT_FAILED";
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
          dispatchEntered: true,
          projectionState: CLOSE_QUEUE_STATE.FAILED,
          closeClientOrderId: payload.closeClientOrderId || null,
          closeQty: closePlan.closeQty,
          qtyBasis: closePlan.qtyBasis,
          reason,
          closePlan,
          actualDispatchGate,
        },
        errorCode: reason,
        errorMessage: `Grid close failed:${reason}`,
      });
      return { processed: true, status: orderIntentQueue.STATUS.FAILED, reason };
    }

    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.DONE,
      result: {
        ok: true,
        dryRun: options.dryRun === true,
        mock: options.mock === true,
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        dispatchEntered: true,
        projectionState: CLOSE_QUEUE_STATE.RUNNING,
        closeClientOrderId: payload.closeClientOrderId || mock.closeClientOrderId || null,
        closeQty: closePlan.closeQty,
        qtyBasis: closePlan.qtyBasis,
        ownership: ownershipQty,
        closePlan,
        closeLifecycle: {
          marketCloseSubmit: "MOCKED",
          exitLedgerApply: "USER_STREAM_FILL_REQUIRED",
          ownershipRelease: "USER_STREAM_FILL_REQUIRED",
          snapshotClose: "USER_STREAM_FILL_REQUIRED",
        },
        actualDispatchGate,
      },
    });
    return { processed: true, status: orderIntentQueue.STATUS.DONE, reason: CLOSE_QUEUE_STATE.RUNNING };
  }

  const dispatcher = getGridCloseDispatcher(options);
  try {
    const dispatchResult = await dispatcher({
      intent,
      payload,
      closeQty: closePlan.closeQty,
      ownershipQty,
      options,
      actualDispatchGate,
    });
    const submitted = Boolean(dispatchResult?.orderId || dispatchResult?.clientOrderId || dispatchResult?.ok === true);
    if (!submitted) {
      const reason = dispatchResult?.reason || "GRID_CLOSE_SUBMIT_FAILED";
      await updateGridCloseProjection({ payload, state: CLOSE_QUEUE_STATE.FAILED, reason }).catch(() => {});
      await orderIntentQueue.completeIntent({
        id: intent.id,
        status: orderIntentQueue.STATUS.FAILED,
        result: {
          ok: false,
          intentType: intent.intentType,
          fifoKey: intent.fifoKey,
          dispatchEntered: true,
          projectionState: CLOSE_QUEUE_STATE.FAILED,
          closeQty: closePlan.closeQty,
          qtyBasis: closePlan.qtyBasis,
          closePlan,
          dispatchResult,
          actualDispatchGate,
          reason,
        },
        errorCode: reason,
        errorMessage: `Grid close failed:${reason}`,
      });
      return { processed: true, status: orderIntentQueue.STATUS.FAILED, reason };
    }

    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.DONE,
      result: {
        ok: true,
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        dispatchEntered: true,
        projectionState: CLOSE_QUEUE_STATE.RUNNING,
        closeClientOrderId: dispatchResult.clientOrderId || payload.closeClientOrderId || null,
        orderId: dispatchResult.orderId || null,
        closeQty: closePlan.closeQty,
        qtyBasis: closePlan.qtyBasis,
        ownership: ownershipQty,
        closePlan,
        closeLifecycle: {
          marketCloseSubmit: "SUBMITTED",
          exitLedgerApply: "USER_STREAM_FILL_REQUIRED",
          ownershipRelease: "USER_STREAM_FILL_REQUIRED",
          snapshotClose: "USER_STREAM_FILL_REQUIRED",
        },
        dispatchResult,
        actualDispatchGate,
      },
    });
    return { processed: true, status: orderIntentQueue.STATUS.DONE, reason: CLOSE_QUEUE_STATE.RUNNING };
  } catch (error) {
    const reason = error?.code || error?.guardReason || "GRID_CLOSE_SUBMIT_FAILED";
    await updateGridCloseProjection({ payload, state: CLOSE_QUEUE_STATE.FAILED, reason }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.FAILED,
      result: {
        ok: false,
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        dispatchEntered: true,
        projectionState: CLOSE_QUEUE_STATE.FAILED,
        closeQty: closePlan.closeQty,
        qtyBasis: closePlan.qtyBasis,
        closePlan,
        reason,
        error: error?.message || String(error),
        actualDispatchGate,
      },
      errorCode: reason,
      errorMessage: error?.message || "Grid close dispatch failed.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.FAILED, reason };
  }
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
    return await dispatchGridCloseIntent({
      intent,
      payload,
      closeQty,
      ownershipQty,
      options,
      actualDispatchGate: {
        allowed: false,
        reason: options.mock === true ? "MOCK_GRID_CLOSE_DISPATCH" : "DRY_RUN_GRID_CLOSE_DISPATCH",
      },
    });
  }

  const actualDispatchGate = await evaluateActualDispatchGateForIntent({ intent, options });
  if (actualDispatchGate.allowed) {
    return await dispatchGridCloseIntent({ intent, payload, closeQty, ownershipQty, options, actualDispatchGate });
  }

  return await blockIntentByActualDispatchGate({
    intent,
    payload,
    options,
    projectionUpdater: updateGridCloseProjection,
    defaultProjectionState: CLOSE_QUEUE_STATE.RUNNING,
    defaultReason: "CLOSE_ACTUAL_DISPATCH_BLOCKED",
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

const normalizeGridProtectionDispatchOrder = (order) => {
  if (!order) {
    return null;
  }
  return {
    ...order,
    clientOrderId: order.clientOrderId || order.clientAlgoId || order.origClientOrderId || null,
    orderId: order.orderId || order.strategyId || order.algoId || order.sourceOrderId || null,
    sourceOrderId: order.sourceOrderId || order.orderId || order.strategyId || order.algoId || null,
    errorCode: order.errorCode || null,
    errorMessage: order.errorMessage || null,
  };
};

const getGridProtectionDispatcher = (options = {}) =>
  typeof options.gridProtectionDispatcher === "function"
    ? options.gridProtectionDispatcher
    : async ({ payload, qty }) => {
        const coin = require("./coin");
        if (
          typeof coin.placeGridTakeProfitOrder !== "function" ||
          typeof coin.placeGridStopOrder !== "function"
        ) {
          throw new Error("coin grid protection handlers are unavailable");
        }
        const takeProfit = Number(payload.takeProfitPrice || 0) > 0
          ? await coin.placeGridTakeProfitOrder({
            uid: payload.uid,
            pid: payload.pid,
            symbol: payload.symbol,
            leg: payload.positionSide || payload.leg,
            qty,
            triggerPrice: payload.takeProfitPrice,
            clientOrderId: payload.takeProfitClientOrderId || null,
          })
          : null;
        const stop = Number(payload.stopPrice || 0) > 0
          ? await coin.placeGridStopOrder({
            uid: payload.uid,
            pid: payload.pid,
            symbol: payload.symbol,
            leg: payload.positionSide || payload.leg,
            qty,
            triggerPrice: payload.stopPrice,
            clientOrderId: payload.stopClientOrderId || null,
          })
          : null;
        return { takeProfit, stop };
      };

const buildGridProtectionDispatchResult = ({
  intent,
  payload,
  ownershipQty,
  takeProfit,
  stop,
  options,
  actualDispatchGate,
  protectionPlan,
} = {}) => {
  const outcome = gridProtectionGuarantee.classifyProtectionOutcome({
    takeProfit,
    stop,
    oneLegEmergency: payload.oneLegEmergency === true,
  });
  const projectionState = buildProtectionResultState(outcome);
  return {
    ok: outcome.protected,
    dryRun: options.dryRun === true,
    mock: options.mock === true,
    dispatchEntered: true,
    intentType: intent.intentType,
    fifoKey: intent.fifoKey,
    projectionState,
    protectionState: outcome.state,
    protectionReason: outcome.reason,
    missingProtection: outcome.missing,
    protectionQty: ownershipQty.finalCloseQty,
    qtyBasis: "PID_OWNED",
    protectionPlan,
    takeProfit,
    stop,
    actualDispatchGate,
  };
};

const dispatchGridProtectionCreateIntent = async ({
  intent,
  payload = {},
  ownershipQty = {},
  options = {},
  actualDispatchGate = null,
} = {}) => {
  const activeReservationCount = options.mock === true || options.dryRun === true
    ? Number(options.mockActiveReservationCount || 0)
    : await loadActiveCloseReservationCount(payload).catch(() => 0);
  const hasEntryLedger = Object.prototype.hasOwnProperty.call(options, "hasEntryLedger")
    ? options.hasEntryLedger
    : null;
  const protectionPlan = gridIntentHandlerGuards.buildGridProtectionDispatchPlan({
    payload,
    ownershipQty,
    activeReservationCount,
    hasEntryLedger,
  });
  if (!protectionPlan.allowed) {
    const projectionState = PROTECTION_QUEUE_STATE.BLOCKED_OWNERSHIP;
    await updateGridProtectionProjection({
      payload,
      state: projectionState,
      outcome: { protected: false, partial: false, reason: protectionPlan.reason },
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.BLOCKED,
      result: buildBlockResult(protectionPlan.reason, {
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        dispatchEntered: false,
        projectionState,
        protectionPlan,
        ownership: ownershipQty,
        actualDispatchGate,
      }),
      errorCode: protectionPlan.reason,
      errorMessage: `Grid protection blocked by PID-owned lifecycle guard:${protectionPlan.reason}`,
    });
    return { processed: true, status: orderIntentQueue.STATUS.BLOCKED, reason: protectionPlan.reason };
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
    const result = buildGridProtectionDispatchResult({
      intent,
      payload,
      ownershipQty,
      takeProfit,
      stop,
      options,
      actualDispatchGate,
      protectionPlan,
    });
    const outcomeProtected = result.projectionState === PROTECTION_QUEUE_STATE.PROTECTED;
    await syncProtectionReservationsForIntent({
      payload,
      result,
      qty: ownershipQty.finalCloseQty,
    }).catch(() => {});
    await updateGridProtectionProjection({
      payload,
      outcome: {
        protected: outcomeProtected,
        partial: result.projectionState === PROTECTION_QUEUE_STATE.PARTIAL,
        reason: result.protectionReason,
        missing: result.missingProtection,
      },
      state: result.projectionState,
      result,
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: outcomeProtected ? orderIntentQueue.STATUS.DONE : orderIntentQueue.STATUS.BLOCKED,
      result,
      errorCode: outcomeProtected ? null : result.protectionReason,
      errorMessage: outcomeProtected ? null : `Grid protection critical:${result.protectionReason}`,
    });
    return {
      processed: true,
      status: outcomeProtected ? orderIntentQueue.STATUS.DONE : orderIntentQueue.STATUS.BLOCKED,
      reason: outcomeProtected ? "PROTECTION_PROTECTED" : result.protectionReason,
      projectionState: result.projectionState,
    };
  }

  const dispatcher = getGridProtectionDispatcher(options);
  try {
    const dispatchResult = await dispatcher({
      intent,
      payload,
      qty: protectionPlan.protectionQty,
      ownershipQty,
      options,
      actualDispatchGate,
    });
    const takeProfit = normalizeGridProtectionDispatchOrder(
      dispatchResult?.takeProfit || dispatchResult?.tp || dispatchResult?.profit
    );
    const stop = normalizeGridProtectionDispatchOrder(
      dispatchResult?.stop || dispatchResult?.stopLoss || dispatchResult?.sl
    );
    const result = buildGridProtectionDispatchResult({
      intent,
      payload,
      ownershipQty,
      takeProfit,
      stop,
      options,
      actualDispatchGate,
      protectionPlan,
    });
    const outcomeProtected = result.projectionState === PROTECTION_QUEUE_STATE.PROTECTED;
    await syncProtectionReservationsForIntent({
      payload,
      result,
      qty: protectionPlan.protectionQty,
    }).catch(() => {});
    await updateGridProtectionProjection({
      payload,
      outcome: {
        protected: outcomeProtected,
        partial: result.projectionState === PROTECTION_QUEUE_STATE.PARTIAL,
        reason: result.protectionReason,
        missing: result.missingProtection,
      },
      state: result.projectionState,
      result,
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: outcomeProtected ? orderIntentQueue.STATUS.DONE : orderIntentQueue.STATUS.BLOCKED,
      result,
      errorCode: outcomeProtected ? null : result.protectionReason,
      errorMessage: outcomeProtected ? null : `Grid protection critical:${result.protectionReason}`,
    });
    return {
      processed: true,
      status: outcomeProtected ? orderIntentQueue.STATUS.DONE : orderIntentQueue.STATUS.BLOCKED,
      reason: outcomeProtected ? "PROTECTION_PROTECTED" : result.protectionReason,
      projectionState: result.projectionState,
    };
  } catch (error) {
    const reason = error?.code || error?.guardReason || "GRID_PROTECTION_SUBMIT_FAILED";
    await updateGridProtectionProjection({
      payload,
      state: PROTECTION_QUEUE_STATE.FAILED,
      outcome: { protected: false, partial: false, reason },
    }).catch(() => {});
    await orderIntentQueue.completeIntent({
      id: intent.id,
      status: orderIntentQueue.STATUS.FAILED,
      result: {
        ok: false,
        intentType: intent.intentType,
        fifoKey: intent.fifoKey,
        dispatchEntered: true,
        projectionState: PROTECTION_QUEUE_STATE.FAILED,
        reason,
        error: error?.message || String(error),
        protectionPlan,
        actualDispatchGate,
      },
      errorCode: reason,
      errorMessage: error?.message || "Grid protection dispatch failed.",
    });
    return { processed: true, status: orderIntentQueue.STATUS.FAILED, reason };
  }
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
    return await dispatchGridProtectionCreateIntent({
      intent,
      payload,
      ownershipQty,
      options,
      actualDispatchGate: {
        allowed: false,
        reason: options.mock === true ? "MOCK_GRID_PROTECTION_DISPATCH" : "DRY_RUN_GRID_PROTECTION_DISPATCH",
      },
    });
  }

  const actualDispatchGate = await evaluateActualDispatchGateForIntent({ intent, options });
  if (actualDispatchGate.allowed) {
    return await dispatchGridProtectionCreateIntent({ intent, payload, ownershipQty, options, actualDispatchGate });
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
    defaultReason: "PROTECTION_ACTUAL_DISPATCH_BLOCKED",
    errorMessage: "Grid protection worker actual dispatch blocked by final gate.",
  });
};

const normalizeGridLiveArmTargetItems = (intent, options = {}) => {
  const payload = intent?.payload || {};
  const gridPayload = payload.gridPayload || {};
  const candidates = [];
  if (payload.targetItem && typeof payload.targetItem === "object") {
    candidates.push(payload.targetItem);
  }
  if (Array.isArray(payload.targetItems)) {
    candidates.push(...payload.targetItems);
  }
  if (payload.gridArm?.targetItem && typeof payload.gridArm.targetItem === "object") {
    candidates.push(payload.gridArm.targetItem);
  }
  const rejected = [];
  const targetItems = [];
  for (const item of candidates) {
    if (
      !item ||
      String(item.strategyCategory || "").toLowerCase() !== "grid" ||
      String(item.strategyMode || "").toLowerCase() !== "live" ||
      Number(item.uid || 0) <= 0 ||
      Number(item.pid || 0) <= 0
    ) {
      continue;
    }
    const hydrated = gridLiveArmHydration.hydrateGridLiveArmTargetItem({
      targetItem: item,
      gridPayload,
      options,
    });
    if (hydrated.ok) {
      targetItems.push({
        ...hydrated.targetItem,
        sourceEventId: payload.sourceEventId || intent?.sourceEventId || null,
        sourceTargetId: payload.sourceTargetId || item.sourceTargetId || null,
      });
    } else {
      rejected.push({
        uid: Number(item.uid || 0),
        pid: Number(item.pid || 0),
        reason: hydrated.reason,
      });
    }
  }
  return { targetItems, rejected };
};

const summarizeGridLiveArmTargetItems = (targetItems = []) =>
  targetItems.map((item) => ({
    uid: Number(item.uid || 0),
    pid: Number(item.pid || 0),
    strategyCategory: item.strategyCategory || null,
    strategyMode: item.strategyMode || null,
    symbol: item.symbol || item.gridPayload?.symbol || null,
    timeframe: item.timeframe || item.gridPayload?.timeframe || null,
    supportPrice: item.supportPrice || item.gridPayload?.supportPrice || null,
    resistancePrice: item.resistancePrice || item.gridPayload?.resistancePrice || null,
    triggerPrice: item.triggerPrice || item.gridPayload?.triggerPrice || null,
    longTriggerPrice: item.longTriggerPrice || item.gridPayload?.longTriggerPrice || null,
    shortTriggerPrice: item.shortTriggerPrice || item.gridPayload?.shortTriggerPrice || null,
    triggerProfile: item.triggerProfile || item.gridPayload?.triggerProfile || null,
    signalTime: item.signalTime || item.gridPayload?.signalTime || null,
    gridPayloadHydrated: item.gridPayloadHydrated === true,
    gridPayloadHydrationReason: item.gridPayloadHydrationReason || null,
  }));

const buildGridLiveArmPairInvariant = (targetItems = []) => ({
  targetCount: targetItems.length,
  pairLegs: ["LONG", "SHORT"],
  bothLegsRequired: true,
  oneSidedAllowed: false,
});

const completeGridLiveArmIntent = async ({ intent, status, reason, result = {}, errorMessage = null }) => {
  await orderIntentQueue.completeIntent({
    id: intent.id,
    status,
    result: {
      intentType: intent.intentType,
      fifoKey: intent.fifoKey,
      ...result,
    },
    errorCode: status === orderIntentQueue.STATUS.DONE ? null : reason,
    errorMessage,
  });
  return { processed: true, status, reason, result };
};

const dispatchGridLiveArmIntent = async ({ intent, options = {}, actualDispatchGate = null } = {}) => {
  const normalizedTargets = normalizeGridLiveArmTargetItems(intent, options);
  const targetItems = normalizedTargets.targetItems;
  const pairInvariant = buildGridLiveArmPairInvariant(targetItems);
  const targetSummary = summarizeGridLiveArmTargetItems(targetItems);
  const rejectedTargets = normalizedTargets.rejected || [];

  if (!targetItems.length) {
    if (rejectedTargets.length > 0) {
      return await completeGridLiveArmIntent({
        intent,
        status: orderIntentQueue.STATUS.BLOCKED,
        reason: GRID_LIVE_ARM_QUEUE_STATE.BLOCKED_PAYLOAD,
        result: buildBlockResult(GRID_LIVE_ARM_QUEUE_STATE.BLOCKED_PAYLOAD, {
          projectionState: GRID_LIVE_ARM_QUEUE_STATE.BLOCKED_PAYLOAD,
          pairInvariant,
          targetItems: targetSummary,
          rejectedTargets,
          actualDispatchGate,
        }),
        errorMessage: `Grid live arm intent payload invalid:${rejectedTargets.map((item) => item.reason).join(",")}`,
      });
    }
    return await completeGridLiveArmIntent({
      intent,
      status: orderIntentQueue.STATUS.BLOCKED,
      reason: GRID_LIVE_ARM_QUEUE_STATE.BLOCKED_TARGET,
      result: buildBlockResult(GRID_LIVE_ARM_QUEUE_STATE.BLOCKED_TARGET, {
        projectionState: GRID_LIVE_ARM_QUEUE_STATE.BLOCKED_TARGET,
        pairInvariant,
        targetItems: targetSummary,
        actualDispatchGate,
      }),
      errorMessage: "Grid live arm intent has no valid live grid target item.",
    });
  }

  if (options.dryRun === true || options.mock === true) {
    return await completeGridLiveArmIntent({
      intent,
      status: orderIntentQueue.STATUS.DONE,
      reason: GRID_LIVE_ARM_QUEUE_STATE.DISPATCH_ENTERED,
      result: {
        ok: true,
        dryRun: options.dryRun === true,
        mock: options.mock === true,
        dispatchEntered: true,
        projectionState: GRID_LIVE_ARM_QUEUE_STATE.DISPATCH_ENTERED,
        pairInvariant,
        targetItems: targetSummary,
        actualDispatchGate,
      },
    });
  }

  const dispatcher =
    typeof options.gridLiveArmDispatcher === "function"
      ? options.gridLiveArmDispatcher
      : async (items) => {
          const gridEngine = require("./grid-engine");
          if (typeof gridEngine.primeLiveEntriesForTargetItems !== "function") {
            throw new Error("primeLiveEntriesForTargetItems handler is unavailable");
          }
          return await gridEngine.primeLiveEntriesForTargetItems(items);
        };

  try {
    const primed = await dispatcher(targetItems, { intent, options, actualDispatchGate });
    const primedCount = Number(primed || 0);
    if (primedCount > 0) {
      return await completeGridLiveArmIntent({
        intent,
        status: orderIntentQueue.STATUS.DONE,
        reason: GRID_LIVE_ARM_QUEUE_STATE.DISPATCHED,
        result: {
          ok: true,
          dispatchEntered: true,
          projectionState: GRID_LIVE_ARM_QUEUE_STATE.DISPATCHED,
          primed: primedCount,
          pairInvariant,
          targetItems: targetSummary,
          actualDispatchGate,
        },
      });
    }
    return await completeGridLiveArmIntent({
      intent,
      status: orderIntentQueue.STATUS.BLOCKED,
      reason: GRID_LIVE_ARM_QUEUE_STATE.BLOCKED_NO_PAIR,
      result: buildBlockResult(GRID_LIVE_ARM_QUEUE_STATE.BLOCKED_NO_PAIR, {
        dispatchEntered: true,
        projectionState: GRID_LIVE_ARM_QUEUE_STATE.BLOCKED_NO_PAIR,
        primed: primedCount,
        pairInvariant,
        targetItems: targetSummary,
        actualDispatchGate,
      }),
      errorMessage: "Grid live arm dispatch entered but no entry pair was primed.",
    });
  } catch (error) {
    return await completeGridLiveArmIntent({
      intent,
      status: orderIntentQueue.STATUS.FAILED,
      reason: GRID_LIVE_ARM_QUEUE_STATE.FAILED,
      result: {
        ok: false,
        dispatchEntered: true,
        projectionState: GRID_LIVE_ARM_QUEUE_STATE.FAILED,
        pairInvariant,
        targetItems: targetSummary,
        actualDispatchGate,
        error: error?.message || String(error),
      },
      errorMessage: error?.message || "Grid live arm dispatch failed.",
    });
  }
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
    return await dispatchGridLiveArmIntent({
      intent,
      options,
      actualDispatchGate: {
        allowed: false,
        reason: options.mock === true ? "MOCK_GRID_LIVE_ARM_DISPATCH" : "DRY_RUN_GRID_LIVE_ARM_DISPATCH",
      },
    });
  }

  const actualDispatchGate = await evaluateActualDispatchGateForIntent({ intent, options });
  if (actualDispatchGate.allowed) {
    return await dispatchGridLiveArmIntent({ intent, options, actualDispatchGate });
  }

  return await blockIntentByActualDispatchGate({
    intent,
    payload: intent?.payload || {},
    options,
    defaultProjectionState: GRID_LIVE_ARM_QUEUE_STATE.RUNNING,
    defaultReason: "GRID_LIVE_ARM_ACTUAL_DISPATCH_BLOCKED",
    errorMessage: "Grid live arm worker actual dispatch blocked by final gate.",
  });
};

const processGridExitRequestIntent = async (intent, options = {}) => {
  const env = options.env || process.env;
  const orchestratorEnabled =
    String(env.GRID_EXIT_ORCHESTRATOR_ENABLED || "0").trim() === "1";
  const reason = orchestratorEnabled
    ? GRID_EXIT_PARENT_QUEUE_STATE.BLOCKED_NOT_IMPLEMENTED
    : GRID_EXIT_PARENT_QUEUE_STATE.ORCHESTRATOR_DISABLED;
  const result = buildBlockResult(reason, {
    intentType: intent.intentType,
    fifoKey: intent.fifoKey,
    parentIntent: true,
    projectionState: reason,
    childIntentCreated: false,
    entryCancelCalled: false,
    protectionCancelCalled: false,
    marketCloseCalled: false,
    closeConverged: false,
    phase: "PHASE_2A_PARENT_INTENT_DRY_RUN_ONLY",
  });

  await orderIntentQueue.completeIntent({
    id: intent.id,
    status: orderIntentQueue.STATUS.BLOCKED,
    result,
    errorCode: reason,
    errorMessage: "GRID_EXIT_REQUEST parent intent is represented only; closeout orchestrator is not implemented in Phase 2A.",
  });

  return {
    processed: true,
    status: orderIntentQueue.STATUS.BLOCKED,
    reason,
    result,
  };
};

const processGridExitChildCancelIntent = async (intent, options = {}) => {
  const env = options.env || process.env;
  const runtimeCancelMode = String(
    options.gridExitRuntimeCancelMode ||
    env.GRID_EXIT_RUNTIME_CANCEL_MODE ||
    options.gridExitCancelExecutorMode ||
    env.GRID_EXIT_CANCEL_EXECUTOR_MODE ||
    (options.mock === true ? "RUNTIME_DISABLED" : (options.dryRun === true ? "DRY_RUN" : "OFF"))
  ).trim().toUpperCase();
  const runtimeCancelAdapter = orderIntentQueue.createGridExitRuntimeDisabledCancelAdapter({
    mode: runtimeCancelMode,
    mockCancelClient: options.gridExitActualCancelClient ||
      options.mockCancelClient ||
      options.mockBinanceClient ||
      null,
    now: options.now || new Date(),
  });
  const executorResult = runtimeCancelMode === orderIntentQueue.GRID_EXIT_ACTUAL_CANCEL_MODE
    ? gridExitSafeExchangeAdapter.executeGridExitGateAActualCancel({
        cancelIntent: intent,
        cancelTarget: parseIntentJsonSafe(intent.payloadJson, intent.payload || {}),
        mode: orderIntentQueue.GRID_EXIT_ACTUAL_CANCEL_MODE,
        client: options.gridExitActualCancelClient ||
          options.mockCancelClient ||
          options.mockBinanceClient ||
          null,
        flags: {
          ...env,
          targetCount: options.gridExitActualCancelTargetCount || 1,
        },
      })
    : runtimeCancelAdapter.cancel({ childIntent: intent });
  const reason = executorResult.result || GRID_EXIT_CHILD_CANCEL_QUEUE_STATE.BLOCKED_NOT_IMPLEMENTED;
  const result = buildBlockResult(reason, {
    intentType: intent.intentType,
    fifoKey: intent.fifoKey,
    childCancelIntent: true,
    projectionState: reason,
    runtimeCancelMode: executorResult.mode,
    runtimeCancelResult: executorResult.result,
    cancelRequestPreview: executorResult.cancelRequestPreview || null,
    cancelRequest: executorResult.cancelRequest || executorResult.cancelRequestPreview || null,
    runtimeDisabledCancelEvent: executorResult.cancelEvent || null,
    runtimeDisabledCancelRecorded: executorResult.runtimeDisabledRecorded === true,
    actualCancelReady: executorResult.actualCancelReady === true,
    actualCancelFakeRecorded: executorResult.mockCancelRecorded === true,
    actualBinanceWrite: executorResult.actualBinanceWrite === true,
    actualCancelFlags: executorResult.flags || null,
    attributionErrors: executorResult.errors || [],
    cancelCalled: false,
    closeCalled: false,
    marketCloseIntentCreated: false,
    childIntentCreated: false,
    cancelAckTerminal: false,
    verificationPending: executorResult.verificationPending !== false,
    openOrdersVerificationPending: executorResult.openOrdersVerificationPending === true,
    openAlgoOrdersVerificationPending: executorResult.openAlgoOrdersVerificationPending === true,
    closeConverged: false,
    phase: runtimeCancelMode === orderIntentQueue.GRID_EXIT_ACTUAL_CANCEL_MODE
      ? "GATE_A_ACTUAL_CANCEL_BOUNDED_NON_TERMINAL"
      : "PHASE_2B_CHILD_CANCEL_PLAN_DRY_RUN_ONLY",
    mock: options.mock === true,
    dryRun: options.dryRun === true,
  });

  await orderIntentQueue.completeIntent({
    id: intent.id,
    status: orderIntentQueue.STATUS.BLOCKED,
    result,
    errorCode: reason,
    errorMessage: "GRID_EXIT child cancel intent remains non-terminal; Gate A cancel ACK is not closeout convergence.",
  });

  return {
    processed: true,
    status: orderIntentQueue.STATUS.BLOCKED,
    reason,
    result,
  };
};

const processGridExitMarketClosePlanIntent = async (intent, options = {}) => {
  const env = options.env || process.env;
  const payload = {
    ...parseIntentJsonSafe(intent.payloadJson, {}),
    ...parseIntentJsonSafe(intent.payload, {}),
  };
  const marketClosePlan = payload.marketClosePlan || payload.marketClose || payload;
  const mode = String(
    options.gridExitMarketCloseExecutorMode ||
    env.GRID_EXIT_MARKET_CLOSE_EXECUTOR_MODE ||
    (options.mock === true ? "MOCK_BINANCE_ONLY" : (options.dryRun === true ? "DRY_RUN" : "OFF"))
  ).trim().toUpperCase();
  const executorResult = gridExitSafeExchangeAdapter.executeGridExitGateBMarketClose({
    closePlan: marketClosePlan,
    mode,
    client: options.gridExitActualMarketCloseClient ||
      options.mockCloseClient ||
      options.mockBinanceClient ||
      null,
    flags: {
      ...env,
      targetCount: options.gridExitActualMarketCloseTargetCount || 1,
    },
  });
  const reason = executorResult.result || GRID_EXIT_MARKET_CLOSE_PLAN_QUEUE_STATE.BLOCKED_NOT_EXECUTABLE;
  const result = buildBlockResult(reason, {
    intentType: intent.intentType,
    fifoKey: intent.fifoKey,
    marketClosePlanIntent: true,
    projectionState: reason,
    marketCloseExecutorMode: executorResult.mode,
    marketCloseExecutorResult: executorResult.result,
    marketCloseRequest: executorResult.closeRequest || null,
    actualMarketCloseReady: executorResult.actualMarketCloseReady === true,
    actualMarketCloseFakeRecorded: executorResult.actualMarketCloseFakeRecorded === true ||
      executorResult.mockMarketCloseRecorded === true,
    actualMarketCloseFlags: executorResult.flags || null,
    attributionErrors: executorResult.errors || [],
    marketCloseCalled: false,
    closeCalled: false,
    reduceOnlyCloseCalled: false,
    marketCloseSubmit: false,
    binanceWrite: false,
    dbMutation: false,
    ledgerMutation: false,
    terminalSuccess: false,
    closeConverged: false,
    actualBinanceWrite: executorResult.actualBinanceWrite === true,
    closeAckTerminal: false,
    verificationPending: executorResult.verificationPending !== false,
    restRecoveryPending: executorResult.restRecoveryPending === true,
    phase: mode === orderIntentQueue.GRID_EXIT_ACTUAL_MARKET_CLOSE_MODE
      ? "GATE_B_ACTUAL_MARKET_CLOSE_BOUNDED_NON_TERMINAL"
      : "BATCH_3_MARKET_CLOSE_PLAN_ONLY",
  });

  await orderIntentQueue.completeIntent({
    id: intent.id,
    status: orderIntentQueue.STATUS.BLOCKED,
    result,
    errorCode: reason,
    errorMessage: "GRID_EXIT market close plan is non-executable in Batch 3; Binance market close is not implemented.",
  });

  return {
    processed: true,
    status: orderIntentQueue.STATUS.BLOCKED,
    reason,
    result,
  };
};

const processIntent = async (intent, options = {}) => {
  if (!intent) {
    return { processed: false, reason: "NO_INTENT" };
  }

  if (intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_EXIT_REQUEST) {
    return await processGridExitRequestIntent(intent, options);
  }

  if (
    intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL ||
    intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL
  ) {
    return await processGridExitChildCancelIntent(intent, options);
  }

  if (intent.intentType === orderIntentQueue.GRID_EXIT_MARKET_CLOSE_PLAN_TYPE) {
    return await processGridExitMarketClosePlanIntent(intent, options);
  }

  if (intent.intentType === orderIntentQueue.INTENT_TYPE.GRID_LIVE_ARM) {
    return await processGridLiveArmIntent(intent, options);
  }

  if (intent.intentType === orderIntentQueue.INTENT_TYPE.SIGNAL_MARKET_ENTRY) {
    return await processSignalMarketEntryIntent(intent, options);
  }

  if (
    intent.intentType === orderIntentQueue.INTENT_TYPE.SIGNAL_PROTECTION_CREATE ||
    intent.intentType === orderIntentQueue.INTENT_TYPE.SIGNAL_SPLIT_TP_CREATE
  ) {
    return await processSignalProtectionIntent(intent, options);
  }

  if (intent.intentType === orderIntentQueue.INTENT_TYPE.SIGNAL_PROTECTION_CANCEL) {
    return await processSignalCancelIntent(intent, options);
  }

  if (
    intent.intentType === orderIntentQueue.INTENT_TYPE.SIGNAL_FORCED_CLOSE ||
    intent.intentType === orderIntentQueue.INTENT_TYPE.SIGNAL_STOP_TIME_EXIT ||
    intent.intentType === orderIntentQueue.INTENT_TYPE.SIGNAL_CLEANUP_FINALIZE
  ) {
    return await processSignalCloseIntent(intent, options);
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
  processSignalMarketEntryIntent,
  processSignalProtectionIntent,
  processSignalCancelIntent,
  processSignalCloseIntent,
  processGridLiveArmIntent,
  processGridExitRequestIntent,
  processGridExitChildCancelIntent,
  processGridExitMarketClosePlanIntent,
  processGridProtectionCreateIntent,
  processGridReentryCreateIntent,
  processGridCancelIntent,
  processGridCloseIntent,
  dispatchGridProtectionCreateIntent,
  dispatchGridCloseIntent,
  PROTECTION_QUEUE_STATE,
  REENTRY_QUEUE_STATE,
  CANCEL_QUEUE_STATE,
  CLOSE_QUEUE_STATE,
  SIGNAL_ENTRY_QUEUE_STATE,
  SIGNAL_PROTECTION_QUEUE_STATE,
  SIGNAL_CANCEL_QUEUE_STATE,
  SIGNAL_CLOSE_QUEUE_STATE,
  GRID_LIVE_ARM_QUEUE_STATE,
  GRID_EXIT_PARENT_QUEUE_STATE,
  GRID_EXIT_CHILD_CANCEL_QUEUE_STATE,
  GRID_EXIT_MARKET_CLOSE_PLAN_QUEUE_STATE,
  startOrderIntentWorker,
  stopOrderIntentWorker,
  getOrderIntentWorkerHealth,
};
