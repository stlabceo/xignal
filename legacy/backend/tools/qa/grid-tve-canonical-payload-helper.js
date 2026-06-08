"use strict";

const gridRuntime = require("../../grid-runtime");

const FORBIDDEN_GRID_TVE_FIELDS = Object.freeze([
  "signalPrice",
  "signal_price",
  "pid",
  "uid",
  "userId",
  "user_id",
  "targetId",
  "target_id",
  "webhookTargetId",
  "webhook_target_id",
]);

const pick = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
};

const assertNoForbiddenFields = (payload = {}) => {
  const forbidden = FORBIDDEN_GRID_TVE_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(payload, field)
  );
  if (forbidden.length > 0) {
    return {
      ok: false,
      reason: `forbidden-grid-tve-field:${forbidden[0]}`,
      forbidden,
    };
  }
  return { ok: true, reason: null, forbidden: [] };
};

const buildCanonicalBase = (input = {}) => ({
  strategySignal: pick(input.strategySignal, input.signal, input.strategy),
  symbol: pick(input.symbol, input.ticker, input.market),
  timeframe: pick(input.timeframe, input.bunbong, input.interval, input.timeFrame),
  supportPrice: pick(input.supportPrice, input.support, input.supportLine, input.lowerLine),
  resistancePrice: pick(input.resistancePrice, input.resistance, input.resistanceLine, input.upperLine),
  triggerPrice: pick(input.triggerPrice, input.trigger, input.triggerLine, input.centerLine),
  signalTime: pick(input.signalTime, input.time, input.eventTime, input.triggeredAt),
});

const buildGridArmTvePayloadUsingCanonicalKey = (input = {}) => {
  const forbidden = assertNoForbiddenFields(input);
  if (!forbidden.ok) {
    return {
      ok: false,
      reason: forbidden.reason,
      payload: null,
      expectedGridRegimeKey: null,
      forbidden: forbidden.forbidden,
    };
  }

  const base = buildCanonicalBase(input);
  const payload = {
    eventType: "GRID_ARM",
    strategySignal: base.strategySignal,
    symbol: base.symbol,
    timeframe: base.timeframe,
    supportPrice: base.supportPrice,
    resistancePrice: base.resistancePrice,
    triggerPrice: base.triggerPrice,
    signalTime: base.signalTime,
  };
  const expectedGridRegimeKey = gridRuntime.buildGridRegimeKey(payload);
  payload.gridRegimeKey = expectedGridRegimeKey;

  return {
    ok: true,
    reason: null,
    payload,
    expectedGridRegimeKey,
    forbidden: [],
  };
};

const buildGridExitTvePayloadUsingCanonicalKey = (input = {}) => {
  const forbidden = assertNoForbiddenFields(input);
  if (!forbidden.ok) {
    return {
      ok: false,
      reason: forbidden.reason,
      payload: null,
      expectedGridRegimeKey: null,
      forbidden: forbidden.forbidden,
    };
  }

  const base = buildCanonicalBase(input);
  const payload = {
    eventType: "GRID_EXIT",
    strategySignal: base.strategySignal,
    symbol: base.symbol,
    timeframe: base.timeframe,
    supportPrice: base.supportPrice,
    resistancePrice: base.resistancePrice,
    triggerPrice: base.triggerPrice,
    signalTime: base.signalTime,
  };
  const expectedGridRegimeKey = gridRuntime.buildGridRegimeKey(payload);
  payload.gridRegimeKey = expectedGridRegimeKey;

  return {
    ok: true,
    reason: null,
    payload,
    expectedGridRegimeKey,
    forbidden: [],
  };
};

const buildValidationSummary = ({ payload, expectedGridRegimeKey, validation, forbidden } = {}) => {
  const suppliedGridRegimeKey = String(payload?.gridRegimeKey || "").trim();
  return {
    ok: Boolean(
      forbidden?.ok &&
      validation?.ok &&
      suppliedGridRegimeKey &&
      expectedGridRegimeKey &&
      suppliedGridRegimeKey === expectedGridRegimeKey
    ),
    reason: !forbidden?.ok
      ? forbidden.reason
      : !validation?.ok
        ? validation.reason
        : suppliedGridRegimeKey !== expectedGridRegimeKey
          ? "grid-regime-key-send-gate-mismatch"
          : null,
    suppliedGridRegimeKey,
    expectedGridRegimeKey,
    equality: suppliedGridRegimeKey === expectedGridRegimeKey,
    signalPriceAbsent: !Object.prototype.hasOwnProperty.call(payload || {}, "signalPrice") &&
      !Object.prototype.hasOwnProperty.call(payload || {}, "signal_price"),
    forbiddenIdentityAbsent: !FORBIDDEN_GRID_TVE_FIELDS
      .filter((field) => !["signalPrice", "signal_price"].includes(field))
      .some((field) => Object.prototype.hasOwnProperty.call(payload || {}, field)),
    validationReason: validation?.reason || null,
    normalized: validation?.payload || null,
  };
};

const validateGridArmPayloadBeforeSend = (payload = {}, options = {}) => {
  const forbidden = assertNoForbiddenFields(payload);
  const expectedGridRegimeKey = gridRuntime.buildGridRegimeKey(payload);
  const validation = gridRuntime.validateGridWebhookPayload(payload, {
    env: options.env || { GRID_EXIT_CONTRACT_MODE: "ENFORCE" },
    featureFlags: options.featureFlags,
  });
  return buildValidationSummary({
    payload,
    expectedGridRegimeKey,
    validation,
    forbidden,
  });
};

const validateGridExitPayloadBeforeSend = (payload = {}, options = {}) => {
  const forbidden = assertNoForbiddenFields(payload);
  const expectedGridRegimeKey = gridRuntime.buildGridRegimeKey(payload);
  const validation = gridRuntime.validateGridExitWebhookPayload(payload, {
    env: options.env || {
      GRID_EXIT_CONTRACT_MODE: "ENFORCE",
      GRID_CANDLE_CLOSE_LEGACY_MODE: "REJECT",
    },
    featureFlags: options.featureFlags,
  });
  return buildValidationSummary({
    payload,
    expectedGridRegimeKey,
    validation,
    forbidden,
  });
};

module.exports = {
  FORBIDDEN_GRID_TVE_FIELDS,
  buildGridArmTvePayloadUsingCanonicalKey,
  buildGridExitTvePayloadUsingCanonicalKey,
  validateGridArmPayloadBeforeSend,
  validateGridExitPayloadBeforeSend,
};
