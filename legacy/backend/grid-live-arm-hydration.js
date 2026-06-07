"use strict";

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeSymbol = (value) => String(value || "").trim().toUpperCase();

const pick = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
};

const buildGridLiveArmPairPrimingPatch = ({ row = {}, payload = {} } = {}) => {
  const supportPrice = toNumber(pick(payload.supportPrice, payload.support, payload.lower, row.supportPrice));
  const resistancePrice = toNumber(pick(payload.resistancePrice, payload.resistance, payload.upper, row.resistancePrice));
  const triggerPrice = toNumber(pick(payload.triggerPrice, payload.trigger, payload.price, row.triggerPrice));
  const signalTime = pick(payload.signalTime, payload.receivedAt, payload.time, row.signalTime);

  return {
    supportPrice: supportPrice > 0 ? supportPrice : row.supportPrice || null,
    resistancePrice: resistancePrice > 0 ? resistancePrice : row.resistancePrice || null,
    triggerPrice: triggerPrice > 0 ? triggerPrice : row.triggerPrice || null,
    signalTime: signalTime || row.signalTime || null,
    regimeReceivedAt: signalTime || row.regimeReceivedAt || null,
    longLegStatus: "ENTRY_ARMED",
    longEntryOrderId: null,
    longQty: 0,
    longEntryPrice: null,
    shortLegStatus: "ENTRY_ARMED",
    shortEntryOrderId: null,
    shortQty: 0,
    shortEntryPrice: null,
  };
};

const hydrateGridLiveArmTargetItem = ({ targetItem = {}, gridPayload = {} } = {}) => {
  const payload = targetItem.gridPayload && typeof targetItem.gridPayload === "object"
    ? { ...gridPayload, ...targetItem.gridPayload }
    : { ...gridPayload };
  const symbol = normalizeSymbol(pick(targetItem.symbol, payload.symbol));
  const supportPrice = toNumber(pick(targetItem.supportPrice, payload.supportPrice, payload.support, payload.lower));
  const resistancePrice = toNumber(pick(targetItem.resistancePrice, payload.resistancePrice, payload.resistance, payload.upper));
  const triggerPrice = toNumber(pick(targetItem.triggerPrice, payload.triggerPrice, payload.trigger, payload.price));

  if (!symbol) {
    return { ok: false, reason: "GRID_LIVE_ARM_SYMBOL_MISSING" };
  }
  if (!(supportPrice > 0) || !(resistancePrice > 0) || !(triggerPrice > 0)) {
    return { ok: false, reason: "GRID_LIVE_ARM_PAIR_CONTEXT_MISSING" };
  }

  return {
    ok: true,
    targetItem: {
      ...targetItem,
      symbol,
      supportPrice,
      resistancePrice,
      triggerPrice,
      timeframe: pick(targetItem.timeframe, targetItem.bunbong, payload.timeframe, payload.bunbong),
      signalTime: pick(targetItem.signalTime, payload.signalTime, payload.receivedAt, payload.time),
      gridPayload: {
        ...payload,
        symbol,
        supportPrice,
        resistancePrice,
        triggerPrice,
      },
      gridPayloadHydrated: true,
      gridPayloadHydrationReason: "GRID_LIVE_ARM_PAIR_CONTEXT_HYDRATED",
    },
  };
};

const hydrateGridLiveArmRowForPairPriming = ({ row = {}, targetItem = {} } = {}) => {
  const payload = targetItem.gridPayload && typeof targetItem.gridPayload === "object"
    ? targetItem.gridPayload
    : targetItem;
  const hydrated = hydrateGridLiveArmTargetItem({
    targetItem: {
      uid: row.uid,
      pid: row.id,
      strategyCategory: "grid",
      strategyMode: "live",
      symbol: row.symbol,
      ...targetItem,
    },
    gridPayload: payload,
  });

  if (!hydrated.ok) {
    return hydrated;
  }

  const pairPrimingPatch = buildGridLiveArmPairPrimingPatch({
    row,
    payload: hydrated.targetItem.gridPayload || hydrated.targetItem,
  });

  return {
    ok: true,
    row: {
      ...row,
      ...pairPrimingPatch,
      gridPayload: hydrated.targetItem.gridPayload,
      __gridLiveArmPayloadHydrated: true,
      __gridLiveArmPairPrimingPatch: pairPrimingPatch,
      __gridLiveArmOriginalPairContext: {
        supportPrice: row.supportPrice,
        resistancePrice: row.resistancePrice,
        triggerPrice: row.triggerPrice,
        signalTime: row.signalTime,
      },
    },
  };
};

module.exports = {
  buildGridLiveArmPairPrimingPatch,
  hydrateGridLiveArmRowForPairPriming,
  hydrateGridLiveArmTargetItem,
};
