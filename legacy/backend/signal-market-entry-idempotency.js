"use strict";

const crypto = require("crypto");
const signalStaleTime = require("./signal-stale-time");

const INTENT_TYPE = "SIGNAL_MARKET_ENTRY";

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

const sha1 = (value) =>
  crypto.createHash("sha1").update(String(value || "")).digest("hex");

const normalizeSymbol = (symbol) =>
  String(symbol || "").trim().toUpperCase().replace(/\.P$/i, "");

const normalizeTimeframe = (value) => String(value || "").trim().toUpperCase();

const normalizePositionSide = (value) => String(value || "").trim().toUpperCase();

const normalizeSignalSide = (value) => String(value || "").trim().toUpperCase();

const signalPositionSideFromSide = (side) => normalizeSignalSide(side) === "SELL" ? "SHORT" : "LONG";

const buildSignalEntryClientOrderId = ({ uid, pid } = {}) =>
  `NEW_${Number(uid || 0)}_${Number(pid || 0)}`;

const normalizeSignalMarketEntryIntentPayload = (payload = {}) => {
  const side = normalizeSignalSide(payload.side || payload.signalType || payload.rSignalType);
  const normalizedSignalTime = signalStaleTime.normalizeSignalTimeToUtcString(
    payload.signalTime ?? payload.r_signalTime ?? payload.rSignalTime ?? payload.time ?? null
  );
  return {
    ...payload,
    uid: Number(payload.uid || 0),
    pid: Number(payload.pid || payload.id || 0),
    strategyCategory: "signal",
    symbol: normalizeSymbol(payload.symbol),
    side,
    positionSide: normalizePositionSide(payload.positionSide || signalPositionSideFromSide(side)),
    strategyRuntimeCode: String(payload.strategyRuntimeCode || payload.type || "").trim(),
    timeframe: normalizeTimeframe(payload.timeframe || payload.bunbong),
    margin: Number(payload.margin || 0),
    leverage: Number(payload.leverage || 0),
    limitST: payload.limitST == null ? null : String(payload.limitST),
    signalPrice: Number(payload.signalPrice || payload.rSignalPrice || 0),
    signalTime: normalizedSignalTime,
    sourceWebhookEventId: payload.sourceWebhookEventId == null ? null : String(payload.sourceWebhookEventId),
    sourceWebhookTargetId: payload.sourceWebhookTargetId == null ? null : String(payload.sourceWebhookTargetId),
    sourceRuntimeTid: payload.sourceRuntimeTid == null ? null : String(payload.sourceRuntimeTid),
    clientOrderId: payload.clientOrderId || buildSignalEntryClientOrderId(payload),
  };
};

const buildSignalMarketEntryStableIdentityFields = (payload = {}) => {
  const normalized = normalizeSignalMarketEntryIntentPayload(payload);
  if (!normalized.uid || !normalized.pid || !normalized.symbol || !normalized.side) {
    return {
      ok: false,
      reason: "SIGNAL_ENTRY_IDENTITY_OWNER_INVALID",
      normalized,
      fields: null,
    };
  }
  if (!normalized.signalTime) {
    return {
      ok: false,
      reason: "SIGNAL_ENTRY_IDENTITY_SIGNAL_TIME_INVALID",
      normalized,
      fields: null,
    };
  }

  return {
    ok: true,
    reason: null,
    normalized,
    fields: {
      action: INTENT_TYPE,
      uid: normalized.uid,
      pid: normalized.pid,
      strategyCategory: "signal",
      symbol: normalized.symbol,
      side: normalized.side,
      positionSide: normalized.positionSide,
      strategyRuntimeCode: normalized.strategyRuntimeCode || null,
      timeframe: normalized.timeframe || null,
      signalTime: normalized.signalTime,
    },
  };
};

const buildSignalMarketEntryStableIdentityHash = ({ payload = {} } = {}) => {
  const identity = buildSignalMarketEntryStableIdentityFields(payload);
  if (!identity.ok) {
    const error = new Error(identity.reason);
    error.code = identity.reason;
    error.identity = identity;
    throw error;
  }
  return sha1(safeJsonStringify(identity.fields));
};

const buildSignalMarketEntryIntentPayloadHash = ({ payload = {} } = {}) => {
  const identity = buildSignalMarketEntryStableIdentityFields(payload);
  if (!identity.ok) {
    const error = new Error(identity.reason);
    error.code = identity.reason;
    error.identity = identity;
    throw error;
  }
  return sha1(
    safeJsonStringify({
      ...identity.fields,
      signalPrice: identity.normalized.signalPrice,
      margin: identity.normalized.margin,
      leverage: identity.normalized.leverage,
      limitST: identity.normalized.limitST,
      clientOrderId: identity.normalized.clientOrderId,
    })
  );
};

const buildSignalMarketEntryIntentKey = ({ payload = {} } = {}) => {
  const identity = buildSignalMarketEntryStableIdentityFields(payload);
  if (!identity.ok) {
    const error = new Error(identity.reason);
    error.code = identity.reason;
    error.identity = identity;
    throw error;
  }
  return [
    INTENT_TYPE,
    identity.fields.uid,
    identity.fields.pid,
    identity.fields.symbol,
    identity.fields.side,
    buildSignalMarketEntryStableIdentityHash({ payload: identity.normalized }),
  ].join(":");
};

const buildSignalMarketEntryFifoKey = ({ payload = {} } = {}) => {
  const normalized = normalizeSignalMarketEntryIntentPayload(payload);
  return [
    normalized.uid,
    "signal",
    normalized.pid,
  ].join(":");
};

const normalizeDuplicateGuardStatus = (value) =>
  String(value || "").trim().toUpperCase();

const evaluateSignalMarketEntryDuplicateGuardSnapshot = ({
  existingIntent = null,
  openOwnership = null,
  openSnapshot = null,
  livePlay = null,
} = {}) => {
  const existingStatus = normalizeDuplicateGuardStatus(existingIntent?.status);
  if (["PENDING", "RUNNING"].includes(existingStatus)) {
    return {
      duplicate: true,
      reason: "SIGNAL_MARKET_ENTRY_DUPLICATE_INTENT_IN_FLIGHT",
      source: "order_intent_queue",
      id: existingIntent?.id || null,
      status: existingStatus,
    };
  }
  if (existingStatus === "DONE") {
    return {
      duplicate: true,
      reason: "SIGNAL_MARKET_ENTRY_DUPLICATE_INTENT_DONE",
      source: "order_intent_queue",
      id: existingIntent?.id || null,
      status: existingStatus,
    };
  }

  if (Number(openOwnership?.ownedQty || 0) > 0) {
    return {
      duplicate: true,
      reason: "SIGNAL_MARKET_ENTRY_DUPLICATE_OPEN_OWNERSHIP",
      source: "live_position_bucket_owner",
      id: openOwnership?.id || null,
      ownedQty: Number(openOwnership.ownedQty || 0),
    };
  }

  if (Number(openSnapshot?.openQty || 0) > 0) {
    return {
      duplicate: true,
      reason: "SIGNAL_MARKET_ENTRY_DUPLICATE_OPEN_SNAPSHOT",
      source: "live_pid_position_snapshot",
      id: openSnapshot?.id || null,
      openQty: Number(openSnapshot.openQty || 0),
    };
  }

  const liveStatus = normalizeDuplicateGuardStatus(livePlay?.status);
  if (liveStatus === "EXACT" && Number(livePlay?.r_qty || livePlay?.qty || 0) > 0) {
    return {
      duplicate: true,
      reason: "SIGNAL_MARKET_ENTRY_DUPLICATE_LIVE_EXACT",
      source: "live_play_list",
      id: livePlay?.id || livePlay?.pid || null,
      status: liveStatus,
      qty: Number(livePlay?.r_qty || livePlay?.qty || 0),
    };
  }

  return {
    duplicate: false,
    reason: null,
    source: null,
  };
};

module.exports = {
  INTENT_TYPE,
  normalizeSignalMarketEntryIntentPayload,
  buildSignalEntryClientOrderId,
  buildSignalMarketEntryStableIdentityFields,
  buildSignalMarketEntryStableIdentityHash,
  buildSignalMarketEntryIntentPayloadHash,
  buildSignalMarketEntryIntentKey,
  buildSignalMarketEntryFifoKey,
  evaluateSignalMarketEntryDuplicateGuardSnapshot,
};
