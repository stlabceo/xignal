"use strict";

const ENTRY_STATE = Object.freeze({
  INTENT_CREATED: "SIGNAL_ENTRY_INTENT_CREATED",
  ORDER_SUBMITTING: "ORDER_SUBMITTING",
  ORDER_ACCEPTED: "ORDER_ACCEPTED",
  FILL_PENDING: "FILL_PENDING",
  PARTIAL_FILL_TRANSIENT: "PARTIAL_FILL_TRANSIENT",
  FILL_CONFIRMED: "FILL_CONFIRMED",
  ENTRY_FILLED_FINAL: "ENTRY_FILLED_FINAL",
  ENTRY_PARTIAL_TERMINAL: "ENTRY_PARTIAL_TERMINAL",
  NO_POSITION_TERMINAL: "NO_POSITION_TERMINAL",
  EXPOSED_PARTIAL_UNRESOLVED_P0: "EXPOSED_PARTIAL_UNRESOLVED_P0",
  LEDGER_APPLIED: "LEDGER_APPLIED",
  OWNERSHIP_OPEN: "OWNERSHIP_OPEN",
  SNAPSHOT_OPEN: "SNAPSHOT_OPEN",
  PROTECTION_REQUIRED: "PROTECTION_REQUIRED",
  PROTECTION_INTENT_CREATED: "PROTECTION_INTENT_CREATED",
  PROTECTION_QUEUED: "PROTECTION_QUEUED",
  PROTECTION_SUBMIT_REQUESTED: "PROTECTION_SUBMIT_REQUESTED",
  PROTECTION_SUBMITTED_ACKED: "PROTECTION_SUBMITTED_ACKED",
  ENTRY_PROTECTED_ACKED: "ENTRY_PROTECTED_ACKED",
  PROTECTION_VERIFY_PENDING: "PROTECTION_VERIFY_PENDING",
  PROTECTION_EXCHANGE_VERIFIED: "PROTECTION_EXCHANGE_VERIFIED",
  PROTECTION_MISMATCH_P0: "PROTECTION_MISMATCH_P0",
  PROTECTION_RETRY_PENDING: "PROTECTION_RETRY_PENDING",
  PROTECTION_ACTIVE: "PROTECTION_ACTIVE",
  PROTECTION_SUBMIT_FAILED_P0: "PROTECTION_SUBMIT_FAILED_P0",
  PROTECTION_FAILED_P0: "PROTECTION_FAILED_P0",
  UNPROTECTED_EXPOSURE_P0: "UNPROTECTED_EXPOSURE_P0",
  UNPROTECTED_OPEN_P0: "UNPROTECTED_OPEN_P0",
  ENTRY_LIFECYCLE_COMPLETE: "ENTRY_LIFECYCLE_COMPLETE",
  ORDER_ACCEPTED_FILL_UNCONFIRMED_P0: "ORDER_ACCEPTED_FILL_UNCONFIRMED_P0",
  ENTRY_FAILED_NO_ORDER: "ENTRY_FAILED_NO_ORDER",
  ENTRY_FAILED_REJECTED: "ENTRY_FAILED_REJECTED",
  ENTRY_RECOVERY_BLOCKED: "ENTRY_RECOVERY_BLOCKED",
});

const PROTECTION_RETRY_REASONS = new Set([
  "BINANCE_READ_BUDGET_EXHAUSTED",
  "READ_GUARD_CIRCUIT_OPEN",
  "BINANCE_PRIVATE_READ_CIRCUIT_OPEN",
  "BINANCE_UID_PRIVATE_READ_BACKOFF",
  "BINANCE_418",
  "BINANCE_429",
  "BINANCE_-1003",
  "-1003",
  "418",
  "429",
]);

const RECOVERY_ACTOR = "signal-entry-recovery";
const RECOVERY_PURPOSE = "ENTRY_FILL_RECOVERY";
const DEFAULT_WS_WAIT_MS = 2000;
const DEFAULT_MAX_UNCONFIRMED_MS = 10000;

const normalizeOrderStatus = (value) => String(value || "").trim().toUpperCase() || "UNKNOWN";

const getExecutedQty = (order = {}) => {
  for (const value of [order.executedQty, order.cumQty, order.z]) {
    const numeric = Number(value || 0);
    if (numeric > 0) {
      return numeric;
    }
  }
  return 0;
};

const hasTradeEvidence = (trades = []) =>
  Array.isArray(trades) && trades.some((trade) => Number(trade?.qty || trade?.fillQty || 0) > 0);

const hasAcceptedOrderEvidence = (input = {}) =>
  Boolean(
    input.orderId ||
      input.clientOrderId ||
      input.sourceOrderId ||
      input.sourceClientOrderId ||
      input.r_tid ||
      input.rTid
  );

const getAcceptedOrderEvidenceFromPlay = (play = {}) => ({
  hasAcceptedOrder: hasAcceptedOrderEvidence({
    orderId: play.orderId || play.sourceOrderId || play.r_tid || play.rTid,
    clientOrderId: play.clientOrderId || play.sourceClientOrderId,
  }),
  orderId: play.orderId || play.sourceOrderId || play.r_tid || play.rTid || null,
  clientOrderId: play.clientOrderId || play.sourceClientOrderId || null,
});

const classifyEntryOrderOutcome = ({ order = {}, trades = [], status = null } = {}) => {
  const orderStatus = normalizeOrderStatus(status || order.status || order.X);
  const executedQty = getExecutedQty(order);
  const hasTrades = hasTradeEvidence(trades);
  const hasFill = executedQty > 0 || hasTrades;

  if (orderStatus === "FILLED") {
    return {
      state: hasFill ? ENTRY_STATE.ENTRY_FILLED_FINAL : ENTRY_STATE.ORDER_ACCEPTED_FILL_UNCONFIRMED_P0,
      action: hasFill ? "APPLY_FULL_FILL" : "ESCALATE_P0",
      terminal: hasFill,
      parentCompleteAllowed: hasFill,
      p0: !hasFill,
      safeNoExposure: false,
      orderStatus,
      executedQty,
      hasTrades,
    };
  }

  if (orderStatus === "PARTIALLY_FILLED") {
    return {
      state: hasFill ? ENTRY_STATE.PARTIAL_FILL_TRANSIENT : ENTRY_STATE.ORDER_ACCEPTED_FILL_UNCONFIRMED_P0,
      action: hasFill ? "TRACK_PARTIAL_FILL_TRANSIENT" : "RECOVER_TRADES_OR_ESCALATE_P0",
      terminal: false,
      parentCompleteAllowed: false,
      p0: !hasFill,
      safeNoExposure: false,
      orderStatus,
      executedQty,
      hasTrades,
    };
  }

  if (["REJECTED", "EXPIRED", "EXPIRED_IN_MATCH", "CANCELED"].includes(orderStatus)) {
    if (hasFill) {
      return {
        state: ENTRY_STATE.ENTRY_PARTIAL_TERMINAL,
        action: "APPLY_PARTIAL_TERMINAL_FILL",
        terminal: true,
        parentCompleteAllowed: true,
        p0: false,
        safeNoExposure: false,
        orderStatus,
        executedQty,
        hasTrades,
      };
    }
    return {
      state: ENTRY_STATE.NO_POSITION_TERMINAL,
      action: "SAFE_TERMINAL_NO_EXPOSURE",
      terminal: true,
      parentCompleteAllowed: false,
      p0: false,
      safeNoExposure: true,
      orderStatus,
      executedQty,
      hasTrades,
    };
  }

  return {
    state: ENTRY_STATE.ORDER_ACCEPTED_FILL_UNCONFIRMED_P0,
    action: "TARGETED_RECOVERY_OR_ESCALATE_P0",
    terminal: false,
    parentCompleteAllowed: false,
    p0: true,
    safeNoExposure: false,
    orderStatus,
    executedQty,
    hasTrades,
  };
};

const isPartialFillTransientStatus = (status) => normalizeOrderStatus(status) === "PARTIALLY_FILLED";

const buildPartialFillTransientResult = ({
  payload = {},
  accepted = {},
  recovery = {},
  protection = null,
  reason = "PARTIAL_FILL_TRANSIENT",
} = {}) => ({
  ok: false,
  p0: false,
  state: ENTRY_STATE.PARTIAL_FILL_TRANSIENT,
  reason,
  uid: Number(payload.uid || accepted.uid || recovery.uid || 0),
  pid: Number(payload.pid || accepted.pid || recovery.pid || 0),
  symbol: payload.symbol || accepted.symbol || recovery.symbol || null,
  orderId: recovery.orderId || accepted.orderId || null,
  clientOrderId: recovery.clientOrderId || accepted.clientOrderId || null,
  orderStatus: normalizeOrderStatus(recovery.orderStatus || recovery.status),
  executedQty: Number(recovery.executedQty || recovery.qty || 0),
  recoveredQty: Number(recovery.qty || 0),
  fillConfirmed: true,
  ledgerApplied: true,
  ownershipOpen: true,
  snapshotOpen: true,
  protectionChildState: protection ? normalizeProtectionChildState(protection) : null,
  protection,
});

const buildRecoveryKeys = ({
  payload = {},
  result = {},
  owner = {},
  intent = {},
} = {}) => {
  const orderId = result.orderId || payload.orderId || owner.sourceOrderId || null;
  const clientOrderId =
    result.clientOrderId || payload.clientOrderId || owner.sourceClientOrderId || null;
  return [
    { key: "orderId", value: orderId || null, priority: 1 },
    { key: "clientOrderId", value: clientOrderId || null, priority: 2 },
    { key: "owner.sourceOrderId", value: owner.sourceOrderId || null, priority: 3 },
    { key: "owner.sourceClientOrderId", value: owner.sourceClientOrderId || null, priority: 4 },
    {
      key: "sourceWebhookEventId",
      value: payload.sourceWebhookEventId || result.sourceWebhookEventId || intent.sourceEventId || null,
      priority: 5,
    },
    {
      key: "sourceWebhookTargetId",
      value: payload.sourceWebhookTargetId || result.sourceWebhookTargetId || null,
      priority: 5,
    },
    { key: "intentId", value: intent.id || result.intentId || payload.intentId || null, priority: 5 },
  ];
};

const buildAcceptedOrderPersistence = ({ intent = {}, payload = {}, sendData = {}, owner = null } = {}) => {
  const orderId =
    sendData.orderId ||
    sendData.exchangeOrderId ||
    sendData?.order?.orderId ||
    sendData?.extData?.orderId ||
    owner?.sourceOrderId ||
    null;
  const clientOrderId =
    sendData.clientOrderId ||
    sendData?.order?.clientOrderId ||
    sendData?.extData?.clientOrderId ||
    payload.clientOrderId ||
    owner?.sourceClientOrderId ||
    null;
  return {
    sourceWebhookEventId: payload.sourceWebhookEventId || intent.sourceEventId || null,
    sourceWebhookTargetId: payload.sourceWebhookTargetId || null,
    intentId: intent.id || payload.intentId || null,
    uid: Number(payload.uid || intent.uid || 0),
    pid: Number(payload.pid || intent.pid || 0),
    symbol: payload.symbol || null,
    side: payload.side || null,
    positionSide: payload.positionSide || null,
    signalTime: payload.signalTime || null,
    clientOrderId,
    orderId,
    acceptedAt: sendData.acceptedAt || sendData?.order?.updateTime || sendData?.order?.time || new Date().toISOString(),
    ownerRowId: sendData.ownerRowId || owner?.id || null,
  };
};

const buildSignalEntryDispatcherContext = ({ intent = {}, payload = {} } = {}) => {
  const intentPayload = intent.payload || {};
  const signalEntryPayload = intentPayload.signalEntry || {};
  return {
    sourceWebhookEventId:
      payload.sourceWebhookEventId ??
      payload.sourceEventId ??
      signalEntryPayload.sourceWebhookEventId ??
      intentPayload.sourceEventId ??
      intent.sourceEventId ??
      null,
    sourceWebhookTargetId:
      payload.sourceWebhookTargetId ??
      payload.sourceTargetId ??
      signalEntryPayload.sourceWebhookTargetId ??
      intentPayload.sourceTargetId ??
      null,
    intentId: payload.intentId ?? intent.id ?? null,
    uid: payload.uid ?? intent.uid ?? null,
    pid: payload.pid ?? intent.pid ?? null,
    symbol: payload.symbol ?? null,
    side: payload.side ?? null,
    positionSide: payload.positionSide ?? null,
    signalTime: payload.signalTime ?? null,
    clientOrderId: payload.clientOrderId ?? null,
  };
};

const normalizeProtectionChildState = (value = {}) => {
  const raw = typeof value === "string"
    ? value
    : (
        value.protectionChildState ||
        value.childState ||
        value.protectionState ||
        value.projectionState ||
        value.state ||
        value.reason ||
        ""
      );
  const normalized = String(raw || "").trim().toUpperCase();
  if (
    normalized === ENTRY_STATE.PROTECTION_EXCHANGE_VERIFIED ||
    normalized === "SIGNAL_PROTECTION_EXISTING_EXCHANGE_ORDER_ACTIVE" ||
    normalized === "PROTECTION_EXCHANGE_VERIFIED"
  ) {
    return ENTRY_STATE.PROTECTION_EXCHANGE_VERIFIED;
  }
  if (
    normalized === ENTRY_STATE.ENTRY_PROTECTED_ACKED ||
    normalized === ENTRY_STATE.PROTECTION_SUBMITTED_ACKED ||
    normalized === ENTRY_STATE.PROTECTION_ACTIVE ||
    normalized === "SIGNAL_PROTECTION_SUBMIT_EVIDENCE_ACTIVE" ||
    normalized === "ENTRY_PROTECTED_ACKED" ||
    normalized === "PROTECTION_SUBMITTED_ACKED" ||
    normalized === "SIGNAL_PROTECTION_PROTECTED" ||
    normalized === "PROTECTED" ||
    normalized === "GRID_PROTECTED"
  ) {
    return normalized === ENTRY_STATE.PROTECTION_ACTIVE
      ? ENTRY_STATE.PROTECTION_ACTIVE
      : ENTRY_STATE.ENTRY_PROTECTED_ACKED;
  }
  if (
    normalized === ENTRY_STATE.PROTECTION_INTENT_CREATED ||
    normalized === ENTRY_STATE.PROTECTION_QUEUED ||
    normalized === ENTRY_STATE.PROTECTION_SUBMIT_REQUESTED ||
    normalized === "SIGNAL_PROTECTION_INTENT_PENDING" ||
    normalized === "SIGNAL_PROTECTION_INTENT_DUPLICATE"
  ) {
    return ENTRY_STATE.PROTECTION_INTENT_CREATED;
  }
  if (
    normalized === ENTRY_STATE.PROTECTION_VERIFY_PENDING ||
    normalized === "SIGNAL_PROTECTION_VERIFY_PENDING" ||
    normalized === "BOUND_LOCAL_IDEMPOTENT_OK" ||
    normalized === "SIGNAL_PROTECTION_RECENT_MEMORY_ONLY" ||
    normalized === "SIGNAL_PROTECTION_RECENT_ENTRY_MEMORY_ONLY" ||
    normalized === "SIGNAL_PROTECTION_LOCAL_RESERVATION_ONLY"
  ) {
    return ENTRY_STATE.PROTECTION_VERIFY_PENDING;
  }
  if (
    PROTECTION_RETRY_REASONS.has(normalized) ||
    normalized === "SIGNAL_PROTECTION_ORDER_RULES_MISSING" ||
    normalized === "SIGNAL_PROTECTION_POSITION_NOT_READY"
  ) {
    return ENTRY_STATE.PROTECTION_RETRY_PENDING;
  }
  if (
    normalized === ENTRY_STATE.UNPROTECTED_OPEN_P0 ||
    normalized === ENTRY_STATE.UNPROTECTED_EXPOSURE_P0 ||
    normalized === "PROTECTION_BOTH_MISSING" ||
    normalized === "PROTECTION_PARTIAL_MISSING" ||
    normalized === "SIGNAL_PROTECTION_NO_BOUND_TARGET" ||
    normalized === "SIGNAL_PROTECTION_QTY_TOO_SMALL" ||
    normalized === "GRID_UNPROTECTED" ||
    normalized === "GRID_PARTIAL_PROTECTION"
  ) {
    return normalized === ENTRY_STATE.UNPROTECTED_EXPOSURE_P0
      ? ENTRY_STATE.UNPROTECTED_EXPOSURE_P0
      : ENTRY_STATE.UNPROTECTED_OPEN_P0;
  }
  if (
    normalized === ENTRY_STATE.PROTECTION_SUBMIT_FAILED_P0 ||
    normalized === ENTRY_STATE.PROTECTION_FAILED_P0 ||
    normalized === "SIGNAL_PROTECTION_FAILED" ||
    normalized === "SIGNAL_PROTECTION_SUBMIT_FAILED" ||
    normalized === "SIGNAL_PROTECTION_OWNER_IDENTITY_MISSING" ||
    normalized === "SIGNAL_PROTECTION_NO_PLAY" ||
    normalized === "SIGNAL_PROTECTION_ENTRY_PRICE_MISSING" ||
    normalized === "PROTECTION_SUBMIT_FAILED" ||
    normalized === "PROTECTION_RESERVATION_MISSING" ||
    normalized === "PROTECTION_ORDER_EVIDENCE_MISSING"
  ) {
    return normalized === ENTRY_STATE.PROTECTION_SUBMIT_FAILED_P0
      ? ENTRY_STATE.PROTECTION_SUBMIT_FAILED_P0
      : ENTRY_STATE.PROTECTION_FAILED_P0;
  }
  return normalized || ENTRY_STATE.PROTECTION_REQUIRED;
};

const isProtectionChildActive = (value = {}) =>
  normalizeProtectionChildState(value) === ENTRY_STATE.PROTECTION_ACTIVE ||
  normalizeProtectionChildState(value) === ENTRY_STATE.ENTRY_PROTECTED_ACKED ||
  normalizeProtectionChildState(value) === ENTRY_STATE.PROTECTION_SUBMITTED_ACKED ||
  normalizeProtectionChildState(value) === ENTRY_STATE.PROTECTION_EXCHANGE_VERIFIED;

const isProtectionChildEntryProtected = isProtectionChildActive;

const isProtectionRetryPending = (value = {}) =>
  normalizeProtectionChildState(value) === ENTRY_STATE.PROTECTION_RETRY_PENDING ||
  normalizeProtectionChildState(value) === ENTRY_STATE.PROTECTION_VERIFY_PENDING ||
  normalizeProtectionChildState(value) === ENTRY_STATE.PROTECTION_INTENT_CREATED;

const buildProtectionChildIdempotencyKey = ({
  uid,
  pid,
  symbol,
  side,
  positionSide,
  ownerRowId,
  entryOrderId,
  boundType,
} = {}) => [
  Number(uid || 0),
  Number(pid || 0),
  String(symbol || "").trim().toUpperCase(),
  String(positionSide || side || "").trim().toUpperCase(),
  ownerRowId == null ? "owner:missing" : `owner:${ownerRowId}`,
  entryOrderId == null ? "entry:missing" : `entry:${entryOrderId}`,
  String(boundType || "PROFIT_STOP").trim().toUpperCase(),
].join(":");

const isDoneAllowed = (convergence = {}) =>
  (
    convergence.state === ENTRY_STATE.ENTRY_LIFECYCLE_COMPLETE ||
    convergence.entryState === ENTRY_STATE.ENTRY_LIFECYCLE_COMPLETE
  ) &&
  isProtectionChildActive(convergence);

const buildProtectionChildBlockedResult = ({
  payload = {},
  accepted = {},
  protection = {},
  reason = null,
} = {}) => {
  const protectionChildState = normalizeProtectionChildState(protection);
  return {
    ok: false,
    p0: !isProtectionRetryPending(protection),
    state: protectionChildState,
    reason: reason || protection.reason || protection.protectionReason || protectionChildState,
    uid: Number(payload.uid || accepted.uid || protection.uid || 0),
    pid: Number(payload.pid || accepted.pid || protection.pid || 0),
    symbol: payload.symbol || accepted.symbol || protection.symbol || null,
    orderId: accepted.orderId || protection.entryOrderId || null,
    clientOrderId: accepted.clientOrderId || protection.entryClientOrderId || null,
    ownerRowId: accepted.ownerRowId || protection.ownerRowId || null,
    fillConfirmed: true,
    ledgerApplied: true,
    ownershipOpen: true,
    snapshotOpen: true,
    protectionChildState,
    protection,
  };
};

const buildUnconfirmedP0Result = ({
  payload = {},
  accepted = {},
  reason = "ORDER_ACCEPTED_FILL_UNCONFIRMED_P0",
  recovery = null,
} = {}) => ({
  ok: false,
  p0: true,
  state: ENTRY_STATE.ORDER_ACCEPTED_FILL_UNCONFIRMED_P0,
  reason,
  uid: Number(payload.uid || accepted.uid || 0),
  pid: Number(payload.pid || accepted.pid || 0),
  symbol: payload.symbol || accepted.symbol || null,
  orderId: accepted.orderId || null,
  clientOrderId: accepted.clientOrderId || null,
  ownerRowId: accepted.ownerRowId || null,
  recovery,
});

const buildRecoveryBlockedResult = ({ payload = {}, accepted = {}, error = null } = {}) => ({
  ok: false,
  p0: true,
  state: ENTRY_STATE.ENTRY_RECOVERY_BLOCKED,
  reason: error?.code || error?.reason || "ENTRY_RECOVERY_BLOCKED",
  uid: Number(payload.uid || accepted.uid || 0),
  pid: Number(payload.pid || accepted.pid || 0),
  symbol: payload.symbol || accepted.symbol || null,
  orderId: accepted.orderId || null,
  clientOrderId: accepted.clientOrderId || null,
  ownerRowId: accepted.ownerRowId || null,
  actualCallCount: 0,
  blockedUntil: error?.blockedUntil || null,
  retryAfterSeconds: error?.retryAfterSeconds || null,
});

module.exports = {
  ENTRY_STATE,
  RECOVERY_ACTOR,
  RECOVERY_PURPOSE,
  DEFAULT_WS_WAIT_MS,
  DEFAULT_MAX_UNCONFIRMED_MS,
  normalizeOrderStatus,
  getExecutedQty,
  hasTradeEvidence,
  hasAcceptedOrderEvidence,
  getAcceptedOrderEvidenceFromPlay,
  classifyEntryOrderOutcome,
  buildRecoveryKeys,
  buildAcceptedOrderPersistence,
  buildSignalEntryDispatcherContext,
  isPartialFillTransientStatus,
  normalizeProtectionChildState,
  isProtectionChildActive,
  isProtectionChildEntryProtected,
  isProtectionRetryPending,
  buildProtectionChildIdempotencyKey,
  isDoneAllowed,
  buildUnconfirmedP0Result,
  buildProtectionChildBlockedResult,
  buildPartialFillTransientResult,
  buildRecoveryBlockedResult,
};
