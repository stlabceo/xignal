"use strict";

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveQty = (value) => {
  const qty = toNumber(value, 0);
  return qty > 0 ? qty : 0;
};

const normalizeLeg = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "LONG" || normalized === "SHORT") {
    return normalized;
  }
  return null;
};

const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
};

const getOwnedQty = ({ payload = {}, ownershipQty = {} } = {}) =>
  positiveQty(
    ownershipQty.finalCloseQty ??
      payload.ownedQty ??
      payload.ownedQtyBasis ??
      payload.qty
  );

const getEntryIdentity = (payload = {}) =>
  firstNonEmpty(
    payload.entryOrderId,
    payload.entryClientOrderId,
    payload.sourceOrderId,
    payload.sourceTradeId,
    payload.fillEvidence?.orderId,
    payload.fillEvidence?.clientOrderId,
    payload.fillEvidence?.tradeId
  );

const buildGridProtectionDispatchPlan = ({
  payload = {},
  ownershipQty = {},
  activeReservationCount = 0,
  hasEntryLedger = null,
} = {}) => {
  const positionSide = normalizeLeg(payload.positionSide || payload.leg);
  const protectionQty = getOwnedQty({ payload, ownershipQty });
  const entryIdentity = getEntryIdentity(payload);
  const takeProfitPrice = toNumber(payload.takeProfitPrice, 0);
  const stopPrice = toNumber(payload.stopPrice, 0);

  if (!payload.uid || !payload.pid || !payload.symbol || !positionSide) {
    return { allowed: false, reason: "GRID_PROTECTION_INVALID_OWNER", positionSide, protectionQty };
  }
  if (!entryIdentity) {
    return { allowed: false, reason: "GRID_PROTECTION_ENTRY_IDENTITY_MISSING", positionSide, protectionQty };
  }
  if (!(protectionQty > 0)) {
    return { allowed: false, reason: "GRID_PROTECTION_PID_OWNED_QTY_ZERO", positionSide, protectionQty };
  }
  if (ownershipQty.allowed === false) {
    return {
      allowed: false,
      reason: ownershipQty.reason || "GRID_PROTECTION_OWNERSHIP_BLOCKED",
      positionSide,
      protectionQty,
    };
  }
  if (hasEntryLedger === false) {
    return { allowed: false, reason: "GRID_PROTECTION_ENTRY_LEDGER_MISSING", positionSide, protectionQty };
  }
  if (Number(activeReservationCount || 0) > 0) {
    return {
      allowed: false,
      reason: "GRID_PROTECTION_ACTIVE_RESERVATION_EXISTS",
      positionSide,
      protectionQty,
      activeReservationCount: Number(activeReservationCount || 0),
    };
  }
  if (!(takeProfitPrice > 0) || !(stopPrice > 0)) {
    const contextReason = String(payload.contextMissingReason || "").trim();
    return {
      allowed: false,
      reason: contextReason.startsWith("GRID_PROTECTION_")
        ? contextReason
        : "GRID_PROTECTION_INVALID_TP_SL_PAYLOAD",
      positionSide,
      protectionQty,
    };
  }

  return {
    allowed: true,
    reason: "GRID_PROTECTION_DISPATCH_READY",
    positionSide,
    protectionQty,
    entryIdentity,
    qtyBasis: "PID_OWNED",
  };
};

const buildGridManualCloseDispatchPlan = ({
  payload = {},
  ownershipQty = {},
  requestedQty = null,
} = {}) => {
  const positionSide = normalizeLeg(payload.positionSide || payload.leg);
  const closeQty = getOwnedQty({ payload, ownershipQty });
  const requested = requestedQty === null || requestedQty === undefined
    ? positiveQty(payload.qty || payload.ownedQtyBasis || payload.ownedQty)
    : positiveQty(requestedQty);

  if (!payload.uid || !payload.pid || !payload.symbol || !positionSide) {
    return { allowed: false, reason: "GRID_CLOSE_INVALID_OWNER", positionSide, closeQty };
  }
  if (!(closeQty > 0)) {
    return { allowed: false, reason: "GRID_CLOSE_PID_OWNED_QTY_ZERO", positionSide, closeQty };
  }
  if (ownershipQty.allowed === false) {
    return {
      allowed: false,
      reason: ownershipQty.reason || "GRID_CLOSE_OWNERSHIP_BLOCKED",
      positionSide,
      closeQty,
    };
  }
  if (requested > closeQty + 1e-9) {
    return {
      allowed: false,
      reason: "GRID_CLOSE_OVER_OWNED_QTY_BLOCKED",
      positionSide,
      closeQty,
      requestedQty: requested,
    };
  }

  return {
    allowed: true,
    reason: "GRID_CLOSE_DISPATCH_READY",
    positionSide,
    closeQty,
    requestedQty: requested,
    qtyBasis: "PID_OWNED",
  };
};

const asArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const normalizeOrderRef = (value, kind = "UNKNOWN") => {
  if (!value) return null;
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text ? { kind, clientOrderId: text, orderId: null } : null;
  }
  const clientOrderId = firstNonEmpty(value.clientOrderId, value.origClientOrderId, value.clientAlgoId);
  const orderId = firstNonEmpty(value.orderId, value.algoId, value.strategyId, value.sourceOrderId);
  if (!clientOrderId && !orderId) return null;
  return {
    kind: value.kind || kind,
    clientOrderId: clientOrderId ? String(clientOrderId) : null,
    orderId: orderId ? String(orderId) : null,
  };
};

const collectGridCancelOrderRefs = (payload = {}) => {
  const refs = [];
  const push = (value, kind) => {
    for (const item of asArray(value)) {
      const normalized = normalizeOrderRef(item, kind);
      if (normalized) refs.push(normalized);
    }
  };

  push(
    payload.targetClientOrderId || payload.targetOrderId
      ? { clientOrderId: payload.targetClientOrderId || null, orderId: payload.targetOrderId || null }
      : null,
    "TARGET"
  );
  push(payload.entryOrderRefs || payload.entryRefs || payload.entryOrders, "ENTRY");
  push(payload.protectionOrderRefs || payload.protectionRefs || payload.protectionOrders, "PROTECTION");
  push(payload.exitOrderRefs || payload.exitRefs || payload.exitOrders, "EXIT");
  push(payload.stopOrderRefs || payload.stopRefs || payload.stopOrders, "STOP");

  return refs;
};

const buildGridCancelScopeDiagnostic = ({
  payload = {},
  target = {},
  cancelResponse = {},
  verification = {},
} = {}) => {
  const refs = collectGridCancelOrderRefs({
    ...payload,
    targetOrderId: payload.targetOrderId || target.targetOrderId || null,
    targetClientOrderId: payload.targetClientOrderId || target.targetClientOrderId || null,
  });
  const includeEntries = payload.includeEntries !== false;
  const includeExits = payload.includeExits !== false;
  const canceledCount = Number(cancelResponse?.canceledCount || 0);
  const expectedScopes = [
    includeEntries ? "ENTRY" : null,
    includeExits ? "PROTECTION" : null,
    includeExits ? "EXIT" : null,
    includeExits ? "STOP" : null,
  ].filter(Boolean);
  const excludedScopes = [
    includeEntries ? null : "ENTRY",
    includeExits ? null : "PROTECTION_EXIT_STOP",
  ].filter(Boolean);

  const verifiedGone = verification?.ok && verification?.terminal;
  let noopReason = null;
  if (canceledCount > 0) {
    noopReason = "GRID_CANCEL_SUBMITTED";
  } else if (verifiedGone) {
    noopReason = "GRID_CANCEL_VERIFIED_GONE_NOOP";
  } else if (refs.length === 0 && expectedScopes.length > 0) {
    noopReason = "GRID_CANCEL_NO_LOCAL_ORDER_REFS";
  } else if (refs.length > 0) {
    noopReason = "GRID_CANCEL_REFS_PRESENT_ZERO_CANCELED";
  } else {
    noopReason = "GRID_CANCEL_NOOP_UNCLASSIFIED";
  }

  return {
    targetType: payload.targetType || null,
    includeEntries,
    includeExits,
    expectedScopes,
    excludedScopes,
    localRefCount: refs.length,
    localRefsByKind: refs.reduce((acc, ref) => {
      const kind = ref.kind || "UNKNOWN";
      acc[kind] = (acc[kind] || 0) + 1;
      return acc;
    }, {}),
    canceledCount,
    noopReason,
    coverageIssue: refs.length === 0 && canceledCount === 0 && !verifiedGone ? "NO_LOCAL_ORDER_REFS_TO_CANCEL" : null,
  };
};

module.exports = {
  buildGridProtectionDispatchPlan,
  buildGridManualCloseDispatchPlan,
  collectGridCancelOrderRefs,
  buildGridCancelScopeDiagnostic,
};
