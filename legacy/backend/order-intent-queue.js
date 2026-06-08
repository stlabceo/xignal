"use strict";

const crypto = require("crypto");
const db = require("./database/connect/config");
const signalMarketEntryIdempotency = require("./signal-market-entry-idempotency");

const STATUS = Object.freeze({
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  DONE: "DONE",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
});

const INTENT_TYPE = Object.freeze({
  GRID_LIVE_ARM: "GRID_LIVE_ARM",
  GRID_EXIT_REQUEST: "GRID_EXIT_REQUEST",
  GRID_EXIT_ENTRY_CANCEL: "GRID_EXIT_ENTRY_CANCEL",
  GRID_EXIT_PROTECTION_CANCEL: "GRID_EXIT_PROTECTION_CANCEL",
  GRID_PROTECTION_CREATE: "GRID_PROTECTION_CREATE",
  GRID_REENTRY_CREATE: "GRID_REENTRY_CREATE",
  GRID_CANCEL_ORDER: "GRID_CANCEL_ORDER",
  GRID_CANCEL_ALL_FOR_REGIME: "GRID_CANCEL_ALL_FOR_REGIME",
  GRID_GMANUAL_CLOSE: "GRID_GMANUAL_CLOSE",
  GRID_CONTROLLED_CLOSE: "GRID_CONTROLLED_CLOSE",
  GRID_REGIME_CLEANUP_CANCEL: "GRID_REGIME_CLEANUP_CANCEL",
  SIGNAL_MARKET_ENTRY: "SIGNAL_MARKET_ENTRY",
  SIGNAL_PROTECTION_CREATE: "SIGNAL_PROTECTION_CREATE",
  SIGNAL_SPLIT_TP_CREATE: "SIGNAL_SPLIT_TP_CREATE",
  SIGNAL_PROTECTION_CANCEL: "SIGNAL_PROTECTION_CANCEL",
  SIGNAL_FORCED_CLOSE: "SIGNAL_FORCED_CLOSE",
  SIGNAL_STOP_TIME_EXIT: "SIGNAL_STOP_TIME_EXIT",
  SIGNAL_CLEANUP_FINALIZE: "SIGNAL_CLEANUP_FINALIZE",
});

const GRID_EXIT_MARKET_CLOSE_PLAN_TYPE = "GRID_EXIT_MARKET_CLOSE_PLAN";

const DEFAULT_MAX_ATTEMPTS = 3;

let schemaReady = false;

const safeJsonStringify = (value) => {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({
      stringifyError: true,
      message: error?.message || "unknown",
    });
  }
};

const parseJsonSafe = (value, fallback = null) => {
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

const sha1 = (value) =>
  crypto.createHash("sha1").update(String(value || "")).digest("hex");

const normalizeSymbol = (symbol) =>
  String(symbol || "").trim().toUpperCase().replace(/\.P$/i, "");

const normalizeTimeframe = (value) => String(value || "").trim().toUpperCase();

const ensureOrderIntentSchema = async () => {
  if (schemaReady) {
    return true;
  }

  const [existingRows] = await db.query(
    `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'order_intent_queue'`
  );
  if (Number(existingRows?.[0]?.cnt || 0) > 0) {
    schemaReady = true;
    return true;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS order_intent_queue (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      intentKey VARCHAR(191) NOT NULL,
      fifoKey VARCHAR(191) NOT NULL,
      uid INT UNSIGNED NOT NULL,
      pid INT UNSIGNED NOT NULL,
      strategyCategory VARCHAR(20) NOT NULL,
      intentType VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      priority INT NOT NULL DEFAULT 100,
      attemptCount INT NOT NULL DEFAULT 0,
      maxAttempts INT NOT NULL DEFAULT 3,
      lockedBy VARCHAR(80) DEFAULT NULL,
      lockedAt DATETIME DEFAULT NULL,
      availableAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      startedAt DATETIME DEFAULT NULL,
      finishedAt DATETIME DEFAULT NULL,
      routePath VARCHAR(100) DEFAULT NULL,
      sourceEventId BIGINT UNSIGNED DEFAULT NULL,
      payloadHash CHAR(40) DEFAULT NULL,
      payloadJson LONGTEXT DEFAULT NULL,
      resultJson LONGTEXT DEFAULT NULL,
      lastErrorCode VARCHAR(80) DEFAULT NULL,
      lastErrorMessage VARCHAR(255) DEFAULT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_order_intent_key (intentKey),
      KEY idx_order_intent_claim (status, availableAt, priority, id),
      KEY idx_order_intent_fifo (fifoKey, status, id),
      KEY idx_order_intent_owner (uid, strategyCategory, pid, status, createdAt),
      KEY idx_order_intent_payload_hash (payloadHash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  schemaReady = true;
  return true;
};

const buildGridArmIntentPayloadHash = ({ payload = {}, targetItem = {} } = {}) =>
  sha1(
    safeJsonStringify({
      action: INTENT_TYPE.GRID_LIVE_ARM,
      uid: targetItem.uid,
      pid: targetItem.pid,
      strategySignal: payload.strategySignal,
      symbol: normalizeSymbol(payload.symbol || targetItem.symbol),
      bunbong: normalizeTimeframe(payload.bunbong || targetItem.bunbong),
      signalTime: payload.signalTime || payload.time || null,
      supportPrice: payload.supportPrice,
      resistancePrice: payload.resistancePrice,
      triggerPrice: payload.triggerPrice,
    })
  );

const buildGridArmIntentKey = ({ payload = {}, targetItem = {} } = {}) =>
  [
    INTENT_TYPE.GRID_LIVE_ARM,
    Number(targetItem.uid || 0),
    Number(targetItem.pid || 0),
    normalizeSymbol(payload.symbol || targetItem.symbol),
    normalizeTimeframe(payload.bunbong || targetItem.bunbong),
    buildGridArmIntentPayloadHash({ payload, targetItem }),
  ].join(":");

const buildGridArmFifoKey = ({ targetItem = {} } = {}) =>
  [
    Number(targetItem.uid || 0),
    "grid",
    Number(targetItem.pid || 0),
    "regime",
    Number(targetItem.pid || 0),
  ].join(":");

const GRID_EXIT_PARENT_STATE = Object.freeze({
  REQUESTED: "GRID_EXIT_REQUESTED",
  ACCEPTED: "GRID_EXIT_PARENT_ACCEPTED",
  DRY_RUN_ONLY: "GRID_EXIT_PARENT_DRY_RUN_ONLY",
  ORCHESTRATOR_DISABLED: "GRID_EXIT_ORCHESTRATOR_DISABLED",
  BLOCKED_NOT_IMPLEMENTED: "GRID_EXIT_PARENT_BLOCKED_NOT_IMPLEMENTED",
  DUPLICATE_IN_FLIGHT: "GRID_EXIT_PARENT_DUPLICATE_IN_FLIGHT",
  DUPLICATE_CONVERGED_NOOP: "GRID_EXIT_PARENT_DUPLICATE_CONVERGED_NOOP",
  USER_ACTION_REQUIRED: "GRID_EXIT_KEYLESS_USER_ACTION_REQUIRED",
  REJECTED_TARGET: "GRID_EXIT_PARENT_REJECTED_TARGET",
});

const GRID_EXIT_CHILD_CANCEL_STATE = Object.freeze({
  PLANNED: "GRID_EXIT_CHILD_CANCEL_PLANNED",
  DRY_RUN_ONLY: "GRID_EXIT_CHILD_CANCEL_DRY_RUN_ONLY",
  WORKER_BLOCKED_NOT_IMPLEMENTED: "GRID_EXIT_CHILD_CANCEL_WORKER_BLOCKED_NOT_IMPLEMENTED",
  RACE_DETECTION_READY: "GRID_EXIT_CHILD_CANCEL_RACE_DETECTION_READY",
  USER_ACTION_REQUIRED: "GRID_EXIT_CHILD_CANCEL_USER_ACTION_REQUIRED",
});

const normalizeGridExitKeySegment = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._|:-]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeGridExitParentIntentPayload = ({
  payload = {},
  targetItem = {},
  routePath = "/user/api/grid/hook",
  sourceEventId = null,
  sourceWebhookTargetId = null,
} = {}) => {
  const uid = Number(targetItem.uid || payload.uid || 0);
  const pid = Number(targetItem.pid || payload.pid || 0);
  const symbol = normalizeSymbol(payload.symbol || targetItem.symbol);
  const timeframe = normalizeTimeframe(
    payload.timeframe || payload.bunbong || targetItem.timeframe || targetItem.bunbong
  );
  const strategySignal = String(payload.strategySignal || targetItem.strategySignal || "").trim();
  const gridRegimeKey = String(
    payload.gridRegimeKey || payload.grid_regime_key || targetItem.gridRegimeKey || ""
  ).trim();
  return {
    action: INTENT_TYPE.GRID_EXIT_REQUEST,
    parentState: GRID_EXIT_PARENT_STATE.REQUESTED,
    uid,
    pid,
    strategyCategory: "grid",
    strategyMode: String(targetItem.strategyMode || "live").trim().toLowerCase(),
    strategySignal,
    symbol,
    timeframe,
    gridRegimeKey,
    routePath,
    sourceEventId,
    sourceWebhookTargetId,
    targetItem,
    gridPayload: payload,
  };
};

const buildGridExitParentIntentPayloadHash = ({ payload = {}, targetItem = {} } = {}) =>
  sha1(safeJsonStringify(normalizeGridExitParentIntentPayload({ payload, targetItem })));

const buildGridExitParentIntentKey = ({ payload = {}, targetItem = {} } = {}) => {
  const normalized = normalizeGridExitParentIntentPayload({ payload, targetItem });
  return [
    INTENT_TYPE.GRID_EXIT_REQUEST,
    "v1",
    normalized.uid,
    normalized.pid,
    normalizeGridExitKeySegment(normalized.strategySignal),
    normalized.symbol,
    normalized.timeframe,
    normalized.gridRegimeKey,
  ].join(":");
};

const buildGridExitParentFifoKey = ({ payload = {}, targetItem = {} } = {}) => {
  const normalized = normalizeGridExitParentIntentPayload({ payload, targetItem });
  return [
    normalized.uid,
    "grid",
    normalized.pid,
    "exit",
    sha1(normalized.gridRegimeKey || "missing-grid-regime-key").slice(0, 12),
  ].join(":");
};

const isGridExitParentConvergedResult = (result = {}) => {
  const joined = [
    result.reason,
    result.state,
    result.parentState,
    result.projectionState,
    result.resultCode,
  ]
    .filter(Boolean)
    .join("|")
    .toUpperCase();
  return /GRID_EXIT_CONVERGED|CLOSE_CONVERGED|EXIT_CONVERGED/.test(joined);
};

const evaluateGridExitParentDuplicate = ({ candidate = {}, existingIntent = null } = {}) => {
  if (!existingIntent) {
    return {
      ...candidate,
      duplicate: false,
      createParent: candidate.createParent === true,
    };
  }

  const status = String(existingIntent.status || "").trim().toUpperCase();
  const existingResult = existingIntent.result || parseJsonSafe(existingIntent.resultJson, {});
  if (["PENDING", "RUNNING", "RETRY", "BLOCKED"].includes(status)) {
    return {
      ...candidate,
      duplicate: true,
      createParent: false,
      duplicateState: GRID_EXIT_PARENT_STATE.DUPLICATE_IN_FLIGHT,
      existingIntentId: existingIntent.id || null,
    };
  }

  if (status === "DONE" && isGridExitParentConvergedResult(existingResult || {})) {
    return {
      ...candidate,
      duplicate: true,
      createParent: false,
      duplicateState: GRID_EXIT_PARENT_STATE.DUPLICATE_CONVERGED_NOOP,
      existingIntentId: existingIntent.id || null,
    };
  }

  return {
    ...candidate,
    duplicate: true,
    createParent: false,
    duplicateState: GRID_EXIT_PARENT_STATE.REJECTED_TARGET,
    existingIntentId: existingIntent.id || null,
  };
};

const buildGridExitParentIntentCandidate = ({
  payload = {},
  targetItem = {},
  routePath = "/user/api/grid/hook",
  sourceEventId = null,
  sourceWebhookTargetId = null,
} = {}) => {
  const strategyCategory = String(targetItem.strategyCategory || "").trim().toLowerCase();
  const strategyMode = String(targetItem.strategyMode || "").trim().toLowerCase();
  const resultCode = String(targetItem.resultCode || "").trim().toUpperCase();

  if (strategyCategory !== "grid" || strategyMode !== "live") {
    return null;
  }

  const normalizedPayload = normalizeGridExitParentIntentPayload({
    payload,
    targetItem,
    routePath,
    sourceEventId,
    sourceWebhookTargetId,
  });
  const accepted = resultCode === "GRID_EXIT_ALERT_PREVIEW";
  const keyless = resultCode === "GRID_EXIT_ROW_KEY_MISSING";
  const hasKey = Boolean(normalizedPayload.gridRegimeKey);
  const parentState = accepted
    ? GRID_EXIT_PARENT_STATE.ACCEPTED
    : keyless
      ? GRID_EXIT_PARENT_STATE.USER_ACTION_REQUIRED
      : GRID_EXIT_PARENT_STATE.REJECTED_TARGET;
  const intentKey = buildGridExitParentIntentKey({ payload, targetItem });
  const fifoKey = buildGridExitParentFifoKey({ payload, targetItem });
  const intentPayload = {
    ...normalizedPayload,
    parentState,
    dryRunOnly: true,
  };

  return {
    createParent: accepted && hasKey,
    dryRunOnly: true,
    parentState,
    reason: resultCode || "GRID_EXIT_PARENT_TARGET_RESULT_UNKNOWN",
    intentType: INTENT_TYPE.GRID_EXIT_REQUEST,
    intentKey,
    fifoKey,
    payloadHash: buildGridExitParentIntentPayloadHash({ payload, targetItem }),
    uid: normalizedPayload.uid,
    pid: normalizedPayload.pid,
    strategyCategory: "grid",
    strategySignal: normalizedPayload.strategySignal,
    symbol: normalizedPayload.symbol,
    timeframe: normalizedPayload.timeframe,
    gridRegimeKey: normalizedPayload.gridRegimeKey,
    routePath,
    sourceEventId,
    sourceWebhookTargetId,
    intentPayload,
  };
};

const buildGridExitParentIntentCandidates = ({
  payload = {},
  previewResult = {},
  routePath = "/user/api/grid/hook",
  sourceEventId = null,
} = {}) => {
  const targetItems = Array.isArray(previewResult?.targetItems) ? previewResult.targetItems : [];
  const candidates = targetItems
    .map((targetItem) =>
      buildGridExitParentIntentCandidate({
        payload,
        targetItem,
        routePath,
        sourceEventId,
        sourceWebhookTargetId: targetItem.sourceTargetId || targetItem.targetId || null,
      })
    )
    .filter(Boolean);
  return {
    intentType: INTENT_TYPE.GRID_EXIT_REQUEST,
    mode: "DRY_RUN_ONLY",
    requested: candidates.filter((item) => item.createParent === true).length,
    userActionRequired: candidates.filter(
      (item) => item.parentState === GRID_EXIT_PARENT_STATE.USER_ACTION_REQUIRED
    ).length,
    rejected: candidates.filter((item) => item.parentState === GRID_EXIT_PARENT_STATE.REJECTED_TARGET).length,
    inserted: 0,
    duplicate: 0,
    candidates,
  };
};

const normalizeGridExitChildSide = (value) =>
  String(value || "").trim().toUpperCase() === "SHORT" ? "SHORT" : "LONG";

const normalizeGridExitChildRole = (value) =>
  String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_");

const resolveGridExitParentKey = (parentCandidate = {}) =>
  String(
    parentCandidate.parentKey ||
      parentCandidate.intentKey ||
      parentCandidate.gridExitParentKey ||
      parentCandidate.intentPayload?.intentKey ||
      ""
  ).trim();

const resolveGridExitParentContext = (parentCandidate = {}, regimeRuntimeSnapshot = {}) => {
  const intentPayload = parentCandidate.intentPayload || {};
  return {
    parentKey: resolveGridExitParentKey(parentCandidate),
    uid: Number(parentCandidate.uid || intentPayload.uid || regimeRuntimeSnapshot.uid || 0),
    pid: Number(parentCandidate.pid || intentPayload.pid || regimeRuntimeSnapshot.pid || 0),
    gridRegimeKey: String(
      parentCandidate.gridRegimeKey ||
        intentPayload.gridRegimeKey ||
        regimeRuntimeSnapshot.gridRegimeKey ||
        ""
    ).trim(),
    strategySignal: String(
      parentCandidate.strategySignal ||
        intentPayload.strategySignal ||
        regimeRuntimeSnapshot.strategySignal ||
        ""
    ).trim(),
    symbol: normalizeSymbol(parentCandidate.symbol || intentPayload.symbol || regimeRuntimeSnapshot.symbol),
    timeframe: normalizeTimeframe(
      parentCandidate.timeframe || intentPayload.timeframe || regimeRuntimeSnapshot.timeframe
    ),
  };
};

const buildGridExitChildCancelIntentKey = ({
  childType,
  parentCandidate = {},
  regimeRuntimeSnapshot = {},
  positionSide = null,
  orderRole = null,
  identity = null,
} = {}) => {
  const context = resolveGridExitParentContext(parentCandidate, regimeRuntimeSnapshot);
  return [
    childType,
    "v1",
    context.parentKey,
    context.uid,
    context.pid,
    context.gridRegimeKey,
    normalizeGridExitKeySegment(context.strategySignal),
    context.symbol,
    context.timeframe,
    normalizeGridExitChildSide(positionSide),
    normalizeGridExitChildRole(orderRole),
    String(identity || "").trim(),
  ].join(":");
};

const buildGridExitChildCancelCandidate = ({
  childType,
  parentCandidate = {},
  regimeRuntimeSnapshot = {},
  leg = {},
  orderRole,
  order = {},
  identity,
} = {}) => {
  const context = resolveGridExitParentContext(parentCandidate, regimeRuntimeSnapshot);
  const positionSide = normalizeGridExitChildSide(leg.positionSide || order.positionSide);
  const naturalIdentity = String(
    identity ||
      order.clientOrderId ||
      order.reservationId ||
      order.orderId ||
      ""
  ).trim();
  const intentKey = buildGridExitChildCancelIntentKey({
    childType,
    parentCandidate,
    regimeRuntimeSnapshot,
    positionSide,
    orderRole,
    identity: naturalIdentity,
  });
  return {
    intentType: childType,
    parentKey: context.parentKey,
    intentKey,
    fifoKey: [context.uid, "grid", context.pid, "exit-child", context.gridRegimeKey || "missing"].join(":"),
    uid: context.uid,
    pid: context.pid,
    gridRegimeKey: context.gridRegimeKey,
    strategySignal: context.strategySignal,
    symbol: context.symbol,
    timeframe: context.timeframe,
    positionSide,
    orderRole: normalizeGridExitChildRole(orderRole),
    identity: naturalIdentity,
    dryRunOnly: true,
    childState: GRID_EXIT_CHILD_CANCEL_STATE.PLANNED,
    workerState: GRID_EXIT_CHILD_CANCEL_STATE.WORKER_BLOCKED_NOT_IMPLEMENTED,
    order,
  };
};

const dedupeGridExitChildCancelCandidates = (items = []) => {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.intentKey || seen.has(item.intentKey)) {
      continue;
    }
    seen.add(item.intentKey);
    out.push(item);
  }
  return out;
};

const isOpenGridExitOrder = (order = {}) => {
  if (order.open === true) {
    return true;
  }
  const status = String(order.status || "").trim().toUpperCase();
  return ["NEW", "OPEN", "PARTIALLY_FILLED"].includes(status);
};

const isActiveGridExitReservation = (reservation = {}) => {
  const status = String(reservation.status || "").trim().toUpperCase();
  return ["ACTIVE", "OPEN", "PENDING"].includes(status);
};

const buildGridExitChildCancelPlan = (parentCandidate = {}, regimeRuntimeSnapshot = {}) => {
  const context = resolveGridExitParentContext(parentCandidate, regimeRuntimeSnapshot);
  const result = {
    parentKey: context.parentKey,
    entryCancelCandidates: [],
    protectionCancelCandidates: [],
    raceWatch: [],
    userActionRequired: [],
    forbidden: {
      marketClose: false,
      binanceWrite: false,
      dbMutation: false,
    },
    marketCloseCandidates: [],
  };

  const parentReason = String(parentCandidate.reason || "").trim().toUpperCase();
  if (
    !context.parentKey ||
    !context.gridRegimeKey ||
    parentCandidate.parentState === GRID_EXIT_PARENT_STATE.USER_ACTION_REQUIRED ||
    parentReason === "GRID_EXIT_ROW_KEY_MISSING"
  ) {
    result.userActionRequired.push({
      reason: GRID_EXIT_CHILD_CANCEL_STATE.USER_ACTION_REQUIRED,
      detail: "missing parent/grid regime key attribution",
    });
    return result;
  }

  if (
    parentReason === "GRID_CANDLE_CLOSE_LEGACY_DISABLED_AUDIT" ||
    parentReason === "GRID_EXIT_KEY_MISMATCH" ||
    parentReason === "GRID_EXIT_SIGNAL_MISMATCH" ||
    parentReason === "GRID_EXIT_NO_ACTIVE_REGIME" ||
    regimeRuntimeSnapshot.terminal === true ||
    regimeRuntimeSnapshot.enabled === false
  ) {
    return result;
  }

  const legs = Array.isArray(regimeRuntimeSnapshot.legs) ? regimeRuntimeSnapshot.legs : [];
  for (const leg of legs) {
    const positionSide = normalizeGridExitChildSide(leg.positionSide);
    for (const order of Array.isArray(leg.entryOrders) ? leg.entryOrders : []) {
      if (!isOpenGridExitOrder(order)) {
        continue;
      }
      result.entryCancelCandidates.push(
        buildGridExitChildCancelCandidate({
          childType: INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL,
          parentCandidate,
          regimeRuntimeSnapshot,
          leg,
          orderRole: order.role || "ENTRY",
          order: { ...order, positionSide },
        })
      );
    }

    for (const reservation of Array.isArray(leg.protectionReservations) ? leg.protectionReservations : []) {
      if (!isActiveGridExitReservation(reservation)) {
        continue;
      }
      result.protectionCancelCandidates.push(
        buildGridExitChildCancelCandidate({
          childType: INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL,
          parentCandidate,
          regimeRuntimeSnapshot,
          leg,
          orderRole: reservation.type || reservation.role || "PROTECTION",
          order: { ...reservation, positionSide },
          identity: reservation.reservationId || reservation.clientOrderId || reservation.orderId,
        })
      );
    }
  }

  result.entryCancelCandidates = dedupeGridExitChildCancelCandidates(result.entryCancelCandidates);
  result.protectionCancelCandidates = dedupeGridExitChildCancelCandidates(result.protectionCancelCandidates);
  result.raceWatch = [...result.entryCancelCandidates, ...result.protectionCancelCandidates].map((candidate) => ({
    intentKey: candidate.intentKey,
    childType: candidate.intentType,
    clientOrderId: candidate.order.clientOrderId || null,
    orderId: candidate.order.orderId || null,
    reservationId: candidate.order.reservationId || null,
    positionSide: candidate.positionSide,
    orderRole: candidate.orderRole,
    state: GRID_EXIT_CHILD_CANCEL_STATE.RACE_DETECTION_READY,
  }));
  return result;
};

const classifyGridExitCancelRaceEvent = (childCancelCandidate = {}, observedEvent = {}) => {
  const role = normalizeGridExitChildRole(observedEvent.role || childCancelCandidate.orderRole);
  const status = String(observedEvent.status || "").trim().toUpperCase();
  const executionType = String(observedEvent.executionType || "").trim().toUpperCase();
  const executedQty = Number(observedEvent.executedQty || 0);
  let raceType = "CANCEL_ACK_ONLY_NOT_TERMINAL";
  let raceDetected = false;

  if (status === "PARTIALLY_FILLED" || executionType === "PARTIAL_FILL" || executedQty > 0 && status !== "FILLED") {
    raceType = "PARTIAL_FILL_NOT_TERMINAL";
    raceDetected = true;
  } else if (status === "FILLED" || executionType === "TRADE" || executedQty > 0) {
    if (role === "ENTRY") {
      raceType = "ENTRY_FILL_DURING_CANCEL";
    } else if (role === "TP" || role === "TAKE_PROFIT") {
      raceType = "TP_FILL_DURING_PROTECTION_CANCEL";
    } else if (role === "STOP" || role === "STOP_LOSS") {
      raceType = "STOP_FILL_DURING_PROTECTION_CANCEL";
    } else {
      raceType = "PARTIAL_FILL_NOT_TERMINAL";
    }
    raceDetected = true;
  }

  return {
    raceDetected,
    raceType,
    nextState: raceDetected
      ? "GRID_EXIT_CANCEL_RACE_FILL_DETECTED"
      : "GRID_EXIT_CANCEL_ACK_OBSERVED_NOT_TERMINAL",
    terminal: false,
    requiresRecovery: true,
    ledgerMutation: false,
    sourceTradeId: observedEvent.sourceTradeId || observedEvent.tradeId || null,
    tradeId: observedEvent.tradeId || observedEvent.sourceTradeId || null,
    clientOrderId: observedEvent.clientOrderId || childCancelCandidate.order?.clientOrderId || null,
    orderId: observedEvent.orderId || childCancelCandidate.order?.orderId || null,
  };
};

const GRID_EXIT_QUEUE_JOIN_STATE = Object.freeze({
  PARENT_PLAN_READY: "GRID_EXIT_PARENT_QUEUE_PLAN_READY",
  PARENT_DRY_RUN_ONLY: "GRID_EXIT_PARENT_QUEUE_DRY_RUN_ONLY",
  CHILD_DRY_RUN_ONLY: "GRID_EXIT_CHILD_QUEUE_DRY_RUN_ONLY",
  CHILD_CANCEL_PLANNED: "GRID_EXIT_CHILD_CANCEL_PLANNED",
  WAITING_CHILD_CANCEL_NOT_IMPLEMENTED: "GRID_EXIT_PARENT_WAITING_CHILD_CANCEL_EXECUTION_NOT_IMPLEMENTED",
  BLOCKED_USER_ACTION_REQUIRED: "GRID_EXIT_PARENT_BLOCKED_USER_ACTION_REQUIRED",
  DUPLICATE_IN_FLIGHT_JOINED: "GRID_EXIT_PARENT_DUPLICATE_IN_FLIGHT_JOINED",
  DUPLICATE_CONVERGED_NOOP: "GRID_EXIT_PARENT_DUPLICATE_CONVERGED_NOOP",
  NO_CHILD_CANCEL_REQUIRED_DRY_RUN: "GRID_EXIT_PARENT_NO_CHILD_CANCEL_REQUIRED_DRY_RUN",
  SCHEMA_GAP_BLOCKED: "QUEUE_SCHEMA_GAP_BLOCKED",
});

const GRID_EXIT_QUEUE_JOIN_REQUIRED_COLUMNS = Object.freeze([
  "intentKey",
  "fifoKey",
  "uid",
  "pid",
  "strategyCategory",
  "intentType",
  "status",
  "payloadHash",
  "payloadJson",
  "resultJson",
]);

const validateGridExitQueueJoinSchema = (columns = []) => {
  const names = new Set(
    (columns || []).map((item) =>
      String(item.COLUMN_NAME || item.columnName || item.name || item || "").trim()
    )
  );
  const missing = GRID_EXIT_QUEUE_JOIN_REQUIRED_COLUMNS.filter((name) => !names.has(name));
  return {
    ok: missing.length === 0,
    missing,
    required: [...GRID_EXIT_QUEUE_JOIN_REQUIRED_COLUMNS],
  };
};

const normalizeGridExitQueueJoinMode = (mode) =>
  String(mode || "DRY_RUN").trim().toUpperCase() === "DRY_RUN" ? "DRY_RUN" : "OFF";

const buildGridExitParentQueueRowCandidate = (parentCandidate = {}, mode = "DRY_RUN") => {
  const parentNaturalKey = resolveGridExitParentKey(parentCandidate);
  const payload = {
    action: INTENT_TYPE.GRID_EXIT_REQUEST,
    parentNaturalKey,
    idempotencyKey: parentNaturalKey,
    uid: Number(parentCandidate.uid || 0),
    pid: Number(parentCandidate.pid || 0),
    strategyCategory: "grid",
    strategySignal: parentCandidate.strategySignal || null,
    symbol: normalizeSymbol(parentCandidate.symbol),
    timeframe: normalizeTimeframe(parentCandidate.timeframe),
    gridRegimeKey: parentCandidate.gridRegimeKey || null,
    source: "GRID_EXIT_QUEUE_JOIN_DRY_RUN",
    dryRunOnly: true,
  };
  const result = {
    state: normalizeGridExitQueueJoinMode(mode) === "DRY_RUN"
      ? GRID_EXIT_QUEUE_JOIN_STATE.PARENT_DRY_RUN_ONLY
      : GRID_EXIT_QUEUE_JOIN_STATE.PARENT_PLAN_READY,
    terminalSuccess: false,
    closeConverged: false,
  };
  return {
    intentType: INTENT_TYPE.GRID_EXIT_REQUEST,
    uid: payload.uid,
    pid: payload.pid,
    strategyCategory: "grid",
    symbol: payload.symbol,
    positionSide: null,
    strategySignal: payload.strategySignal,
    timeframe: payload.timeframe,
    gridRegimeKey: payload.gridRegimeKey,
    parentNaturalKey,
    idempotencyKey: parentNaturalKey,
    intentKey: parentNaturalKey,
    fifoKey: parentCandidate.fifoKey || [payload.uid, "grid", payload.pid, "exit-parent"].join(":"),
    status: STATUS.BLOCKED,
    state: result.state,
    payloadHash: sha1(safeJsonStringify(payload)),
    payload,
    payloadJsonCandidate: safeJsonStringify(payload),
    result,
    resultJsonCandidate: safeJsonStringify(result),
    createRow: Boolean(parentNaturalKey && parentCandidate.createParent !== false),
    dryRunOnly: true,
  };
};

const buildGridExitChildQueueRowCandidate = (childCandidate = {}, parentRowCandidate = {}) => {
  const parentNaturalKey = String(childCandidate.parentKey || parentRowCandidate.parentNaturalKey || "").trim();
  const childNaturalKey = String(childCandidate.intentKey || "").trim();
  const payload = {
    action: childCandidate.intentType,
    parentNaturalKey,
    childNaturalKey,
    gridExitGroupKey: parentNaturalKey,
    gridExitGeneration: sha1(parentNaturalKey).slice(0, 12),
    uid: Number(childCandidate.uid || parentRowCandidate.uid || 0),
    pid: Number(childCandidate.pid || parentRowCandidate.pid || 0),
    strategyCategory: "grid",
    strategySignal: childCandidate.strategySignal || parentRowCandidate.strategySignal || null,
    symbol: normalizeSymbol(childCandidate.symbol || parentRowCandidate.symbol),
    timeframe: normalizeTimeframe(childCandidate.timeframe || parentRowCandidate.timeframe),
    gridRegimeKey: childCandidate.gridRegimeKey || parentRowCandidate.gridRegimeKey || null,
    positionSide: normalizeGridExitChildSide(childCandidate.positionSide),
    orderRole: normalizeGridExitChildRole(childCandidate.orderRole),
    clientOrderId: childCandidate.order?.clientOrderId || null,
    reservationId: childCandidate.order?.reservationId || null,
    orderId: childCandidate.order?.orderId || null,
    source: "GRID_EXIT_QUEUE_JOIN_DRY_RUN",
    dryRunOnly: true,
  };
  const result = {
    state: GRID_EXIT_QUEUE_JOIN_STATE.CHILD_DRY_RUN_ONLY,
    childState: GRID_EXIT_QUEUE_JOIN_STATE.CHILD_CANCEL_PLANNED,
    terminalSuccess: false,
    cancelAckTerminal: false,
    closeConverged: false,
  };
  return {
    intentType: childCandidate.intentType,
    uid: payload.uid,
    pid: payload.pid,
    strategyCategory: "grid",
    symbol: payload.symbol,
    positionSide: payload.positionSide,
    strategySignal: payload.strategySignal,
    timeframe: payload.timeframe,
    gridRegimeKey: payload.gridRegimeKey,
    parentNaturalKey,
    parentIntentIdCandidate: parentRowCandidate.idCandidate || null,
    gridExitGroupKey: payload.gridExitGroupKey,
    gridExitGeneration: payload.gridExitGeneration,
    childRole: payload.orderRole,
    childNaturalKey,
    intentKey: childNaturalKey,
    fifoKey: childCandidate.fifoKey || [payload.uid, "grid", payload.pid, "exit-child"].join(":"),
    orderRole: payload.orderRole,
    clientOrderId: payload.clientOrderId,
    reservationId: payload.reservationId,
    orderId: payload.orderId,
    status: STATUS.BLOCKED,
    state: result.state,
    payloadHash: sha1(safeJsonStringify(payload)),
    payload,
    payloadJsonCandidate: safeJsonStringify(payload),
    result,
    resultJsonCandidate: safeJsonStringify(result),
    createRow: Boolean(parentNaturalKey && childNaturalKey),
    dryRunOnly: true,
  };
};

const isGridExitQueueInFlightStatus = (status) =>
  ["PENDING", "RUNNING", "RETRY", "BLOCKED"].includes(String(status || "").trim().toUpperCase());

const resolveGridExitIntentIdempotency = (plan = {}, existingIntentRows = []) => {
  const parentKey = plan.parentRowCandidate?.parentNaturalKey || "";
  const rows = Array.isArray(existingIntentRows) ? existingIntentRows : [];
  const duplicateParents = [];
  const duplicateChildren = [];

  if (!parentKey) {
    return {
      ...plan,
      duplicateParents: [{
        state: GRID_EXIT_QUEUE_JOIN_STATE.BLOCKED_USER_ACTION_REQUIRED,
        reason: "missing-parentNaturalKey",
      }],
      duplicateChildren,
      joinState: {
        blocked: true,
        reason: GRID_EXIT_QUEUE_JOIN_STATE.BLOCKED_USER_ACTION_REQUIRED,
      },
    };
  }

  const parentExisting = rows.find((row) =>
    String(row.intentType || "").toUpperCase() === INTENT_TYPE.GRID_EXIT_REQUEST &&
    String(row.intentKey || row.parentNaturalKey || "") === parentKey
  );
  let parentRowCandidate = plan.parentRowCandidate;
  if (parentExisting && isGridExitQueueInFlightStatus(parentExisting.status)) {
    duplicateParents.push({
      existingIntentId: parentExisting.id || null,
      parentNaturalKey: parentKey,
      state: GRID_EXIT_QUEUE_JOIN_STATE.DUPLICATE_IN_FLIGHT_JOINED,
    });
    parentRowCandidate = {
      ...parentRowCandidate,
      createRow: false,
      duplicateState: GRID_EXIT_QUEUE_JOIN_STATE.DUPLICATE_IN_FLIGHT_JOINED,
      existingIntentId: parentExisting.id || null,
    };
  } else if (
    parentExisting &&
    String(parentExisting.status || "").toUpperCase() === STATUS.DONE &&
    isGridExitParentConvergedResult(parentExisting.result || parseJsonSafe(parentExisting.resultJson, {}))
  ) {
    duplicateParents.push({
      existingIntentId: parentExisting.id || null,
      parentNaturalKey: parentKey,
      state: GRID_EXIT_QUEUE_JOIN_STATE.DUPLICATE_CONVERGED_NOOP,
    });
    parentRowCandidate = {
      ...parentRowCandidate,
      createRow: false,
      duplicateState: GRID_EXIT_QUEUE_JOIN_STATE.DUPLICATE_CONVERGED_NOOP,
      existingIntentId: parentExisting.id || null,
    };
  }

  const childRowCandidates = (plan.childRowCandidates || []).map((child) => {
    const existingChild = rows.find((row) =>
      String(row.intentKey || row.childNaturalKey || "") === child.childNaturalKey &&
      String(row.intentType || "").toUpperCase() === String(child.intentType || "").toUpperCase()
    );
    if (existingChild && isGridExitQueueInFlightStatus(existingChild.status)) {
      duplicateChildren.push({
        existingIntentId: existingChild.id || null,
        childNaturalKey: child.childNaturalKey,
        state: "GRID_EXIT_CHILD_DUPLICATE_IN_FLIGHT_JOINED",
      });
      return {
        ...child,
        createRow: false,
        duplicateState: "GRID_EXIT_CHILD_DUPLICATE_IN_FLIGHT_JOINED",
        existingIntentId: existingChild.id || null,
      };
    }
    return child;
  });

  return {
    ...plan,
    parentRowCandidate,
    childRowCandidates,
    duplicateParents,
    duplicateChildren,
    joinState: {
      parentNaturalKey: parentKey,
      duplicateParentCount: duplicateParents.length,
      duplicateChildCount: duplicateChildren.length,
      parentCreateRow: parentRowCandidate.createRow === true,
      childCreateRows: childRowCandidates.filter((child) => child.createRow === true).length,
      dryRunOnly: true,
    },
  };
};

const reduceGridExitParentQueueJoinState = (
  parentRowCandidate = {},
  childRowCandidates = [],
  observations = []
) => {
  if (
    !parentRowCandidate?.parentNaturalKey ||
    parentRowCandidate.duplicateState === GRID_EXIT_QUEUE_JOIN_STATE.BLOCKED_USER_ACTION_REQUIRED
  ) {
    return {
      state: GRID_EXIT_QUEUE_JOIN_STATE.BLOCKED_USER_ACTION_REQUIRED,
      terminalSuccess: false,
      closeConverged: false,
      forbiddenShortcutPrevented: true,
    };
  }
  if (parentRowCandidate.duplicateState === GRID_EXIT_QUEUE_JOIN_STATE.DUPLICATE_IN_FLIGHT_JOINED) {
    return {
      state: GRID_EXIT_QUEUE_JOIN_STATE.DUPLICATE_IN_FLIGHT_JOINED,
      terminalSuccess: false,
      closeConverged: false,
      forbiddenShortcutPrevented: true,
    };
  }
  if (parentRowCandidate.duplicateState === GRID_EXIT_QUEUE_JOIN_STATE.DUPLICATE_CONVERGED_NOOP) {
    return {
      state: GRID_EXIT_QUEUE_JOIN_STATE.DUPLICATE_CONVERGED_NOOP,
      terminalSuccess: false,
      closeConverged: false,
      forbiddenShortcutPrevented: true,
    };
  }

  const observedRace = (observations || []).map((item) =>
    item?.raceType || classifyGridExitCancelRaceEvent({}, item).raceType
  );
  if ((childRowCandidates || []).length > 0) {
    return {
      state: GRID_EXIT_QUEUE_JOIN_STATE.WAITING_CHILD_CANCEL_NOT_IMPLEMENTED,
      childCount: childRowCandidates.length,
      observationTypes: observedRace,
      terminalSuccess: false,
      closeConverged: false,
      forbiddenShortcutPrevented: true,
    };
  }
  return {
    state: GRID_EXIT_QUEUE_JOIN_STATE.NO_CHILD_CANCEL_REQUIRED_DRY_RUN,
    childCount: 0,
    observationTypes: observedRace,
    terminalSuccess: false,
    closeConverged: false,
    forbiddenShortcutPrevented: true,
  };
};

const buildGridExitQueueJoinPlan = ({
  parentCandidate = {},
  childCancelPlan = {},
  existingIntentRows = [],
  mode = "DRY_RUN",
  schemaColumns = null,
} = {}) => {
  const normalizedMode = normalizeGridExitQueueJoinMode(mode);
  const schema = schemaColumns ? validateGridExitQueueJoinSchema(schemaColumns) : { ok: true, missing: [] };
  const parentRowCandidate = buildGridExitParentQueueRowCandidate(parentCandidate, normalizedMode);
  const childSource = [
    ...(childCancelPlan.entryCancelCandidates || []),
    ...(childCancelPlan.protectionCancelCandidates || []),
  ];
  const childRowCandidates = childSource.map((child) =>
    buildGridExitChildQueueRowCandidate(child, parentRowCandidate)
  );
  const basePlan = {
    mode: normalizedMode,
    schema,
    parentRowCandidate,
    childRowCandidates,
    duplicateParents: [],
    duplicateChildren: [],
    joinState: {},
    reducerResult: {},
    forbidden: {
      dbInsert: false,
      dbUpdate: false,
      dbDelete: false,
      binanceWrite: false,
      cancel: false,
      close: false,
      marketClose: false,
      ledgerMutation: false,
    },
  };
  const withDedupe = resolveGridExitIntentIdempotency(basePlan, existingIntentRows);
  return {
    ...withDedupe,
    reducerResult: schema.ok
      ? reduceGridExitParentQueueJoinState(withDedupe.parentRowCandidate, withDedupe.childRowCandidates)
      : {
          state: GRID_EXIT_QUEUE_JOIN_STATE.SCHEMA_GAP_BLOCKED,
          missing: schema.missing,
          terminalSuccess: false,
          closeConverged: false,
          forbiddenShortcutPrevented: true,
        },
  };
};

const GRID_EXIT_ACTUAL_CANCEL_MODE = "ACTUAL_CANCEL";
const GRID_EXIT_ACTUAL_CANCEL_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  hardConfirm: false,
  maxTargets: 1,
});
const GRID_EXIT_CANCEL_EXECUTOR_ALLOWED_MODES = Object.freeze(["OFF", "DRY_RUN", "MOCK_BINANCE_ONLY", GRID_EXIT_ACTUAL_CANCEL_MODE]);
const GRID_EXIT_CANCEL_EXECUTOR_REJECTED_MODES = Object.freeze(["LIVE", "BINANCE_WRITE", "EXECUTE"]);
const GRID_EXIT_CANCEL_EXECUTOR_STATE = Object.freeze({
  DISABLED: "GRID_EXIT_CANCEL_EXECUTOR_DISABLED",
  DRY_RUN_READY: "GRID_EXIT_CANCEL_REQUEST_DRY_RUN_READY",
  MOCK_REQUEST_RECORDED: "GRID_EXIT_CANCEL_MOCK_REQUEST_RECORDED",
  ACTUAL_CANCEL_READY: "GRID_EXIT_ACTUAL_CANCEL_READY",
  ACTUAL_CANCEL_FAKE_RECORDED: "GRID_EXIT_ACTUAL_CANCEL_FAKE_CLIENT_RECORDED",
  BLOCKED_NOT_IMPLEMENTED: "GRID_EXIT_CANCEL_EXECUTOR_BLOCKED_NOT_IMPLEMENTED",
  MODE_REJECTED: "GRID_EXIT_CANCEL_EXECUTOR_MODE_REJECTED",
  HARD_CONFIRM_REQUIRED: "GRID_EXIT_ACTUAL_CANCEL_HARD_CONFIRM_REQUIRED",
  MAX_TARGETS_EXCEEDED: "GRID_EXIT_ACTUAL_CANCEL_MAX_TARGETS_EXCEEDED",
  FAKE_CLIENT_REQUIRED: "GRID_EXIT_ACTUAL_CANCEL_FAKE_CLIENT_REQUIRED",
});

const normalizeGridExitCancelExecutorMode = (mode = "OFF") => {
  const requestedMode = String(mode || "OFF").trim().toUpperCase();
  if (GRID_EXIT_CANCEL_EXECUTOR_ALLOWED_MODES.includes(requestedMode)) {
    return { ok: true, mode: requestedMode, requestedMode };
  }
  if (GRID_EXIT_CANCEL_EXECUTOR_REJECTED_MODES.includes(requestedMode)) {
    return {
      ok: false,
      mode: "OFF",
      requestedMode,
      reason: GRID_EXIT_CANCEL_EXECUTOR_STATE.MODE_REJECTED,
    };
  }
  return {
    ok: false,
    mode: "OFF",
    requestedMode,
    reason: GRID_EXIT_CANCEL_EXECUTOR_STATE.MODE_REJECTED,
  };
};

const normalizeGridExitCancelTarget = ({ childIntent = {}, cancelCandidate = {} } = {}) => {
  const payload = {
    ...(parseJsonSafe(childIntent.payloadJson, {}) || {}),
    ...(childIntent.payload || {}),
    ...(cancelCandidate || {}),
  };
  const intentType = String(
    childIntent.intentType || payload.intentType || payload.action || ""
  ).trim().toUpperCase();
  const uid = Number(payload.uid || childIntent.uid || 0);
  const pid = Number(payload.pid || childIntent.pid || 0);
  const orderRole = String(payload.orderRole || payload.role || "").trim().toUpperCase();
  return {
    uid,
    pid,
    strategyCategory: String(payload.strategyCategory || childIntent.strategyCategory || "grid").trim().toLowerCase(),
    intentType,
    childNaturalKey: String(payload.childNaturalKey || childIntent.childNaturalKey || childIntent.intentKey || "").trim(),
    gridRegimeKey: String(payload.gridRegimeKey || payload.grid_regime_key || "").trim(),
    strategySignal: String(payload.strategySignal || "").trim(),
    symbol: normalizeSymbol(payload.symbol),
    timeframe: normalizeTimeframe(payload.timeframe || payload.bunbong),
    positionSide: String(payload.positionSide || payload.side || "").trim().toUpperCase(),
    orderRole,
    clientOrderId: payload.clientOrderId == null ? "" : String(payload.clientOrderId).trim(),
    orderId: payload.orderId == null ? "" : String(payload.orderId).trim(),
    reservationId: payload.reservationId == null ? "" : String(payload.reservationId).trim(),
    source: String(payload.source || childIntent.source || "").trim(),
  };
};

const validateGridExitCancelTargetAttribution = (target = {}) => {
  const errors = [];
  if (!Number.isFinite(Number(target.uid)) || Number(target.uid) <= 0) {
    errors.push("GRID_EXIT_CANCEL_UID_REQUIRED");
  }
  if (!Number.isFinite(Number(target.pid)) || Number(target.pid) <= 0) {
    errors.push("GRID_EXIT_CANCEL_PID_REQUIRED");
  }
  if (!target.gridRegimeKey) {
    errors.push("GRID_EXIT_CANCEL_GRID_REGIME_KEY_REQUIRED");
  }
  if (/CANDLE_CLOSE|LEGACY_CANDLE_CLOSE/i.test(`${target.gridRegimeKey}|${target.source}`)) {
    errors.push("GRID_EXIT_CANCEL_CANDLE_CLOSE_LEGACY_REJECTED");
  }
  if (!target.symbol) {
    errors.push("GRID_EXIT_CANCEL_SYMBOL_REQUIRED");
  }
  if (!target.positionSide || !["LONG", "SHORT"].includes(target.positionSide)) {
    errors.push("GRID_EXIT_CANCEL_POSITION_SIDE_REQUIRED");
  }
  if (!target.childNaturalKey) {
    errors.push("GRID_EXIT_CANCEL_CHILD_NATURAL_KEY_REQUIRED");
  }
  if (![
    INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL,
    INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL,
  ].includes(target.intentType)) {
    errors.push("GRID_EXIT_CANCEL_CHILD_INTENT_TYPE_REQUIRED");
  }

  const hasOrderIdentity = Boolean(target.clientOrderId || target.orderId);
  if (target.intentType === INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL) {
    if (target.orderRole !== "ENTRY") {
      errors.push("GRID_EXIT_ENTRY_CANCEL_ORDER_ROLE_REQUIRED");
    }
    if (!hasOrderIdentity) {
      errors.push("GRID_EXIT_ENTRY_CANCEL_ORDER_IDENTITY_REQUIRED");
    }
  }
  if (target.intentType === INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL) {
    if (!["TP", "STOP"].includes(target.orderRole)) {
      errors.push("GRID_EXIT_PROTECTION_CANCEL_ORDER_ROLE_REQUIRED");
    }
    if (!target.reservationId) {
      errors.push("GRID_EXIT_PROTECTION_CANCEL_RESERVATION_ID_REQUIRED");
    }
    if (!hasOrderIdentity) {
      errors.push("GRID_EXIT_PROTECTION_CANCEL_ORDER_IDENTITY_REQUIRED");
    }
  }
  return {
    ok: errors.length === 0,
    errors,
  };
};

const buildGridExitCancelRequestPreview = (target = {}) => ({
  type: "GRID_EXIT_CANCEL_DRY_RUN",
  uid: target.uid,
  pid: target.pid,
  symbol: target.symbol,
  positionSide: target.positionSide,
  orderRole: target.orderRole,
  clientOrderId: target.clientOrderId || null,
  orderId: target.orderId || null,
  reservationId: target.reservationId || null,
  gridRegimeKey: target.gridRegimeKey,
  strategySignal: target.strategySignal,
  sourceChildNaturalKey: target.childNaturalKey,
  executable: false,
  mockOnly: true,
  reduceOnly: false,
  marketClose: false,
  cancelAllBySymbol: false,
  cancelAllOpenOrders: false,
  cancelAllAlgoOrders: false,
});

const recordGridExitMockCancelRequest = (mockBinanceClient, request) => {
  if (!mockBinanceClient) {
    return false;
  }
  if (typeof mockBinanceClient.recordCancelRequest === "function") {
    mockBinanceClient.recordCancelRequest(request);
    return true;
  }
  if (Array.isArray(mockBinanceClient.requests)) {
    mockBinanceClient.requests.push(request);
    return true;
  }
  return false;
};

const envFlagEnabled = (value) => String(value || "0").trim() === "1";

const normalizeGridExitActualCancelFlags = ({ env = process.env, targetCount = 1 } = {}) => {
  const maxTargetsRaw = env.GRID_EXIT_ACTUAL_CANCEL_MAX_TARGETS ?? GRID_EXIT_ACTUAL_CANCEL_FLAG_DEFAULTS.maxTargets;
  const maxTargets = Number(maxTargetsRaw);
  const normalizedTargetCount = Number(targetCount || 0);
  const flags = {
    enabled: envFlagEnabled(env.GRID_EXIT_ACTUAL_CANCEL_ENABLED),
    hardConfirm: envFlagEnabled(env.GRID_EXIT_ACTUAL_CANCEL_HARD_CONFIRM),
    maxTargets: Number.isFinite(maxTargets) && maxTargets > 0
      ? Math.floor(maxTargets)
      : GRID_EXIT_ACTUAL_CANCEL_FLAG_DEFAULTS.maxTargets,
    targetCount: Number.isFinite(normalizedTargetCount) && normalizedTargetCount > 0
      ? Math.floor(normalizedTargetCount)
      : 1,
  };
  const errors = [];
  if (!flags.enabled) {
    errors.push("GRID_EXIT_ACTUAL_CANCEL_ENABLED_REQUIRED");
  }
  if (!flags.hardConfirm) {
    errors.push("GRID_EXIT_ACTUAL_CANCEL_HARD_CONFIRM_REQUIRED");
  }
  if (flags.maxTargets !== 1) {
    errors.push("GRID_EXIT_ACTUAL_CANCEL_MAX_TARGETS_MUST_BE_1");
  }
  if (flags.targetCount > flags.maxTargets) {
    errors.push("GRID_EXIT_ACTUAL_CANCEL_TARGET_COUNT_EXCEEDED");
  }
  return {
    ok: errors.length === 0,
    flags,
    errors,
    reason: errors.includes("GRID_EXIT_ACTUAL_CANCEL_TARGET_COUNT_EXCEEDED") ||
      errors.includes("GRID_EXIT_ACTUAL_CANCEL_MAX_TARGETS_MUST_BE_1")
      ? GRID_EXIT_CANCEL_EXECUTOR_STATE.MAX_TARGETS_EXCEEDED
      : GRID_EXIT_CANCEL_EXECUTOR_STATE.HARD_CONFIRM_REQUIRED,
  };
};

const GRID_EXIT_CANCEL_EXECUTOR_RACE_POLICY = Object.freeze({
  cancelAckTerminal: false,
  partiallyFilledTerminal: false,
  fillDuringCancelTerminal: false,
  fillDuringCancelRaceCandidate: true,
});

const classifyGridExitCancelExecutorObservation = (observation = {}) => {
  const status = String(observation.status || observation.orderStatus || "").trim().toUpperCase();
  const eventType = String(observation.eventType || observation.executionType || "").trim().toUpperCase();
  const fillDuringCancel = Boolean(observation.cancelRequested) &&
    (status === "PARTIALLY_FILLED" || status === "FILLED" || eventType === "TRADE");
  return {
    state: fillDuringCancel
      ? GRID_EXIT_CANCEL_EXECUTOR_STATE.BLOCKED_NOT_IMPLEMENTED
      : GRID_EXIT_CANCEL_EXECUTOR_STATE.DRY_RUN_READY,
    terminalSuccess: false,
    closeConverged: false,
    cancelAckTerminal: false,
    partiallyFilledTerminal: false,
    raceCandidate: fillDuringCancel,
  };
};

const buildGridExitCancelExecutorDryRun = ({
  childIntent = {},
  cancelCandidate = {},
  mode = "OFF",
  mockBinanceClient = null,
  env = process.env,
  targetCount = 1,
} = {}) => {
  const normalizedMode = normalizeGridExitCancelExecutorMode(mode);
  const forbidden = {
    dbInsert: false,
    dbUpdate: false,
    dbDelete: false,
    binanceWrite: false,
    actualCancel: false,
    actualClose: false,
    marketClose: false,
    cancelAllBySymbol: false,
    cancelAllOpenOrders: false,
    cancelAllAlgoOrders: false,
    terminalSuccess: false,
    success: false,
    converged: false,
  };

  if (!normalizedMode.ok) {
    return {
      ok: false,
      mode: normalizedMode.mode,
      requestedMode: normalizedMode.requestedMode,
      result: normalizedMode.reason,
      rejected: true,
      cancelRequest: null,
      mockCancelRecorded: false,
      forbidden,
    };
  }

  if (normalizedMode.mode === "OFF") {
    return {
      ok: true,
      mode: normalizedMode.mode,
      result: GRID_EXIT_CANCEL_EXECUTOR_STATE.DISABLED,
      cancelRequest: null,
      mockCancelRecorded: false,
      terminalSuccess: false,
      racePolicy: GRID_EXIT_CANCEL_EXECUTOR_RACE_POLICY,
      forbidden,
    };
  }

  const target = normalizeGridExitCancelTarget({ childIntent, cancelCandidate });
  const validation = validateGridExitCancelTargetAttribution(target);
  if (!validation.ok) {
    return {
      ok: false,
      mode: normalizedMode.mode,
      result: GRID_EXIT_CANCEL_EXECUTOR_STATE.BLOCKED_NOT_IMPLEMENTED,
      target,
      errors: validation.errors,
      cancelRequest: null,
      mockCancelRecorded: false,
      terminalSuccess: false,
      racePolicy: GRID_EXIT_CANCEL_EXECUTOR_RACE_POLICY,
      forbidden,
    };
  }

  const cancelRequest = buildGridExitCancelRequestPreview(target);
  if (normalizedMode.mode === GRID_EXIT_ACTUAL_CANCEL_MODE) {
    const flagState = normalizeGridExitActualCancelFlags({ env, targetCount });
    if (!flagState.ok) {
      return {
        ok: false,
        mode: normalizedMode.mode,
        requestedMode: normalizedMode.requestedMode,
        result: flagState.reason,
        target,
        errors: flagState.errors,
        flags: flagState.flags,
        cancelRequest,
        mockCancelRecorded: false,
        actualCancelReady: false,
        actualBinanceWrite: false,
        terminalSuccess: false,
        success: false,
        converged: false,
        closeConverged: false,
        verificationPending: true,
        racePolicy: GRID_EXIT_CANCEL_EXECUTOR_RACE_POLICY,
        forbidden,
      };
    }
    const mockCancelRecorded = recordGridExitMockCancelRequest(mockBinanceClient, {
      ...cancelRequest,
      type: "GRID_EXIT_ACTUAL_CANCEL_FAKE_CLIENT_REQUEST",
      executable: true,
      mockOnly: true,
      actualBinanceWrite: false,
      verificationPending: true,
    });
    return {
      ok: mockCancelRecorded,
      mode: normalizedMode.mode,
      result: mockCancelRecorded
        ? GRID_EXIT_CANCEL_EXECUTOR_STATE.ACTUAL_CANCEL_FAKE_RECORDED
        : GRID_EXIT_CANCEL_EXECUTOR_STATE.FAKE_CLIENT_REQUIRED,
      target,
      flags: flagState.flags,
      cancelRequest: {
        ...cancelRequest,
        executable: true,
        mockOnly: true,
        actualBinanceWrite: false,
        verificationPending: true,
      },
      mockCancelRecorded,
      actualCancelReady: mockCancelRecorded,
      actualBinanceWrite: false,
      terminalSuccess: false,
      success: false,
      converged: false,
      closeConverged: false,
      cancelAckTerminal: false,
      verificationPending: true,
      openOrdersVerificationPending: target.intentType === INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL,
      openAlgoOrdersVerificationPending: target.intentType === INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL,
      racePolicy: GRID_EXIT_CANCEL_EXECUTOR_RACE_POLICY,
      forbidden,
    };
  }
  const mockCancelRecorded = normalizedMode.mode === "MOCK_BINANCE_ONLY"
    ? recordGridExitMockCancelRequest(mockBinanceClient, cancelRequest)
    : false;
  return {
    ok: true,
    mode: normalizedMode.mode,
    result: normalizedMode.mode === "MOCK_BINANCE_ONLY"
      ? GRID_EXIT_CANCEL_EXECUTOR_STATE.MOCK_REQUEST_RECORDED
      : GRID_EXIT_CANCEL_EXECUTOR_STATE.DRY_RUN_READY,
    target,
    cancelRequest,
    mockCancelRecorded,
    terminalSuccess: false,
    success: false,
    converged: false,
    closeConverged: false,
    cancelAckTerminal: false,
    verificationPending: true,
    racePolicy: GRID_EXIT_CANCEL_EXECUTOR_RACE_POLICY,
    forbidden,
  };
};

const GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_ALLOWED_MODES = Object.freeze(["OFF", "DRY_RUN", "RUNTIME_DISABLED"]);
const GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_REJECTED_MODES = Object.freeze(["LIVE", "BINANCE_WRITE", "EXECUTE"]);
const GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_STATE = Object.freeze({
  DISABLED: "GRID_EXIT_RUNTIME_CANCEL_DISABLED",
  DRY_RUN_ONLY: "GRID_EXIT_RUNTIME_CANCEL_DRY_RUN_ONLY",
  RECORDED: "GRID_EXIT_RUNTIME_DISABLED_CANCEL_RECORDED",
  BLOCKED_NOT_EXECUTABLE: "GRID_EXIT_CHILD_CANCEL_WORKER_BLOCKED_NOT_EXECUTABLE",
  MODE_REJECTED: "GRID_EXIT_RUNTIME_CANCEL_MODE_REJECTED",
});

const normalizeGridExitRuntimeDisabledCancelMode = (mode = "OFF") => {
  const requestedMode = String(mode || "OFF").trim().toUpperCase();
  if (GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_ALLOWED_MODES.includes(requestedMode)) {
    return { ok: true, mode: requestedMode, requestedMode };
  }
  if (GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_REJECTED_MODES.includes(requestedMode)) {
    return {
      ok: false,
      mode: "OFF",
      requestedMode,
      reason: GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_STATE.MODE_REJECTED,
    };
  }
  return {
    ok: false,
    mode: "OFF",
    requestedMode,
    reason: GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_STATE.MODE_REJECTED,
  };
};

const buildGridExitRuntimeDisabledCancelEvent = (cancelRequest = {}, now = new Date()) => ({
  eventType: "GRID_EXIT_RUNTIME_DISABLED_CANCEL_REQUEST",
  uid: cancelRequest.uid,
  pid: cancelRequest.pid,
  symbol: cancelRequest.symbol,
  positionSide: cancelRequest.positionSide,
  orderRole: cancelRequest.orderRole,
  clientOrderId: cancelRequest.clientOrderId || null,
  orderId: cancelRequest.orderId || null,
  reservationId: cancelRequest.reservationId || null,
  gridRegimeKey: cancelRequest.gridRegimeKey,
  strategySignal: cancelRequest.strategySignal,
  sourceChildNaturalKey: cancelRequest.sourceChildNaturalKey,
  actualBinanceWrite: false,
  terminal: false,
  marketClose: false,
  reduceOnlyClose: false,
  cancelAllBySymbol: false,
  cancelAllOpenOrders: false,
  cancelAllOpenAlgoOrders: false,
  recordedAt: now instanceof Date ? now.toISOString() : String(now || ""),
});

const recordGridExitRuntimeDisabledCancelEvent = (mockCancelClient, event) => {
  if (!mockCancelClient) {
    return false;
  }
  if (typeof mockCancelClient.recordRuntimeDisabledCancelEvent === "function") {
    mockCancelClient.recordRuntimeDisabledCancelEvent(event);
    return true;
  }
  if (typeof mockCancelClient.recordCancelRequest === "function") {
    mockCancelClient.recordCancelRequest(event);
    return true;
  }
  if (Array.isArray(mockCancelClient.events)) {
    mockCancelClient.events.push(event);
    return true;
  }
  if (Array.isArray(mockCancelClient.requests)) {
    mockCancelClient.requests.push(event);
    return true;
  }
  return false;
};

const createGridExitRuntimeDisabledCancelAdapter = ({
  mode = "OFF",
  mockCancelClient = null,
  now = new Date(),
} = {}) => {
  const normalizedMode = normalizeGridExitRuntimeDisabledCancelMode(mode);
  const execute = ({ childIntent = {}, cancelCandidate = {} } = {}) => {
    if (!normalizedMode.ok) {
      return {
        ok: false,
        mode: normalizedMode.mode,
        requestedMode: normalizedMode.requestedMode,
        result: normalizedMode.reason,
        rejected: true,
        cancelEvent: null,
        actualBinanceWrite: false,
        terminal: false,
      };
    }
    if (normalizedMode.mode === "OFF") {
      return {
        ok: true,
        mode: normalizedMode.mode,
        result: GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_STATE.DISABLED,
        cancelEvent: null,
        actualBinanceWrite: false,
        terminal: false,
      };
    }

    const dryRun = buildGridExitCancelExecutorDryRun({
      childIntent,
      cancelCandidate,
      mode: "DRY_RUN",
    });
    if (!dryRun.ok || !dryRun.cancelRequest) {
      return {
        ...dryRun,
        mode: normalizedMode.mode,
        result: GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_STATE.BLOCKED_NOT_EXECUTABLE,
        cancelEvent: null,
        actualBinanceWrite: false,
        terminal: false,
      };
    }

    const cancelEvent = normalizedMode.mode === "RUNTIME_DISABLED"
      ? buildGridExitRuntimeDisabledCancelEvent(dryRun.cancelRequest, now)
      : null;
    const runtimeDisabledRecorded = normalizedMode.mode === "RUNTIME_DISABLED"
      ? recordGridExitRuntimeDisabledCancelEvent(mockCancelClient, cancelEvent)
      : false;
    return {
      ok: true,
      mode: normalizedMode.mode,
      result: normalizedMode.mode === "RUNTIME_DISABLED"
        ? GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_STATE.RECORDED
        : GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_STATE.DRY_RUN_ONLY,
      cancelRequestPreview: dryRun.cancelRequest,
      cancelEvent,
      runtimeDisabledRecorded,
      actualBinanceWrite: false,
      terminal: false,
      terminalSuccess: false,
      closeConverged: false,
      racePolicy: GRID_EXIT_CANCEL_EXECUTOR_RACE_POLICY,
    };
  };
  return {
    mode: normalizedMode.mode,
    requestedMode: normalizedMode.requestedMode,
    ok: normalizedMode.ok,
    cancel: execute,
    execute,
  };
};

const GRID_EXIT_MARKET_CLOSE_PLAN_STATE = Object.freeze({
  PLAN_READY: "GRID_EXIT_MARKET_CLOSE_PLAN_READY",
  BLOCKED_PROTECTION_CANCEL_PENDING: "GRID_EXIT_MARKET_CLOSE_BLOCKED_PROTECTION_CANCEL_PENDING",
  BLOCKED_EXPOSURE_MISMATCH: "GRID_EXIT_MARKET_CLOSE_BLOCKED_EXPOSURE_MISMATCH",
  NOT_REQUIRED_NO_REMAINING_EXPOSURE: "GRID_EXIT_MARKET_CLOSE_NOT_REQUIRED_NO_REMAINING_EXPOSURE",
});

const GRID_EXIT_MARKET_CLOSE_PLAN_ALLOWED_MODES = Object.freeze(["OFF", "DRY_RUN", "PLAN_ONLY"]);
const GRID_EXIT_MARKET_CLOSE_PLAN_REJECTED_MODES = Object.freeze(["LIVE", "BINANCE_WRITE", "EXECUTE", "MARKET_CLOSE"]);

const normalizeGridExitMarketClosePlanMode = (mode = "OFF") => {
  const requestedMode = String(mode || "OFF").trim().toUpperCase();
  if (GRID_EXIT_MARKET_CLOSE_PLAN_ALLOWED_MODES.includes(requestedMode)) {
    return { ok: true, mode: requestedMode, requestedMode };
  }
  if (GRID_EXIT_MARKET_CLOSE_PLAN_REJECTED_MODES.includes(requestedMode)) {
    return {
      ok: false,
      mode: "OFF",
      requestedMode,
      reason: "GRID_EXIT_MARKET_CLOSE_PLAN_MODE_REJECTED",
    };
  }
  return {
    ok: false,
    mode: "OFF",
    requestedMode,
    reason: "GRID_EXIT_MARKET_CLOSE_PLAN_MODE_REJECTED",
  };
};

const toGridExitNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const roundGridExitQty = (value) => {
  const numeric = toGridExitNumber(value, 0);
  return Math.max(0, Number(numeric.toFixed(12)));
};

const normalizeGridExitSnapshotRows = (value) => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value.filter(Boolean) : [value];
};

const isGridExitNonTerminalState = (value) => {
  const state = String(value || "").trim().toUpperCase();
  if (!state) {
    return true;
  }
  return ![
    "DONE",
    "SUCCESS",
    "CLOSED",
    "CLOSE",
    "FILLED",
    "CANCELED",
    "CANCELLED",
    "ENDED",
    "TERMINAL",
    "EXPIRED",
    "FAILED",
    "BLOCKED",
    "DISABLED",
    "INACTIVE",
  ].includes(state);
};

const matchesGridExitPidSymbolSide = (row = {}, context = {}) => {
  const rowPid = Number(row.pid || row.playId || row.livePlayId || 0);
  const contextPid = Number(context.pid || 0);
  const rowSymbol = normalizeSymbol(row.symbol || row.s || "");
  const contextSymbol = normalizeSymbol(context.symbol || "");
  const rowSide = normalizeGridExitChildSide(row.positionSide || row.side || row.direction || "");
  const contextSide = normalizeGridExitChildSide(context.positionSide || context.side || "");
  return (
    (!contextPid || !rowPid || rowPid === contextPid) &&
    (!contextSymbol || !rowSymbol || rowSymbol === contextSymbol) &&
    (!contextSide || !rowSide || rowSide === contextSide)
  );
};

const sumGridExitOwnerOpenQty = (ownerSnapshot, context) => {
  const rows = normalizeGridExitSnapshotRows(ownerSnapshot)
    .filter((row) => matchesGridExitPidSymbolSide(row, context));
  return rows.reduce((sum, row) => {
    if (!isGridExitNonTerminalState(row.status || row.state)) {
      return sum;
    }
    const ownedQty = toGridExitNumber(row.ownedQty ?? row.openQty ?? row.qty, 0);
    return sum + Math.max(0, ownedQty);
  }, 0);
};

const sumGridExitSnapshotOpenQty = (positionSnapshot, context) => {
  const rows = normalizeGridExitSnapshotRows(positionSnapshot)
    .filter((row) => matchesGridExitPidSymbolSide(row, context));
  return rows.reduce((sum, row) => {
    if (!isGridExitNonTerminalState(row.status || row.state || row.snapshotState)) {
      return sum;
    }
    const openQty = toGridExitNumber(row.openQty ?? row.positionQty ?? row.qty, 0);
    return sum + Math.max(0, openQty);
  }, 0);
};

const sumGridExitReservationRemainingQty = (reservationSnapshot, context) => {
  const rows = normalizeGridExitSnapshotRows(reservationSnapshot)
    .filter((row) => matchesGridExitPidSymbolSide(row, context));
  return rows.reduce((sum, row) => {
    const state = String(row.status || row.state || "").trim().toUpperCase();
    if (state !== "ACTIVE") {
      return sum;
    }
    const remaining = toGridExitNumber(
      row.remainingQty ?? row.reservedCloseQty ?? row.qty ?? row.openQty,
      0
    );
    return sum + Math.max(0, remaining);
  }, 0);
};

const sumGridExitRaceAppliedQty = (raceObservations = [], context = {}) =>
  normalizeGridExitSnapshotRows(raceObservations)
    .filter((row) => matchesGridExitPidSymbolSide(row, context))
    .reduce((sum, row) => {
      const status = String(row.status || row.orderStatus || "").trim().toUpperCase();
      const eventType = String(row.eventType || row.executionType || "").trim().toUpperCase();
      const raceLike = row.cancelRequested === true ||
        row.raceCandidate === true ||
        row.raceType ||
        status === "PARTIALLY_FILLED" ||
        status === "FILLED" ||
        eventType === "TRADE";
      if (!raceLike) {
        return sum;
      }
      const qty = toGridExitNumber(row.executedQty ?? row.fillQty ?? row.qty ?? row.appliedQty, 0);
      return sum + Math.max(0, qty);
    }, 0);

const resolveGridExitAggregateExchangeQty = (exchangeAggregateSnapshot = null, context = {}) => {
  if (!exchangeAggregateSnapshot) {
    return null;
  }
  const rows = normalizeGridExitSnapshotRows(exchangeAggregateSnapshot)
    .filter((row) => matchesGridExitPidSymbolSide(row, context));
  if (rows.length === 0 && !Array.isArray(exchangeAggregateSnapshot)) {
    return roundGridExitQty(
      toGridExitNumber(
        exchangeAggregateSnapshot.positionAmt ??
          exchangeAggregateSnapshot.positionQty ??
          exchangeAggregateSnapshot.openQty ??
          exchangeAggregateSnapshot.qty,
        0
      )
    );
  }
  const total = rows.reduce((sum, row) => {
    const qty = toGridExitNumber(row.positionAmt ?? row.positionQty ?? row.openQty ?? row.qty, 0);
    return sum + Math.abs(qty);
  }, 0);
  return roundGridExitQty(total);
};

const hasGridExitZeroQtyNonTerminalResidue = (ownerSnapshot, context = {}) =>
  normalizeGridExitSnapshotRows(ownerSnapshot)
    .filter((row) => matchesGridExitPidSymbolSide(row, context))
    .some((row) => {
      const ownedQty = toGridExitNumber(row.ownedQty ?? row.openQty ?? row.qty, 0);
      const reservedCloseQty = toGridExitNumber(row.reservedCloseQty, 0);
      return ownedQty === 0 && reservedCloseQty === 0 && isGridExitNonTerminalState(row.status || row.state);
    });

const resolveGridExitRemainingExposureContext = (parentCandidate = {}) => {
  const payload = parentCandidate.payload || parentCandidate.payloadJson || parentCandidate;
  const context = resolveGridExitParentContext(parentCandidate, {});
  const uid = Number(parentCandidate.uid || payload.uid || context.uid || 0);
  const pid = Number(parentCandidate.pid || payload.pid || context.pid || 0);
  const symbol = normalizeSymbol(parentCandidate.symbol || payload.symbol || context.symbol || "");
  const timeframe = normalizeTimeframe(parentCandidate.timeframe || payload.timeframe || context.timeframe || "");
  const gridRegimeKey = String(parentCandidate.gridRegimeKey || payload.gridRegimeKey || context.gridRegimeKey || "").trim();
  const parentNaturalKey = String(
    parentCandidate.parentNaturalKey ||
    payload.parentNaturalKey ||
    parentCandidate.intentKey ||
    payload.intentKey ||
    context.parentNaturalKey ||
    [
      INTENT_TYPE.GRID_EXIT_REQUEST,
      uid,
      pid,
      symbol,
      timeframe,
      gridRegimeKey,
    ].join(":")
  ).trim();
  return {
    uid,
    pid,
    symbol,
    timeframe,
    positionSide: normalizeGridExitChildSide(
      parentCandidate.positionSide || payload.positionSide || payload.side || context.positionSide || context.side
    ),
    gridRegimeKey,
    strategySignal: String(parentCandidate.strategySignal || payload.strategySignal || context.strategySignal || "").trim(),
    parentNaturalKey,
    enabled: parentCandidate.enabled ?? payload.enabled,
    status: parentCandidate.status || payload.status || parentCandidate.parentState || payload.parentState || "",
  };
};

const isGridExitDisabledTarget = (context = {}) => {
  const enabled = String(context.enabled ?? "").trim().toUpperCase();
  if (["N", "NO", "FALSE", "0", "DISABLED"].includes(enabled)) {
    return true;
  }
  const status = String(context.status || "").trim().toUpperCase();
  return ["ENDED", "CLOSED", "TERMINAL", "DISABLED", "INACTIVE"].includes(status);
};

const scanGridExitRemainingPidExposure = ({
  parentCandidate = {},
  childCancelPlan = {},
  raceObservations = [],
  ownerSnapshot,
  positionSnapshot,
  reservationSnapshot,
  exchangeAggregateSnapshot = null,
} = {}) => {
  const context = resolveGridExitRemainingExposureContext(parentCandidate);
  const audit = [
    "PID_CLOSE_QTY_GUARD",
    "AGGREGATE_EXPOSURE_NOT_USED_FOR_CLOSE_QTY",
    "SAME_SYMBOL_SIDE_OTHER_PID_UNTOUCHED",
  ];
  const blockers = [];
  const userActionRequired = [];

  if (!context.gridRegimeKey) {
    blockers.push("GRID_EXIT_MARKET_CLOSE_BLOCKED_KEYLESS_REGIME");
    userActionRequired.push("GRID_EXIT_KEYLESS_REGIME_USER_ACTION_REQUIRED");
  }
  if (isGridExitDisabledTarget(context)) {
    blockers.push("GRID_EXIT_MARKET_CLOSE_BLOCKED_TERMINAL_OR_DISABLED_TARGET");
    userActionRequired.push("GRID_EXIT_TERMINAL_OR_DISABLED_TARGET_USER_ACTION_REQUIRED");
  }

  const pidOwnedOpenQty = roundGridExitQty(sumGridExitOwnerOpenQty(ownerSnapshot, context));
  const snapshotOpenQty = roundGridExitQty(sumGridExitSnapshotOpenQty(positionSnapshot, context));
  const reservationRemainingQty = roundGridExitQty(sumGridExitReservationRemainingQty(reservationSnapshot, context));
  const raceAppliedQty = roundGridExitQty(sumGridExitRaceAppliedQty(raceObservations, context));
  const remainingPidOwnedQty = roundGridExitQty(Math.max(0, pidOwnedOpenQty - raceAppliedQty));
  const aggregateExchangeQty = resolveGridExitAggregateExchangeQty(exchangeAggregateSnapshot, context);

  const ownerProvided = normalizeGridExitSnapshotRows(ownerSnapshot).length > 0;
  const snapshotProvided = normalizeGridExitSnapshotRows(positionSnapshot).length > 0;
  if (ownerProvided && snapshotProvided && Math.abs(pidOwnedOpenQty - snapshotOpenQty) > 0.00000001) {
    blockers.push("GRID_EXIT_MARKET_CLOSE_BLOCKED_OWNER_SNAPSHOT_MISMATCH");
    userActionRequired.push("GRID_EXIT_OWNER_SNAPSHOT_MISMATCH_USER_ACTION_REQUIRED");
  }
  if (reservationRemainingQty > 0) {
    blockers.push("GRID_EXIT_MARKET_CLOSE_BLOCKED_PROTECTION_CANCEL_PENDING");
    userActionRequired.push("GRID_EXIT_ACTIVE_PROTECTION_CANCEL_REQUIRED");
  }
  if (raceAppliedQty > 0) {
    audit.push("GRID_EXIT_RACE_FILL_REDUCED_REMAINING_QTY_PLAN_ONLY");
    userActionRequired.push("GRID_EXIT_RACE_REST_RECOVERY_REQUIRED");
  }
  if (aggregateExchangeQty !== null && aggregateExchangeQty < remainingPidOwnedQty) {
    blockers.push("GRID_EXIT_MARKET_CLOSE_BLOCKED_EXCHANGE_AGGREGATE_BELOW_PID_QTY");
    userActionRequired.push("GRID_EXIT_EXCHANGE_AGGREGATE_MISMATCH_REVIEW_REQUIRED");
  }
  if (aggregateExchangeQty !== null && aggregateExchangeQty !== remainingPidOwnedQty) {
    audit.push("GRID_EXIT_AGGREGATE_EXCHANGE_QTY_MISMATCH_AUDIT_ONLY");
  }
  if (hasGridExitZeroQtyNonTerminalResidue(ownerSnapshot, context)) {
    audit.push("GRID_EXIT_ZERO_QTY_NONTERMINAL_RESIDUE_AUDIT_ONLY");
  }
  if (childCancelPlan?.blocked === true || childCancelPlan?.pendingProtectionCancel === true) {
    blockers.push("GRID_EXIT_MARKET_CLOSE_BLOCKED_CHILD_CANCEL_PLAN_UNRESOLVED");
  }

  return {
    uid: context.uid,
    pid: context.pid,
    symbol: context.symbol,
    positionSide: context.positionSide,
    gridRegimeKey: context.gridRegimeKey,
    strategySignal: context.strategySignal,
    parentNaturalKey: context.parentNaturalKey,
    sourcePlanKey: [
      GRID_EXIT_MARKET_CLOSE_PLAN_TYPE,
      context.parentNaturalKey,
      context.uid,
      context.pid,
      context.symbol,
      context.positionSide,
      context.gridRegimeKey,
    ].join(":"),
    pidOwnedOpenQty,
    snapshotOpenQty,
    reservationRemainingQty,
    raceAppliedQty,
    remainingPidOwnedQty,
    aggregateExchangeQty,
    aggregateUsedForClose: false,
    closeRequired: remainingPidOwnedQty > 0 && !blockers.includes("GRID_EXIT_MARKET_CLOSE_BLOCKED_KEYLESS_REGIME") &&
      !blockers.includes("GRID_EXIT_MARKET_CLOSE_BLOCKED_TERMINAL_OR_DISABLED_TARGET"),
    userActionRequired: [...new Set(userActionRequired)],
    blockers: [...new Set(blockers)],
    audit: [...new Set(audit)],
  };
};

const buildGridExitMarketCloseCandidate = (scan = {}, state) => ({
  type: GRID_EXIT_MARKET_CLOSE_PLAN_TYPE,
  state,
  uid: scan.uid,
  pid: scan.pid,
  symbol: scan.symbol,
  positionSide: scan.positionSide,
  remainingPidOwnedQty: roundGridExitQty(scan.remainingPidOwnedQty),
  closeQty: roundGridExitQty(scan.remainingPidOwnedQty),
  maxAllowedQty: roundGridExitQty(scan.pidOwnedOpenQty),
  source: "PID_OWNED_REMAINING_QTY",
  gridRegimeKey: scan.gridRegimeKey,
  strategySignal: scan.strategySignal,
  sourcePlanKey: scan.sourcePlanKey,
  parentNaturalKey: scan.parentNaturalKey,
  executable: false,
  blocker: scan.blockers?.[0] || null,
  blockers: scan.blockers || [],
  audit: scan.audit || [],
  recoveryRequired: Array.isArray(scan.userActionRequired) &&
    scan.userActionRequired.includes("GRID_EXIT_RACE_REST_RECOVERY_REQUIRED"),
});

const resolveGridExitMarketClosePlanState = (scan = {}) => {
  if (roundGridExitQty(scan.remainingPidOwnedQty) <= 0) {
    return GRID_EXIT_MARKET_CLOSE_PLAN_STATE.NOT_REQUIRED_NO_REMAINING_EXPOSURE;
  }
  if ((scan.blockers || []).includes("GRID_EXIT_MARKET_CLOSE_BLOCKED_PROTECTION_CANCEL_PENDING")) {
    return GRID_EXIT_MARKET_CLOSE_PLAN_STATE.BLOCKED_PROTECTION_CANCEL_PENDING;
  }
  if ((scan.blockers || []).length > 0) {
    return GRID_EXIT_MARKET_CLOSE_PLAN_STATE.BLOCKED_EXPOSURE_MISMATCH;
  }
  return GRID_EXIT_MARKET_CLOSE_PLAN_STATE.PLAN_READY;
};

const buildGridExitMarketClosePlan = ({
  remainingExposureScan,
  mode = "OFF",
} = {}) => {
  const normalizedMode = normalizeGridExitMarketClosePlanMode(mode);
  const forbidden = {
    binanceWrite: false,
    marketCloseSubmit: false,
    aggregateClose: false,
    dbMutation: false,
    ledgerMutation: false,
    reduceOnlyClose: false,
  };
  const base = {
    ok: normalizedMode.ok,
    mode: normalizedMode.mode,
    requestedMode: normalizedMode.requestedMode,
    marketCloseCandidates: [],
    previewCandidates: [],
    forbidden,
    terminalSuccess: false,
    closeConverged: false,
  };

  if (!normalizedMode.ok) {
    return {
      ...base,
      rejected: true,
      reason: normalizedMode.reason,
    };
  }
  if (normalizedMode.mode === "OFF") {
    return {
      ...base,
      state: "GRID_EXIT_MARKET_CLOSE_PLAN_OFF",
      reason: "GRID_EXIT_MARKET_CLOSE_PLAN_DISABLED",
    };
  }

  const scan = remainingExposureScan || {};
  const state = resolveGridExitMarketClosePlanState(scan);
  if (state === GRID_EXIT_MARKET_CLOSE_PLAN_STATE.NOT_REQUIRED_NO_REMAINING_EXPOSURE) {
    return {
      ...base,
      state,
      remainingExposureScan: scan,
      reason: state,
    };
  }

  const candidate = buildGridExitMarketCloseCandidate(scan, state);
  if (candidate.closeQty > candidate.maxAllowedQty) {
    candidate.state = GRID_EXIT_MARKET_CLOSE_PLAN_STATE.BLOCKED_EXPOSURE_MISMATCH;
    candidate.blockers = [...new Set([...(candidate.blockers || []), "GRID_EXIT_MARKET_CLOSE_BLOCKED_OVER_CLOSE_GUARD"])];
    candidate.blocker = candidate.blocker || "GRID_EXIT_MARKET_CLOSE_BLOCKED_OVER_CLOSE_GUARD";
  }

  if (normalizedMode.mode === "DRY_RUN") {
    return {
      ...base,
      state: candidate.state,
      remainingExposureScan: scan,
      previewCandidates: [candidate],
      previewOnly: true,
      reason: candidate.state,
    };
  }

  return {
    ...base,
    state: candidate.state,
    remainingExposureScan: scan,
    marketCloseCandidates: [candidate],
    previewOnly: false,
    reason: candidate.state,
  };
};

const GRID_EXIT_ACTUAL_MARKET_CLOSE_MODE = "ACTUAL_MARKET_CLOSE";
const GRID_EXIT_MARKET_CLOSE_EXECUTOR_ALLOWED_MODES = Object.freeze(["OFF", "DRY_RUN", "MOCK_BINANCE_ONLY", GRID_EXIT_ACTUAL_MARKET_CLOSE_MODE]);
const GRID_EXIT_MARKET_CLOSE_EXECUTOR_REJECTED_MODES = Object.freeze(["LIVE", "BINANCE_WRITE", "EXECUTE", "MARKET_CLOSE"]);
const GRID_EXIT_ACTUAL_MARKET_CLOSE_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  hardConfirm: false,
  maxTargets: 1,
  fakeClientOnly: true,
});
const GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE = Object.freeze({
  DISABLED: "GRID_EXIT_MARKET_CLOSE_EXECUTOR_DISABLED",
  DRY_RUN_READY: "GRID_EXIT_MARKET_CLOSE_DRY_RUN_READY",
  MOCK_REQUEST_RECORDED: "GRID_EXIT_MARKET_CLOSE_MOCK_REQUEST_RECORDED",
  ACTUAL_MARKET_CLOSE_READY: "GRID_EXIT_ACTUAL_MARKET_CLOSE_READY",
  ACTUAL_MARKET_CLOSE_FAKE_RECORDED: "GRID_EXIT_ACTUAL_MARKET_CLOSE_FAKE_CLIENT_RECORDED",
  BLOCKED_NOT_EXECUTABLE: "GRID_EXIT_MARKET_CLOSE_EXECUTOR_BLOCKED_NOT_EXECUTABLE",
  MODE_REJECTED: "GRID_EXIT_MARKET_CLOSE_EXECUTOR_MODE_REJECTED",
  HARD_CONFIRM_REQUIRED: "GRID_EXIT_ACTUAL_MARKET_CLOSE_HARD_CONFIRM_REQUIRED",
  MAX_TARGETS_EXCEEDED: "GRID_EXIT_ACTUAL_MARKET_CLOSE_MAX_TARGETS_EXCEEDED",
  FAKE_CLIENT_REQUIRED: "GRID_EXIT_ACTUAL_MARKET_CLOSE_FAKE_CLIENT_REQUIRED",
});

const GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION = Object.freeze({
  ACK_ONLY_NOT_TERMINAL: "CLOSE_ACK_ONLY_NOT_TERMINAL",
  PARTIAL_FILL_NOT_TERMINAL: "CLOSE_PARTIAL_FILL_NOT_TERMINAL",
  FILLED_FINAL_OBSERVED: "CLOSE_FILLED_FINAL_OBSERVED",
  SOCKET_MISSING_REST_RECOVERY_REQUIRED: "CLOSE_SOCKET_MISSING_REST_RECOVERY_REQUIRED",
  CANCELED_WITH_EXECUTED_QTY_REQUIRES_RECOVERY: "CLOSE_CANCELED_WITH_EXECUTED_QTY_REQUIRES_RECOVERY",
  CANCELED_WITH_ZERO_EXECUTED_QTY_FAILED_OR_BLOCKED: "CLOSE_CANCELED_WITH_ZERO_EXECUTED_QTY_FAILED_OR_BLOCKED",
  DUPLICATE_SOURCE_TRADE_ID_IGNORED: "DUPLICATE_SOURCE_TRADE_ID_IGNORED",
  NEW_SOURCE_TRADE_ID_APPLY_REQUIRED: "NEW_SOURCE_TRADE_ID_APPLY_REQUIRED",
  OVER_CLOSE_QTY_BLOCKED: "OVER_CLOSE_QTY_BLOCKED",
  WRONG_PID_OR_ATTRIBUTION_IGNORED: "WRONG_PID_OR_ATTRIBUTION_IGNORED",
});

const GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE = Object.freeze({
  FULL_READY: "GRID_EXIT_CLOSE_CONVERGENCE_MOCK_FULL_READY",
  PARTIAL_REMAINING: "GRID_EXIT_CLOSE_CONVERGENCE_MOCK_PARTIAL_REMAINING",
  REST_RECOVERY_REQUIRED: "GRID_EXIT_CLOSE_CONVERGENCE_MOCK_REST_RECOVERY_REQUIRED",
  BLOCKED_OVER_CLOSE: "GRID_EXIT_CLOSE_CONVERGENCE_MOCK_BLOCKED_OVER_CLOSE",
  BLOCKED_ATTRIBUTION: "GRID_EXIT_CLOSE_CONVERGENCE_MOCK_BLOCKED_ATTRIBUTION",
});

const GRID_EXIT_PARENT_MARKET_CLOSE_MOCK_STATE = Object.freeze({
  READY: "GRID_EXIT_PARENT_MARKET_CLOSE_MOCK_READY",
  PARTIAL_REMAINING: "GRID_EXIT_PARENT_MARKET_CLOSE_MOCK_PARTIAL_REMAINING",
  REST_RECOVERY_REQUIRED: "GRID_EXIT_PARENT_MARKET_CLOSE_MOCK_REST_RECOVERY_REQUIRED",
  BLOCKED: "GRID_EXIT_PARENT_MARKET_CLOSE_MOCK_BLOCKED",
});

const normalizeGridExitMarketCloseExecutorMode = (mode = "OFF") => {
  const requestedMode = String(mode || "OFF").trim().toUpperCase();
  if (GRID_EXIT_MARKET_CLOSE_EXECUTOR_ALLOWED_MODES.includes(requestedMode)) {
    return { ok: true, mode: requestedMode, requestedMode };
  }
  if (GRID_EXIT_MARKET_CLOSE_EXECUTOR_REJECTED_MODES.includes(requestedMode)) {
    return {
      ok: false,
      mode: "OFF",
      requestedMode,
      reason: GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.MODE_REJECTED,
    };
  }
  return {
    ok: false,
    mode: "OFF",
    requestedMode,
    reason: GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.MODE_REJECTED,
  };
};

const normalizeGridExitActualMarketCloseFlags = ({
  env = process.env,
  targetCount = 1,
} = {}) => {
  const maxTargetsRaw = env.GRID_EXIT_ACTUAL_MARKET_CLOSE_MAX_TARGETS ?? GRID_EXIT_ACTUAL_MARKET_CLOSE_FLAG_DEFAULTS.maxTargets;
  const maxTargets = Number(maxTargetsRaw);
  const fakeClientOnlyValue = env.GRID_EXIT_ACTUAL_MARKET_CLOSE_FAKE_CLIENT_ONLY;
  const fakeClientOnly = fakeClientOnlyValue === undefined
    ? GRID_EXIT_ACTUAL_MARKET_CLOSE_FLAG_DEFAULTS.fakeClientOnly
    : envFlagEnabled(fakeClientOnlyValue);
  const flags = {
    enabled: envFlagEnabled(env.GRID_EXIT_ACTUAL_MARKET_CLOSE_ENABLED),
    hardConfirm: envFlagEnabled(env.GRID_EXIT_ACTUAL_MARKET_CLOSE_HARD_CONFIRM),
    maxTargets: Number.isFinite(maxTargets)
      ? maxTargets
      : GRID_EXIT_ACTUAL_MARKET_CLOSE_FLAG_DEFAULTS.maxTargets,
    fakeClientOnly,
    targetCount: Number(targetCount || 0),
  };
  const errors = [];
  if (!flags.enabled) {
    errors.push("GRID_EXIT_ACTUAL_MARKET_CLOSE_ENABLED_REQUIRED");
  }
  if (!flags.hardConfirm) {
    errors.push("GRID_EXIT_ACTUAL_MARKET_CLOSE_HARD_CONFIRM_REQUIRED");
  }
  if (flags.maxTargets !== 1) {
    errors.push("GRID_EXIT_ACTUAL_MARKET_CLOSE_MAX_TARGETS_MUST_BE_1");
  }
  if (flags.targetCount > flags.maxTargets) {
    errors.push("GRID_EXIT_ACTUAL_MARKET_CLOSE_TARGET_COUNT_EXCEEDED");
  }
  if (!flags.fakeClientOnly) {
    errors.push("GRID_EXIT_ACTUAL_MARKET_CLOSE_FAKE_CLIENT_ONLY_REQUIRED");
  }
  return {
    ...flags,
    ok: errors.length === 0,
    errors,
    reason: errors.length === 0
      ? null
      : errors.includes("GRID_EXIT_ACTUAL_MARKET_CLOSE_TARGET_COUNT_EXCEEDED") ||
        errors.includes("GRID_EXIT_ACTUAL_MARKET_CLOSE_MAX_TARGETS_MUST_BE_1")
        ? GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.MAX_TARGETS_EXCEEDED
        : errors.includes("GRID_EXIT_ACTUAL_MARKET_CLOSE_HARD_CONFIRM_REQUIRED")
          ? GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.HARD_CONFIRM_REQUIRED
          : errors.includes("GRID_EXIT_ACTUAL_MARKET_CLOSE_FAKE_CLIENT_ONLY_REQUIRED")
            ? GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.FAKE_CLIENT_REQUIRED
            : GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.BLOCKED_NOT_EXECUTABLE,
  };
};

const resolveGridExitMarketCloseCandidate = (marketClosePlan = {}) => {
  const candidates = [
    ...(marketClosePlan.marketCloseCandidates || []),
    ...(marketClosePlan.previewCandidates || []),
  ];
  return candidates.find(Boolean) || null;
};

const validateGridExitMarketCloseTarget = (candidate = {}) => {
  const errors = [];
  const closeQty = roundGridExitQty(candidate.closeQty);
  const maxAllowedQty = roundGridExitQty(candidate.maxAllowedQty);
  const remainingPidOwnedQty = roundGridExitQty(candidate.remainingPidOwnedQty);
  const sourcePlanKey = String(candidate.sourcePlanKey || "").trim();
  const parentNaturalKey = String(candidate.parentNaturalKey || "").trim();
  if (!Number(candidate.uid || 0)) {
    errors.push("GRID_EXIT_MARKET_CLOSE_UID_REQUIRED");
  }
  if (!Number(candidate.pid || 0)) {
    errors.push("GRID_EXIT_MARKET_CLOSE_PID_REQUIRED");
  }
  if (!normalizeSymbol(candidate.symbol)) {
    errors.push("GRID_EXIT_MARKET_CLOSE_SYMBOL_REQUIRED");
  }
  if (!normalizeGridExitChildSide(candidate.positionSide)) {
    errors.push("GRID_EXIT_MARKET_CLOSE_POSITION_SIDE_REQUIRED");
  }
  if (!candidate.gridRegimeKey) {
    errors.push("GRID_EXIT_MARKET_CLOSE_GRID_REGIME_KEY_REQUIRED");
  }
  if (!sourcePlanKey) {
    errors.push("GRID_EXIT_MARKET_CLOSE_SOURCE_PLAN_KEY_REQUIRED");
  }
  if (!parentNaturalKey) {
    errors.push("GRID_EXIT_MARKET_CLOSE_PARENT_NATURAL_KEY_REQUIRED");
  }
  if (closeQty <= 0) {
    errors.push("GRID_EXIT_MARKET_CLOSE_QTY_REQUIRED");
  }
  if (remainingPidOwnedQty <= 0) {
    errors.push("GRID_EXIT_MARKET_CLOSE_REMAINING_PID_OWNED_QTY_REQUIRED");
  }
  if (maxAllowedQty <= 0) {
    errors.push("GRID_EXIT_MARKET_CLOSE_MAX_ALLOWED_QTY_REQUIRED");
  }
  if (remainingPidOwnedQty > 0 && closeQty > remainingPidOwnedQty) {
    errors.push("GRID_EXIT_MARKET_CLOSE_OVER_PID_OWNED_QTY_BLOCKED");
  }
  if (closeQty > maxAllowedQty) {
    errors.push("GRID_EXIT_MARKET_CLOSE_OVER_CLOSE_QTY_BLOCKED");
  }
  if (candidate.executable === true) {
    errors.push("GRID_EXIT_MARKET_CLOSE_EXECUTABLE_REQUEST_FORBIDDEN");
  }
  if (candidate.aggregateClose === true) {
    errors.push("GRID_EXIT_MARKET_CLOSE_AGGREGATE_CLOSE_FORBIDDEN");
  }
  if (candidate.closeAllBySymbol === true || candidate.closeAllPositionSide === true || candidate.closeAll === true) {
    errors.push("GRID_EXIT_MARKET_CLOSE_CLOSE_ALL_FORBIDDEN");
  }
  if (candidate.unscopedClose === true || candidate.reduceOnlyClose === true) {
    errors.push("GRID_EXIT_MARKET_CLOSE_UNSCOPED_REDUCE_ONLY_FORBIDDEN");
  }
  return {
    ok: errors.length === 0,
    errors,
    closeQty,
    maxAllowedQty,
    remainingPidOwnedQty,
    sourcePlanKey,
    parentNaturalKey,
  };
};

const buildGridExitMarketCloseRequestPreview = (candidate = {}, sourcePlanKey = "") => ({
  type: "GRID_EXIT_MARKET_CLOSE_DRY_RUN",
  uid: candidate.uid,
  pid: candidate.pid,
  symbol: normalizeSymbol(candidate.symbol),
  positionSide: normalizeGridExitChildSide(candidate.positionSide),
  remainingPidOwnedQty: roundGridExitQty(candidate.remainingPidOwnedQty),
  closeQty: roundGridExitQty(candidate.closeQty),
  maxAllowedQty: roundGridExitQty(candidate.maxAllowedQty),
  source: "PID_OWNED_REMAINING_QTY",
  gridRegimeKey: candidate.gridRegimeKey,
  strategySignal: candidate.strategySignal,
  sourcePlanKey: sourcePlanKey || candidate.sourcePlanKey || [
    GRID_EXIT_MARKET_CLOSE_PLAN_TYPE,
    candidate.uid,
    candidate.pid,
    normalizeSymbol(candidate.symbol),
    normalizeGridExitChildSide(candidate.positionSide),
    candidate.gridRegimeKey,
  ].join(":"),
  parentNaturalKey: candidate.parentNaturalKey,
  executable: false,
  mockOnly: true,
  actualBinanceWrite: false,
  aggregateClose: false,
  closeAllBySymbol: false,
  closeAllPositionSide: false,
  reduceOnlyClose: false,
  unscopedClose: false,
});

const recordGridExitMockMarketCloseRequest = (mockCloseClient, request) => {
  if (!mockCloseClient) {
    return false;
  }
  if (typeof mockCloseClient.recordMarketCloseRequest === "function") {
    mockCloseClient.recordMarketCloseRequest(request);
    return true;
  }
  if (typeof mockCloseClient.recordCloseRequest === "function") {
    mockCloseClient.recordCloseRequest(request);
    return true;
  }
  if (Array.isArray(mockCloseClient.marketCloseRequests)) {
    mockCloseClient.marketCloseRequests.push(request);
    return true;
  }
  if (Array.isArray(mockCloseClient.requests)) {
    mockCloseClient.requests.push(request);
    return true;
  }
  return false;
};

const buildGridExitMarketCloseDryRun = ({
  marketClosePlan,
  mode = "OFF",
  mockCloseClient = null,
  env = process.env,
  targetCount = 1,
} = {}) => {
  const normalizedMode = normalizeGridExitMarketCloseExecutorMode(mode);
  const forbidden = {
    binanceWrite: false,
    marketCloseSubmit: false,
    aggregateClose: false,
    closeAllBySymbol: false,
    closeAllPositionSide: false,
    reduceOnlyClose: false,
    dbMutation: false,
    ledgerMutation: false,
  };
  if (!normalizedMode.ok) {
    return {
      ok: false,
      mode: normalizedMode.mode,
      requestedMode: normalizedMode.requestedMode,
      result: normalizedMode.reason,
      rejected: true,
      closeRequest: null,
      mockMarketCloseRecorded: false,
      terminalSuccess: false,
      closeConverged: false,
      forbidden,
    };
  }
  if (normalizedMode.mode === "OFF") {
    return {
      ok: true,
      mode: normalizedMode.mode,
      result: GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.DISABLED,
      closeRequest: null,
      mockMarketCloseRecorded: false,
      terminalSuccess: false,
      closeConverged: false,
      forbidden,
    };
  }

  const candidate = resolveGridExitMarketCloseCandidate(marketClosePlan);
  const validation = validateGridExitMarketCloseTarget(candidate || {});
  if (!candidate || !validation.ok) {
    return {
      ok: false,
      mode: normalizedMode.mode,
      result: GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.BLOCKED_NOT_EXECUTABLE,
      errors: validation.errors,
      closeRequest: null,
      mockMarketCloseRecorded: false,
      terminalSuccess: false,
      closeConverged: false,
      forbidden,
    };
  }
  if (normalizedMode.mode === GRID_EXIT_ACTUAL_MARKET_CLOSE_MODE) {
    const flags = normalizeGridExitActualMarketCloseFlags({ env, targetCount });
    if (!flags.ok) {
      return {
        ok: false,
        mode: normalizedMode.mode,
        result: flags.reason,
        errors: flags.errors,
        flags,
        closeRequest: null,
        mockMarketCloseRecorded: false,
        actualMarketCloseReady: false,
        actualMarketCloseFakeRecorded: false,
        terminalSuccess: false,
        closeConverged: false,
        forbidden,
      };
    }
    if (!mockCloseClient) {
      return {
        ok: false,
        mode: normalizedMode.mode,
        result: GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.FAKE_CLIENT_REQUIRED,
        errors: ["GRID_EXIT_ACTUAL_MARKET_CLOSE_FAKE_CLIENT_REQUIRED"],
        flags,
        closeRequest: null,
        mockMarketCloseRecorded: false,
        actualMarketCloseReady: false,
        actualMarketCloseFakeRecorded: false,
        terminalSuccess: false,
        closeConverged: false,
        forbidden,
      };
    }
    const closeRequest = {
      ...buildGridExitMarketCloseRequestPreview(
        candidate,
        marketClosePlan?.sourcePlanKey || marketClosePlan?.intentKey || marketClosePlan?.planKey
      ),
      type: "GRID_EXIT_ACTUAL_MARKET_CLOSE_FAKE_CLIENT_REQUEST",
    };
    const mockMarketCloseRecorded = recordGridExitMockMarketCloseRequest(mockCloseClient, closeRequest);
    return {
      ok: mockMarketCloseRecorded,
      mode: normalizedMode.mode,
      result: mockMarketCloseRecorded
        ? GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.ACTUAL_MARKET_CLOSE_FAKE_RECORDED
        : GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.FAKE_CLIENT_REQUIRED,
      closeRequest,
      mockMarketCloseRecorded,
      actualMarketCloseReady: true,
      actualMarketCloseFakeRecorded: mockMarketCloseRecorded,
      actualBinanceWrite: false,
      marketCloseSubmit: false,
      verificationPending: true,
      restRecoveryPending: true,
      terminalSuccess: false,
      closeConverged: false,
      flags,
      forbidden,
    };
  }

  const closeRequest = buildGridExitMarketCloseRequestPreview(
    candidate,
    marketClosePlan?.sourcePlanKey || marketClosePlan?.intentKey || marketClosePlan?.planKey
  );
  const mockMarketCloseRecorded = normalizedMode.mode === "MOCK_BINANCE_ONLY"
    ? recordGridExitMockMarketCloseRequest(mockCloseClient, closeRequest)
    : false;
  return {
    ok: true,
    mode: normalizedMode.mode,
    result: normalizedMode.mode === "MOCK_BINANCE_ONLY"
      ? GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.MOCK_REQUEST_RECORDED
      : GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.DRY_RUN_READY,
    closeRequest,
    mockMarketCloseRecorded,
    terminalSuccess: false,
    closeConverged: false,
    forbidden,
  };
};

const resolveGridExitMarketClosePlanTarget = (marketClosePlan = {}) => {
  const candidate = resolveGridExitMarketCloseCandidate(marketClosePlan) || {};
  return {
    uid: Number(candidate.uid || 0),
    pid: Number(candidate.pid || 0),
    symbol: normalizeSymbol(candidate.symbol || ""),
    positionSide: normalizeGridExitChildSide(candidate.positionSide || ""),
    closeQty: roundGridExitQty(candidate.closeQty),
    maxAllowedQty: roundGridExitQty(candidate.maxAllowedQty || candidate.closeQty),
  };
};

const matchesGridExitMarketCloseObservationTarget = (target = {}, event = {}) => {
  const eventPid = Number(event.pid || event.playId || 0);
  const eventSymbol = normalizeSymbol(event.symbol || "");
  const eventSide = normalizeGridExitChildSide(event.positionSide || event.side || "");
  return (
    (!target.pid || !eventPid || target.pid === eventPid) &&
    (!target.symbol || !eventSymbol || target.symbol === eventSymbol) &&
    (!target.positionSide || !eventSide || target.positionSide === eventSide)
  );
};

const classifyGridExitMarketCloseObservation = ({
  marketClosePlan,
  observedEvent = {},
} = {}) => {
  const target = resolveGridExitMarketClosePlanTarget(marketClosePlan);
  const status = String(observedEvent.status || observedEvent.orderStatus || "").trim().toUpperCase();
  const eventType = String(observedEvent.eventType || observedEvent.executionType || "").trim().toUpperCase();
  const executedQty = roundGridExitQty(
    observedEvent.executedQty ?? observedEvent.cumulativeFilledQty ?? observedEvent.fillQty ?? observedEvent.qty
  );
  const sourceTradeId = observedEvent.sourceTradeId || observedEvent.tradeId || null;
  const seenSourceTradeIds = new Set(observedEvent.seenSourceTradeIds || observedEvent.appliedSourceTradeIds || []);

  if (!matchesGridExitMarketCloseObservationTarget(target, observedEvent)) {
    return {
      classification: GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.WRONG_PID_OR_ATTRIBUTION_IGNORED,
      terminal: false,
      recoveryRequired: false,
      ledgerMutation: false,
      sourceTradeId,
    };
  }
  if (executedQty > target.maxAllowedQty || executedQty > target.closeQty) {
    return {
      classification: GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.OVER_CLOSE_QTY_BLOCKED,
      terminal: false,
      recoveryRequired: false,
      ledgerMutation: false,
      sourceTradeId,
    };
  }
  if (sourceTradeId && seenSourceTradeIds.has(sourceTradeId)) {
    return {
      classification: GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.DUPLICATE_SOURCE_TRADE_ID_IGNORED,
      terminal: false,
      recoveryRequired: false,
      ledgerMutation: false,
      sourceTradeId,
    };
  }
  if (sourceTradeId && (status === "FILLED" || status === "PARTIALLY_FILLED" || eventType === "TRADE")) {
    return {
      classification: GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.NEW_SOURCE_TRADE_ID_APPLY_REQUIRED,
      terminal: false,
      recoveryRequired: false,
      ledgerMutation: false,
      sourceTradeId,
    };
  }
  if (observedEvent.socketMissing === true || observedEvent.restRecoveryRequired === true || !status && !eventType) {
    return {
      classification: GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.SOCKET_MISSING_REST_RECOVERY_REQUIRED,
      terminal: false,
      recoveryRequired: true,
      ledgerMutation: false,
      sourceTradeId,
    };
  }
  if (status === "CANCELED" || status === "CANCELLED" || eventType === "CANCELED" || eventType === "CANCELLED") {
    return {
      classification: executedQty > 0
        ? GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.CANCELED_WITH_EXECUTED_QTY_REQUIRES_RECOVERY
        : GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.CANCELED_WITH_ZERO_EXECUTED_QTY_FAILED_OR_BLOCKED,
      terminal: false,
      recoveryRequired: executedQty > 0,
      ledgerMutation: false,
      sourceTradeId,
    };
  }
  if (status === "PARTIALLY_FILLED") {
    return {
      classification: GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.PARTIAL_FILL_NOT_TERMINAL,
      terminal: false,
      recoveryRequired: false,
      ledgerMutation: false,
      sourceTradeId,
    };
  }
  if (status === "FILLED" || eventType === "TRADE") {
    return {
      classification: GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.FILLED_FINAL_OBSERVED,
      terminal: false,
      finalObserved: true,
      recoveryRequired: false,
      ledgerMutation: false,
      sourceTradeId,
    };
  }
  return {
    classification: GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.ACK_ONLY_NOT_TERMINAL,
    terminal: false,
    recoveryRequired: false,
    ledgerMutation: false,
    sourceTradeId,
  };
};

const normalizeGridExitConvergenceInitialState = (initialState = {}) => ({
  uid: Number(initialState.uid || 0),
  pid: Number(initialState.pid || 0),
  symbol: normalizeSymbol(initialState.symbol || ""),
  positionSide: normalizeGridExitChildSide(initialState.positionSide || ""),
  ownerOpenQty: roundGridExitQty(initialState.ownerOpenQty),
  snapshotOpenQty: roundGridExitQty(initialState.snapshotOpenQty),
  activeReservationQty: roundGridExitQty(initialState.activeReservationQty),
  ledgerRows: [...(initialState.ledgerRows || [])],
  reservations: [...(initialState.reservations || [])],
});

const simulateGridExitCloseConvergence = ({
  initialState,
  closeFillObservations = [],
  mode = "MOCK_ONLY",
} = {}) => {
  const normalizedMode = String(mode || "MOCK_ONLY").trim().toUpperCase();
  const state = normalizeGridExitConvergenceInitialState(initialState);
  const blockers = [];
  const audit = [];
  const seenSourceTradeIds = new Set((state.ledgerRows || []).map((row) => row.sourceTradeId).filter(Boolean));
  const mockLedgerRows = [];
  let appliedQty = 0;
  let recoveryRequired = false;

  if (normalizedMode !== "MOCK_ONLY") {
    blockers.push("GRID_EXIT_CLOSE_CONVERGENCE_MOCK_MODE_REQUIRED");
  }

  for (const observation of closeFillObservations || []) {
    const sourceTradeId = observation.sourceTradeId || observation.tradeId || null;
    const eventPid = Number(observation.pid || 0);
    const eventSymbol = normalizeSymbol(observation.symbol || state.symbol);
    const eventSide = normalizeGridExitChildSide(observation.positionSide || state.positionSide);
    if (
      (eventPid && state.pid && eventPid !== state.pid) ||
      (eventSymbol && state.symbol && eventSymbol !== state.symbol) ||
      (eventSide && state.positionSide && eventSide !== state.positionSide)
    ) {
      blockers.push("GRID_EXIT_CLOSE_CONVERGENCE_MOCK_BLOCKED_ATTRIBUTION");
      audit.push("GRID_EXIT_CLOSE_FILL_WRONG_PID_OR_ATTRIBUTION_IGNORED");
      continue;
    }
    const classification = classifyGridExitMarketCloseObservation({
      marketClosePlan: {
        marketCloseCandidates: [{
          uid: state.uid,
          pid: state.pid,
          symbol: state.symbol,
          positionSide: state.positionSide,
          closeQty: state.ownerOpenQty,
          maxAllowedQty: state.ownerOpenQty,
          gridRegimeKey: observation.gridRegimeKey || "MOCK_CONVERGENCE",
        }],
      },
      observedEvent: {
        ...observation,
        seenSourceTradeIds: [...seenSourceTradeIds],
      },
    });
    if (classification.recoveryRequired) {
      recoveryRequired = true;
      audit.push("GRID_EXIT_CLOSE_MOCK_REST_RECOVERY_REQUIRED");
      continue;
    }
    if (classification.classification === GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.DUPLICATE_SOURCE_TRADE_ID_IGNORED) {
      audit.push("GRID_EXIT_CLOSE_DUPLICATE_SOURCE_TRADE_ID_IGNORED");
      continue;
    }
    if (classification.classification === GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.OVER_CLOSE_QTY_BLOCKED) {
      blockers.push("GRID_EXIT_CLOSE_CONVERGENCE_MOCK_BLOCKED_OVER_CLOSE");
      continue;
    }
    if (![
      GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.NEW_SOURCE_TRADE_ID_APPLY_REQUIRED,
      GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.FILLED_FINAL_OBSERVED,
      GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.PARTIAL_FILL_NOT_TERMINAL,
    ].includes(classification.classification)) {
      continue;
    }
    const qty = roundGridExitQty(observation.executedQty ?? observation.fillQty ?? observation.qty);
    if (qty <= 0) {
      continue;
    }
    if (sourceTradeId) {
      seenSourceTradeIds.add(sourceTradeId);
    }
    appliedQty = roundGridExitQty(appliedQty + qty);
    mockLedgerRows.push({
      uid: state.uid,
      pid: state.pid,
      symbol: state.symbol,
      positionSide: state.positionSide,
      sourceTradeId,
      executedQty: qty,
      price: toGridExitNumber(observation.price ?? observation.avgPrice, 0),
      mockOnly: true,
      actualLedgerWrite: false,
    });
  }

  if (appliedQty > state.ownerOpenQty) {
    blockers.push("GRID_EXIT_CLOSE_CONVERGENCE_MOCK_BLOCKED_OVER_CLOSE");
  }

  const remainingQty = roundGridExitQty(Math.max(0, state.ownerOpenQty - Math.min(appliedQty, state.ownerOpenQty)));
  if (remainingQty > 0 && state.activeReservationQty > 0) {
    audit.push("GRID_EXIT_CLOSE_MOCK_PROTECTION_ADJUSTMENT_REQUIRED");
  }

  let convergenceState = GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.PARTIAL_REMAINING;
  if (blockers.includes("GRID_EXIT_CLOSE_CONVERGENCE_MOCK_BLOCKED_OVER_CLOSE")) {
    convergenceState = GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.BLOCKED_OVER_CLOSE;
  } else if (blockers.includes("GRID_EXIT_CLOSE_CONVERGENCE_MOCK_BLOCKED_ATTRIBUTION")) {
    convergenceState = GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.BLOCKED_ATTRIBUTION;
  } else if (recoveryRequired) {
    convergenceState = GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.REST_RECOVERY_REQUIRED;
  } else if (state.ownerOpenQty > 0 && remainingQty === 0) {
    convergenceState = GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.FULL_READY;
  }

  return {
    mockLedgerRows,
    mockOwnerState: {
      uid: state.uid,
      pid: state.pid,
      symbol: state.symbol,
      positionSide: state.positionSide,
      ownedQty: remainingQty,
      status: remainingQty === 0 && state.ownerOpenQty > 0 ? "MOCK_CLOSED" : "MOCK_OPEN_REMAINING",
      actualOwnerWrite: false,
    },
    mockSnapshotState: {
      uid: state.uid,
      pid: state.pid,
      symbol: state.symbol,
      positionSide: state.positionSide,
      openQty: remainingQty,
      status: remainingQty === 0 && state.snapshotOpenQty > 0 ? "MOCK_CLOSED" : "MOCK_OPEN_REMAINING",
      actualSnapshotWrite: false,
    },
    mockReservationState: {
      uid: state.uid,
      pid: state.pid,
      symbol: state.symbol,
      positionSide: state.positionSide,
      activeReservationQty: remainingQty === 0 ? 0 : state.activeReservationQty,
      status: remainingQty === 0 ? "MOCK_TERMINAL" : "MOCK_ADJUSTMENT_REQUIRED",
      actualReservationWrite: false,
    },
    convergenceState,
    remainingQty,
    terminal: false,
    terminalSuccess: false,
    closeConverged: false,
    blockers: [...new Set(blockers)],
    audit: [...new Set(audit)],
  };
};

const reduceGridExitParentMarketCloseMockState = ({ convergenceResult = {} } = {}) => {
  let result = GRID_EXIT_PARENT_MARKET_CLOSE_MOCK_STATE.BLOCKED;
  if (convergenceResult.convergenceState === GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.FULL_READY) {
    result = GRID_EXIT_PARENT_MARKET_CLOSE_MOCK_STATE.READY;
  } else if (convergenceResult.convergenceState === GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.PARTIAL_REMAINING) {
    result = GRID_EXIT_PARENT_MARKET_CLOSE_MOCK_STATE.PARTIAL_REMAINING;
  } else if (convergenceResult.convergenceState === GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.REST_RECOVERY_REQUIRED) {
    result = GRID_EXIT_PARENT_MARKET_CLOSE_MOCK_STATE.REST_RECOVERY_REQUIRED;
  }
  return {
    result,
    terminalSuccess: false,
    closeConverged: false,
  };
};

const GRID_EXIT_REST_RECOVERY_STATE = Object.freeze({
  FIXTURE_READY: "GRID_EXIT_REST_RECOVERY_FIXTURE_READY",
  SOCKET_MISSING_REQUIRED: "GRID_EXIT_REST_RECOVERY_SOCKET_MISSING_REQUIRED",
  HARD_CIRCUIT_BLOCKED: "GRID_EXIT_REST_RECOVERY_HARD_CIRCUIT_BLOCKED",
  COOLDOWN_BLOCKED: "GRID_EXIT_REST_RECOVERY_COOLDOWN_BLOCKED",
});

const GRID_EXIT_PARENT_JOIN_STATE = Object.freeze({
  WAITING_CANCEL: "GRID_EXIT_PARENT_WAITING_CHILD_CANCEL",
  WAITING_MARKET_CLOSE: "GRID_EXIT_PARENT_WAITING_MARKET_CLOSE",
  REST_RECOVERY_REQUIRED_NO_LIVE: "GRID_EXIT_PARENT_REST_RECOVERY_REQUIRED_NO_LIVE",
  CONVERGENCE_READY_NO_LIVE: "GRID_EXIT_CONVERGENCE_READY_NO_LIVE",
  CONVERGENCE_ROLLBACK_VERIFIED: "GRID_EXIT_CONVERGENCE_ROLLBACK_VERIFIED",
  CONVERGENCE_FAKE_REPOSITORY_VERIFIED: "GRID_EXIT_CONVERGENCE_FAKE_REPOSITORY_VERIFIED",
  BLOCKED: "GRID_EXIT_PARENT_JOIN_BLOCKED_NO_LIVE",
});

const normalizeGridExitRecoveryRows = (value) => Array.isArray(value)
  ? value.filter(Boolean)
  : value
    ? [value]
    : [];

const buildGridExitRestRecoveryPlan = ({
  marketClosePlan,
  allOrders = [],
  userTrades = [],
  maxAllOrders = 10,
  maxUserTrades = 20,
  circuitOpen = false,
  cooldown = false,
} = {}) => {
  const hardCircuit = circuitOpen === true;
  const cooldownActive = cooldown === true;
  const target = resolveGridExitMarketClosePlanTarget(marketClosePlan);
  const callBudget = {
    allOrdersLimit: Math.max(0, Number(maxAllOrders || 0)),
    userTradesLimit: Math.max(0, Number(maxUserTrades || 0)),
    actualCallCount: 0,
    actualRestCall: false,
    unboundedLoop: false,
  };
  if (hardCircuit || cooldownActive) {
    return {
      state: hardCircuit ? GRID_EXIT_REST_RECOVERY_STATE.HARD_CIRCUIT_BLOCKED : GRID_EXIT_REST_RECOVERY_STATE.COOLDOWN_BLOCKED,
      target,
      observations: [],
      classifications: [],
      callBudget,
      bounded: true,
      terminalSuccess: false,
      closeConverged: false,
    };
  }

  const boundedOrders = normalizeGridExitRecoveryRows(allOrders).slice(0, callBudget.allOrdersLimit);
  const boundedTrades = normalizeGridExitRecoveryRows(userTrades).slice(0, callBudget.userTradesLimit);
  const orderObservations = boundedOrders.map((row) => ({
    uid: row.uid ?? target.uid,
    pid: row.pid ?? target.pid,
    symbol: row.symbol ?? target.symbol,
    positionSide: row.positionSide ?? row.side ?? target.positionSide,
    orderStatus: row.status || row.orderStatus,
    eventType: row.eventType || row.executionType,
    executedQty: row.executedQty ?? row.cumulativeFilledQty ?? row.origQty ?? row.qty,
    orderId: row.orderId,
    clientOrderId: row.clientOrderId,
    socketMissing: row.socketMissing === true,
  }));
  const tradeObservations = boundedTrades.map((row) => ({
    uid: row.uid ?? target.uid,
    pid: row.pid ?? target.pid,
    symbol: row.symbol ?? target.symbol,
    positionSide: row.positionSide ?? row.side ?? target.positionSide,
    orderStatus: row.status || row.orderStatus || "FILLED",
    eventType: row.eventType || row.executionType || "TRADE",
    executedQty: row.executedQty ?? row.qty,
    orderId: row.orderId,
    clientOrderId: row.clientOrderId,
    sourceTradeId: row.sourceTradeId || row.tradeId || row.id,
    price: row.price,
  }));
  const observations = [...orderObservations, ...tradeObservations];
  const seenSourceTradeIds = new Set();
  const classifications = observations.map((observation) => {
    const result = classifyGridExitMarketCloseObservation({
      marketClosePlan,
      observedEvent: {
        ...observation,
        seenSourceTradeIds: [...seenSourceTradeIds],
      },
    });
    if (
      result.sourceTradeId &&
      result.classification === GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION.NEW_SOURCE_TRADE_ID_APPLY_REQUIRED
    ) {
      seenSourceTradeIds.add(result.sourceTradeId);
    }
    return result;
  });
  const recoveryRequired = classifications.some((item) => item.recoveryRequired === true);
  return {
    state: recoveryRequired
      ? GRID_EXIT_REST_RECOVERY_STATE.SOCKET_MISSING_REQUIRED
      : GRID_EXIT_REST_RECOVERY_STATE.FIXTURE_READY,
    target,
    observations,
    classifications,
    readCounts: {
      allOrders: boundedOrders.length,
      userTrades: boundedTrades.length,
    },
    callBudget,
    bounded: true,
    terminalSuccess: false,
    closeConverged: false,
  };
};

const buildGridExitParentCloseoutJoin = ({
  cancelResults = [],
  marketCloseResult = {},
  recoveryResult = {},
  convergenceResult = {},
  rollbackVerified = false,
  fakeRepositoryVerified = false,
} = {}) => {
  const cancelBlocked = normalizeGridExitRecoveryRows(cancelResults)
    .some((item) => item.blocked === true || item.result === GRID_EXIT_CANCEL_EXECUTOR_STATE.BLOCKED_NOT_EXECUTABLE);
  let state = GRID_EXIT_PARENT_JOIN_STATE.BLOCKED;
  if (cancelBlocked) {
    state = GRID_EXIT_PARENT_JOIN_STATE.WAITING_CANCEL;
  } else if (
    recoveryResult.state === GRID_EXIT_REST_RECOVERY_STATE.SOCKET_MISSING_REQUIRED ||
    convergenceResult.convergenceState === GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.REST_RECOVERY_REQUIRED
  ) {
    state = GRID_EXIT_PARENT_JOIN_STATE.REST_RECOVERY_REQUIRED_NO_LIVE;
  } else if (
    marketCloseResult.result === GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.DRY_RUN_READY ||
    marketCloseResult.result === GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.MOCK_REQUEST_RECORDED ||
    marketCloseResult.result === GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE.ACTUAL_MARKET_CLOSE_FAKE_RECORDED
  ) {
    state = GRID_EXIT_PARENT_JOIN_STATE.WAITING_MARKET_CLOSE;
  }
  if (convergenceResult.convergenceState === GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE.FULL_READY) {
    state = rollbackVerified
      ? GRID_EXIT_PARENT_JOIN_STATE.CONVERGENCE_ROLLBACK_VERIFIED
      : fakeRepositoryVerified
        ? GRID_EXIT_PARENT_JOIN_STATE.CONVERGENCE_FAKE_REPOSITORY_VERIFIED
        : GRID_EXIT_PARENT_JOIN_STATE.CONVERGENCE_READY_NO_LIVE;
  }
  return {
    state,
    terminal: false,
    terminalSuccess: false,
    closeConverged: false,
    productionStateCreated: false,
    done: false,
    success: false,
    marketCloseResult: marketCloseResult.result || null,
    recoveryState: recoveryResult.state || null,
    convergenceState: convergenceResult.convergenceState || null,
  };
};

const GRID_STOP_EMERGENCY_BACKSTOP_ALLOWED_MODES = Object.freeze(["OFF", "DRY_RUN", "MOCK_ONLY"]);
const GRID_STOP_EMERGENCY_BACKSTOP_REJECTED_MODES = Object.freeze(["LIVE", "BINANCE_WRITE", "EXECUTE", "PLACE_STOP"]);
const GRID_STOP_EMERGENCY_BACKSTOP_STATE = Object.freeze({
  DISABLED: "GRID_STOP_EMERGENCY_BACKSTOP_DISABLED",
  DRY_RUN_READY: "GRID_STOP_EMERGENCY_BACKSTOP_DRY_RUN_READY",
  MOCK_READY: "GRID_STOP_EMERGENCY_BACKSTOP_MOCK_READY",
  MODE_REJECTED: "GRID_STOP_EMERGENCY_BACKSTOP_MODE_REJECTED",
  RECOVERY_REQUIRED: "GRID_STOP_EMERGENCY_BACKSTOP_RECOVERY_REQUIRED",
});

const GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION = Object.freeze({
  FILL_CONFIRMED: "STOP_FILL_CONFIRMED",
  PARTIAL_FILL_NOT_TERMINAL: "STOP_PARTIAL_FILL_NOT_TERMINAL",
  FILL_DURING_GRID_EXIT_RACE: "STOP_FILL_DURING_GRID_EXIT_RACE",
  SOCKET_MISSING_REST_RECOVERY_REQUIRED: "STOP_SOCKET_MISSING_REST_RECOVERY_REQUIRED",
  CANCELED_WITH_EXECUTED_QTY_REQUIRES_RECOVERY: "STOP_CANCELED_WITH_EXECUTED_QTY_REQUIRES_RECOVERY",
  CANCELED_WITH_ZERO_EXECUTED_QTY_BLOCKED: "STOP_CANCELED_WITH_ZERO_EXECUTED_QTY_BLOCKED",
  DUPLICATE_SOURCE_TRADE_ID_IGNORED: "STOP_DUPLICATE_SOURCE_TRADE_ID_IGNORED",
  NEW_SOURCE_TRADE_ID_APPLY_REQUIRED: "STOP_NEW_SOURCE_TRADE_ID_APPLY_REQUIRED",
  WRONG_PID_OR_ATTRIBUTION_IGNORED: "STOP_WRONG_PID_OR_ATTRIBUTION_IGNORED",
  NOT_NORMAL_GRID_EXIT_SUCCESS: "STOP_NOT_NORMAL_GRID_EXIT_SUCCESS",
});

const GRID_STOP_EMERGENCY_MOCK_STATE = Object.freeze({
  FULL_READY: "GRID_STOP_EMERGENCY_MOCK_FULL_READY",
  PARTIAL_REMAINING: "GRID_STOP_EMERGENCY_MOCK_PARTIAL_REMAINING",
  REST_RECOVERY_REQUIRED: "GRID_STOP_EMERGENCY_MOCK_REST_RECOVERY_REQUIRED",
  SIBLING_USER_ACTION_REQUIRED: "GRID_STOP_EMERGENCY_MOCK_SIBLING_USER_ACTION_REQUIRED",
  BLOCKED_ATTRIBUTION: "GRID_STOP_EMERGENCY_MOCK_BLOCKED_ATTRIBUTION",
});

const normalizeGridStopEmergencyBackstopMode = (mode = "OFF") => {
  const requestedMode = String(mode || "OFF").trim().toUpperCase();
  if (GRID_STOP_EMERGENCY_BACKSTOP_ALLOWED_MODES.includes(requestedMode)) {
    return { ok: true, mode: requestedMode, requestedMode };
  }
  if (GRID_STOP_EMERGENCY_BACKSTOP_REJECTED_MODES.includes(requestedMode)) {
    return {
      ok: false,
      mode: "OFF",
      requestedMode,
      reason: GRID_STOP_EMERGENCY_BACKSTOP_STATE.MODE_REJECTED,
    };
  }
  return {
    ok: false,
    mode: "OFF",
    requestedMode,
    reason: GRID_STOP_EMERGENCY_BACKSTOP_STATE.MODE_REJECTED,
  };
};

const resolveGridStopEmergencyContext = (gridRegime = {}) => {
  const stoppedLeg = gridRegime.stoppedLeg || gridRegime.leg || {};
  return {
    uid: Number(gridRegime.uid || stoppedLeg.uid || 0),
    pid: Number(gridRegime.pid || stoppedLeg.pid || 0),
    symbol: normalizeSymbol(gridRegime.symbol || stoppedLeg.symbol || ""),
    positionSide: normalizeGridExitChildSide(gridRegime.positionSide || stoppedLeg.positionSide || stoppedLeg.side || ""),
    gridRegimeKey: String(gridRegime.gridRegimeKey || stoppedLeg.gridRegimeKey || "").trim(),
    strategySignal: String(gridRegime.strategySignal || stoppedLeg.strategySignal || "").trim(),
  };
};

const matchesGridStopEmergencyTarget = (context = {}, event = {}) => {
  const eventPid = Number(event.pid || event.playId || 0);
  const eventSymbol = normalizeSymbol(event.symbol || "");
  const eventSide = normalizeGridExitChildSide(event.positionSide || event.side || "");
  return (
    (!context.pid || !eventPid || context.pid === eventPid) &&
    (!context.symbol || !eventSymbol || context.symbol === eventSymbol) &&
    (!context.positionSide || !eventSide || context.positionSide === eventSide)
  );
};

const classifyGridStopEmergencyObservation = ({
  gridRegime = {},
  observedEvent = {},
} = {}) => {
  const context = resolveGridStopEmergencyContext(gridRegime);
  const status = String(observedEvent.status || observedEvent.orderStatus || "").trim().toUpperCase();
  const eventType = String(observedEvent.eventType || observedEvent.executionType || "").trim().toUpperCase();
  const executedQty = roundGridExitQty(
    observedEvent.executedQty ?? observedEvent.cumulativeFilledQty ?? observedEvent.fillQty ?? observedEvent.qty
  );
  const sourceTradeId = observedEvent.sourceTradeId || observedEvent.tradeId || null;
  const seenSourceTradeIds = new Set(observedEvent.seenSourceTradeIds || observedEvent.appliedSourceTradeIds || []);

  if (!matchesGridStopEmergencyTarget(context, observedEvent)) {
    return {
      classification: GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.WRONG_PID_OR_ATTRIBUTION_IGNORED,
      terminal: false,
      recoveryRequired: false,
      ledgerMutation: false,
      emergencyPath: true,
      normalGridExitSuccess: false,
      sourceTradeId,
    };
  }
  if (sourceTradeId && seenSourceTradeIds.has(sourceTradeId)) {
    return {
      classification: GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.DUPLICATE_SOURCE_TRADE_ID_IGNORED,
      terminal: false,
      recoveryRequired: false,
      ledgerMutation: false,
      emergencyPath: true,
      normalGridExitSuccess: false,
      sourceTradeId,
    };
  }
  if (observedEvent.socketMissing === true || observedEvent.restRecoveryRequired === true || (!status && !eventType)) {
    return {
      classification: GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.SOCKET_MISSING_REST_RECOVERY_REQUIRED,
      terminal: false,
      recoveryRequired: true,
      ledgerMutation: false,
      emergencyPath: true,
      normalGridExitSuccess: false,
      sourceTradeId,
    };
  }
  if (status === "CANCELED" || status === "CANCELLED" || eventType === "CANCELED" || eventType === "CANCELLED") {
    return {
      classification: executedQty > 0
        ? GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.CANCELED_WITH_EXECUTED_QTY_REQUIRES_RECOVERY
        : GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.CANCELED_WITH_ZERO_EXECUTED_QTY_BLOCKED,
      terminal: false,
      recoveryRequired: executedQty > 0,
      ledgerMutation: false,
      emergencyPath: true,
      normalGridExitSuccess: false,
      sourceTradeId,
    };
  }
  if (observedEvent.gridExitInProgress === true && (status === "FILLED" || eventType === "TRADE" || executedQty > 0)) {
    return {
      classification: GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.FILL_DURING_GRID_EXIT_RACE,
      terminal: false,
      recoveryRequired: true,
      ledgerMutation: false,
      emergencyPath: true,
      normalGridExitSuccess: false,
      sourceTradeId,
    };
  }
  if (sourceTradeId && (status === "FILLED" || status === "PARTIALLY_FILLED" || eventType === "TRADE")) {
    return {
      classification: GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.NEW_SOURCE_TRADE_ID_APPLY_REQUIRED,
      terminal: false,
      recoveryRequired: false,
      ledgerMutation: false,
      emergencyPath: true,
      normalGridExitSuccess: false,
      sourceTradeId,
    };
  }
  if (status === "PARTIALLY_FILLED") {
    return {
      classification: GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.PARTIAL_FILL_NOT_TERMINAL,
      terminal: false,
      recoveryRequired: false,
      ledgerMutation: false,
      emergencyPath: true,
      normalGridExitSuccess: false,
      sourceTradeId,
    };
  }
  if (status === "FILLED" || eventType === "TRADE") {
    return {
      classification: GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.FILL_CONFIRMED,
      terminal: false,
      recoveryRequired: false,
      ledgerMutation: false,
      emergencyPath: true,
      normalGridExitSuccess: false,
      sourceTradeId,
    };
  }
  return {
    classification: GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.NOT_NORMAL_GRID_EXIT_SUCCESS,
    terminal: false,
    recoveryRequired: false,
    ledgerMutation: false,
    emergencyPath: true,
    normalGridExitSuccess: false,
    sourceTradeId,
  };
};

const buildGridExitStopEmergencyBackstopPolicy = ({
  gridRegime = {},
  stopObservation = {},
  mode = "OFF",
} = {}) => {
  const normalizedMode = normalizeGridStopEmergencyBackstopMode(mode);
  const classification = classifyGridStopEmergencyObservation({
    gridRegime,
    observedEvent: stopObservation,
  });
  const forbidden = {
    binanceWrite: false,
    stopOrderPlacement: false,
    stopOrderModify: false,
    dbMutation: false,
    ledgerMutation: false,
    normalGridExitSuccess: false,
  };
  if (!normalizedMode.ok) {
    return {
      ok: false,
      mode: normalizedMode.mode,
      requestedMode: normalizedMode.requestedMode,
      result: normalizedMode.reason,
      rejected: true,
      classification,
      terminalSuccess: false,
      forbidden,
    };
  }
  if (normalizedMode.mode === "OFF") {
    return {
      ok: true,
      mode: normalizedMode.mode,
      result: GRID_STOP_EMERGENCY_BACKSTOP_STATE.DISABLED,
      classification,
      terminalSuccess: false,
      forbidden,
    };
  }
  return {
    ok: true,
    mode: normalizedMode.mode,
    result: classification.recoveryRequired
      ? GRID_STOP_EMERGENCY_BACKSTOP_STATE.RECOVERY_REQUIRED
      : normalizedMode.mode === "MOCK_ONLY"
        ? GRID_STOP_EMERGENCY_BACKSTOP_STATE.MOCK_READY
        : GRID_STOP_EMERGENCY_BACKSTOP_STATE.DRY_RUN_READY,
    classification,
    stopIsEmergencyBackstop: true,
    stopIsNormalGridExitSuccess: false,
    terminalSuccess: false,
    forbidden,
  };
};

const scanGridStopSiblingExposureMock = ({
  stoppedLeg = {},
  siblingLeg = {},
  ownerSnapshot,
  positionSnapshot,
  reservationSnapshot,
} = {}) => {
  const context = {
    uid: Number(siblingLeg.uid || stoppedLeg.uid || 0),
    pid: Number(siblingLeg.pid || stoppedLeg.pid || 0),
    symbol: normalizeSymbol(siblingLeg.symbol || stoppedLeg.symbol || ""),
    positionSide: normalizeGridExitChildSide(siblingLeg.positionSide || siblingLeg.side || ""),
  };
  const siblingOwnerQty = roundGridExitQty(sumGridExitOwnerOpenQty(ownerSnapshot, context));
  const siblingSnapshotQty = roundGridExitQty(sumGridExitSnapshotOpenQty(positionSnapshot, context));
  const siblingReservationQty = roundGridExitQty(sumGridExitReservationRemainingQty(reservationSnapshot, context));
  const audit = [
    "STOP_SIBLING_PID_OWNED_QTY_SCAN",
    "STOP_SIBLING_AGGREGATE_EXPOSURE_NOT_USED",
    "STOP_SIBLING_OTHER_PID_UNTOUCHED",
  ];
  if (siblingReservationQty > 0) {
    audit.push("STOP_SIBLING_PROTECTION_ACTIVE_AUDIT");
  }
  return {
    uid: context.uid,
    pid: context.pid,
    symbol: context.symbol,
    positionSide: context.positionSide,
    siblingOwnerQty,
    siblingSnapshotQty,
    siblingReservationQty,
    aggregateUsedForSiblingClose: false,
    siblingCloseCreated: false,
    userActionRequired: siblingOwnerQty > 0
      ? ["STOP_SIBLING_EXPOSURE_USER_ACTION_REQUIRED_OR_FUTURE_BOUNDED_CLOSE_PLAN"]
      : [],
    audit,
  };
};

const normalizeGridStopEmergencyInitialState = (initialState = {}) => ({
  uid: Number(initialState.uid || 0),
  pid: Number(initialState.pid || 0),
  symbol: normalizeSymbol(initialState.symbol || ""),
  positionSide: normalizeGridExitChildSide(initialState.positionSide || ""),
  ownerOpenQty: roundGridExitQty(initialState.ownerOpenQty),
  snapshotOpenQty: roundGridExitQty(initialState.snapshotOpenQty),
  activeReservationQty: roundGridExitQty(initialState.activeReservationQty),
  ledgerRows: [...(initialState.ledgerRows || [])],
});

const simulateGridStopEmergencyConvergenceMock = ({
  initialState,
  stopFillObservations = [],
  siblingExposureScan = null,
} = {}) => {
  const state = normalizeGridStopEmergencyInitialState(initialState);
  const gridRegime = {
    uid: state.uid,
    pid: state.pid,
    symbol: state.symbol,
    positionSide: state.positionSide,
    gridRegimeKey: initialState?.gridRegimeKey || "STOP_EMERGENCY_MOCK",
  };
  const seenSourceTradeIds = new Set((state.ledgerRows || []).map((row) => row.sourceTradeId).filter(Boolean));
  const mockLedgerRows = [];
  const blockers = [];
  const audit = [];
  let appliedQty = 0;
  let recoveryRequired = false;

  for (const observation of stopFillObservations || []) {
    const classification = classifyGridStopEmergencyObservation({
      gridRegime,
      observedEvent: {
        ...observation,
        seenSourceTradeIds: [...seenSourceTradeIds],
      },
    });
    if (classification.classification === GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.WRONG_PID_OR_ATTRIBUTION_IGNORED) {
      blockers.push("GRID_STOP_EMERGENCY_MOCK_BLOCKED_ATTRIBUTION");
      audit.push("STOP_EMERGENCY_WRONG_PID_OR_ATTRIBUTION_IGNORED");
      continue;
    }
    if (classification.recoveryRequired) {
      recoveryRequired = true;
      audit.push("STOP_EMERGENCY_REST_RECOVERY_REQUIRED");
    }
    if (classification.classification === GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.DUPLICATE_SOURCE_TRADE_ID_IGNORED) {
      audit.push("STOP_EMERGENCY_DUPLICATE_SOURCE_TRADE_ID_IGNORED");
      continue;
    }
    if (![
      GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.FILL_CONFIRMED,
      GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.PARTIAL_FILL_NOT_TERMINAL,
      GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.FILL_DURING_GRID_EXIT_RACE,
      GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION.NEW_SOURCE_TRADE_ID_APPLY_REQUIRED,
    ].includes(classification.classification)) {
      continue;
    }
    const qty = roundGridExitQty(observation.executedQty ?? observation.fillQty ?? observation.qty);
    if (qty <= 0) {
      continue;
    }
    const sourceTradeId = classification.sourceTradeId || observation.sourceTradeId || observation.tradeId || null;
    if (sourceTradeId) {
      seenSourceTradeIds.add(sourceTradeId);
    }
    appliedQty = roundGridExitQty(appliedQty + qty);
    mockLedgerRows.push({
      uid: state.uid,
      pid: state.pid,
      symbol: state.symbol,
      positionSide: state.positionSide,
      sourceTradeId,
      executedQty: qty,
      emergencyStop: true,
      normalGridExitSuccess: false,
      mockOnly: true,
      actualLedgerWrite: false,
    });
  }

  if (appliedQty > state.ownerOpenQty) {
    blockers.push("GRID_STOP_EMERGENCY_MOCK_BLOCKED_OVER_APPLIED_QTY");
  }
  const remainingQty = roundGridExitQty(Math.max(0, state.ownerOpenQty - Math.min(appliedQty, state.ownerOpenQty)));
  if (siblingExposureScan && (siblingExposureScan.siblingOwnerQty || 0) > 0) {
    audit.push("STOP_EMERGENCY_SIBLING_USER_ACTION_REQUIRED");
  }

  let convergenceState = GRID_STOP_EMERGENCY_MOCK_STATE.PARTIAL_REMAINING;
  if (blockers.includes("GRID_STOP_EMERGENCY_MOCK_BLOCKED_ATTRIBUTION")) {
    convergenceState = GRID_STOP_EMERGENCY_MOCK_STATE.BLOCKED_ATTRIBUTION;
  } else if (recoveryRequired) {
    convergenceState = GRID_STOP_EMERGENCY_MOCK_STATE.REST_RECOVERY_REQUIRED;
  } else if (siblingExposureScan && (siblingExposureScan.siblingOwnerQty || 0) > 0) {
    convergenceState = GRID_STOP_EMERGENCY_MOCK_STATE.SIBLING_USER_ACTION_REQUIRED;
  } else if (state.ownerOpenQty > 0 && remainingQty === 0) {
    convergenceState = GRID_STOP_EMERGENCY_MOCK_STATE.FULL_READY;
  }

  return {
    mockLedgerRows,
    mockOwnerState: {
      uid: state.uid,
      pid: state.pid,
      symbol: state.symbol,
      positionSide: state.positionSide,
      ownedQty: remainingQty,
      status: remainingQty === 0 && state.ownerOpenQty > 0 ? "MOCK_STOP_CLOSED" : "MOCK_STOP_OPEN_REMAINING",
      actualOwnerWrite: false,
    },
    mockSnapshotState: {
      uid: state.uid,
      pid: state.pid,
      symbol: state.symbol,
      positionSide: state.positionSide,
      openQty: remainingQty,
      status: remainingQty === 0 && state.snapshotOpenQty > 0 ? "MOCK_STOP_CLOSED" : "MOCK_STOP_OPEN_REMAINING",
      actualSnapshotWrite: false,
    },
    mockReservationState: {
      uid: state.uid,
      pid: state.pid,
      symbol: state.symbol,
      positionSide: state.positionSide,
      activeReservationQty: remainingQty === 0 ? 0 : state.activeReservationQty,
      status: remainingQty === 0 ? "MOCK_STOP_TERMINAL_SHAPE" : "MOCK_STOP_ADJUSTMENT_REQUIRED",
      actualReservationWrite: false,
    },
    convergenceState,
    remainingQty,
    terminal: false,
    terminalSuccess: false,
    normalGridExitSuccess: false,
    blockers: [...new Set(blockers)],
    audit: [...new Set(audit)],
  };
};

const GRID_EXIT_ENQUEUE_ADAPTER_STATE = Object.freeze({
  DISABLED: "GRID_EXIT_ENQUEUE_DISABLED",
  DRY_RUN_ONLY: "GRID_EXIT_ENQUEUE_DRY_RUN_ONLY",
  MOCK_COMMITTED: "GRID_EXIT_ENQUEUE_MOCK_COMMITTED",
  MOCK_ROLLED_BACK: "GRID_EXIT_ENQUEUE_MOCK_ROLLED_BACK",
  MODE_REJECTED: "GRID_EXIT_ENQUEUE_MODE_REJECTED",
  REPOSITORY_REQUIRED: "GRID_EXIT_ENQUEUE_MOCK_REPOSITORY_REQUIRED",
});

const GRID_EXIT_ENQUEUE_ADAPTER_ALLOWED_MODES = Object.freeze(["OFF", "DRY_RUN", "MOCK_ONLY"]);
const GRID_EXIT_ENQUEUE_ADAPTER_TEMP_TABLE_MODE = "TEMP_TABLE_ONLY";
const GRID_EXIT_ENQUEUE_ADAPTER_ACTUAL_QUEUE_ROLLBACK_MODE = "ACTUAL_QUEUE_ROLLBACK_ONLY";
const GRID_EXIT_ENQUEUE_ADAPTER_PERSISTENT_BLOCKED_QA_MODE = "PERSISTENT_BLOCKED_QA_ONLY";
const GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_HARNESS = "GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_HARNESS";
const GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_QA_MARKER = Object.freeze({
  qaHarness: GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_HARNESS,
  phase: "2F",
  persistentCommit: false,
});
const GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_HARNESS = "GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_ENQUEUE";
const GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_QA_MARKER = Object.freeze({
  qaHarness: GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_HARNESS,
  phase: "2G",
  persistentCommit: true,
  executable: false,
  workerClaimable: false,
  cleanupRequiresPmApproval: true,
});

const normalizeGridExitEnqueueAdapterMode = (mode = "OFF") => {
  const requestedMode = String(mode || "OFF").trim().toUpperCase();
  if (
    GRID_EXIT_ENQUEUE_ADAPTER_ALLOWED_MODES.includes(requestedMode) ||
    requestedMode === GRID_EXIT_ENQUEUE_ADAPTER_TEMP_TABLE_MODE ||
    requestedMode === GRID_EXIT_ENQUEUE_ADAPTER_ACTUAL_QUEUE_ROLLBACK_MODE ||
    requestedMode === GRID_EXIT_ENQUEUE_ADAPTER_PERSISTENT_BLOCKED_QA_MODE
  ) {
    return { ok: true, mode: requestedMode, requestedMode };
  }
  return {
    ok: false,
    mode: "OFF",
    requestedMode,
    reason: GRID_EXIT_ENQUEUE_ADAPTER_STATE.MODE_REJECTED,
  };
};

const buildGridExitNonExecutableResult = ({ canonicalState, reason, extra = {} } = {}) => ({
  canonicalState: canonicalState || "GRID_EXIT_ENQUEUE_MOCK_ONLY_BLOCKED_NOT_EXECUTABLE",
  reason: reason || "GRID_EXIT_ORCHESTRATOR_NOT_IMPLEMENTED",
  executable: false,
  terminalSuccess: false,
  closeConverged: false,
  ...extra,
});

const GRID_EXIT_QUEUE_KEY_MAX_LENGTH = 191;

const buildGridExitBoundedQueueKey = (value, prefix = "GRID_EXIT_KEY") => {
  const raw = String(value || "").trim();
  if (raw.length <= GRID_EXIT_QUEUE_KEY_MAX_LENGTH) {
    return raw;
  }
  const safePrefix = String(prefix || "GRID_EXIT_KEY").trim().replace(/[^A-Z0-9_:-]/gi, "_");
  return `${safePrefix}:sha1:${sha1(raw)}`;
};

const buildGridExitIntentRowShape = (rowCandidate = {}, now = new Date(), mode = "MOCK_ONLY", options = {}) => {
  const normalizedMode = normalizeGridExitEnqueueAdapterMode(mode).mode;
  const isTempTableOnly = normalizedMode === GRID_EXIT_ENQUEUE_ADAPTER_TEMP_TABLE_MODE;
  const isActualRollbackOnly = normalizedMode === GRID_EXIT_ENQUEUE_ADAPTER_ACTUAL_QUEUE_ROLLBACK_MODE;
  const isPersistentBlockedQaOnly = normalizedMode === GRID_EXIT_ENQUEUE_ADAPTER_PERSISTENT_BLOCKED_QA_MODE;
  const qaRunId = String(options.qaRunId || rowCandidate.qaRunId || rowCandidate.payload?.runId || "").trim();
  const naturalIntentKey = rowCandidate.intentKey || rowCandidate.idempotencyKey || rowCandidate.childNaturalKey;
  const naturalFifoKey = rowCandidate.fifoKey;
  const queueIntentKeySource = isPersistentBlockedQaOnly
    ? `${naturalIntentKey}:qaRunId:${qaRunId || "missing"}`
    : naturalIntentKey;
  const boundedIntentKey = (isActualRollbackOnly || isPersistentBlockedQaOnly)
    ? buildGridExitBoundedQueueKey(queueIntentKeySource, rowCandidate.intentType || "GRID_EXIT_INTENT")
    : naturalIntentKey;
  const boundedFifoKey = (isActualRollbackOnly || isPersistentBlockedQaOnly)
    ? buildGridExitBoundedQueueKey(naturalFifoKey, "GRID_EXIT_FIFO")
    : naturalFifoKey;
  const canonicalState = isActualRollbackOnly
    ? "GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_BLOCKED_NOT_EXECUTABLE"
    : isPersistentBlockedQaOnly
      ? "GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_NOT_EXECUTABLE"
      : isTempTableOnly
        ? "GRID_EXIT_ENQUEUE_TEMP_TABLE_ONLY_BLOCKED_NOT_EXECUTABLE"
        : "GRID_EXIT_ENQUEUE_MOCK_ONLY_BLOCKED_NOT_EXECUTABLE";
  const qaMarker = isActualRollbackOnly
    ? GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_QA_MARKER
    : isPersistentBlockedQaOnly
      ? GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_QA_MARKER
      : {};
  const qaRunFields = isPersistentBlockedQaOnly ? { runId: qaRunId } : {};
  const result = buildGridExitNonExecutableResult({
    canonicalState,
    reason: "GRID_EXIT_ORCHESTRATOR_NOT_IMPLEMENTED",
    extra: {
      intentType: rowCandidate.intentType,
      parentNaturalKey: rowCandidate.parentNaturalKey || null,
      childNaturalKey: rowCandidate.childNaturalKey || null,
      dryRunOnly: true,
      mockOnly: true,
      naturalIntentKey: (isActualRollbackOnly || isPersistentBlockedQaOnly) ? naturalIntentKey : undefined,
      queueIntentKey: (isActualRollbackOnly || isPersistentBlockedQaOnly) ? boundedIntentKey : undefined,
      ...qaMarker,
      ...qaRunFields,
    },
  });
  const payload = {
    ...(rowCandidate.payload || {}),
    parentNaturalKey: rowCandidate.parentNaturalKey || null,
    childNaturalKey: rowCandidate.childNaturalKey || null,
    dryRunOnly: true,
    mockOnly: true,
    naturalIntentKey: (isActualRollbackOnly || isPersistentBlockedQaOnly) ? naturalIntentKey : undefined,
    queueIntentKey: (isActualRollbackOnly || isPersistentBlockedQaOnly) ? boundedIntentKey : undefined,
    ...qaMarker,
    ...qaRunFields,
  };
  return {
    intentKey: boundedIntentKey,
    fifoKey: boundedFifoKey,
    uid: Number(rowCandidate.uid || 0),
    pid: Number(rowCandidate.pid || 0),
    strategyCategory: rowCandidate.strategyCategory || "grid",
    intentType: rowCandidate.intentType,
    status: STATUS.BLOCKED,
    priority: 100,
    attemptCount: 0,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    routePath: rowCandidate.routePath || null,
    sourceEventId: rowCandidate.sourceEventId || null,
    payloadHash: (isActualRollbackOnly || isPersistentBlockedQaOnly) ? sha1(safeJsonStringify(payload)) : (rowCandidate.payloadHash || sha1(safeJsonStringify(payload))),
    payloadJson: safeJsonStringify(payload),
    resultJson: safeJsonStringify(result),
    createdAt: now instanceof Date ? now.toISOString() : String(now || ""),
    updatedAt: now instanceof Date ? now.toISOString() : String(now || ""),
  };
};

const buildGridExitEnqueueAdapterPlan = ({
  queueJoinPlan = {},
  existingIntentRows = [],
  mode = "OFF",
  now = new Date(),
  qaRunId = null,
} = {}) => {
  const normalizedMode = normalizeGridExitEnqueueAdapterMode(mode);
  const forbidden = {
    dbInsert: false,
    dbUpdate: false,
    dbDelete: false,
    binanceWrite: false,
    cancel: false,
    close: false,
    marketClose: false,
    ledgerMutation: false,
  };

  if (!normalizedMode.ok) {
    return {
      ok: false,
      mode: normalizedMode.mode,
      requestedMode: normalizedMode.requestedMode,
      result: normalizedMode.reason,
      rejected: true,
      writesPlanned: [],
      forbidden,
    };
  }

  const resolved = resolveGridExitIntentIdempotency(queueJoinPlan, existingIntentRows);
  const parent = resolved.parentRowCandidate || null;
  const duplicateParentState = String(parent?.duplicateState || "");
  const parentJoinedExisting =
    duplicateParentState === GRID_EXIT_QUEUE_JOIN_STATE.DUPLICATE_IN_FLIGHT_JOINED;
  const parentNoop =
    duplicateParentState === GRID_EXIT_QUEUE_JOIN_STATE.DUPLICATE_CONVERGED_NOOP;
  const parentWrite = parent && parent.createRow === true && !parentNoop
    ? buildGridExitIntentRowShape(parent, now, normalizedMode.mode, { qaRunId })
    : null;
  const childWritesAllowed = Boolean(parentWrite || parentJoinedExisting);
  const childWrites = childWritesAllowed
    ? (resolved.childRowCandidates || [])
        .filter((child) => child.createRow === true)
        .map((child) => buildGridExitIntentRowShape(child, now, normalizedMode.mode, { qaRunId }))
    : [];
  const writesPlanned = parentWrite ? [parentWrite, ...childWrites] : childWrites;

  const result =
    normalizedMode.mode === "OFF"
      ? GRID_EXIT_ENQUEUE_ADAPTER_STATE.DISABLED
      : normalizedMode.mode === "DRY_RUN"
        ? GRID_EXIT_ENQUEUE_ADAPTER_STATE.DRY_RUN_ONLY
        : normalizedMode.mode === GRID_EXIT_ENQUEUE_ADAPTER_TEMP_TABLE_MODE
          ? "GRID_EXIT_ENQUEUE_TEMP_TABLE_ONLY_COMMITTED"
        : normalizedMode.mode === GRID_EXIT_ENQUEUE_ADAPTER_ACTUAL_QUEUE_ROLLBACK_MODE
          ? "GRID_EXIT_ENQUEUE_ACTUAL_QUEUE_ROLLBACK_VERIFIED"
          : normalizedMode.mode === GRID_EXIT_ENQUEUE_ADAPTER_PERSISTENT_BLOCKED_QA_MODE
            ? "GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_ENQUEUED"
            : GRID_EXIT_ENQUEUE_ADAPTER_STATE.MOCK_COMMITTED;
  const repositoryWritesEnabled =
    normalizedMode.mode === "MOCK_ONLY" ||
    normalizedMode.mode === GRID_EXIT_ENQUEUE_ADAPTER_TEMP_TABLE_MODE ||
    normalizedMode.mode === GRID_EXIT_ENQUEUE_ADAPTER_ACTUAL_QUEUE_ROLLBACK_MODE ||
    normalizedMode.mode === GRID_EXIT_ENQUEUE_ADAPTER_PERSISTENT_BLOCKED_QA_MODE;

  return {
    ok: true,
    mode: normalizedMode.mode,
    result,
    rejected: false,
    repositoryWritesEnabled,
    actualDbWrite: normalizedMode.mode === GRID_EXIT_ENQUEUE_ADAPTER_PERSISTENT_BLOCKED_QA_MODE,
    actualRollbackOnly: normalizedMode.mode === GRID_EXIT_ENQUEUE_ADAPTER_ACTUAL_QUEUE_ROLLBACK_MODE,
    persistentBlockedQaOnly: normalizedMode.mode === GRID_EXIT_ENQUEUE_ADAPTER_PERSISTENT_BLOCKED_QA_MODE,
    mutation: normalizedMode.mode === GRID_EXIT_ENQUEUE_ADAPTER_PERSISTENT_BLOCKED_QA_MODE,
    queueJoinPlan: resolved,
    parentWrite,
    childWrites,
    writesPlanned: repositoryWritesEnabled ? writesPlanned : [],
    dryRunWritesPlanned: writesPlanned,
    duplicateParents: resolved.duplicateParents || [],
    duplicateChildren: resolved.duplicateChildren || [],
    forbidden,
  };
};

const createGridExitMockRepository = ({
  existingRows = [],
  failOnInsertKey = null,
  failOnInsertIndex = null,
} = {}) => {
  let writes = [];
  let inTransaction = false;
  const events = [];
  const existing = [...(existingRows || [])];
  return {
    findByNaturalKey: async (naturalKey) =>
      [...existing, ...writes].find((row) => row.intentKey === naturalKey || row.childNaturalKey === naturalKey) || null,
    begin: async () => {
      events.push("begin");
      inTransaction = true;
    },
    insertIntentRow: async (row) => {
      events.push(`insert:${row.intentType}:${row.intentKey}`);
      if (!inTransaction) {
        throw new Error("mock repository insert outside transaction");
      }
      if (
        (failOnInsertKey && row.intentKey === failOnInsertKey) ||
        (failOnInsertIndex != null && writes.length === Number(failOnInsertIndex))
      ) {
        throw new Error(`mock insert failure:${row.intentKey}`);
      }
      const duplicate = [...existing, ...writes].find((item) => item.intentKey === row.intentKey);
      if (duplicate) {
        throw new Error(`mock duplicate key:${row.intentKey}`);
      }
      writes.push({ ...row });
      return { inserted: true, row: { ...row } };
    },
    commit: async () => {
      events.push("commit");
      inTransaction = false;
    },
    rollback: async () => {
      events.push("rollback");
      writes = [];
      inTransaction = false;
    },
    getWrites: () => writes.map((row) => ({ ...row })),
    getEvents: () => [...events],
  };
};

const GRID_EXIT_TEMP_TABLE_PREFIX = "tmp_grid_exit_order_intent_queue_";

const quoteGridExitTempTableName = (tableName) => {
  const normalized = String(tableName || "").trim();
  if (
    !normalized.startsWith(GRID_EXIT_TEMP_TABLE_PREFIX) ||
    normalized === "order_intent_queue" ||
    !/^tmp_grid_exit_order_intent_queue_[A-Za-z0-9_]+$/.test(normalized)
  ) {
    throw new Error(`unsafe temp table name:${normalized || "-"}`);
  }
  return `\`${normalized.replace(/`/g, "``")}\``;
};

const createGridExitTempTableQueueRepository = ({ connection, tableName } = {}) => {
  if (!connection || typeof connection.query !== "function") {
    throw new Error("temp table repository requires a query-capable connection");
  }
  const quotedTableName = quoteGridExitTempTableName(tableName);
  const audit = [];
  const record = (event) => audit.push(event);
  return {
    findByNaturalKey: async (naturalKey) => {
      record({ op: "SELECT", tableName, naturalKey });
      const [rows] = await connection.query(
        `SELECT * FROM ${quotedTableName} WHERE intentKey = ? LIMIT 1`,
        [String(naturalKey || "")]
      );
      return rows?.[0] || null;
    },
    begin: async () => {
      record({ op: "BEGIN", tableName });
      await connection.query("START TRANSACTION");
    },
    insertIntentRow: async (row) => {
      record({ op: "INSERT", tableName, intentType: row.intentType, intentKey: row.intentKey });
      await connection.query(
        `INSERT INTO ${quotedTableName}
          (
            intentKey,
            fifoKey,
            uid,
            pid,
            strategyCategory,
            intentType,
            status,
            priority,
            attemptCount,
            maxAttempts,
            routePath,
            sourceEventId,
            payloadHash,
            payloadJson,
            resultJson
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.intentKey,
          row.fifoKey,
          row.uid,
          row.pid,
          row.strategyCategory,
          row.intentType,
          row.status,
          row.priority,
          row.attemptCount,
          row.maxAttempts,
          row.routePath,
          row.sourceEventId,
          row.payloadHash,
          row.payloadJson,
          row.resultJson,
        ]
      );
      return { inserted: true };
    },
    commit: async () => {
      record({ op: "COMMIT", tableName });
      await connection.query("COMMIT");
    },
    rollback: async () => {
      record({ op: "ROLLBACK", tableName });
      await connection.query("ROLLBACK");
    },
    countRows: async () => {
      record({ op: "COUNT", tableName });
      const [rows] = await connection.query(`SELECT COUNT(*) AS cnt FROM ${quotedTableName}`);
      return Number(rows?.[0]?.cnt || 0);
    },
    getAudit: () => audit.map((item) => ({ ...item })),
  };
};

const GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_ALLOWED_INTENT_TYPES = Object.freeze([
  INTENT_TYPE.GRID_EXIT_REQUEST,
  INTENT_TYPE.GRID_EXIT_ENTRY_CANCEL,
  INTENT_TYPE.GRID_EXIT_PROTECTION_CANCEL,
]);

const parseGridExitRollbackJson = (value, label) => {
  try {
    return typeof value === "string" ? JSON.parse(value) : (value || {});
  } catch (error) {
    throw new Error(`actual rollback row ${label} is not valid JSON`);
  }
};

const assertGridExitActualRollbackQaMarker = (row = {}) => {
  const payload = parseGridExitRollbackJson(row.payloadJson, "payloadJson");
  const result = parseGridExitRollbackJson(row.resultJson, "resultJson");
  for (const [label, source] of [["payloadJson", payload], ["resultJson", result]]) {
    if (
      source.qaHarness !== GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_QA_MARKER.qaHarness ||
      source.phase !== GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_QA_MARKER.phase ||
      source.persistentCommit !== GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_QA_MARKER.persistentCommit
    ) {
      throw new Error(`actual rollback row missing QA marker in ${label}`);
    }
  }
};

const createGridExitActualQueueRollbackRepository = ({
  connection,
  tableName = "order_intent_queue",
  harnessEnabled = false,
} = {}) => {
  if (harnessEnabled !== true) {
    throw new Error("actual queue rollback harness flag is required");
  }
  if (!connection || typeof connection.query !== "function") {
    throw new Error("actual queue rollback repository requires a query-capable connection");
  }
  if (String(tableName || "").trim() !== "order_intent_queue") {
    throw new Error(`actual queue rollback repository rejects table:${tableName || "-"}`);
  }

  let inTransaction = false;
  const audit = [];
  const record = (event) => audit.push({ tableName: "order_intent_queue", ...event });

  const assertInsertAllowed = (row = {}) => {
    if (!inTransaction) {
      throw new Error("actual queue rollback insert outside transaction");
    }
    if (row.status !== STATUS.BLOCKED) {
      throw new Error(`actual queue rollback only allows BLOCKED status:${row.status || "-"}`);
    }
    if (["PENDING", "RUNNING", "RETRY"].includes(String(row.status || "").toUpperCase())) {
      throw new Error(`actual queue rollback rejects claimable status:${row.status}`);
    }
    if (!GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_ALLOWED_INTENT_TYPES.includes(row.intentType)) {
      throw new Error(`actual queue rollback rejects intentType:${row.intentType || "-"}`);
    }
    assertGridExitActualRollbackQaMarker(row);
  };

  return {
    findByNaturalKey: async (naturalKey) => {
      record({ op: "SELECT", naturalKey });
      const [rows] = await connection.query(
        "SELECT * FROM order_intent_queue WHERE intentKey = ? LIMIT 1",
        [String(naturalKey || "")]
      );
      return rows?.[0] || null;
    },
    begin: async () => {
      record({ op: "START_TRANSACTION" });
      await connection.query("START TRANSACTION");
      inTransaction = true;
    },
    insertIntentRow: async (row) => {
      assertInsertAllowed(row);
      record({
        op: "INSERT",
        intentType: row.intentType,
        intentKey: row.intentKey,
        status: row.status,
        qaHarness: GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_HARNESS,
      });
      await connection.query(
        `INSERT INTO order_intent_queue
          (
            intentKey,
            fifoKey,
            uid,
            pid,
            strategyCategory,
            intentType,
            status,
            priority,
            attemptCount,
            maxAttempts,
            routePath,
            sourceEventId,
            payloadHash,
            payloadJson,
            resultJson
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.intentKey,
          row.fifoKey,
          row.uid,
          row.pid,
          row.strategyCategory,
          row.intentType,
          row.status,
          row.priority,
          row.attemptCount,
          row.maxAttempts,
          row.routePath,
          row.sourceEventId,
          row.payloadHash,
          row.payloadJson,
          row.resultJson,
        ]
      );
      return { inserted: true };
    },
    commit: async () => {
      record({ op: "COMMIT_REJECTED" });
      throw new Error("actual queue rollback repository never commits");
    },
    rollback: async () => {
      record({ op: "ROLLBACK" });
      await connection.query("ROLLBACK");
      inTransaction = false;
    },
    countRows: async () => {
      record({ op: "COUNT" });
      const [rows] = await connection.query("SELECT COUNT(*) AS cnt FROM order_intent_queue");
      return Number(rows?.[0]?.cnt || 0);
    },
    getAudit: () => audit.map((item) => ({ ...item })),
    getWrites: () => [],
  };
};

const GRID_EXIT_PERSISTENT_BLOCKED_QA_MAX_ROWS = 4;

const parseGridExitPersistentBlockedJson = (value, label) => {
  try {
    return typeof value === "string" ? JSON.parse(value) : (value || {});
  } catch (error) {
    throw new Error(`persistent blocked QA row ${label} is not valid JSON`);
  }
};

const assertGridExitPersistentBlockedQaMarker = (row = {}) => {
  const payload = parseGridExitPersistentBlockedJson(row.payloadJson, "payloadJson");
  const result = parseGridExitPersistentBlockedJson(row.resultJson, "resultJson");
  for (const [label, source] of [["payloadJson", payload], ["resultJson", result]]) {
    if (
      source.qaHarness !== GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_QA_MARKER.qaHarness ||
      source.phase !== GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_QA_MARKER.phase ||
      source.persistentCommit !== GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_QA_MARKER.persistentCommit ||
      source.executable !== false ||
      source.workerClaimable !== false ||
      source.cleanupRequiresPmApproval !== true
    ) {
      throw new Error(`persistent blocked QA row missing QA marker in ${label}`);
    }
    if (!source.runId || typeof source.runId !== "string") {
      throw new Error(`persistent blocked QA row missing runId in ${label}`);
    }
  }
  if (payload.runId !== result.runId) {
    throw new Error("persistent blocked QA row runId mismatch");
  }
  return payload.runId;
};

const createGridExitPersistentBlockedQuarantineRepository = ({
  connection,
  tableName = "order_intent_queue",
  harnessEnabled = false,
  allowPersistentBlockedQaEnqueue = false,
  maxRows = GRID_EXIT_PERSISTENT_BLOCKED_QA_MAX_ROWS,
} = {}) => {
  if (harnessEnabled !== true) {
    throw new Error("persistent blocked quarantine harness flag is required");
  }
  if (allowPersistentBlockedQaEnqueue !== true) {
    throw new Error("persistent blocked QA enqueue approval flag is required");
  }
  if (!connection || typeof connection.query !== "function") {
    throw new Error("persistent blocked quarantine repository requires a query-capable connection");
  }
  if (String(tableName || "").trim() !== "order_intent_queue") {
    throw new Error(`persistent blocked quarantine repository rejects table:${tableName || "-"}`);
  }

  let insertedCount = 0;
  const audit = [];
  const record = (event) => audit.push({ tableName: "order_intent_queue", ...event });

  const assertInsertAllowed = (row = {}) => {
    if (insertedCount >= Number(maxRows || 0)) {
      throw new Error(`persistent blocked QA row limit exceeded:${maxRows}`);
    }
    if (row.status !== STATUS.BLOCKED) {
      throw new Error(`persistent blocked QA only allows BLOCKED status:${row.status || "-"}`);
    }
    if (["PENDING", "RUNNING", "RETRY", "DONE", "SUCCESS", "CONVERGED"].includes(String(row.status || "").toUpperCase())) {
      throw new Error(`persistent blocked QA rejects executable/success status:${row.status}`);
    }
    if (!GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_ALLOWED_INTENT_TYPES.includes(row.intentType)) {
      throw new Error(`persistent blocked QA rejects intentType:${row.intentType || "-"}`);
    }
    return assertGridExitPersistentBlockedQaMarker(row);
  };

  return {
    findByNaturalKey: async (naturalKey) => {
      record({ op: "SELECT", naturalKey });
      const [rows] = await connection.query(
        "SELECT * FROM order_intent_queue WHERE intentKey = ? LIMIT 1",
        [String(naturalKey || "")]
      );
      return rows?.[0] || null;
    },
    insertIntentRow: async (row) => {
      const runId = assertInsertAllowed(row);
      record({
        op: "INSERT",
        intentType: row.intentType,
        intentKey: row.intentKey,
        status: row.status,
        runId,
        qaHarness: GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_HARNESS,
      });
      await connection.query(
        `INSERT INTO order_intent_queue
          (
            intentKey,
            fifoKey,
            uid,
            pid,
            strategyCategory,
            intentType,
            status,
            priority,
            attemptCount,
            maxAttempts,
            routePath,
            sourceEventId,
            payloadHash,
            payloadJson,
            resultJson
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.intentKey,
          row.fifoKey,
          row.uid,
          row.pid,
          row.strategyCategory,
          row.intentType,
          row.status,
          row.priority,
          row.attemptCount,
          row.maxAttempts,
          row.routePath,
          row.sourceEventId,
          row.payloadHash,
          row.payloadJson,
          row.resultJson,
        ]
      );
      insertedCount += 1;
      return { inserted: true, runId };
    },
    countRows: async () => {
      record({ op: "COUNT" });
      const [rows] = await connection.query("SELECT COUNT(*) AS cnt FROM order_intent_queue");
      return Number(rows?.[0]?.cnt || 0);
    },
    getAudit: () => audit.map((item) => ({ ...item })),
    getWrites: () => [],
  };
};

const createGridExitPersistentBlockedQuarantineCleanupRepository = ({
  connection,
  tableName = "order_intent_queue",
  harnessEnabled = false,
  allowCleanup = false,
  runId = "",
  expectedIds = [],
  expectedCount = GRID_EXIT_PERSISTENT_BLOCKED_QA_MAX_ROWS,
} = {}) => {
  if (harnessEnabled !== true) {
    throw new Error("persistent blocked quarantine cleanup harness flag is required");
  }
  if (allowCleanup !== true) {
    throw new Error("persistent blocked quarantine cleanup approval flag is required");
  }
  if (!connection || typeof connection.query !== "function") {
    throw new Error("persistent blocked quarantine cleanup repository requires a query-capable connection");
  }
  if (String(tableName || "").trim() !== "order_intent_queue") {
    throw new Error(`persistent blocked quarantine cleanup repository rejects table:${tableName || "-"}`);
  }
  const normalizedRunId = String(runId || "").trim();
  if (!normalizedRunId) {
    throw new Error("persistent blocked quarantine cleanup runId is required");
  }
  const normalizedExpectedIds = [...new Set((expectedIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
  if (normalizedExpectedIds.length === 0) {
    throw new Error("persistent blocked quarantine cleanup expected ids are required");
  }
  const normalizedExpectedCount = Number(expectedCount || normalizedExpectedIds.length);
  if (normalizedExpectedCount !== normalizedExpectedIds.length) {
    throw new Error("persistent blocked quarantine cleanup expected count must match expected ids");
  }

  let inTransaction = false;
  const audit = [];
  const record = (event) => audit.push({ tableName: "order_intent_queue", ...event });
  const placeholders = normalizedExpectedIds.map(() => "?").join(",");

  const readMatchingRows = async () => {
    record({ op: "SELECT_TARGET_ROWS", runId: normalizedRunId, ids: [...normalizedExpectedIds] });
    const [rows] = await connection.query(
      `SELECT id, uid, pid, strategyCategory, intentType, status, payloadJson, resultJson
         FROM order_intent_queue
        WHERE id IN (${placeholders})
          AND status = ?
          AND (
            JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.qaHarness')) = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(resultJson, '$.qaHarness')) = ?
          )
          AND (
            JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.runId')) = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(resultJson, '$.runId')) = ?
          )
        ORDER BY id`,
      [
        ...normalizedExpectedIds,
        STATUS.BLOCKED,
        GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_HARNESS,
        GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_HARNESS,
        normalizedRunId,
        normalizedRunId,
      ]
    );
    return rows || [];
  };

  const countRowsByIds = async () => {
    record({ op: "COUNT_IDS", runId: normalizedRunId, ids: [...normalizedExpectedIds] });
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS cnt
         FROM order_intent_queue
        WHERE id IN (${placeholders})`,
      normalizedExpectedIds
    );
    return Number(rows?.[0]?.cnt || 0);
  };

  const countRowsByMarker = async () => {
    record({ op: "COUNT_MARKER", runId: normalizedRunId });
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS cnt
         FROM order_intent_queue
        WHERE (
            JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.qaHarness')) = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(resultJson, '$.qaHarness')) = ?
          )
          AND (
            JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.runId')) = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(resultJson, '$.runId')) = ?
          )`,
      [
        GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_HARNESS,
        GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_HARNESS,
        normalizedRunId,
        normalizedRunId,
      ]
    );
    return Number(rows?.[0]?.cnt || 0);
  };

  const validateCleanupTargetRows = (rows = []) => {
    if (rows.length !== normalizedExpectedCount) {
      throw new Error(`BLOCKED_PARTIAL_QA_QUARANTINE_ROWS:${rows.length}/${normalizedExpectedCount}`);
    }
    const actualIds = rows.map((row) => Number(row.id)).sort((a, b) => a - b);
    const expectedSorted = [...normalizedExpectedIds].sort((a, b) => a - b);
    if (actualIds.join(",") !== expectedSorted.join(",")) {
      throw new Error(`persistent blocked quarantine cleanup target id mismatch:${actualIds.join(",")}`);
    }
    for (const row of rows) {
      if (row.status !== STATUS.BLOCKED) {
        throw new Error(`persistent blocked quarantine cleanup rejects status:${row.status || "-"}`);
      }
      if (["PENDING", "RUNNING", "RETRY", "DONE", "SUCCESS", "CONVERGED"].includes(String(row.status || "").toUpperCase())) {
        throw new Error(`persistent blocked quarantine cleanup rejects executable/success status:${row.status}`);
      }
      if (!GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_ALLOWED_INTENT_TYPES.includes(row.intentType)) {
        throw new Error(`persistent blocked quarantine cleanup rejects intentType:${row.intentType || "-"}`);
      }
      const rowRunId = assertGridExitPersistentBlockedQaMarker(row);
      if (rowRunId !== normalizedRunId) {
        throw new Error(`persistent blocked quarantine cleanup runId mismatch:${rowRunId || "-"}`);
      }
    }
    return true;
  };

  const beginCleanup = async () => {
    record({ op: "START_TRANSACTION", runId: normalizedRunId });
    await connection.query("START TRANSACTION");
    inTransaction = true;
  };

  const deleteCleanupTargetRows = async (rows = []) => {
    if (!inTransaction) {
      throw new Error("persistent blocked quarantine cleanup delete outside transaction");
    }
    validateCleanupTargetRows(rows);
    record({
      op: "DELETE",
      runId: normalizedRunId,
      ids: rows.map((row) => Number(row.id)),
      count: rows.length,
    });
    const [result] = await connection.query(
      `DELETE FROM order_intent_queue
        WHERE id IN (${placeholders})
          AND status = ?
          AND (
            JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.qaHarness')) = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(resultJson, '$.qaHarness')) = ?
          )
          AND (
            JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.runId')) = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(resultJson, '$.runId')) = ?
          )`,
      [
        ...normalizedExpectedIds,
        STATUS.BLOCKED,
        GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_HARNESS,
        GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_HARNESS,
        normalizedRunId,
        normalizedRunId,
      ]
    );
    const affectedRows = Number(result?.affectedRows || 0);
    if (affectedRows !== normalizedExpectedCount) {
      throw new Error(`persistent blocked quarantine cleanup delete count mismatch:${affectedRows}/${normalizedExpectedCount}`);
    }
    return { deletedCount: affectedRows };
  };

  const commitCleanup = async () => {
    record({ op: "COMMIT", runId: normalizedRunId });
    await connection.query("COMMIT");
    inTransaction = false;
  };

  const rollbackCleanup = async () => {
    record({ op: "ROLLBACK", runId: normalizedRunId });
    await connection.query("ROLLBACK");
    inTransaction = false;
  };

  return {
    selectTargetRows: readMatchingRows,
    validateCleanupTargetRows,
    begin: beginCleanup,
    deleteTargetRows: deleteCleanupTargetRows,
    commit: commitCleanup,
    rollback: rollbackCleanup,
    cleanupExpectedRows: async () => {
      const rows = await readMatchingRows();
      if (rows.length === 0) {
        const [idCount, markerCount] = await Promise.all([countRowsByIds(), countRowsByMarker()]);
        if (idCount === 0 && markerCount === 0) {
          return {
            result: "GRID_EXIT_QA_QUARANTINE_ALREADY_CLEANED",
            deletedCount: 0,
            committed: false,
            alreadyCleaned: true,
            rows: [],
          };
        }
      }
      validateCleanupTargetRows(rows);
      try {
        await beginCleanup();
      } catch (error) {
        record({ op: "BEGIN_FAILED", runId: normalizedRunId, error: error?.message || String(error) });
        throw error;
      }
      try {
        const deleted = await deleteCleanupTargetRows(rows);
        await commitCleanup();
        return {
          result: "GRID_EXIT_QA_QUARANTINE_CLEANED",
          deletedCount: deleted.deletedCount,
          committed: true,
          alreadyCleaned: false,
          rows,
        };
      } catch (error) {
        if (inTransaction) {
          await rollbackCleanup();
        }
        throw error;
      }
    },
    countRowsByIds,
    countRowsByMarker,
    getAudit: () => audit.map((item) => ({ ...item })),
  };
};

const enqueueGridExitPlanWithRepository = async ({
  queueJoinPlan = {},
  repository = null,
  mode = "OFF",
  now = new Date(),
  existingIntentRows = [],
  qaRunId = null,
} = {}) => {
  const adapterPlan = buildGridExitEnqueueAdapterPlan({
    queueJoinPlan,
    existingIntentRows,
    mode,
    now,
    qaRunId,
  });

  if (!adapterPlan.ok || adapterPlan.mode === "OFF" || adapterPlan.mode === "DRY_RUN") {
    return {
      ...adapterPlan,
      repositoryEvents: [],
      writes: [],
    };
  }

  if (!repository || typeof repository.insertIntentRow !== "function") {
    return {
      ...adapterPlan,
      ok: false,
      result: GRID_EXIT_ENQUEUE_ADAPTER_STATE.REPOSITORY_REQUIRED,
      writes: [],
      repositoryEvents: [],
    };
  }

  const actualRollbackOnly = adapterPlan.mode === GRID_EXIT_ENQUEUE_ADAPTER_ACTUAL_QUEUE_ROLLBACK_MODE;
  const persistentBlockedQaOnly = adapterPlan.mode === GRID_EXIT_ENQUEUE_ADAPTER_PERSISTENT_BLOCKED_QA_MODE;
  try {
    if (!persistentBlockedQaOnly && typeof repository.begin === "function") {
      await repository.begin();
    }
    for (const row of adapterPlan.writesPlanned || []) {
      await repository.insertIntentRow(row);
    }
    if (actualRollbackOnly) {
      const insertedVisibleInTransaction =
        typeof repository.countRows === "function" ? await repository.countRows() : null;
      if (typeof repository.rollback === "function") {
        await repository.rollback();
      }
      return {
        ...adapterPlan,
        result: "GRID_EXIT_ENQUEUE_ACTUAL_QUEUE_ROLLBACK_VERIFIED",
        writes: adapterPlan.writesPlanned,
        insertedVisibleInTransaction,
        committed: false,
        rolledBack: true,
        persistentMutation: false,
        repositoryEvents: typeof repository.getEvents === "function"
          ? repository.getEvents()
          : (typeof repository.getAudit === "function" ? repository.getAudit() : []),
      };
    }
    if (persistentBlockedQaOnly) {
      return {
        ...adapterPlan,
        result: "GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_ENQUEUED",
        writes: adapterPlan.writesPlanned,
        committed: true,
        rolledBack: false,
        persistentMutation: true,
        repositoryEvents: typeof repository.getEvents === "function"
          ? repository.getEvents()
          : (typeof repository.getAudit === "function" ? repository.getAudit() : []),
      };
    }
    if (typeof repository.commit === "function") {
      await repository.commit();
    }
    return {
      ...adapterPlan,
      result: adapterPlan.mode === GRID_EXIT_ENQUEUE_ADAPTER_TEMP_TABLE_MODE
        ? "GRID_EXIT_ENQUEUE_TEMP_TABLE_ONLY_COMMITTED"
        : GRID_EXIT_ENQUEUE_ADAPTER_STATE.MOCK_COMMITTED,
      writes: typeof repository.getWrites === "function" ? repository.getWrites() : adapterPlan.writesPlanned,
      repositoryEvents: typeof repository.getEvents === "function"
        ? repository.getEvents()
        : (typeof repository.getAudit === "function" ? repository.getAudit() : []),
    };
  } catch (error) {
    if (typeof repository.rollback === "function") {
      await repository.rollback();
    }
    return {
      ...adapterPlan,
      ok: false,
      result: GRID_EXIT_ENQUEUE_ADAPTER_STATE.MOCK_ROLLED_BACK,
      error: error?.message || String(error),
      writes: typeof repository.getWrites === "function" ? repository.getWrites() : [],
      committed: false,
      rolledBack: true,
      persistentMutation: false,
      repositoryEvents: typeof repository.getEvents === "function"
        ? repository.getEvents()
        : (typeof repository.getAudit === "function" ? repository.getAudit() : []),
    };
  }
};

const normalizePositionSide = (value) => String(value || "").trim().toUpperCase();

const normalizeSignalSide = (value) => String(value || "").trim().toUpperCase();

const signalPositionSideFromSide = (side) => normalizeSignalSide(side) === "SELL" ? "SHORT" : "LONG";

const buildSignalEntryClientOrderId = signalMarketEntryIdempotency.buildSignalEntryClientOrderId;

const normalizeSignalMarketEntryIntentPayload = signalMarketEntryIdempotency.normalizeSignalMarketEntryIntentPayload;

const buildSignalMarketEntryIntentPayloadHash = signalMarketEntryIdempotency.buildSignalMarketEntryIntentPayloadHash;

const buildSignalMarketEntryIntentKey = signalMarketEntryIdempotency.buildSignalMarketEntryIntentKey;

const buildSignalMarketEntryFifoKey = signalMarketEntryIdempotency.buildSignalMarketEntryFifoKey;

const normalizeSignalProtectionIntentPayload = (payload = {}) => {
  const side = normalizeSignalSide(payload.side || payload.signalSide || payload.rSignalType);
  const boundType = String(payload.boundType || payload.protectionType || "PROFIT_STOP").trim().toUpperCase();
  return {
    ...payload,
    uid: Number(payload.uid || 0),
    pid: Number(payload.pid || payload.id || 0),
    strategyCategory: "signal",
    symbol: normalizeSymbol(payload.symbol),
    side,
    positionSide: normalizePositionSide(payload.positionSide || signalPositionSideFromSide(side)),
    entryIntentId: payload.entryIntentId == null ? null : String(payload.entryIntentId),
    sourceWebhookEventId: payload.sourceWebhookEventId == null ? null : String(payload.sourceWebhookEventId),
    sourceWebhookTargetId: payload.sourceWebhookTargetId == null ? null : String(payload.sourceWebhookTargetId),
    ownerRowId: payload.ownerRowId == null ? null : String(payload.ownerRowId),
    snapshotRowId: payload.snapshotRowId == null ? null : String(payload.snapshotRowId),
    entryOrderId: payload.entryOrderId == null ? null : String(payload.entryOrderId),
    entryClientOrderId: payload.entryClientOrderId == null ? null : String(payload.entryClientOrderId),
    sourceOrderId: payload.sourceOrderId == null ? null : String(payload.sourceOrderId),
    sourceTradeId: payload.sourceTradeId == null ? null : String(payload.sourceTradeId),
    tradeTime: payload.tradeTime == null ? null : String(payload.tradeTime),
    qty: Number(payload.qty || payload.ownedQty || payload.ownedQtyBasis || 0),
    ownedQty: Number(payload.ownedQty || payload.ownedQtyBasis || payload.qty || 0),
    entryPrice: Number(payload.entryPrice || payload.exactPrice || 0),
    takeProfitPrice: Number(payload.takeProfitPrice || payload.profitPrice || 0),
    stopPrice: Number(payload.stopPrice || 0),
    splitStageQty: Number(payload.splitStageQty || 0),
    splitStageIndex: Number(payload.splitStageIndex || 0),
    boundType,
    reason: String(payload.reason || payload.sourceReason || "SIGNAL_PROTECTION").trim().toUpperCase(),
  };
};

const resolveSignalProtectionIntentType = (payload = {}) => {
  const normalizedType = String(payload.intentType || "").trim().toUpperCase();
  if (
    normalizedType === INTENT_TYPE.SIGNAL_PROTECTION_CREATE ||
    normalizedType === INTENT_TYPE.SIGNAL_SPLIT_TP_CREATE
  ) {
    return normalizedType;
  }
  const boundType = String(payload.boundType || payload.protectionType || "").trim().toUpperCase();
  return boundType === "SPLITTP" ? INTENT_TYPE.SIGNAL_SPLIT_TP_CREATE : INTENT_TYPE.SIGNAL_PROTECTION_CREATE;
};

const buildSignalProtectionIntentPayloadHash = ({ payload = {} } = {}) => {
  const normalized = normalizeSignalProtectionIntentPayload(payload);
  return sha1(
    safeJsonStringify({
      action: resolveSignalProtectionIntentType(normalized),
      uid: normalized.uid,
      pid: normalized.pid,
      symbol: normalized.symbol,
      side: normalized.side,
      positionSide: normalized.positionSide,
      entryIntentId: normalized.entryIntentId,
      ownerRowId: normalized.ownerRowId,
      entryOrderId: normalized.entryOrderId,
      sourceOrderId: normalized.sourceOrderId,
      sourceTradeId: normalized.sourceTradeId,
      qty: normalized.qty,
      ownedQty: normalized.ownedQty,
      takeProfitPrice: normalized.takeProfitPrice,
      stopPrice: normalized.stopPrice,
      splitStageQty: normalized.splitStageQty,
      splitStageIndex: normalized.splitStageIndex,
      boundType: normalized.boundType,
    })
  );
};

const buildSignalProtectionIntentKey = ({ payload = {} } = {}) => {
  const normalized = normalizeSignalProtectionIntentPayload(payload);
  const identity = [
    normalized.ownerRowId ? `owner:${normalized.ownerRowId}` : null,
    normalized.entryOrderId ? `entry:${normalized.entryOrderId}` : null,
    normalized.sourceTradeId ? `trade:${normalized.sourceTradeId}` : null,
    normalized.sourceOrderId ? `order:${normalized.sourceOrderId}` : null,
  ].filter(Boolean).join("|") || buildSignalProtectionIntentPayloadHash({ payload: normalized });
  return [
    resolveSignalProtectionIntentType(normalized),
    normalized.uid,
    normalized.pid,
    normalized.symbol,
    normalized.positionSide,
    normalized.boundType,
    normalized.splitStageIndex,
    identity,
  ].join(":");
};

const buildSignalFifoKey = ({ payload = {} } = {}) => {
  const uid = Number(payload.uid || 0);
  const pid = Number(payload.pid || payload.id || 0);
  return [uid, "signal", pid].join(":");
};

const normalizeSignalCancelIntentPayload = (payload = {}) => ({
  ...payload,
  uid: Number(payload.uid || 0),
  pid: Number(payload.pid || payload.id || 0),
  strategyCategory: "signal",
  symbol: normalizeSymbol(payload.symbol),
  positionSide: normalizePositionSide(payload.positionSide || payload.leg),
  targetType: String(payload.targetType || "PROTECTION").trim().toUpperCase(),
  targetOrderId: payload.targetOrderId == null ? null : String(payload.targetOrderId),
  targetClientOrderId: payload.targetClientOrderId || payload.clientOrderId || null,
  excludeType: payload.excludeType == null ? null : String(payload.excludeType).trim().toUpperCase(),
  reason: String(payload.reason || payload.sourceReason || "SIGNAL_PROTECTION_CANCEL").trim().toUpperCase(),
  sourceReason: String(payload.sourceReason || payload.reason || "SIGNAL_PROTECTION_CANCEL").trim().toUpperCase(),
});

const resolveSignalCancelIntentType = (payload = {}) => {
  const normalizedType = String(payload.intentType || "").trim().toUpperCase();
  if (
    normalizedType === INTENT_TYPE.SIGNAL_PROTECTION_CANCEL ||
    normalizedType === INTENT_TYPE.SIGNAL_CLEANUP_FINALIZE
  ) {
    return normalizedType;
  }
  const reason = String(payload.reason || payload.sourceReason || "").trim().toUpperCase();
  return reason.includes("CLEANUP") || reason.includes("FINALIZE")
    ? INTENT_TYPE.SIGNAL_CLEANUP_FINALIZE
    : INTENT_TYPE.SIGNAL_PROTECTION_CANCEL;
};

const buildSignalCancelIntentPayloadHash = ({ payload = {} } = {}) => {
  const normalized = normalizeSignalCancelIntentPayload(payload);
  return sha1(
    safeJsonStringify({
      action: resolveSignalCancelIntentType(normalized),
      uid: normalized.uid,
      pid: normalized.pid,
      symbol: normalized.symbol,
      positionSide: normalized.positionSide,
      targetType: normalized.targetType,
      targetOrderId: normalized.targetOrderId,
      targetClientOrderId: normalized.targetClientOrderId,
      excludeType: normalized.excludeType,
      reason: normalized.reason,
    })
  );
};

const buildSignalCancelIntentKey = ({ payload = {} } = {}) => {
  const normalized = normalizeSignalCancelIntentPayload(payload);
  const targetIdentity = normalized.targetClientOrderId
    || normalized.targetOrderId
    || `${normalized.targetType}:${normalized.excludeType || "ALL"}:${normalized.reason}`;
  return [
    resolveSignalCancelIntentType(normalized),
    normalized.uid,
    normalized.pid,
    normalized.symbol,
    normalized.positionSide || "ALL",
    targetIdentity,
  ].join(":");
};

const buildSignalCloseClientOrderId = (payload = {}) => {
  if (payload.closeClientOrderId) {
    return payload.closeClientOrderId;
  }
  const sideCode = normalizePositionSide(payload.positionSide || payload.leg) === "SHORT" ? "S" : "L";
  const reason = String(payload.reason || payload.closeType || "FORCED_CLOSE").trim().toUpperCase();
  const source = payload.sourceEventId || payload.sourceOrderId || payload.sourceTradeId || payload.sourceClientOrderId || payload.rTid || null;
  const seed = sha1(
    safeJsonStringify({
      uid: Number(payload.uid || 0),
      pid: Number(payload.pid || payload.id || 0),
      symbol: normalizeSymbol(payload.symbol),
      positionSide: normalizePositionSide(payload.positionSide || payload.leg),
      reason,
      source,
    })
  );
  const suffix = String(parseInt(seed.slice(0, 10), 16) % 100000000).padStart(8, "0");
  return `${reason}_${sideCode}_${Number(payload.uid || 0)}_${Number(payload.pid || 0)}_${suffix}`;
};

const normalizeSignalCloseIntentPayload = (payload = {}) => {
  const side = normalizeSignalSide(payload.side || payload.signalSide || payload.rSignalType);
  const normalized = {
    ...payload,
    uid: Number(payload.uid || 0),
    pid: Number(payload.pid || payload.id || 0),
    strategyCategory: "signal",
    symbol: normalizeSymbol(payload.symbol),
    side,
    positionSide: normalizePositionSide(payload.positionSide || signalPositionSideFromSide(side)),
    qty: Number(payload.qty || payload.ownedQtyBasis || payload.ownedQty || 0),
    ownedQtyBasis: Number(payload.ownedQtyBasis || payload.qty || payload.ownedQty || 0),
    reason: String(payload.reason || payload.closeType || "FORCED_CLOSE").trim().toUpperCase(),
    sourceEventId: payload.sourceEventId == null ? null : String(payload.sourceEventId),
    sourceOrderId: payload.sourceOrderId == null ? null : String(payload.sourceOrderId),
    sourceTradeId: payload.sourceTradeId == null ? null : String(payload.sourceTradeId),
    sourceClientOrderId: payload.sourceClientOrderId || null,
    rTid: payload.rTid == null ? null : String(payload.rTid),
    closeClientOrderId: payload.closeClientOrderId || null,
  };
  normalized.closeClientOrderId = normalized.closeClientOrderId || buildSignalCloseClientOrderId(normalized);
  return normalized;
};

const resolveSignalCloseIntentType = (payload = {}) => {
  const normalizedType = String(payload.intentType || "").trim().toUpperCase();
  if (
    normalizedType === INTENT_TYPE.SIGNAL_FORCED_CLOSE ||
    normalizedType === INTENT_TYPE.SIGNAL_STOP_TIME_EXIT ||
    normalizedType === INTENT_TYPE.SIGNAL_CLEANUP_FINALIZE
  ) {
    return normalizedType;
  }
  const reason = String(payload.reason || payload.closeType || "").trim().toUpperCase();
  if (reason.includes("TIME") || reason.includes("STOP_TIME")) {
    return INTENT_TYPE.SIGNAL_STOP_TIME_EXIT;
  }
  if (reason.includes("CLEANUP") || reason.includes("FINALIZE")) {
    return INTENT_TYPE.SIGNAL_CLEANUP_FINALIZE;
  }
  return INTENT_TYPE.SIGNAL_FORCED_CLOSE;
};

const buildSignalCloseIntentPayloadHash = ({ payload = {} } = {}) => {
  const normalized = normalizeSignalCloseIntentPayload(payload);
  return sha1(
    safeJsonStringify({
      action: resolveSignalCloseIntentType(normalized),
      uid: normalized.uid,
      pid: normalized.pid,
      symbol: normalized.symbol,
      side: normalized.side,
      positionSide: normalized.positionSide,
      qty: normalized.qty,
      ownedQtyBasis: normalized.ownedQtyBasis,
      reason: normalized.reason,
      sourceEventId: normalized.sourceEventId,
      sourceOrderId: normalized.sourceOrderId,
      sourceTradeId: normalized.sourceTradeId,
      sourceClientOrderId: normalized.sourceClientOrderId,
      rTid: normalized.rTid,
      closeClientOrderId: normalized.closeClientOrderId,
    })
  );
};

const buildSignalCloseIntentKey = ({ payload = {} } = {}) => {
  const normalized = normalizeSignalCloseIntentPayload(payload);
  return [
    resolveSignalCloseIntentType(normalized),
    normalized.uid,
    normalized.pid,
    normalized.symbol,
    normalized.positionSide,
    normalized.closeClientOrderId || buildSignalCloseIntentPayloadHash({ payload: normalized }),
  ].join(":");
};

const normalizeProtectionIntentPayload = (payload = {}) => ({
  ...payload,
  uid: Number(payload.uid || 0),
  pid: Number(payload.pid || 0),
  strategyCategory: "grid",
  symbol: normalizeSymbol(payload.symbol),
  positionSide: normalizePositionSide(payload.positionSide || payload.leg),
  qty: Number(payload.qty || payload.ownedQty || 0),
  ownedQty: Number(payload.ownedQty || payload.qty || 0),
  entryPrice: Number(payload.entryPrice || 0),
  takeProfitPrice: Number(payload.takeProfitPrice || 0),
  stopPrice: Number(payload.stopPrice || 0),
  sourceTradeId: payload.sourceTradeId == null ? null : String(payload.sourceTradeId),
  sourceOrderId: payload.sourceOrderId == null ? null : String(payload.sourceOrderId),
  entryOrderId: payload.entryOrderId || payload.entryClientOrderId || null,
});

const buildGridProtectionIntentPayloadHash = ({ payload = {} } = {}) => {
  const normalized = normalizeProtectionIntentPayload(payload);
  return sha1(
    safeJsonStringify({
      action: INTENT_TYPE.GRID_PROTECTION_CREATE,
      uid: normalized.uid,
      pid: normalized.pid,
      symbol: normalized.symbol,
      positionSide: normalized.positionSide,
      qty: normalized.qty,
      entryPrice: normalized.entryPrice,
      entryOrderId: normalized.entryOrderId,
      sourceOrderId: normalized.sourceOrderId,
      sourceTradeId: normalized.sourceTradeId,
      takeProfitPrice: normalized.takeProfitPrice,
      stopPrice: normalized.stopPrice,
      oneLegEmergency: normalized.oneLegEmergency === true,
    })
  );
};

const buildGridProtectionIntentKey = ({ payload = {} } = {}) => {
  const normalized = normalizeProtectionIntentPayload(payload);
  const tradeIdentity = normalized.sourceTradeId
    || normalized.sourceOrderId
    || normalized.entryOrderId
    || buildGridProtectionIntentPayloadHash({ payload: normalized });
  return [
    INTENT_TYPE.GRID_PROTECTION_CREATE,
    normalized.uid,
    normalized.pid,
    normalized.symbol,
    normalized.positionSide,
    tradeIdentity,
  ].join(":");
};

const buildGridProtectionFifoKey = ({ payload = {} } = {}) => {
  const normalized = normalizeProtectionIntentPayload(payload);
  return [
    normalized.uid,
    "grid",
    normalized.pid,
    "regime",
    normalized.regimeId || normalized.pid,
  ].join(":");
};

const normalizeReentryIntentPayload = (payload = {}) => ({
  ...payload,
  uid: Number(payload.uid || 0),
  pid: Number(payload.pid || 0),
  strategyCategory: "grid",
  symbol: normalizeSymbol(payload.symbol),
  timeframe: normalizeTimeframe(payload.timeframe || payload.bunbong),
  positionSide: normalizePositionSide(payload.positionSide || payload.leg),
  regimeId: payload.regimeId || payload.gridRowId || payload.pid || null,
  triggerPrice: Number(payload.triggerPrice || 0),
  reentryQty: Number(payload.reentryQty || payload.qty || 0),
  ownedQtyBasis: Number(payload.ownedQtyBasis || payload.closedQty || payload.fillQty || 0),
  sourceTakeProfitClientOrderId: payload.sourceTakeProfitClientOrderId || payload.sourceClientOrderId || null,
  sourceOrderId: payload.sourceOrderId == null ? null : String(payload.sourceOrderId),
  sourceTradeId: payload.sourceTradeId == null ? null : String(payload.sourceTradeId),
  tradeTime: payload.tradeTime == null ? null : String(payload.tradeTime),
  reentryClientOrderId: payload.reentryClientOrderId || null,
});

const normalizeCancelIntentPayload = (payload = {}) => ({
  ...payload,
  uid: Number(payload.uid || 0),
  pid: Number(payload.pid || 0),
  strategyCategory: "grid",
  symbol: normalizeSymbol(payload.symbol),
  positionSide: normalizePositionSide(payload.positionSide || payload.leg),
  regimeId: payload.regimeId || payload.gridRowId || payload.pid || null,
  targetType: String(payload.targetType || "ALL_FOR_REGIME").trim().toUpperCase(),
  targetOrderId: payload.targetOrderId == null ? null : String(payload.targetOrderId),
  targetClientOrderId: payload.targetClientOrderId || payload.clientOrderId || null,
  includeEntries: payload.includeEntries !== false,
  includeExits: payload.includeExits !== false,
  reason: String(payload.reason || payload.sourceReason || "GRID_CANCEL").trim().toUpperCase(),
  sourceReason: String(payload.sourceReason || payload.reason || "GRID_CANCEL").trim().toUpperCase(),
});

const normalizeCloseIntentPayload = (payload = {}) => {
  const normalized = {
    ...payload,
    uid: Number(payload.uid || 0),
    pid: Number(payload.pid || 0),
    strategyCategory: "grid",
    symbol: normalizeSymbol(payload.symbol),
    positionSide: normalizePositionSide(payload.positionSide || payload.leg),
    regimeId: payload.regimeId || payload.gridRowId || payload.pid || null,
    qty: Number(payload.qty || payload.ownedQtyBasis || payload.ownedQty || 0),
    ownedQtyBasis: Number(payload.ownedQtyBasis || payload.qty || payload.ownedQty || 0),
    reservedCloseQtyBasis: Number(payload.reservedCloseQtyBasis || 0),
    reason: String(payload.reason || "CONTROLLED_CLOSE").trim().toUpperCase(),
    gridRegimeKey: String(payload.gridRegimeKey || payload.regimeKey || "").trim() || null,
    sourceEventId: payload.sourceEventId == null ? null : String(payload.sourceEventId),
    sourceOrderId: payload.sourceOrderId == null ? null : String(payload.sourceOrderId),
    sourceTradeId: payload.sourceTradeId == null ? null : String(payload.sourceTradeId),
    sourceClientOrderId: payload.sourceClientOrderId || null,
    closeClientOrderId: payload.closeClientOrderId || null,
  };
  normalized.closeClientOrderId = normalized.closeClientOrderId || buildGridCloseClientOrderId(normalized);
  return normalized;
};

const buildGridReentryIntentPayloadHash = ({ payload = {} } = {}) => {
  const normalized = normalizeReentryIntentPayload(payload);
  return sha1(
    safeJsonStringify({
      action: INTENT_TYPE.GRID_REENTRY_CREATE,
      uid: normalized.uid,
      pid: normalized.pid,
      symbol: normalized.symbol,
      timeframe: normalized.timeframe,
      positionSide: normalized.positionSide,
      regimeId: normalized.regimeId,
      triggerPrice: normalized.triggerPrice,
      reentryQty: normalized.reentryQty,
      ownedQtyBasis: normalized.ownedQtyBasis,
      sourceTakeProfitClientOrderId: normalized.sourceTakeProfitClientOrderId,
      sourceOrderId: normalized.sourceOrderId,
      sourceTradeId: normalized.sourceTradeId,
      tradeTime: normalized.tradeTime,
    })
  );
};

const buildGridReentryIntentKey = ({ payload = {} } = {}) => {
  const normalized = normalizeReentryIntentPayload(payload);
  const tradeIdentity = normalized.sourceTradeId
    || normalized.sourceOrderId
    || normalized.sourceTakeProfitClientOrderId
    || buildGridReentryIntentPayloadHash({ payload: normalized });
  return [
    INTENT_TYPE.GRID_REENTRY_CREATE,
    normalized.uid,
    normalized.pid,
    normalized.symbol,
    normalized.positionSide,
    tradeIdentity,
  ].join(":");
};

const buildGridReentryFifoKey = ({ payload = {} } = {}) => {
  const normalized = normalizeReentryIntentPayload(payload);
  return [
    normalized.uid,
    "grid",
    normalized.pid,
    "regime",
    normalized.regimeId || normalized.pid,
  ].join(":");
};

const resolveGridCancelIntentType = (payload = {}) => {
  const normalizedType = String(payload.intentType || "").trim().toUpperCase();
  if (
    normalizedType === INTENT_TYPE.GRID_CANCEL_ORDER ||
    normalizedType === INTENT_TYPE.GRID_CANCEL_ALL_FOR_REGIME ||
    normalizedType === INTENT_TYPE.GRID_REGIME_CLEANUP_CANCEL
  ) {
    return normalizedType;
  }
  const targetType = String(payload.targetType || "").trim().toUpperCase();
  if (targetType === "ORDER" || payload.targetClientOrderId || payload.targetOrderId) {
    return INTENT_TYPE.GRID_CANCEL_ORDER;
  }
  if (targetType === "REGIME_CLEANUP") {
    return INTENT_TYPE.GRID_REGIME_CLEANUP_CANCEL;
  }
  return INTENT_TYPE.GRID_CANCEL_ALL_FOR_REGIME;
};

const resolveGridCloseIntentType = (payload = {}) => {
  const normalizedType = String(payload.intentType || "").trim().toUpperCase();
  if (
    normalizedType === INTENT_TYPE.GRID_GMANUAL_CLOSE ||
    normalizedType === INTENT_TYPE.GRID_CONTROLLED_CLOSE
  ) {
    return normalizedType;
  }
  const reason = String(payload.reason || "").trim().toUpperCase();
  if (reason.includes("GMANUAL") || reason.includes("MANUAL")) {
    return INTENT_TYPE.GRID_GMANUAL_CLOSE;
  }
  return INTENT_TYPE.GRID_CONTROLLED_CLOSE;
};

const buildGridCancelIntentPayloadHash = ({ payload = {} } = {}) => {
  const normalized = normalizeCancelIntentPayload(payload);
  return sha1(
    safeJsonStringify({
      action: resolveGridCancelIntentType(normalized),
      uid: normalized.uid,
      pid: normalized.pid,
      symbol: normalized.symbol,
      positionSide: normalized.positionSide,
      regimeId: normalized.regimeId,
      targetType: normalized.targetType,
      targetOrderId: normalized.targetOrderId,
      targetClientOrderId: normalized.targetClientOrderId,
      includeEntries: normalized.includeEntries,
      includeExits: normalized.includeExits,
      reason: normalized.reason,
    })
  );
};

const buildGridCancelIntentKey = ({ payload = {} } = {}) => {
  const normalized = normalizeCancelIntentPayload(payload);
  const intentType = resolveGridCancelIntentType(normalized);
  const targetIdentity = normalized.targetClientOrderId
    || normalized.targetOrderId
    || `${normalized.targetType}:${normalized.includeEntries ? "E1" : "E0"}:${normalized.includeExits ? "X1" : "X0"}:${normalized.reason}`;
  return [
    intentType,
    normalized.uid,
    normalized.pid,
    normalized.symbol,
    normalized.positionSide || "ALL",
    targetIdentity,
  ].join(":");
};

const buildGridCancelFifoKey = ({ payload = {} } = {}) => {
  const normalized = normalizeCancelIntentPayload(payload);
  return [
    normalized.uid,
    "grid",
    normalized.pid,
    "regime",
    normalized.regimeId || normalized.pid,
  ].join(":");
};

const buildGridCloseClientOrderId = (payload = {}) => {
  const sideCode = normalizePositionSide(payload.positionSide || payload.leg) === "SHORT" ? "S" : "L";
  const seed = sha1(
    safeJsonStringify({
      uid: Number(payload.uid || 0),
      pid: Number(payload.pid || 0),
      symbol: normalizeSymbol(payload.symbol),
      positionSide: normalizePositionSide(payload.positionSide || payload.leg),
      reason: payload.reason || null,
      sourceEventId: payload.sourceEventId || null,
      sourceOrderId: payload.sourceOrderId || null,
      sourceTradeId: payload.sourceTradeId || null,
      sourceClientOrderId: payload.sourceClientOrderId || null,
    })
  );
  const suffix = String(parseInt(seed.slice(0, 10), 16) % 100000000).padStart(8, "0");
  return `GMANUAL_${sideCode}_${Number(payload.uid || 0)}_${Number(payload.pid || 0)}_${suffix}`;
};

const buildGridCloseIntentPayloadHash = ({ payload = {} } = {}) => {
  const normalized = normalizeCloseIntentPayload(payload);
  return sha1(
    safeJsonStringify({
      action: resolveGridCloseIntentType(normalized),
      uid: normalized.uid,
      pid: normalized.pid,
      symbol: normalized.symbol,
      positionSide: normalized.positionSide,
      regimeId: normalized.regimeId,
      gridRegimeKey: normalized.gridRegimeKey,
      qty: normalized.qty,
      ownedQtyBasis: normalized.ownedQtyBasis,
      reason: normalized.reason,
      sourceEventId: normalized.sourceEventId,
      sourceOrderId: normalized.sourceOrderId,
      sourceTradeId: normalized.sourceTradeId,
      sourceClientOrderId: normalized.sourceClientOrderId,
      closeClientOrderId: normalized.closeClientOrderId,
    })
  );
};

const buildGridCloseIntentKey = ({ payload = {} } = {}) => {
  const normalized = normalizeCloseIntentPayload(payload);
  const intentType = resolveGridCloseIntentType(normalized);
  const closeIdentity = normalized.closeClientOrderId
    || normalized.sourceTradeId
    || normalized.sourceOrderId
    || buildGridCloseIntentPayloadHash({ payload: normalized });
  return [
    intentType,
    normalized.uid,
    normalized.pid,
    normalized.symbol,
    normalized.positionSide,
    closeIdentity,
  ].join(":");
};

const buildGridCloseFifoKey = ({ payload = {} } = {}) => {
  const normalized = normalizeCloseIntentPayload(payload);
  return [
    normalized.uid,
    "grid",
    normalized.pid,
    "regime",
    normalized.regimeId || normalized.pid,
  ].join(":");
};

const normalizeQueuedIntentRow = (row = null) => {
  if (!row) {
    return null;
  }
  return {
    ...row,
    id: Number(row.id || 0),
    uid: Number(row.uid || 0),
    pid: Number(row.pid || 0),
    priority: Number(row.priority || 0),
    attemptCount: Number(row.attemptCount || 0),
    maxAttempts: Number(row.maxAttempts || 0),
    payload: parseJsonSafe(row.payloadJson, null),
    result: parseJsonSafe(row.resultJson, null),
  };
};

const enqueueGridLiveArmIntents = async ({
  payload = {},
  previewResult = {},
  routePath = "/user/api/grid/hook",
  sourceEventId = null,
} = {}) => {
  await ensureOrderIntentSchema();
  const liveTargets = (previewResult?.targetItems || []).filter(
    (item) =>
      item?.strategyCategory === "grid" &&
      item?.strategyMode === "live" &&
      String(item.resultCode || "").toUpperCase() === "GRID_ARM_PREVIEW"
  );

  const summary = {
    requested: liveTargets.length,
    inserted: 0,
    duplicate: 0,
    intents: [],
  };

  for (const targetItem of liveTargets) {
    const payloadHash = buildGridArmIntentPayloadHash({ payload, targetItem });
    const intentKey = buildGridArmIntentKey({ payload, targetItem });
    const fifoKey = buildGridArmFifoKey({ targetItem });
    const intentPayload = {
      action: INTENT_TYPE.GRID_LIVE_ARM,
      routePath,
      sourceEventId,
      targetItem,
      gridPayload: payload,
    };

    const [result] = await db.query(
      `INSERT IGNORE INTO order_intent_queue
        (
          intentKey,
          fifoKey,
          uid,
          pid,
          strategyCategory,
          intentType,
          status,
          priority,
          attemptCount,
          maxAttempts,
          routePath,
          sourceEventId,
          payloadHash,
          payloadJson
        )
       VALUES (?, ?, ?, ?, 'grid', ?, ?, 100, 0, ?, ?, ?, ?, ?)`,
      [
        intentKey,
        fifoKey,
        Number(targetItem.uid || 0),
        Number(targetItem.pid || 0),
        INTENT_TYPE.GRID_LIVE_ARM,
        STATUS.PENDING,
        DEFAULT_MAX_ATTEMPTS,
        routePath,
        sourceEventId,
        payloadHash,
        safeJsonStringify(intentPayload),
      ]
    );

    const inserted = Number(result?.affectedRows || 0) === 1;
    if (inserted) {
      summary.inserted += 1;
    } else {
      summary.duplicate += 1;
    }

    summary.intents.push({
      intentKey,
      fifoKey,
      uid: Number(targetItem.uid || 0),
      pid: Number(targetItem.pid || 0),
      status: inserted ? STATUS.PENDING : "DUPLICATE",
    });
  }

  return summary;
};

const findSignalMarketEntryDuplicateGuard = async ({ normalized = {}, intentKey = null } = {}) => {
  try {
    const [intentRows] = await db.query(
      `SELECT id, status, intentKey
         FROM order_intent_queue
        WHERE uid = ?
          AND pid = ?
          AND strategyCategory = 'signal'
          AND intentType = ?
          AND status IN ('PENDING', 'RUNNING', 'DONE')
          AND (
            intentKey = ?
            OR (
              JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.signalEntry.symbol')) = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.signalEntry.side')) = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.signalEntry.positionSide')) = ?
              AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.signalEntry.strategyRuntimeCode')), '') = ?
              AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.signalEntry.timeframe')), '') = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.signalEntry.signalTime')) = ?
            )
          )
        ORDER BY FIELD(status, 'PENDING', 'RUNNING', 'DONE'), id DESC
        LIMIT 1`,
      [
        normalized.uid,
        normalized.pid,
        INTENT_TYPE.SIGNAL_MARKET_ENTRY,
        intentKey,
        normalized.symbol,
        normalized.side,
        normalized.positionSide,
        normalized.strategyRuntimeCode || "",
        normalized.timeframe || "",
        normalized.signalTime,
      ]
    );

    const [ownershipRows] = await db.query(
      `SELECT id, ownedQty
         FROM live_position_bucket_owner
        WHERE uid = ?
          AND ownerPid = ?
          AND ownerStrategyCategory = 'signal'
          AND symbol = ?
          AND positionSide = ?
          AND status = 'OPEN'
          AND ownerState = 'OPEN'
          AND ownedQty > 0
        ORDER BY id DESC
        LIMIT 1`,
      [normalized.uid, normalized.pid, normalized.symbol, normalized.positionSide]
    );

    const [snapshotRows] = await db.query(
      `SELECT id, openQty
         FROM live_pid_position_snapshot
        WHERE uid = ?
          AND pid = ?
          AND strategyCategory = 'signal'
          AND symbol = ?
          AND positionSide = ?
          AND status = 'OPEN'
          AND openQty > 0
        ORDER BY id DESC
        LIMIT 1`,
      [normalized.uid, normalized.pid, normalized.symbol, normalized.positionSide]
    );

    const [livePlayRows] = await db.query(
      `SELECT id, status, r_qty
         FROM live_play_list
        WHERE uid = ?
          AND id = ?
          AND symbol = ?
          AND status = 'EXACT'
          AND COALESCE(r_qty, 0) > 0
        LIMIT 1`,
      [normalized.uid, normalized.pid, normalized.symbol]
    );

    return signalMarketEntryIdempotency.evaluateSignalMarketEntryDuplicateGuardSnapshot({
      existingIntent: intentRows?.[0] || null,
      openOwnership: ownershipRows?.[0] || null,
      openSnapshot: snapshotRows?.[0] || null,
      livePlay: livePlayRows?.[0] || null,
    });
  } catch (error) {
    return {
      duplicate: true,
      reason: "SIGNAL_MARKET_ENTRY_DUPLICATE_GUARD_UNAVAILABLE",
      source: "duplicate_guard",
      error: error?.message || String(error),
    };
  }
};

const enqueueSignalMarketEntryIntent = async ({
  payload = {},
  routePath = "signal-runtime-entry",
  sourceEventId = null,
} = {}) => {
  await ensureOrderIntentSchema();
  const normalized = normalizeSignalMarketEntryIntentPayload(payload);
  if (!normalized.uid || !normalized.pid || !normalized.symbol || !normalized.side) {
    throw new Error("SIGNAL_MARKET_ENTRY_INTENT_INVALID_OWNER");
  }

  const identity = signalMarketEntryIdempotency.buildSignalMarketEntryStableIdentityFields(normalized);
  if (!identity.ok) {
    return {
      requested: 1,
      inserted: 0,
      duplicate: 0,
      blocked: 1,
      reason: identity.reason,
      intent: {
        uid: normalized.uid,
        pid: normalized.pid,
        status: STATUS.BLOCKED,
        payloadHash: null,
        intentType: INTENT_TYPE.SIGNAL_MARKET_ENTRY,
        clientOrderId: normalized.clientOrderId,
      },
    };
  }

  const payloadHash = buildSignalMarketEntryIntentPayloadHash({ payload: normalized });
  const intentKey = buildSignalMarketEntryIntentKey({ payload: normalized });
  const fifoKey = buildSignalMarketEntryFifoKey({ payload: normalized });
  const duplicateGuard = await findSignalMarketEntryDuplicateGuard({ normalized, intentKey });
  if (duplicateGuard.duplicate) {
    return {
      requested: 1,
      inserted: 0,
      duplicate: 1,
      blocked: duplicateGuard.reason === "SIGNAL_MARKET_ENTRY_DUPLICATE_GUARD_UNAVAILABLE" ? 1 : 0,
      reason: duplicateGuard.reason,
      intent: {
        intentKey,
        fifoKey,
        uid: normalized.uid,
        pid: normalized.pid,
        status: "DUPLICATE",
        payloadHash,
        intentType: INTENT_TYPE.SIGNAL_MARKET_ENTRY,
        clientOrderId: normalized.clientOrderId,
        duplicateGuard,
      },
    };
  }
  const intentPayload = {
    action: INTENT_TYPE.SIGNAL_MARKET_ENTRY,
    routePath,
    sourceEventId: sourceEventId || normalized.sourceWebhookEventId || null,
    sourceTargetId: normalized.sourceWebhookTargetId || null,
    signalEntry: normalized,
  };

  const [result] = await db.query(
    `INSERT IGNORE INTO order_intent_queue
      (
        intentKey,
        fifoKey,
        uid,
        pid,
        strategyCategory,
        intentType,
        status,
        priority,
        attemptCount,
        maxAttempts,
        routePath,
        sourceEventId,
        payloadHash,
        payloadJson
      )
     VALUES (?, ?, ?, ?, 'signal', ?, ?, 80, 0, ?, ?, ?, ?, ?)`,
    [
      intentKey,
      fifoKey,
      normalized.uid,
      normalized.pid,
      INTENT_TYPE.SIGNAL_MARKET_ENTRY,
      STATUS.PENDING,
      DEFAULT_MAX_ATTEMPTS,
      routePath,
      sourceEventId || normalized.sourceWebhookEventId || null,
      payloadHash,
      safeJsonStringify(intentPayload),
    ]
  );

  const inserted = Number(result?.affectedRows || 0) === 1;
  return {
    requested: 1,
    inserted: inserted ? 1 : 0,
    duplicate: inserted ? 0 : 1,
    intent: {
      intentKey,
      fifoKey,
      uid: normalized.uid,
      pid: normalized.pid,
      status: inserted ? STATUS.PENDING : "DUPLICATE",
      payloadHash,
      intentType: INTENT_TYPE.SIGNAL_MARKET_ENTRY,
      clientOrderId: normalized.clientOrderId,
    },
  };
};

const attachSignalMarketEntryWebhookTarget = async ({
  intentKey = null,
  sourceWebhookEventId = null,
  sourceWebhookTargetId = null,
} = {}) => {
  if (!intentKey || !sourceWebhookEventId || !sourceWebhookTargetId) {
    return { matchedRows: 0, changedRows: 0, skipped: true };
  }
  await ensureOrderIntentSchema();
  const [result] = await db.query(
    `UPDATE order_intent_queue
        SET sourceEventId = COALESCE(sourceEventId, ?),
            payloadJson = JSON_SET(
              COALESCE(payloadJson, JSON_OBJECT()),
              '$.sourceEventId', ?,
              '$.sourceTargetId', ?,
              '$.signalEntry.sourceWebhookEventId', ?,
              '$.signalEntry.sourceWebhookTargetId', ?
            )
      WHERE intentKey = ?
        AND intentType = ?
      LIMIT 1`,
    [
      sourceWebhookEventId,
      String(sourceWebhookEventId),
      String(sourceWebhookTargetId),
      String(sourceWebhookEventId),
      String(sourceWebhookTargetId),
      intentKey,
      INTENT_TYPE.SIGNAL_MARKET_ENTRY,
    ]
  );
  return {
    matchedRows: Number(result?.affectedRows || 0),
    changedRows: Number(result?.changedRows || 0),
  };
};

const enqueueSignalProtectionIntent = async ({
  payload = {},
  intentType = null,
  routePath = "signal-runtime-protection",
  sourceEventId = null,
} = {}) => {
  await ensureOrderIntentSchema();
  const normalized = normalizeSignalProtectionIntentPayload({
    ...payload,
    intentType: intentType || payload.intentType,
  });
  if (!normalized.uid || !normalized.pid || !normalized.symbol || !normalized.positionSide) {
    throw new Error("SIGNAL_PROTECTION_INTENT_INVALID_OWNER");
  }

  const resolvedIntentType = resolveSignalProtectionIntentType(normalized);
  const payloadHash = buildSignalProtectionIntentPayloadHash({ payload: normalized });
  const intentKey = buildSignalProtectionIntentKey({ payload: normalized });
  const fifoKey = buildSignalFifoKey({ payload: normalized });
  const intentPayload = {
    action: resolvedIntentType,
    routePath,
    sourceEventId,
    protection: normalized,
  };

  const [result] = await db.query(
    `INSERT IGNORE INTO order_intent_queue
      (
        intentKey,
        fifoKey,
        uid,
        pid,
        strategyCategory,
        intentType,
        status,
        priority,
        attemptCount,
        maxAttempts,
        routePath,
        sourceEventId,
        payloadHash,
        payloadJson
      )
     VALUES (?, ?, ?, ?, 'signal', ?, ?, 82, 0, ?, ?, ?, ?, ?)`,
    [
      intentKey,
      fifoKey,
      normalized.uid,
      normalized.pid,
      resolvedIntentType,
      STATUS.PENDING,
      DEFAULT_MAX_ATTEMPTS,
      routePath,
      sourceEventId,
      payloadHash,
      safeJsonStringify(intentPayload),
    ]
  );

  const inserted = Number(result?.affectedRows || 0) === 1;
  return {
    requested: 1,
    inserted: inserted ? 1 : 0,
    duplicate: inserted ? 0 : 1,
    intent: {
      intentKey,
      fifoKey,
      uid: normalized.uid,
      pid: normalized.pid,
      status: inserted ? STATUS.PENDING : "DUPLICATE",
      payloadHash,
      intentType: resolvedIntentType,
    },
  };
};

const enqueueSignalCancelIntent = async ({
  payload = {},
  intentType = null,
  routePath = "signal-runtime-cancel",
  sourceEventId = null,
} = {}) => {
  await ensureOrderIntentSchema();
  const normalized = normalizeSignalCancelIntentPayload({
    ...payload,
    intentType: intentType || payload.intentType,
  });
  if (!normalized.uid || !normalized.pid || !normalized.symbol) {
    throw new Error("SIGNAL_CANCEL_INTENT_INVALID_OWNER");
  }

  const resolvedIntentType = resolveSignalCancelIntentType(normalized);
  const payloadHash = buildSignalCancelIntentPayloadHash({ payload: normalized });
  const intentKey = buildSignalCancelIntentKey({ payload: normalized });
  const fifoKey = buildSignalFifoKey({ payload: normalized });
  const intentPayload = {
    action: resolvedIntentType,
    routePath,
    sourceEventId,
    cancel: normalized,
  };

  const [result] = await db.query(
    `INSERT IGNORE INTO order_intent_queue
      (
        intentKey,
        fifoKey,
        uid,
        pid,
        strategyCategory,
        intentType,
        status,
        priority,
        attemptCount,
        maxAttempts,
        routePath,
        sourceEventId,
        payloadHash,
        payloadJson
      )
     VALUES (?, ?, ?, ?, 'signal', ?, ?, 72, 0, ?, ?, ?, ?, ?)`,
    [
      intentKey,
      fifoKey,
      normalized.uid,
      normalized.pid,
      resolvedIntentType,
      STATUS.PENDING,
      DEFAULT_MAX_ATTEMPTS,
      routePath,
      sourceEventId,
      payloadHash,
      safeJsonStringify(intentPayload),
    ]
  );

  const inserted = Number(result?.affectedRows || 0) === 1;
  return {
    requested: 1,
    inserted: inserted ? 1 : 0,
    duplicate: inserted ? 0 : 1,
    intent: {
      intentKey,
      fifoKey,
      uid: normalized.uid,
      pid: normalized.pid,
      status: inserted ? STATUS.PENDING : "DUPLICATE",
      payloadHash,
      intentType: resolvedIntentType,
    },
  };
};

const enqueueSignalCloseIntent = async ({
  payload = {},
  intentType = null,
  routePath = "signal-runtime-close",
  sourceEventId = null,
} = {}) => {
  await ensureOrderIntentSchema();
  const normalized = normalizeSignalCloseIntentPayload({
    ...payload,
    intentType: intentType || payload.intentType,
  });
  if (!normalized.uid || !normalized.pid || !normalized.symbol || !normalized.positionSide) {
    throw new Error("SIGNAL_CLOSE_INTENT_INVALID_OWNER");
  }

  const resolvedIntentType = resolveSignalCloseIntentType(normalized);
  const payloadHash = buildSignalCloseIntentPayloadHash({ payload: normalized });
  const intentKey = buildSignalCloseIntentKey({ payload: normalized });
  const fifoKey = buildSignalFifoKey({ payload: normalized });
  const intentPayload = {
    action: resolvedIntentType,
    routePath,
    sourceEventId,
    close: normalized,
  };

  const [result] = await db.query(
    `INSERT IGNORE INTO order_intent_queue
      (
        intentKey,
        fifoKey,
        uid,
        pid,
        strategyCategory,
        intentType,
        status,
        priority,
        attemptCount,
        maxAttempts,
        routePath,
        sourceEventId,
        payloadHash,
        payloadJson
      )
     VALUES (?, ?, ?, ?, 'signal', ?, ?, 76, 0, ?, ?, ?, ?, ?)`,
    [
      intentKey,
      fifoKey,
      normalized.uid,
      normalized.pid,
      resolvedIntentType,
      STATUS.PENDING,
      DEFAULT_MAX_ATTEMPTS,
      routePath,
      sourceEventId,
      payloadHash,
      safeJsonStringify(intentPayload),
    ]
  );

  const inserted = Number(result?.affectedRows || 0) === 1;
  return {
    requested: 1,
    inserted: inserted ? 1 : 0,
    duplicate: inserted ? 0 : 1,
    intent: {
      intentKey,
      fifoKey,
      uid: normalized.uid,
      pid: normalized.pid,
      status: inserted ? STATUS.PENDING : "DUPLICATE",
      payloadHash,
      intentType: resolvedIntentType,
      closeClientOrderId: normalized.closeClientOrderId,
    },
  };
};

const enqueueGridProtectionCreateIntent = async ({
  payload = {},
  routePath = "grid-runtime-entry-fill",
  sourceEventId = null,
} = {}) => {
  await ensureOrderIntentSchema();
  const normalized = normalizeProtectionIntentPayload(payload);
  if (!normalized.uid || !normalized.pid || !normalized.symbol || !normalized.positionSide) {
    throw new Error("GRID_PROTECTION_INTENT_INVALID_OWNER");
  }

  const payloadHash = buildGridProtectionIntentPayloadHash({ payload: normalized });
  const intentKey = buildGridProtectionIntentKey({ payload: normalized });
  const fifoKey = buildGridProtectionFifoKey({ payload: normalized });
  const intentPayload = {
    action: INTENT_TYPE.GRID_PROTECTION_CREATE,
    routePath,
    sourceEventId,
    protection: normalized,
  };

  const [result] = await db.query(
    `INSERT IGNORE INTO order_intent_queue
      (
        intentKey,
        fifoKey,
        uid,
        pid,
        strategyCategory,
        intentType,
        status,
        priority,
        attemptCount,
        maxAttempts,
        routePath,
        sourceEventId,
        payloadHash,
        payloadJson
      )
     VALUES (?, ?, ?, ?, 'grid', ?, ?, 90, 0, ?, ?, ?, ?, ?)`,
    [
      intentKey,
      fifoKey,
      normalized.uid,
      normalized.pid,
      INTENT_TYPE.GRID_PROTECTION_CREATE,
      STATUS.PENDING,
      DEFAULT_MAX_ATTEMPTS,
      routePath,
      sourceEventId,
      payloadHash,
      safeJsonStringify(intentPayload),
    ]
  );

  const inserted = Number(result?.affectedRows || 0) === 1;
  return {
    requested: 1,
    inserted: inserted ? 1 : 0,
    duplicate: inserted ? 0 : 1,
    intent: {
      intentKey,
      fifoKey,
      uid: normalized.uid,
      pid: normalized.pid,
      status: inserted ? STATUS.PENDING : "DUPLICATE",
      payloadHash,
    },
  };
};

const enqueueGridReentryCreateIntent = async ({
  payload = {},
  routePath = "grid-runtime-tp-reentry",
  sourceEventId = null,
} = {}) => {
  await ensureOrderIntentSchema();
  const normalized = normalizeReentryIntentPayload(payload);
  if (!normalized.uid || !normalized.pid || !normalized.symbol || !normalized.positionSide) {
    throw new Error("GRID_REENTRY_INTENT_INVALID_OWNER");
  }

  const payloadHash = buildGridReentryIntentPayloadHash({ payload: normalized });
  const intentKey = buildGridReentryIntentKey({ payload: normalized });
  const fifoKey = buildGridReentryFifoKey({ payload: normalized });
  const intentPayload = {
    action: INTENT_TYPE.GRID_REENTRY_CREATE,
    routePath,
    sourceEventId,
    reentry: normalized,
  };

  const [result] = await db.query(
    `INSERT IGNORE INTO order_intent_queue
      (
        intentKey,
        fifoKey,
        uid,
        pid,
        strategyCategory,
        intentType,
        status,
        priority,
        attemptCount,
        maxAttempts,
        routePath,
        sourceEventId,
        payloadHash,
        payloadJson
      )
     VALUES (?, ?, ?, ?, 'grid', ?, ?, 95, 0, ?, ?, ?, ?, ?)`,
    [
      intentKey,
      fifoKey,
      normalized.uid,
      normalized.pid,
      INTENT_TYPE.GRID_REENTRY_CREATE,
      STATUS.PENDING,
      DEFAULT_MAX_ATTEMPTS,
      routePath,
      sourceEventId,
      payloadHash,
      safeJsonStringify(intentPayload),
    ]
  );

  const inserted = Number(result?.affectedRows || 0) === 1;
  return {
    requested: 1,
    inserted: inserted ? 1 : 0,
    duplicate: inserted ? 0 : 1,
    intent: {
      intentKey,
      fifoKey,
      uid: normalized.uid,
      pid: normalized.pid,
      status: inserted ? STATUS.PENDING : "DUPLICATE",
      payloadHash,
    },
  };
};

const enqueueGridCancelIntent = async ({
  payload = {},
  intentType = null,
  routePath = "grid-runtime-cancel",
  sourceEventId = null,
} = {}) => {
  await ensureOrderIntentSchema();
  const normalized = normalizeCancelIntentPayload({
    ...payload,
    intentType: intentType || payload.intentType,
  });
  if (!normalized.uid || !normalized.pid || !normalized.symbol) {
    throw new Error("GRID_CANCEL_INTENT_INVALID_OWNER");
  }

  const resolvedIntentType = resolveGridCancelIntentType(normalized);
  const payloadHash = buildGridCancelIntentPayloadHash({ payload: normalized });
  const intentKey = buildGridCancelIntentKey({ payload: normalized });
  const fifoKey = buildGridCancelFifoKey({ payload: normalized });
  const intentPayload = {
    action: resolvedIntentType,
    routePath,
    sourceEventId,
    cancel: normalized,
  };

  const [result] = await db.query(
    `INSERT IGNORE INTO order_intent_queue
      (
        intentKey,
        fifoKey,
        uid,
        pid,
        strategyCategory,
        intentType,
        status,
        priority,
        attemptCount,
        maxAttempts,
        routePath,
        sourceEventId,
        payloadHash,
        payloadJson
      )
     VALUES (?, ?, ?, ?, 'grid', ?, ?, 70, 0, ?, ?, ?, ?, ?)`,
    [
      intentKey,
      fifoKey,
      normalized.uid,
      normalized.pid,
      resolvedIntentType,
      STATUS.PENDING,
      DEFAULT_MAX_ATTEMPTS,
      routePath,
      sourceEventId,
      payloadHash,
      safeJsonStringify(intentPayload),
    ]
  );

  const inserted = Number(result?.affectedRows || 0) === 1;
  return {
    requested: 1,
    inserted: inserted ? 1 : 0,
    duplicate: inserted ? 0 : 1,
    intent: {
      intentKey,
      fifoKey,
      uid: normalized.uid,
      pid: normalized.pid,
      status: inserted ? STATUS.PENDING : "DUPLICATE",
      payloadHash,
      intentType: resolvedIntentType,
    },
  };
};

const enqueueGridCloseIntent = async ({
  payload = {},
  intentType = null,
  routePath = "grid-runtime-close",
  sourceEventId = null,
} = {}) => {
  await ensureOrderIntentSchema();
  const normalized = normalizeCloseIntentPayload({
    ...payload,
    intentType: intentType || payload.intentType,
  });
  if (!normalized.uid || !normalized.pid || !normalized.symbol || !normalized.positionSide) {
    throw new Error("GRID_CLOSE_INTENT_INVALID_OWNER");
  }

  const resolvedIntentType = resolveGridCloseIntentType(normalized);
  const payloadHash = buildGridCloseIntentPayloadHash({ payload: normalized });
  const intentKey = buildGridCloseIntentKey({ payload: normalized });
  const fifoKey = buildGridCloseFifoKey({ payload: normalized });
  const intentPayload = {
    action: resolvedIntentType,
    routePath,
    sourceEventId,
    close: normalized,
  };

  const [result] = await db.query(
    `INSERT IGNORE INTO order_intent_queue
      (
        intentKey,
        fifoKey,
        uid,
        pid,
        strategyCategory,
        intentType,
        status,
        priority,
        attemptCount,
        maxAttempts,
        routePath,
        sourceEventId,
        payloadHash,
        payloadJson
      )
     VALUES (?, ?, ?, ?, 'grid', ?, ?, 75, 0, ?, ?, ?, ?, ?)`,
    [
      intentKey,
      fifoKey,
      normalized.uid,
      normalized.pid,
      resolvedIntentType,
      STATUS.PENDING,
      DEFAULT_MAX_ATTEMPTS,
      routePath,
      sourceEventId,
      payloadHash,
      safeJsonStringify(intentPayload),
    ]
  );

  const inserted = Number(result?.affectedRows || 0) === 1;
  return {
    requested: 1,
    inserted: inserted ? 1 : 0,
    duplicate: inserted ? 0 : 1,
    intent: {
      intentKey,
      fifoKey,
      uid: normalized.uid,
      pid: normalized.pid,
      status: inserted ? STATUS.PENDING : "DUPLICATE",
      payloadHash,
      intentType: resolvedIntentType,
      closeClientOrderId: normalized.closeClientOrderId,
    },
  };
};

const claimNextIntent = async ({ workerId = null } = {}) => {
  await ensureOrderIntentSchema();
  const claimWorkerId = String(workerId || `worker-${process.pid || "local"}`).slice(0, 80);
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT *
         FROM order_intent_queue q
        WHERE q.status = 'PENDING'
          AND q.availableAt <= NOW()
          AND NOT EXISTS (
            SELECT 1
              FROM order_intent_queue earlier
             WHERE earlier.fifoKey = q.fifoKey
               AND earlier.id < q.id
               AND earlier.status IN ('PENDING', 'RUNNING')
          )
        ORDER BY q.priority ASC, q.id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`
    );

    const row = rows?.[0] || null;
    if (!row) {
      await connection.commit();
      return null;
    }

    await connection.query(
      `UPDATE order_intent_queue
          SET status = 'RUNNING',
              lockedBy = ?,
              lockedAt = NOW(),
              startedAt = COALESCE(startedAt, NOW()),
              attemptCount = attemptCount + 1
        WHERE id = ?
          AND status = 'PENDING'`,
      [claimWorkerId, row.id]
    );

    await connection.commit();
    return normalizeQueuedIntentRow({
      ...row,
      status: STATUS.RUNNING,
      lockedBy: claimWorkerId,
      attemptCount: Number(row.attemptCount || 0) + 1,
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

const completeIntent = async ({ id, status, result = null, errorCode = null, errorMessage = null } = {}) => {
  await ensureOrderIntentSchema();
  const normalizedStatus = String(status || "").trim().toUpperCase();
  if (!Object.values(STATUS).includes(normalizedStatus)) {
    throw new Error(`invalid intent status:${status}`);
  }

  await db.query(
    `UPDATE order_intent_queue
        SET status = ?,
            finishedAt = CASE WHEN ? IN ('DONE', 'FAILED', 'BLOCKED') THEN NOW() ELSE finishedAt END,
            lockedBy = CASE WHEN ? IN ('DONE', 'FAILED', 'BLOCKED') THEN NULL ELSE lockedBy END,
            lockedAt = CASE WHEN ? IN ('DONE', 'FAILED', 'BLOCKED') THEN NULL ELSE lockedAt END,
            resultJson = ?,
            lastErrorCode = ?,
            lastErrorMessage = ?
      WHERE id = ?`,
    [
      normalizedStatus,
      normalizedStatus,
      normalizedStatus,
      normalizedStatus,
      safeJsonStringify(result),
      errorCode || null,
      errorMessage ? String(errorMessage).slice(0, 255) : null,
      id,
    ]
  );
};

const updateSignalEntryProtectionChildState = async ({
  entryIntentId = null,
  protectionIntentId = null,
  childState = null,
  reason = null,
  childStatus = null,
  childResult = {},
} = {}) => {
  await ensureOrderIntentSchema();
  const resolvedEntryIntentId = Number(entryIntentId || 0);
  if (!resolvedEntryIntentId || !childState) {
    return { updated: 0, reason: "ENTRY_PROTECTION_CHILD_LINK_MISSING" };
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, intentType, status, resultJson
         FROM order_intent_queue
        WHERE id = ?
          AND intentType = ?
        LIMIT 1
        FOR UPDATE`,
      [resolvedEntryIntentId, INTENT_TYPE.SIGNAL_MARKET_ENTRY]
    );
    const parent = rows?.[0] || null;
    if (!parent) {
      await connection.commit();
      return { updated: 0, reason: "SIGNAL_ENTRY_PARENT_NOT_FOUND" };
    }

    const currentResult = parseJsonSafe(parent.resultJson, {}) || {};
    const convergenceResult = currentResult.convergence || {};
    const normalizedChildState = String(childState || "").trim().toUpperCase();
    const retryPending = [
      "PROTECTION_INTENT_CREATED",
      "PROTECTION_VERIFY_PENDING",
      "PROTECTION_RETRY_PENDING",
    ].includes(normalizedChildState);
    const entryProtected = [
      "PROTECTION_ACTIVE",
      "PROTECTION_SUBMITTED_ACKED",
      "ENTRY_PROTECTED_ACKED",
      "PROTECTION_EXCHANGE_VERIFIED",
    ].includes(normalizedChildState);
    const parentHasEntryConvergence =
      (currentResult.fillConfirmed === true || convergenceResult.fillConfirmed === true) &&
      (currentResult.ledgerApplied === true || convergenceResult.ledgerApplied === true) &&
      (currentResult.ownershipOpen === true || convergenceResult.ownershipOpen === true) &&
      (currentResult.snapshotOpen === true || convergenceResult.snapshotOpen === true);
    const nextStatus = entryProtected
      ? (parentHasEntryConvergence ? STATUS.DONE : parent.status)
      : retryPending
        ? STATUS.BLOCKED
        : STATUS.FAILED;
    const nextResult = {
      ...currentResult,
      ok: entryProtected ? Boolean(parentHasEntryConvergence || currentResult.ok === true) : false,
      projectionState: entryProtected
        ? (parentHasEntryConvergence ? "ENTRY_LIFECYCLE_COMPLETE" : currentResult.projectionState)
        : normalizedChildState,
      reason: entryProtected && parentHasEntryConvergence
        ? "ENTRY_LIFECYCLE_COMPLETE"
        : (currentResult.reason || reason || normalizedChildState),
      protectionChildState: normalizedChildState,
      protectionChild: {
        entryIntentId: resolvedEntryIntentId,
        protectionIntentId: protectionIntentId == null ? null : Number(protectionIntentId || 0),
        childStatus,
        childState: normalizedChildState,
        reason,
        result: childResult || {},
        updatedAt: new Date().toISOString(),
      },
    };

    await connection.query(
      `UPDATE order_intent_queue
          SET status = ?,
              finishedAt = CASE WHEN ? IN ('DONE', 'FAILED', 'BLOCKED') THEN NOW() ELSE finishedAt END,
              lockedBy = CASE WHEN ? IN ('DONE', 'FAILED', 'BLOCKED') THEN NULL ELSE lockedBy END,
              lockedAt = CASE WHEN ? IN ('DONE', 'FAILED', 'BLOCKED') THEN NULL ELSE lockedAt END,
              resultJson = ?,
              lastErrorCode = ?,
              lastErrorMessage = ?
        WHERE id = ?
          AND intentType = ?`,
      [
        nextStatus,
        nextStatus,
        nextStatus,
        nextStatus,
        safeJsonStringify(nextResult),
        entryProtected ? null : normalizedChildState,
        entryProtected ? null : String(reason || normalizedChildState).slice(0, 255),
        resolvedEntryIntentId,
        INTENT_TYPE.SIGNAL_MARKET_ENTRY,
      ]
    );
    await connection.commit();
    return { updated: 1, status: nextStatus, childState: normalizedChildState };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

const recoverStaleRunningIntents = async ({ staleSeconds = 60 } = {}) => {
  await ensureOrderIntentSchema();
  const [result] = await db.query(
    `UPDATE order_intent_queue
        SET status = 'PENDING',
            lockedBy = NULL,
            lockedAt = NULL,
            availableAt = NOW(),
            lastErrorCode = 'WORKER_STALE_REQUEUED',
            lastErrorMessage = 'worker stale running intent requeued'
      WHERE status = 'RUNNING'
        AND lockedAt < DATE_SUB(NOW(), INTERVAL ? SECOND)`,
    [Math.max(1, Number(staleSeconds || 60))]
  );
  return Number(result?.affectedRows || 0);
};

const loadIntentByKey = async (intentKey) => {
  await ensureOrderIntentSchema();
  const [rows] = await db.query(
    `SELECT * FROM order_intent_queue WHERE intentKey = ? LIMIT 1`,
    [intentKey]
  );
  return normalizeQueuedIntentRow(rows?.[0] || null);
};

const deleteQaIntentsByPrefix = async (prefix) => {
  await ensureOrderIntentSchema();
  await db.query(
    `DELETE FROM order_intent_queue WHERE intentKey LIKE ?`,
    [`${String(prefix || "")}%`]
  );
};

const deleteQaIntentsByUid = async (uid) => {
  await ensureOrderIntentSchema();
  await db.query(
    `DELETE FROM order_intent_queue WHERE uid = ?`,
    [Number(uid || 0)]
  );
};

module.exports = {
  STATUS,
  INTENT_TYPE,
  ensureOrderIntentSchema,
  buildGridArmIntentPayloadHash,
  buildGridArmIntentKey,
  buildGridArmFifoKey,
  GRID_EXIT_PARENT_STATE,
  normalizeGridExitParentIntentPayload,
  buildGridExitParentIntentPayloadHash,
  buildGridExitParentIntentKey,
  buildGridExitParentFifoKey,
  evaluateGridExitParentDuplicate,
  buildGridExitParentIntentCandidate,
  buildGridExitParentIntentCandidates,
  GRID_EXIT_CHILD_CANCEL_STATE,
  buildGridExitChildCancelIntentKey,
  buildGridExitChildCancelPlan,
  classifyGridExitCancelRaceEvent,
  GRID_EXIT_QUEUE_JOIN_STATE,
  GRID_EXIT_QUEUE_JOIN_REQUIRED_COLUMNS,
  validateGridExitQueueJoinSchema,
  buildGridExitQueueJoinPlan,
  resolveGridExitIntentIdempotency,
  reduceGridExitParentQueueJoinState,
  GRID_EXIT_CANCEL_EXECUTOR_STATE,
  GRID_EXIT_ACTUAL_CANCEL_MODE,
  GRID_EXIT_ACTUAL_CANCEL_FLAG_DEFAULTS,
  GRID_EXIT_CANCEL_EXECUTOR_ALLOWED_MODES,
  GRID_EXIT_CANCEL_EXECUTOR_REJECTED_MODES,
  GRID_EXIT_CANCEL_EXECUTOR_RACE_POLICY,
  normalizeGridExitCancelExecutorMode,
  normalizeGridExitActualCancelFlags,
  normalizeGridExitCancelTarget,
  validateGridExitCancelTargetAttribution,
  buildGridExitCancelExecutorDryRun,
  classifyGridExitCancelExecutorObservation,
  GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_STATE,
  GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_ALLOWED_MODES,
  GRID_EXIT_RUNTIME_DISABLED_CANCEL_ADAPTER_REJECTED_MODES,
  normalizeGridExitRuntimeDisabledCancelMode,
  createGridExitRuntimeDisabledCancelAdapter,
  GRID_EXIT_MARKET_CLOSE_PLAN_TYPE,
  GRID_EXIT_MARKET_CLOSE_PLAN_STATE,
  GRID_EXIT_MARKET_CLOSE_PLAN_ALLOWED_MODES,
  GRID_EXIT_MARKET_CLOSE_PLAN_REJECTED_MODES,
  normalizeGridExitMarketClosePlanMode,
  scanGridExitRemainingPidExposure,
  buildGridExitMarketClosePlan,
  GRID_EXIT_ACTUAL_MARKET_CLOSE_MODE,
  GRID_EXIT_ACTUAL_MARKET_CLOSE_FLAG_DEFAULTS,
  GRID_EXIT_MARKET_CLOSE_EXECUTOR_STATE,
  GRID_EXIT_MARKET_CLOSE_EXECUTOR_ALLOWED_MODES,
  GRID_EXIT_MARKET_CLOSE_EXECUTOR_REJECTED_MODES,
  GRID_EXIT_MARKET_CLOSE_OBSERVATION_CLASSIFICATION,
  GRID_EXIT_CLOSE_CONVERGENCE_MOCK_STATE,
  GRID_EXIT_PARENT_MARKET_CLOSE_MOCK_STATE,
  GRID_EXIT_REST_RECOVERY_STATE,
  GRID_EXIT_PARENT_JOIN_STATE,
  normalizeGridExitMarketCloseExecutorMode,
  normalizeGridExitActualMarketCloseFlags,
  buildGridExitMarketCloseDryRun,
  classifyGridExitMarketCloseObservation,
  simulateGridExitCloseConvergence,
  reduceGridExitParentMarketCloseMockState,
  buildGridExitRestRecoveryPlan,
  buildGridExitParentCloseoutJoin,
  GRID_STOP_EMERGENCY_BACKSTOP_ALLOWED_MODES,
  GRID_STOP_EMERGENCY_BACKSTOP_REJECTED_MODES,
  GRID_STOP_EMERGENCY_BACKSTOP_STATE,
  GRID_STOP_EMERGENCY_OBSERVATION_CLASSIFICATION,
  GRID_STOP_EMERGENCY_MOCK_STATE,
  normalizeGridStopEmergencyBackstopMode,
  buildGridExitStopEmergencyBackstopPolicy,
  classifyGridStopEmergencyObservation,
  scanGridStopSiblingExposureMock,
  simulateGridStopEmergencyConvergenceMock,
  GRID_EXIT_ENQUEUE_ADAPTER_STATE,
  GRID_EXIT_ENQUEUE_ADAPTER_ALLOWED_MODES,
  GRID_EXIT_ENQUEUE_ADAPTER_TEMP_TABLE_MODE,
  GRID_EXIT_ENQUEUE_ADAPTER_ACTUAL_QUEUE_ROLLBACK_MODE,
  GRID_EXIT_ENQUEUE_ADAPTER_PERSISTENT_BLOCKED_QA_MODE,
  GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_HARNESS,
  GRID_EXIT_ACTUAL_QUEUE_ROLLBACK_QA_MARKER,
  GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_HARNESS,
  GRID_EXIT_PERSISTENT_BLOCKED_QUARANTINE_QA_MARKER,
  normalizeGridExitEnqueueAdapterMode,
  buildGridExitEnqueueAdapterPlan,
  createGridExitMockRepository,
  GRID_EXIT_TEMP_TABLE_PREFIX,
  quoteGridExitTempTableName,
  createGridExitTempTableQueueRepository,
  createGridExitActualQueueRollbackRepository,
  createGridExitPersistentBlockedQuarantineRepository,
  createGridExitPersistentBlockedQuarantineCleanupRepository,
  enqueueGridExitPlanWithRepository,
  normalizeSignalMarketEntryIntentPayload,
  buildSignalEntryClientOrderId,
  buildSignalMarketEntryIntentPayloadHash,
  buildSignalMarketEntryIntentKey,
  buildSignalMarketEntryFifoKey,
  normalizeSignalProtectionIntentPayload,
  buildSignalProtectionIntentPayloadHash,
  buildSignalProtectionIntentKey,
  normalizeSignalCancelIntentPayload,
  buildSignalCancelIntentPayloadHash,
  buildSignalCancelIntentKey,
  normalizeSignalCloseIntentPayload,
  buildSignalCloseClientOrderId,
  buildSignalCloseIntentPayloadHash,
  buildSignalCloseIntentKey,
  buildGridProtectionIntentPayloadHash,
  buildGridProtectionIntentKey,
  buildGridProtectionFifoKey,
  buildGridReentryIntentPayloadHash,
  buildGridReentryIntentKey,
  buildGridReentryFifoKey,
  buildGridCancelIntentPayloadHash,
  buildGridCancelIntentKey,
  buildGridCancelFifoKey,
  buildGridCloseClientOrderId,
  buildGridCloseIntentPayloadHash,
  buildGridCloseIntentKey,
  buildGridCloseFifoKey,
  enqueueGridLiveArmIntents,
  enqueueSignalMarketEntryIntent,
  attachSignalMarketEntryWebhookTarget,
  enqueueSignalProtectionIntent,
  enqueueSignalCancelIntent,
  enqueueSignalCloseIntent,
  enqueueGridProtectionCreateIntent,
  enqueueGridReentryCreateIntent,
  enqueueGridCancelIntent,
  enqueueGridCloseIntent,
  claimNextIntent,
  completeIntent,
  updateSignalEntryProtectionChildState,
  recoverStaleRunningIntents,
  loadIntentByKey,
  deleteQaIntentsByPrefix,
  deleteQaIntentsByUid,
};
