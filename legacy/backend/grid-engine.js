const crypto = require("crypto");
const db = require("./database/connect/config");
const dbcon = require("./dbcon");
const dt = require("./data");
const gridRuntime = require("./grid-runtime");
const positionOwnership = require("./position-ownership");
const pidPositionLedger = require("./pid-position-ledger");
const redisClient = require("./util/redis.util");
const gridPairAtomicity = require("./grid-pair-atomicity");
const gridProtectionGuarantee = require("./grid-protection-guarantee");
const gridPriceSource = require("./grid-price-source");
const gridReentrySlPolicy = require("./grid-reentry-sl-policy");
const gridLiveArmHydration = require("./grid-live-arm-hydration");
const liveWriteSafetyGate = require("./live-write-safety-gate");
const orderIntentQueue = require("./order-intent-queue");

const MODE_TABLE = {
  LIVE: "live_grid_strategy_list",
  TEST: "test_grid_strategy_list",
};

const LEG_META = {
  LONG: {
    key: "long",
    code: "L",
    signalSide: "BUY",
    closeSide: "SELL",
    positionSide: "LONG",
  },
  SHORT: {
    key: "short",
    code: "S",
    signalSide: "SELL",
    closeSide: "BUY",
    positionSide: "SHORT",
  },
};

const RUN_LOCK = {
  LIVE: false,
  TEST: false,
};
const GRID_RUNTIME_EVENT_TTL_MS = 120000;
const recentGridRuntimeEvents = new Map();
const activeGridRuntimeLocks = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTruthyEnv = (value) =>
  ["1", "true", "yes", "y", "on"].includes(String(value || "").trim().toLowerCase());

const parsePositiveIntegerEnv = (value, fallback, { min = 1, max = 20 } = {}) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return Math.min(max, parsed);
};

const isBoundedLiveArmEntryFillRecoveryEnabled = () =>
  isTruthyEnv(process.env.QA_SCOPED_GRID_RUNTIME) ||
  isTruthyEnv(process.env.GRID_LIVE_ARM_ENTRY_FILL_BOUNDED_RECOVERY);

const getLiveArmEntryFillRecoveryAttempts = () =>
  isBoundedLiveArmEntryFillRecoveryEnabled()
    ? parsePositiveIntegerEnv(process.env.GRID_LIVE_ARM_ENTRY_FILL_RECOVERY_ATTEMPTS, 4, { min: 1, max: 8 })
    : 1;

const getLiveArmEntryFillRecoveryDelayMs = () =>
  parsePositiveIntegerEnv(process.env.GRID_LIVE_ARM_ENTRY_FILL_RECOVERY_DELAY_MS, 1500, { min: 250, max: 10000 });

const logGridRuntimeTrace = (stage, payload = {}) => {
  try {
    console.log(`[GRID_RUNTIME][${stage}] ${JSON.stringify(payload)}`);
  } catch (error) {
    console.log(`[GRID_RUNTIME][${stage}]`);
  }
};

const buildGridRuntimeTracePayload = (handler, parsed, reData, extra = {}) => ({
  handler,
  uid: parsed?.uid || null,
  pid: parsed?.pid || null,
  symbol: parsed?.symbol || reData?.s || null,
  leg: parsed?.leg || null,
  clientOrderId: parsed?.clientOrderId || reData?.c || null,
  orderId: reData?.i || null,
  tradeId: reData?.t || null,
  eventType: reData?.x || null,
  endStatus: reData?.X || null,
  tradeTime: reData?.T || null,
  ...extra,
});

const toAuditTimestamp = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildLatencyMs = (from, to = Date.now()) => {
  const fromMs = toAuditTimestamp(from);
  const toMs = toAuditTimestamp(to);
  if (!(fromMs > 0) || !(toMs > 0)) {
    return null;
  }
  return Math.max(0, toMs - fromMs);
};

const buildPrivateSocketLatencyPayload = (reData = {}) => {
  const receivedAt = toAuditTimestamp(reData?.__privateSocketReceivedAt);
  const eventTime = toAuditTimestamp(reData?.__privateSocketEventTime || reData?.T);
  return {
    socketIngressLatencyMs: eventTime && receivedAt ? buildLatencyMs(eventTime, receivedAt) : null,
    socketHandlerLatencyMs: receivedAt ? Date.now() - receivedAt : null,
    socketConvergenceLatencyMs: null,
  };
};

const withGridRuntimeTraceScope = async (handler, parsed, reData, worker) => {
  let outcome = "IGNORED";
  const tracePayload = buildGridRuntimeTracePayload(handler, parsed, reData);
  logGridRuntimeTrace(`${handler}_START`, tracePayload);

  try {
    const result = await worker({
      setOutcome: (nextOutcome) => {
        if (nextOutcome) {
          outcome = nextOutcome;
        }
      },
      tracePayload,
    });
    if (result && outcome === "IGNORED") {
      outcome = "HANDLED";
    }
    return result;
  } catch (error) {
    outcome = "ERROR";
    logGridRuntimeTrace(`${handler}_ERROR`, {
      ...tracePayload,
      message: error?.message || String(error),
      stack: error?.stack || null,
    });
    console.log(`[${handler}]`, error);
    return false;
  } finally {
    logGridRuntimeTrace(`${handler}_END`, {
      ...tracePayload,
      outcome,
    });
  }
};

const getCoin = () => require("./coin");

const loadFreshGridDecisionPrice = async (symbol, options = {}) => {
  const coin = getCoin();
  if (typeof coin.ensurePublicMarketPrice === "function") {
    return await coin.ensurePublicMarketPrice(symbol, options);
  }
  return dt.getPrice(symbol);
};

const pruneRecentGridRuntimeEvents = () => {
  const now = Date.now();
  for (const [key, expireAt] of recentGridRuntimeEvents.entries()) {
    if (expireAt <= now) {
      recentGridRuntimeEvents.delete(key);
    }
  }
};

const reserveRedisGridLock = async (key, token, ttlSeconds = 15) => {
  if (!redisClient || typeof redisClient.set !== "function") {
    return null;
  }

  if (redisClient.isOpen === false || redisClient.isReady === false) {
    return null;
  }

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      resolve(value);
    };

    const timeoutId = setTimeout(() => finish(null), 250);

    try {
      redisClient.set(key, token, "EX", ttlSeconds, "NX", (error, response) => {
        if (error) {
          finish(null);
          return;
        }

        finish(response === "OK");
      });
    } catch (error) {
      finish(null);
    }
  });
};

const releaseRedisGridLock = async (key, token) => {
  if (!redisClient || typeof redisClient.get !== "function") {
    return;
  }

  if (redisClient.isOpen === false || redisClient.isReady === false) {
    return;
  }

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      resolve();
    };

    const timeoutId = setTimeout(() => finish(), 250);

    try {
      redisClient.get(key, (getError, currentValue) => {
        if (getError || currentValue !== token) {
          finish();
          return;
        }

        redisClient.del(key, () => finish());
      });
    } catch (error) {
      finish();
    }
  });
};

const shouldSkipDuplicateGridRuntimeEvent = (parsed, reData) => {
  pruneRecentGridRuntimeEvents();
  const eventKey = [
    parsed.type,
    parsed.clientOrderId,
    reData.i || 0,
    reData.x || "",
    reData.X || "",
    reData.z || "",
    reData.ap || reData.L || reData.p || "",
  ].join(":");

  if (recentGridRuntimeEvents.has(eventKey)) {
    logGridRuntimeTrace("GRID_RUNTIME_DEDUPE", {
      skip: true,
      reason: "RECENT_DUPLICATE",
      dedupeKey: eventKey,
      pid: parsed?.pid || null,
      uid: parsed?.uid || null,
      symbol: parsed?.symbol || null,
      leg: parsed?.leg || null,
      type: parsed?.type || null,
      eventType: reData?.x || null,
      endStatus: reData?.X || null,
      orderId: reData?.i || null,
      clientOrderId: parsed?.clientOrderId || null,
      tradeTime: reData?.T || null,
    });
    return true;
  }

  recentGridRuntimeEvents.set(eventKey, Date.now() + GRID_RUNTIME_EVENT_TTL_MS);
  logGridRuntimeTrace("GRID_RUNTIME_DEDUPE", {
    skip: false,
    reason: "ACCEPTED",
    dedupeKey: eventKey,
    pid: parsed?.pid || null,
    uid: parsed?.uid || null,
    symbol: parsed?.symbol || null,
    leg: parsed?.leg || null,
    type: parsed?.type || null,
    eventType: reData?.x || null,
    endStatus: reData?.X || null,
    orderId: reData?.i || null,
    clientOrderId: parsed?.clientOrderId || null,
    tradeTime: reData?.T || null,
  });
  return false;
};

const withGridRuntimeLock = async (
  key,
  worker,
  {
    waitForUnlock = false,
    waitMs = 5000,
    pollMs = 20,
  } = {}
) => {
  if (!key) {
    return await worker();
  }

  const startedAt = Date.now();
  while (true) {
    if (activeGridRuntimeLocks.has(key)) {
      if (!waitForUnlock || Date.now() - startedAt >= waitMs) {
        return false;
      }

      await sleep(pollMs);
      continue;
    }

    const lockToken = crypto.randomBytes(8).toString("hex");
    activeGridRuntimeLocks.add(key);
    const redisLockKey = `grid:lock:${key}`;
    const redisReserved = await reserveRedisGridLock(redisLockKey, lockToken);
    const redisGate = liveWriteSafetyGate.evaluateRedisLockReservation({
      redisReserved,
      lockKey: redisLockKey,
      scope: key,
      strategyCategory: "grid",
      liveScope: String(key || "").startsWith("LIVE:"),
    });
    if (!redisGate.allowed) {
      activeGridRuntimeLocks.delete(key);
      console.log("[LIVE_WRITE_SAFETY_GATE] grid runtime lock blocked", {
        reason: redisGate.reason,
        scope: key,
        lockKey: redisLockKey,
      });
      return false;
    }
    if (redisReserved === false) {
      activeGridRuntimeLocks.delete(key);
      if (!waitForUnlock || Date.now() - startedAt >= waitMs) {
        return false;
      }

      await sleep(pollMs);
      continue;
    }

    try {
      return await worker();
    } finally {
      activeGridRuntimeLocks.delete(key);
      await releaseRedisGridLock(redisLockKey, lockToken);
    }
  }
};

const withLiveGridArmLock = async (pid, worker) => {
  if (!pid) {
    return await worker();
  }

  return await withGridRuntimeLock(`LIVE:ARM:${pid}`, worker);
};

const withQueuedLiveGridEventLock = async (scope, clientOrderId, worker) => {
  if (!clientOrderId) {
    return await worker();
  }

  return await withGridRuntimeLock(`LIVE:${scope}:${clientOrderId}`, worker, {
    waitForUnlock: true,
    waitMs: 5000,
    pollMs: 15,
  });
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const nowClientSuffix = () => String(Date.now()).slice(-8);

const getTableName = (mode) => MODE_TABLE[String(mode || "").toUpperCase()] || null;

const getLegMeta = (leg) => LEG_META[String(leg || "").toUpperCase()] || null;

const getLegFieldPrefix = (leg) => {
  const meta = getLegMeta(leg);
  return meta ? meta.key : null;
};

const getLegPositionSide = (leg) => getLegMeta(leg)?.positionSide || null;

const buildGridClientOrderId = (prefix, leg, uid, pid) =>
  `${prefix}_${getLegMeta(leg)?.code || "X"}_${uid}_${pid}_${nowClientSuffix()}`;

const GRID_CANCEL_CLOSE_STATE = Object.freeze({
  CANCEL_INTENT_PENDING: "CANCEL_INTENT_PENDING",
  CLOSE_INTENT_PENDING: "CLOSE_INTENT_PENDING",
  GMANUAL_QUEUED: "GMANUAL_QUEUED",
  CONTROLLED_CLOSE_QUEUED: "CONTROLLED_CLOSE_QUEUED",
});

const parseGridClientOrderId = (clientOrderId) => {
  const raw = String(clientOrderId || "").trim();
  const match = raw.match(/^(GENTRY|GTP|GSTOP|GMANUAL)_(L|S)_(\d+)_(\d+)(?:_(\d+))?$/);
  if (!match) {
    return null;
  }

  const [, type, legCode, uid, pid] = match;
  return {
    type,
    leg: legCode === "L" ? "LONG" : "SHORT",
    uid: Number(uid),
    pid: Number(pid),
    clientOrderId: raw,
  };
};

const acquireGridLegPositionOwnership = async (
  row,
  leg,
  {
    ownerState = "ENTRY_ARMED",
    sourceClientOrderId = null,
    sourceOrderId = null,
    note = null,
  } = {}
) => {
  if (!row?.uid || !row?.id || !row?.symbol || !leg) {
    return {
      ok: false,
      conflict: false,
      reason: "INVALID_GRID_BUCKET",
      owner: null,
    };
  }

  return await positionOwnership.acquirePositionBucketOwner({
    uid: row.uid,
    symbol: row.symbol,
    positionSide: getLegPositionSide(leg),
    ownerPid: row.id,
    ownerStrategyCategory: "grid",
    ownerSignalType: getLegMeta(leg)?.signalSide || null,
    ownerStrategyName: row.a_name || row.strategySignal || null,
    ownerState,
    sourceClientOrderId,
    sourceOrderId: sourceOrderId == null ? null : String(sourceOrderId),
    note,
  });
};

const touchGridLegPositionOwnership = async (
  row,
  leg,
  {
    ownerState = null,
    sourceClientOrderId = null,
    sourceOrderId = null,
    note = null,
  } = {}
) => {
  if (!row?.uid || !row?.id || !row?.symbol || !leg) {
    return false;
  }

  return await positionOwnership.touchPositionBucketOwner({
    uid: row.uid,
    symbol: row.symbol,
    positionSide: getLegPositionSide(leg),
    ownerPid: row.id,
    ownerStrategyCategory: "grid",
    ownerSignalType: getLegMeta(leg)?.signalSide || null,
    ownerState,
    sourceClientOrderId,
    sourceOrderId: sourceOrderId == null ? null : String(sourceOrderId),
    note,
  });
};

const releaseGridLegPositionOwnership = async (row, leg) => {
  if (!row?.uid || !row?.id || !row?.symbol || !leg) {
    return false;
  }

  return await positionOwnership.releasePositionBucketOwner({
    uid: row.uid,
    symbol: row.symbol,
    positionSide: getLegPositionSide(leg),
    ownerPid: row.id,
    ownerStrategyCategory: "grid",
  });
};

const releaseAllGridPositionOwnership = async (row) => {
  if (!row?.id) {
    return 0;
  }

  return await positionOwnership.releaseAllPositionBucketOwnersByPid({
    ownerPid: row.id,
    ownerStrategyCategory: "grid",
  });
};

const getTradeValue = (row) => {
  const configuredTradeValue = toNumber(row.tradeValue);
  if (configuredTradeValue > 0) {
    return configuredTradeValue;
  }

  return toNumber(row.margin) * toNumber(row.leverage);
};

const computeGridEntryQty = (row, entryPrice) => {
  if (!entryPrice) {
    return 0;
  }

  const tradeValue = getTradeValue(row);
  if (tradeValue <= 0) {
    return 0;
  }

  return tradeValue / entryPrice;
};

const parseGridPayloadObject = (value) => {
  if (!value) {
    return {};
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
};

const pickGridPayloadValue = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
};

const GRID_CONTEXT_PRESERVE_FIELDS = [
  "supportPrice",
  "resistancePrice",
  "triggerPrice",
  "lastWebhookPayloadJson",
];

const isBlankGridContextValue = (value) =>
  value === undefined || value === null || String(value).trim() === "";

const isLiveGridStrategyTable = (tableName) =>
  String(tableName || "").trim() === "live_grid_strategy_list";

const isStrictSideTriggerGridRow = (row = {}) => {
  const profile = String(getGridTriggerProfile(row) || "").trim().toUpperCase();
  const signal = String(row.strategySignal || "").trim().toUpperCase();
  return profile === "35_65" || signal.endsWith("_35_65");
};

const getGridRowPayload = (row = {}) => {
  if (row.gridPayload && typeof row.gridPayload === "object") {
    return row.gridPayload;
  }
  return parseGridPayloadObject(row.lastWebhookPayloadJson);
};

const getGridTriggerProfile = (row = {}) => {
  const payload = getGridRowPayload(row);
  return String(pickGridPayloadValue(row.triggerProfile, payload.triggerProfile, payload.trigger_profile) || "").trim();
};

const getGridSupportPrice = (row = {}) => {
  const payload = getGridRowPayload(row);
  return toNumber(pickGridPayloadValue(
    row.supportPrice,
    payload.supportPrice,
    payload.support,
    payload.supportLine,
    payload.lowerLine
  ));
};

const getGridResistancePrice = (row = {}) => {
  const payload = getGridRowPayload(row);
  return toNumber(pickGridPayloadValue(
    row.resistancePrice,
    payload.resistancePrice,
    payload.resistance,
    payload.resistanceLine,
    payload.upperLine
  ));
};

const getGridLegTriggerPrice = (row = {}, leg = "LONG") => {
  const payload = getGridRowPayload(row);
  const fallbackTriggerPrice = pickGridPayloadValue(row.triggerPrice, payload.triggerPrice, payload.trigger, payload.price);
  const sideValue = leg === "SHORT"
    ? pickGridPayloadValue(
        row.shortTriggerPrice,
        row.short_trigger_price,
        payload.shortTriggerPrice,
        payload.short_trigger_price,
        payload.shortTrigger,
        payload.shortEntryPrice,
        payload.sellTriggerPrice
      )
    : pickGridPayloadValue(
        row.longTriggerPrice,
        row.long_trigger_price,
        payload.longTriggerPrice,
        payload.long_trigger_price,
        payload.longTrigger,
        payload.longEntryPrice,
        payload.buyTriggerPrice
      );
  if (isStrictSideTriggerGridRow(row) && !(toNumber(sideValue) > 0)) {
    return 0;
  }
  return toNumber(pickGridPayloadValue(sideValue, fallbackTriggerPrice));
};

const getGridSideTriggerMetadata = (row = {}) => {
  const payload = getGridRowPayload(row);
  return {
    supportPrice: getGridSupportPrice(row),
    resistancePrice: getGridResistancePrice(row),
    payloadTriggerPrice: toNumber(pickGridPayloadValue(row.triggerPrice, payload.triggerPrice, payload.trigger, payload.price)),
    longTriggerPrice: getGridLegTriggerPrice(row, "LONG"),
    shortTriggerPrice: getGridLegTriggerPrice(row, "SHORT"),
    triggerProfile: getGridTriggerProfile(row) || null,
    gridRegimeKey: pickGridPayloadValue(
      row.gridRegimeKey,
      payload.gridRegimeKey,
      payload.canonicalGridRegimeKey,
      extractGridRegimeKeyFromLastPayload(row.lastWebhookPayloadJson)
    ) || null,
  };
};

const computeLegTakeProfitPrice = (row, leg, entryPrice) => {
  const profitPercent = toNumber(row.profit);
  if (!(profitPercent > 0) || !(entryPrice > 0)) {
    return 0;
  }

  const rate = profitPercent * 0.01;
  return leg === "LONG" ? entryPrice * (1 + rate) : entryPrice * (1 - rate);
};

const computeLegStopPrice = (row, leg) =>
  leg === "LONG" ? getGridSupportPrice(row) : getGridResistancePrice(row);

const getEntryFillPriceFromTicker = (leg, price) => {
  if (!price?.st) {
    return 0;
  }

  return leg === "LONG" ? toNumber(price.bestAsk) : toNumber(price.bestBid);
};

const getExitFillPriceFromTicker = (leg, reason, price) => {
  if (!price?.st) {
    return 0;
  }

  if (leg === "LONG") {
    return reason === "take-profit" ? toNumber(price.bestBid) : toNumber(price.bestBid);
  }

  return reason === "take-profit" ? toNumber(price.bestAsk) : toNumber(price.bestAsk);
};

const isLegEntryTriggered = (leg, row, price) => {
  const triggerPrice = getGridLegTriggerPrice(row, leg);
  if (!(triggerPrice > 0) || !price?.st) {
    return false;
  }

  if (leg === "LONG") {
    return toNumber(price.bestAsk) <= triggerPrice;
  }

  return toNumber(price.bestBid) >= triggerPrice;
};

const isLegTakeProfitTriggered = (leg, row, price) => {
  const prefix = getLegFieldPrefix(leg);
  const targetPrice = toNumber(row?.[`${prefix}TakeProfitPrice`]);
  if (!(targetPrice > 0) || !price?.st) {
    return false;
  }

  if (leg === "LONG") {
    return toNumber(price.bestBid) >= targetPrice;
  }

  return toNumber(price.bestAsk) <= targetPrice;
};

const isLegStopTriggered = (leg, row, price) => {
  const prefix = getLegFieldPrefix(leg);
  const stopPrice = toNumber(row?.[`${prefix}StopPrice`]);
  if (!(stopPrice > 0) || !price?.st) {
    return false;
  }

  if (leg === "LONG") {
    return toNumber(price.bestBid) <= stopPrice;
  }

  return toNumber(price.bestAsk) >= stopPrice;
};

const isBoundaryBreakWithoutOpenPosition = (row, price) => {
  if (!price?.st) {
    return false;
  }

  const supportPrice = toNumber(row.supportPrice);
  const resistancePrice = toNumber(row.resistancePrice);
  const hasOpenPosition = toNumber(row.longQty) > 0 || toNumber(row.shortQty) > 0;

  if (hasOpenPosition) {
    return false;
  }

  return toNumber(price.bestBid) <= supportPrice || toNumber(price.bestAsk) >= resistancePrice;
};

const isBoundaryBreak = (row, price) => {
  if (!price?.st) {
    return false;
  }

  const supportPrice = toNumber(row.supportPrice);
  const resistancePrice = toNumber(row.resistancePrice);
  return toNumber(price.bestBid) <= supportPrice || toNumber(price.bestAsk) >= resistancePrice;
};

const hasOpenPosition = (row) => toNumber(row.longQty) > 0 || toNumber(row.shortQty) > 0;

const hasOpenLeg = (row, leg) => {
  const prefix = getLegFieldPrefix(leg);
  return row?.[`${prefix}LegStatus`] === "OPEN" && toNumber(row?.[`${prefix}Qty`]) > 0;
};

const hasArmedEntryLeg = (row, leg) => {
  const prefix = getLegFieldPrefix(leg);
  return row?.[`${prefix}LegStatus`] === "ENTRY_ARMED";
};

const hasAnyEntryArmed = (row) => hasArmedEntryLeg(row, "LONG") || hasArmedEntryLeg(row, "SHORT");

const isGridControlEnabled = (row) =>
  String(row?.enabled || "").trim().toUpperCase() === "Y";

const canArmEntriesForRow = (row) =>
  isGridControlEnabled(row)
  && row?.regimeStatus !== "ENDED"
  && !gridPairAtomicity.isPairArmDefectState(row)
  && !gridProtectionGuarantee.isProtectionCriticalState(row)
  && !gridReentrySlPolicy.isReentryCriticalState(row)
  && !gridReentrySlPolicy.isSlCriticalState(row)
  && row?.regimeEndReason !== "BOX_BREAK"
  && row?.regimeEndReason !== "BOX_BREAK_WAITING";

const canArmInitialLiveEntriesForRow = (row) =>
  canArmEntriesForRow(row)
  && !hasOpenPosition(row)
  && !hasAnyEntryArmed(row);

const getLegPatchForReset = (leg) => {
  const prefix = getLegFieldPrefix(leg);
  return {
    [`${prefix}LegStatus`]: "IDLE",
    [`${prefix}EntryOrderId`]: null,
    [`${prefix}ExitOrderId`]: null,
    [`${prefix}StopOrderId`]: null,
    [`${prefix}Qty`]: 0,
    [`${prefix}EntryPrice`]: null,
    [`${prefix}TakeProfitPrice`]: null,
    [`${prefix}StopPrice`]: null,
  };
};

const getLegPatchForEntryArmed = (leg, entryOrderId = null) => {
  const prefix = getLegFieldPrefix(leg);
  return {
    [`${prefix}LegStatus`]: "ENTRY_ARMED",
    [`${prefix}EntryOrderId`]: entryOrderId,
    [`${prefix}ExitOrderId`]: null,
    [`${prefix}StopOrderId`]: null,
    [`${prefix}Qty`]: 0,
    [`${prefix}EntryPrice`]: null,
    [`${prefix}TakeProfitPrice`]: null,
    [`${prefix}StopPrice`]: null,
  };
};

const getLegPatchForClosed = (leg) => getLegPatchForReset(leg);

const extractGridRegimeKeyFromLastPayload = (payloadJson = null) => {
  if (!payloadJson) {
    return null;
  }
  try {
    const payload = typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;
    return String(payload?.gridRegimeKey || payload?.regimeKey || "").trim() || null;
  } catch (error) {
    return null;
  }
};

const buildResetRegimePatch = (reason = null) => ({
  regimeStatus: "WAITING_WEBHOOK",
  regimeEndReason: reason,
  regimeReceivedAt: null,
  signalTime: null,
  supportPrice: null,
  resistancePrice: null,
  triggerPrice: null,
  lastWebhookPayloadJson: null,
  ...getLegPatchForReset("LONG"),
  ...getLegPatchForReset("SHORT"),
});

const buildEndedRegimePatch = (row, reason = "BOX_BREAK") => {
  const patch = {
    regimeStatus: "ENDED",
    regimeEndReason: reason,
  };

  for (const leg of ["LONG", "SHORT"]) {
    if (hasOpenLeg(row, leg)) {
      continue;
    }

    Object.assign(patch, getLegPatchForReset(leg));
  }

  return patch;
};

const buildOpenLegPatch = ({
  leg,
  entryOrderId,
  entryPrice,
  qty,
  takeProfitPrice,
  stopPrice,
  takeProfitOrderId,
  stopOrderId,
  regimeStatus = "ACTIVE",
  regimeEndReason = null,
}) => {
  const prefix = getLegFieldPrefix(leg);
  return {
    regimeStatus,
    regimeEndReason,
    [`${prefix}LegStatus`]: "OPEN",
    [`${prefix}EntryOrderId`]: entryOrderId,
    [`${prefix}ExitOrderId`]: takeProfitOrderId || null,
    [`${prefix}StopOrderId`]: stopOrderId || null,
    [`${prefix}Qty`]: qty,
    [`${prefix}EntryPrice`]: entryPrice,
    [`${prefix}TakeProfitPrice`]: takeProfitPrice,
    [`${prefix}StopPrice`]: stopPrice,
  };
};

const buildSqlSetClause = (patch) =>
  Object.keys(patch)
    .map((key) => `${key} = ?`)
    .join(", ");

const isSafeGridPatchColumn = (column) => /^[A-Za-z0-9_]+$/.test(String(column || ""));

const areGridPatchValuesEquivalent = (current, next) => {
  if (current == null && next == null) {
    return true;
  }
  if (current == null || next == null) {
    return false;
  }
  if (current instanceof Date || next instanceof Date) {
    const currentTime = current instanceof Date ? current.getTime() : Date.parse(String(current));
    const nextTime = next instanceof Date ? next.getTime() : Date.parse(String(next));
    return Number.isFinite(currentTime) && Number.isFinite(nextTime) && currentTime === nextTime;
  }
  const currentNumber = Number(current);
  const nextNumber = Number(next);
  if (Number.isFinite(currentNumber) && Number.isFinite(nextNumber)) {
    return currentNumber === nextNumber;
  }
  return String(current) === String(next);
};

const isNoopGridPatch = async (tableName, id, patch = {}) => {
  const columns = Object.keys(patch);
  if (!id || columns.length === 0 || columns.some((column) => !isSafeGridPatchColumn(column))) {
    return false;
  }

  const [rows] = await db.query(
    `SELECT ${columns.join(", ")}
       FROM ${tableName}
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  const current = rows?.[0];
  if (!current) {
    return false;
  }
  return columns.every((column) => areGridPatchValuesEquivalent(current[column], patch[column]));
};

const preserveLiveGridContextPatch = async (tableName, id, patch = {}) => {
  if (!isLiveGridStrategyTable(tableName) || !id || !patch || typeof patch !== "object") {
    return patch;
  }

  const resetFields = GRID_CONTEXT_PRESERVE_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(patch, field) && isBlankGridContextValue(patch[field])
  );
  if (resetFields.length === 0) {
    return patch;
  }

  const [rows] = await db.query(
    `SELECT ${GRID_CONTEXT_PRESERVE_FIELDS.join(", ")}
       FROM live_grid_strategy_list
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  const current = rows?.[0] || {};
  const preserved = { ...patch };
  for (const field of resetFields) {
    if (!isBlankGridContextValue(current[field])) {
      preserved[field] = current[field];
    }
  }
  return preserved;
};

const applyGridPatch = async (tableName, id, patch = {}) => {
  const finalPatch = await preserveLiveGridContextPatch(tableName, id, patch);
  const entries = Object.entries(finalPatch);
  if (entries.length === 0) {
    return false;
  }
  if (await isNoopGridPatch(tableName, id, finalPatch)) {
    return false;
  }

  const sql = `UPDATE ${tableName} SET ${buildSqlSetClause(finalPatch)}, updatedAt = NOW() WHERE id = ? LIMIT 1`;
  await db.query(sql, [...entries.map(([, value]) => value), id]);
  return true;
};

const reserveLiveGridEntrySlot = async (row, leg) => {
  if (!row?.id || !row?.uid) {
    return null;
  }

  const prefix = getLegFieldPrefix(leg);
  if (!prefix) {
    return null;
  }

  const reservationId = `GPENDING_${getLegMeta(leg)?.code || "X"}_${row.uid}_${row.id}_${nowClientSuffix()}`;
  const [result] = await db.query(
    `UPDATE live_grid_strategy_list
        SET regimeStatus = 'ACTIVE',
            regimeEndReason = NULL,
            ${prefix}EntryOrderId = ?,
            updatedAt = NOW()
      WHERE id = ?
        AND uid = ?
        AND ${prefix}LegStatus = 'ENTRY_ARMED'
        AND (${prefix}EntryOrderId IS NULL OR ${prefix}EntryOrderId = '')
        AND regimeStatus <> 'ENDED'
      LIMIT 1`,
    [reservationId, row.id, row.uid]
  );

  return result?.affectedRows > 0 ? reservationId : null;
};

const finalizeLiveGridEntrySlot = async (row, leg, reservedOrderId, actualOrderId = null) => {
  if (!row?.id || !row?.uid || !reservedOrderId) {
    return false;
  }

  const prefix = getLegFieldPrefix(leg);
  if (!prefix) {
    return false;
  }

  const [result] = await db.query(
    `UPDATE live_grid_strategy_list
        SET regimeStatus = 'ACTIVE',
            regimeEndReason = NULL,
            ${prefix}EntryOrderId = ?,
            updatedAt = NOW()
      WHERE id = ?
        AND uid = ?
        AND ${prefix}EntryOrderId = ?
      LIMIT 1`,
    [actualOrderId || null, row.id, row.uid, reservedOrderId]
  );

  return result?.affectedRows > 0;
};

const loadGridItem = async (mode, id) => {
  const tableName = getTableName(mode);
  if (!tableName || !id) {
    return null;
  }

  const [rows] = await db.query(`SELECT * FROM ${tableName} WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
};

const loadLiveGridLegSnapshotState = async (row, leg) => {
  if (!row?.uid || !row?.id || !leg) {
    return {
      snapshot: null,
      qty: 0,
      entryPrice: null,
    };
  }

  const snapshot = await pidPositionLedger.loadSnapshot({
    uid: row.uid,
    pid: row.id,
    strategyCategory: "grid",
    positionSide: leg,
  });
  const qty = toNumber(snapshot?.openQty);
  const entryPrice = toNumber(snapshot?.avgEntryPrice);

  return {
    snapshot,
    qty,
    entryPrice: entryPrice > 0 ? entryPrice : null,
  };
};

const buildLiveOpenLegPatchFromSnapshot = (
  row,
  leg,
  snapshotState,
  { clearOrderRefs = false } = {}
) => {
  const prefix = getLegFieldPrefix(leg);
  if (!prefix) {
    return {};
  }

  return {
    [`${prefix}LegStatus`]: "OPEN",
    [`${prefix}EntryOrderId`]: clearOrderRefs ? null : row?.[`${prefix}EntryOrderId`] || null,
    [`${prefix}ExitOrderId`]: clearOrderRefs ? null : row?.[`${prefix}ExitOrderId`] || null,
    [`${prefix}StopOrderId`]: clearOrderRefs ? null : row?.[`${prefix}StopOrderId`] || null,
    [`${prefix}Qty`]: toNumber(snapshotState?.qty),
    [`${prefix}EntryPrice`]: snapshotState?.entryPrice || null,
    [`${prefix}TakeProfitPrice`]: clearOrderRefs ? null : row?.[`${prefix}TakeProfitPrice`] || null,
    [`${prefix}StopPrice`]: clearOrderRefs ? null : row?.[`${prefix}StopPrice`] || null,
  };
};

const syncLiveGridRowFromPidState = async (
  row,
  {
    regimeStatus = null,
    regimeEndReason = undefined,
    clearOpenLegOrderRefs = false,
  } = {}
) => {
  if (!row?.id || !row?.uid) {
    return row || null;
  }

  const longState = await loadLiveGridLegSnapshotState(row, "LONG");
  const shortState = await loadLiveGridLegSnapshotState(row, "SHORT");
  const patch = {};

  if (regimeStatus != null) {
    patch.regimeStatus = regimeStatus;
  }
  if (regimeEndReason !== undefined) {
    patch.regimeEndReason = regimeEndReason;
  }

  Object.assign(
    patch,
    longState.qty > 0
      ? buildLiveOpenLegPatchFromSnapshot(row, "LONG", longState, {
          clearOrderRefs: clearOpenLegOrderRefs,
        })
      : getLegPatchForClosed("LONG")
  );
  Object.assign(
    patch,
    shortState.qty > 0
      ? buildLiveOpenLegPatchFromSnapshot(row, "SHORT", shortState, {
          clearOrderRefs: clearOpenLegOrderRefs,
        })
      : getLegPatchForClosed("SHORT")
  );

  await applyGridPatch("live_grid_strategy_list", row.id, patch);
  return (await loadGridItem("LIVE", row.id)) || row;
};

const hasLiveGridActiveReservations = async (row) => {
  if (!row?.uid || !row?.id) {
    return false;
  }

  const reservations = await pidPositionLedger.loadActiveReservations({
    uid: row.uid,
    pid: row.id,
    strategyCategory: "grid",
  });

  return reservations.length > 0;
};

const hasLiveGridOpenSnapshotQty = async (row) => {
  if (!row?.uid || !row?.id) {
    return false;
  }

  const [longQty, shortQty] = await Promise.all([
    pidPositionLedger.getOpenQty({
      uid: row.uid,
      pid: row.id,
      strategyCategory: "grid",
      positionSide: "LONG",
    }),
    pidPositionLedger.getOpenQty({
      uid: row.uid,
      pid: row.id,
      strategyCategory: "grid",
      positionSide: "SHORT",
    }),
  ]);

  return toNumber(longQty) > 0 || toNumber(shortQty) > 0;
};

const loadRunnableGridItems = async (mode) => {
  const tableName = getTableName(mode);
  if (!tableName) {
    return [];
  }

  const [rows] = await db.query(
    `SELECT *
       FROM ${tableName}
      WHERE enabled = 'Y'
        AND regimeStatus <> 'WAITING_WEBHOOK'
      ORDER BY id ASC`
  );
  return rows;
};

const appendGridRuntimeLog = async (row, fun, code, message, leg = null) => {
  if (!row?.uid || !row?.id) {
    return;
  }

  try {
    await dbcon.DBCall(`CALL SP_MSG_ADD(?,?,?,?,?,?,?,?)`, [
      String(fun || "grid").slice(0, 20),
      String(code || "GRID").slice(0, 20),
      String(message || "").slice(0, 500),
      row.uid,
      row.id,
      null,
      row.symbol,
      leg ? getLegMeta(leg)?.signalSide || null : null,
    ]);
  } catch (error) {}
};

const getGridCancelTargetType = (options = {}) => {
  if (options.targetType) {
    return String(options.targetType).trim().toUpperCase();
  }
  if (options.includeEntries === false && options.includeExits !== false) {
    return "PROTECTION";
  }
  if (options.includeEntries !== false && options.includeExits === false) {
    return "ENTRY";
  }
  return "ALL_FOR_REGIME";
};

const enqueueLiveGridCancelIntent = async (row, options = {}) => {
  if (!row?.uid || !row?.id || !row?.symbol) {
    return { pending: false, reason: "GRID_CANCEL_INTENT_INVALID_ROW" };
  }
  const targetType = getGridCancelTargetType(options);
  const intentType = targetType === "REGIME_CLEANUP"
    ? orderIntentQueue.INTENT_TYPE.GRID_REGIME_CLEANUP_CANCEL
    : targetType === "ORDER"
      ? orderIntentQueue.INTENT_TYPE.GRID_CANCEL_ORDER
      : orderIntentQueue.INTENT_TYPE.GRID_CANCEL_ALL_FOR_REGIME;
  const summary = await orderIntentQueue.enqueueGridCancelIntent({
    intentType,
    routePath: options.routePath || "grid-runtime-cancel",
    sourceEventId: options.sourceEventId || null,
    payload: {
      uid: row.uid,
      pid: row.id,
      gridRowId: row.id,
      regimeId: row.id,
      symbol: row.symbol,
      positionSide: options.leg || options.positionSide || null,
      targetType,
      targetOrderId: options.targetOrderId || null,
      targetClientOrderId: options.targetClientOrderId || options.clientOrderId || null,
      protectionOrderRefs: Array.isArray(options.protectionOrderRefs) ? options.protectionOrderRefs : [],
      includeEntries: options.includeEntries !== false,
      includeExits: options.includeExits !== false,
      reason: options.reason || "GRID_CANCEL",
      sourceReason: options.sourceReason || options.reason || "GRID_CANCEL",
    },
  });
  await applyGridPatch("live_grid_strategy_list", row.id, {
    regimeStatus: GRID_CANCEL_CLOSE_STATE.CANCEL_INTENT_PENDING,
    regimeEndReason: options.reason || "CANCEL_INTENT_PENDING",
  }).catch(() => {});
  await appendGridRuntimeLog(
    row,
    "gridCancelQueue",
    "CANCEL_INTENT_PENDING",
    `targetType:${targetType}, leg:${options.leg || "ALL"}, intent:${summary.intent?.intentKey || "NONE"}, duplicate:${summary.duplicate || 0}`,
    options.leg || null
  );
  return {
    pending: true,
    reason: "CANCEL_INTENT_PENDING",
    targetType,
    intentSummary: summary,
  };
};

const enqueueLiveGridCloseIntent = async (row, leg, qty, reason = "CONTROLLED_CLOSE", options = {}) => {
  const closeQty = toNumber(qty);
  if (!row?.uid || !row?.id || !row?.symbol || !leg || !(closeQty > 0)) {
    return { pending: false, reason: "GRID_CLOSE_INTENT_INVALID_ROW_OR_QTY" };
  }
  const normalizedReason = String(reason || "CONTROLLED_CLOSE").trim().toUpperCase();
  const intentType = normalizedReason.includes("GMANUAL") || normalizedReason.includes("MANUAL")
    ? orderIntentQueue.INTENT_TYPE.GRID_GMANUAL_CLOSE
    : orderIntentQueue.INTENT_TYPE.GRID_CONTROLLED_CLOSE;
  const closeClientOrderId = options.closeClientOrderId
    || orderIntentQueue.buildGridCloseClientOrderId({
      uid: row.uid,
      pid: row.id,
      symbol: row.symbol,
      positionSide: leg,
      qty: closeQty,
      reason: normalizedReason,
      sourceEventId: options.sourceEventId || null,
      sourceOrderId: options.sourceOrderId || null,
      sourceTradeId: options.sourceTradeId || null,
      sourceClientOrderId: options.sourceClientOrderId || null,
    });
  const summary = await orderIntentQueue.enqueueGridCloseIntent({
    intentType,
    routePath: options.routePath || "grid-runtime-close",
    sourceEventId: options.sourceEventId || null,
    payload: {
      uid: row.uid,
      pid: row.id,
      gridRowId: row.id,
      regimeId: row.id,
      symbol: row.symbol,
      positionSide: leg,
      qty: closeQty,
      ownedQtyBasis: options.ownedQtyBasis || closeQty,
      reservedCloseQtyBasis: options.reservedCloseQtyBasis || 0,
      reason: normalizedReason,
      sourceEventId: options.sourceEventId || null,
      sourceOrderId: options.sourceOrderId || null,
      sourceTradeId: options.sourceTradeId || null,
      sourceClientOrderId: options.sourceClientOrderId || null,
      gridRegimeKey: row.gridRegimeKey || options.gridRegimeKey || extractGridRegimeKeyFromLastPayload(row.lastWebhookPayloadJson) || null,
      closeClientOrderId,
    },
  });
  const state = intentType === orderIntentQueue.INTENT_TYPE.GRID_GMANUAL_CLOSE
    ? GRID_CANCEL_CLOSE_STATE.GMANUAL_QUEUED
    : GRID_CANCEL_CLOSE_STATE.CONTROLLED_CLOSE_QUEUED;
  await applyGridPatch("live_grid_strategy_list", row.id, {
    regimeStatus: state,
    regimeEndReason: normalizedReason,
  }).catch(() => {});
  await appendGridRuntimeLog(
    row,
    "gridCloseQueue",
    state,
    `leg:${leg}, qty:${closeQty}, closeClientOrderId:${closeClientOrderId}, intent:${summary.intent?.intentKey || "NONE"}, duplicate:${summary.duplicate || 0}`,
    leg
  );
  return {
    pending: true,
    reason: state,
    closeClientOrderId,
    intentSummary: summary,
  };
};

const cancelAllGridOrders = async (mode, row, options = {}) => {
  if (mode !== "LIVE") {
    return 0;
  }

  await enqueueLiveGridCancelIntent(row, options);
  return 0;
};

const loadLiveGridLegProtectionState = async (row, leg) => {
  if (!row?.uid || !row?.id || !leg) {
    return {
      activeReservations: [],
      activeReservationCount: 0,
    };
  }

  const activeReservations = await pidPositionLedger.loadActiveReservations({
    uid: row.uid,
    pid: row.id,
    strategyCategory: "grid",
    positionSide: leg,
  });

  return {
    activeReservations,
    activeReservationCount: activeReservations.length,
  };
};

const cleanupLiveGridProtectionAfterFlatClose = async (
  row,
  leg,
  reason = "GRID_CLOSE_CONVERGED_PROTECTION_CLEANUP",
  filledClientOrderId = null
) => {
  const protectionBeforeCleanup = await loadLiveGridLegProtectionState(row, leg);
  if (protectionBeforeCleanup.activeReservationCount <= 0) {
    await appendGridRuntimeLog(
      row,
      "gridProtection",
      `${reason}_NOOP`,
      `leg:${leg}, activeProtectionBefore:0, flatClose:Y`,
      leg
    );
    return {
      pending: false,
      reason: "NO_ACTIVE_PROTECTION",
      activeProtectionBefore: 0,
    };
  }

  await cancelAllGridOrders("LIVE", row, buildSiblingProtectionCancelOptions({
    leg,
    filledClientOrderId,
    activeReservations: protectionBeforeCleanup.activeReservations,
    reason,
  }));
  await appendGridRuntimeLog(
    row,
    "gridProtection",
    `${reason}_QUEUED`,
    `leg:${leg}, activeProtectionBefore:${protectionBeforeCleanup.activeReservationCount}, flatClose:Y`,
    leg
  );
  return {
    pending: true,
    reason,
    activeProtectionBefore: protectionBeforeCleanup.activeReservationCount,
  };
};

const getGridProtectionReservationRole = (reservation = {}) => {
  const kind = String(reservation.reservationKind || "").trim().toUpperCase();
  const clientOrderId = String(reservation.clientOrderId || "").trim().toUpperCase();
  if (kind === "GRID_TP" || clientOrderId.startsWith("GTP_")) {
    return "TP";
  }
  if (kind === "GRID_STOP" || clientOrderId.startsWith("GSTOP_")) {
    return "STOP";
  }
  return null;
};

const getFilledProtectionRole = (clientOrderId = "") => {
  const normalized = String(clientOrderId || "").trim().toUpperCase();
  if (normalized.startsWith("GTP_")) {
    return "TP";
  }
  if (normalized.startsWith("GSTOP_")) {
    return "STOP";
  }
  return null;
};

const buildSiblingProtectionCancelOptions = ({
  leg,
  filledClientOrderId = null,
  activeReservations = [],
  reason = "GRID_PROTECTION_SIBLING_CLEANUP",
} = {}) => {
  const filledRole = getFilledProtectionRole(filledClientOrderId);
  const siblingRole = filledRole === "TP" ? "STOP" : filledRole === "STOP" ? "TP" : null;
  const protectionOrderRefs = []
    .concat(activeReservations || [])
    .filter((reservation) => {
      const clientOrderId = String(reservation.clientOrderId || "").trim();
      if (!clientOrderId || clientOrderId === filledClientOrderId) {
        return false;
      }
      const role = getGridProtectionReservationRole(reservation);
      if (!role) {
        return false;
      }
      return siblingRole ? role === siblingRole : true;
    })
    .map((reservation) => ({
      kind: getGridProtectionReservationRole(reservation) || "PROTECTION",
      clientOrderId: String(reservation.clientOrderId || "").trim(),
      orderId: pickGridPayloadValue(
        reservation.actualOrderId,
        reservation.sourceOrderId,
        reservation.orderId
      ),
      reservationId: reservation.id || null,
    }));

  const firstRef = protectionOrderRefs[0] || {};
  return {
    leg,
    includeEntries: false,
    includeExits: true,
    targetType: "PROTECTION",
    reason,
    sourceReason: reason,
    targetClientOrderId: firstRef.clientOrderId || null,
    targetOrderId: firstRef.orderId || null,
    protectionOrderRefs,
  };
};

const buildRecoveredTakeProfitReentryData = (recoveredExecution = {}) => {
  const fills = Array.isArray(recoveredExecution?.fills) ? recoveredExecution.fills : [];
  const firstFill = fills[0] || {};
  return {
    c: recoveredExecution.clientOrderId || firstFill.clientOrderId || null,
    i: recoveredExecution.orderId || firstFill.orderId || null,
    t: recoveredExecution.tradeId || firstFill.tradeId || null,
    T: recoveredExecution.tradeTime || firstFill.tradeTime || null,
    l: recoveredExecution.qty || firstFill.qty || null,
    z: recoveredExecution.qty || firstFill.qty || null,
    L: recoveredExecution.price || firstFill.price || null,
    ap: recoveredExecution.price || firstFill.price || null,
    p: recoveredExecution.price || firstFill.price || null,
    n: recoveredExecution.fee || firstFill.fee || null,
    rp: recoveredExecution.realizedPnl || firstFill.realizedPnl || null,
    X: "FILLED",
  };
};

const enqueueRecoveredTakeProfitReentryIfAllowed = async ({
  row,
  leg,
  recoveredExecution,
  logScope,
} = {}) => {
  if (!row?.id || !leg || !recoveredExecution) {
    return { handled: false, reason: "RECOVERED_TP_REENTRY_INVALID_INPUT" };
  }

  const recoveryKind = gridReentrySlPolicy.classifyGridExitRecoveryKind(recoveredExecution);
  const triggerPrice = getGridLegTriggerPrice(row, leg);
  await appendGridRuntimeLog(
    row,
    logScope || "gridRecoveredTpReentry",
    "RECOVERED_EXIT_REENTRY_DECISION",
    `leg:${leg}, recoveryKind:${recoveryKind}, clientOrderId:${recoveredExecution.clientOrderId || "NONE"}, trigger:${triggerPrice}`,
    leg
  );

  if (recoveryKind !== gridReentrySlPolicy.GRID_EXIT_RECOVERY_KIND.TAKE_PROFIT) {
    return { handled: false, reason: `RECOVERED_EXIT_REENTRY_SKIPPED_${recoveryKind}` };
  }

  const refreshed = (await loadGridItem("LIVE", row.id)) || row;
  if (!canArmEntriesForRow(refreshed)) {
    await appendGridRuntimeLog(
      refreshed,
      logScope || "gridRecoveredTpReentry",
      "RECOVERED_TP_REENTRY_SKIPPED",
      `leg:${leg}, reason:REGIME_NOT_ARMABLE, regimeStatus:${refreshed.regimeStatus || "NONE"}, regimeEndReason:${refreshed.regimeEndReason || "NONE"}`,
      leg
    );
    return { handled: false, reason: "RECOVERED_TP_REENTRY_SKIPPED_REGIME_NOT_ARMABLE" };
  }

  const reentry = await enqueueLiveReentryIntentAfterTakeProfit(
    refreshed,
    {
      uid: refreshed.uid,
      pid: refreshed.id,
      leg,
      type: "GTP",
      clientOrderId: recoveredExecution.clientOrderId,
    },
    buildRecoveredTakeProfitReentryData(recoveredExecution)
  );
  await appendGridRuntimeLog(
    refreshed,
    logScope || "gridRecoveredTpReentry",
    reentry.pending ? "RECOVERED_TP_REENTRY_INTENT_PENDING" : reentry.reason,
    `leg:${leg}, recoveredTp:${recoveredExecution.clientOrderId || "NONE"}, reentry:${reentry.clientOrderId || "NONE"}, trigger:${triggerPrice}, intent:${reentry.intentSummary?.intent?.intentKey || "NONE"}`,
    leg
  );
  return { handled: Boolean(reentry.pending), reason: reentry.reason, reentry };
};

const convergeLiveGridLegToExchangeFlat = async (
  row,
  leg,
  {
    logScope,
    logCode,
    message,
    fallbackReason = "MANUAL_OFF",
    recoveredExecution = null,
    allowLocalFlatten = false,
    exchangeSnapshotCache = null,
  } = {}
) => {
  if (!row?.uid || !row?.id || !row?.symbol || !leg) {
    return false;
  }

  const coin = getCoin();
  const current = (await loadGridItem("LIVE", row.id)) || row;
  const prefix = getLegFieldPrefix(leg);
  const cacheKey = `${current.uid}:${current.symbol}`;
  let exchangeSnapshot = null;
  if (exchangeSnapshotCache?.has(cacheKey)) {
    exchangeSnapshot = exchangeSnapshotCache.get(cacheKey);
  } else if (exchangeSnapshotCache) {
    exchangeSnapshot = await coin.getExchangePositionSnapshot(current.uid, current.symbol);
    exchangeSnapshotCache.set(cacheKey, exchangeSnapshot);
  }
  const exchangePosition = await coin.getGridLegExchangePosition({
    uid: current.uid,
    symbol: current.symbol,
    leg,
    exchangeSnapshot,
  });
  if (exchangePosition?.readOk === false) {
    logGridRuntimeTrace("GRID_EXCHANGE_FLAT_CONVERGENCE_BLOCKED_READ_FAILED", {
      uid: current.uid,
      pid: current.id,
      symbol: current.symbol,
      positionSide: leg,
      readError: exchangePosition.readError || null,
    });
    return false;
  }
  const exchangeQty = toNumber(exchangePosition?.qty);
  if (exchangeQty > 0) {
    return false;
  }

  const snapshotBeforeState = await loadLiveGridLegSnapshotState(current, leg);
  if (allowLocalFlatten && !recoveredExecution && snapshotBeforeState.qty > 0) {
    const [ownerRows] = await db.query(
      `SELECT pid, strategyCategory, openQty
         FROM live_pid_position_snapshot
        WHERE uid = ?
          AND symbol = ?
          AND positionSide = ?
          AND status = 'OPEN'
          AND openQty > 0`,
      [current.uid, current.symbol, leg]
    );
    const owners = (ownerRows || []).filter((owner) => toNumber(owner?.openQty) > 0);
    if (owners.length !== 1 || Number(owners[0]?.pid || 0) !== Number(current.id)) {
      await appendGridRuntimeLog(
        current,
        logScope,
        "GRID_EXTERNAL_CLOSE_CORRECTION_FLATTEN_BLOCKED",
        `${message}, leg:${leg}, reason:OWNER_AMBIGUOUS, ownerCount:${owners.length}`,
        leg
      );
      logGridRuntimeTrace("GRID_EXTERNAL_CLOSE_CORRECTION_FLATTEN_BLOCKED", {
        uid: current.uid,
        pid: current.id,
        symbol: current.symbol,
        positionSide: leg,
        reason: "OWNER_AMBIGUOUS",
        owners: owners.map((owner) => ({
          pid: Number(owner?.pid || 0),
          strategyCategory: owner?.strategyCategory || null,
          openQty: toNumber(owner?.openQty),
        })),
      });
      return false;
    }
  }

  const protectionBefore = await loadLiveGridLegProtectionState(current, leg);
  const localProtectionClientIds = protectionBefore.activeReservations
    .map((item) => String(item.clientOrderId || "").trim())
    .filter(Boolean);
  const localRowProjectionOpen =
    toNumber(current?.[`${prefix}Qty`]) > 0 ||
    current?.[`${prefix}LegStatus`] === "OPEN" ||
    Boolean(current?.[`${prefix}EntryOrderId`]);

  if (!recoveredExecution && snapshotBeforeState.qty <= 0 && localProtectionClientIds.length === 0) {
    if (allowLocalFlatten && localRowProjectionOpen) {
      const synced = await syncLiveGridRowFromPidState(current, {
        regimeStatus: "ENDED",
        regimeEndReason: current.regimeEndReason || fallbackReason,
        clearOpenLegOrderRefs: true,
      });
      const finalized = await finalizeEndedGridRegimeIfIdle(
        "LIVE",
        synced || current,
        (synced || current)?.regimeEndReason || fallbackReason
      );
      await appendGridRuntimeLog(
        synced || current,
        logScope,
        "GRID_ROW_PROJECTION_STALE_FLATTENED",
        `${message}, leg:${leg}, exchangeQty:${exchangeQty}, snapshotOpenQty:${snapshotBeforeState.qty}, activeProtectionBefore:${protectionBefore.activeReservationCount}, reason:ROW_PROJECTION_ONLY_STALE, finalized:${finalized}`,
        leg
      );
      logGridRuntimeTrace("GRID_ROW_PROJECTION_STALE_FLATTENED", {
        uid: current.uid,
        pid: current.id,
        symbol: current.symbol,
        positionSide: leg,
        regimeStatusBefore: current.regimeStatus || null,
        legStatusBefore: current?.[`${prefix}LegStatus`] || null,
        rowQtyBefore: toNumber(current?.[`${prefix}Qty`]),
        snapshotOpenQtyBefore: snapshotBeforeState.qty,
        exchangePositionQty: exchangeQty,
        activeProtectionCountBefore: protectionBefore.activeReservationCount,
        finalized,
      });
      return true;
    }
    return false;
  }

  if (!recoveredExecution && localProtectionClientIds.length > 0) {
    await appendGridRuntimeLog(
      current,
      logScope,
      "GRID_EXTERNAL_CLOSE_CORRECTION_FLATTEN_BLOCKED",
      `${message}, leg:${leg}, activeProtectionBefore:${protectionBefore.activeReservationCount}, reason:ACTIVE_LOCAL_RESERVATION`,
      leg
    );
    logGridRuntimeTrace("GRID_EXTERNAL_CLOSE_CORRECTION_FLATTEN_BLOCKED", {
      uid: current.uid,
      pid: current.id,
      symbol: current.symbol,
      positionSide: leg,
      activeProtectionCountBefore: protectionBefore.activeReservationCount,
      localProtectionClientIds,
      reason: "ACTIVE_LOCAL_RESERVATION",
    });
    return false;
  }

  const canceledProtectionCount = await cancelAllGridOrders("LIVE", current, buildSiblingProtectionCancelOptions({
    leg,
    filledClientOrderId: recoveredExecution?.clientOrderId || null,
    activeReservations: protectionBefore.activeReservations,
    reason: recoveredExecution
      ? "GRID_TP_SIBLING_PROTECTION_CLEANUP"
      : "GRID_PROTECTION_SIBLING_CLEANUP",
  }));
  const protectionAfter = await loadLiveGridLegProtectionState(current, leg);
  const shouldFlatten =
    Boolean(recoveredExecution) ||
    (allowLocalFlatten && protectionAfter.activeReservationCount === 0);

  if (!shouldFlatten) {
    return false;
  }

  if (recoveredExecution) {
    const reentryResult = await enqueueRecoveredTakeProfitReentryIfAllowed({
      row: current,
      leg,
      recoveredExecution,
      logScope,
    });
    if (reentryResult.handled) {
      logGridRuntimeTrace("GRID_RECOVERED_TP_REENTRY_INTENT_PENDING", {
        uid: current.uid,
        pid: current.id,
        symbol: current.symbol,
        positionSide: leg,
        recoveredClientOrderId: recoveredExecution.clientOrderId || null,
        recoveredOrderId: recoveredExecution.orderId || null,
        reentryClientOrderId: reentryResult.reentry?.clientOrderId || null,
        intentKey: reentryResult.reentry?.intentSummary?.intent?.intentKey || null,
      });
      return true;
    }
  }

  let correctionResult = null;
  const correctionEventType = recoveredExecution
    ? "GRID_EXCHANGE_FLAT_RECONCILE_CLOSE"
    : "GRID_EXCHANGE_FLAT_LOCAL_STALE_FLATTEN";
  if (snapshotBeforeState.qty > 0) {
    const recoveredDescriptor = recoveredExecution
      ? `recoveredClientOrderId:${recoveredExecution.clientOrderId || "NONE"}, recoveredOrderId:${recoveredExecution.orderId || "NONE"}`
      : "recoveredClientOrderId:NONE, recoveredOrderId:NONE";
    correctionResult = await pidPositionLedger.closeSnapshotAsOrphan({
      uid: current.uid,
      pid: current.id,
      strategyCategory: "grid",
      symbol: current.symbol,
      positionSide: leg,
      eventType: correctionEventType,
      note: `${logCode}: ${message}, ${recoveredDescriptor}`,
      tradeTime: recoveredExecution?.tradeTime || new Date(),
    });
  }

  await pidPositionLedger.syncGridLegSnapshot(current.id, leg);
  await releaseGridLegPositionOwnership(current, leg);
  const refreshed = (await loadGridItem("LIVE", current.id)) || current;
  const synced = await syncLiveGridRowFromPidState(refreshed, {
    regimeStatus: "ENDED",
    regimeEndReason: refreshed.regimeEndReason || fallbackReason,
    clearOpenLegOrderRefs: true,
  });
  const snapshotAfterState = await loadLiveGridLegSnapshotState(synced || refreshed, leg);
  const finalized = await finalizeEndedGridRegimeIfIdle(
    "LIVE",
    synced || refreshed,
    (synced || refreshed)?.regimeEndReason || fallbackReason
  );

  await appendGridRuntimeLog(
    synced || refreshed,
    logScope,
    correctionEventType,
    `${message}, leg:${leg}, exchangeQty:${exchangeQty}, activeProtectionBefore:${protectionBefore.activeReservationCount}, canceledProtection:${canceledProtectionCount}, openQtyBefore:${snapshotBeforeState.qty}, openQtyAfter:${snapshotAfterState.qty}, recoveredCloseClientOrderId:${recoveredExecution?.clientOrderId || "NONE"}, recoveredOrderId:${recoveredExecution?.orderId || "NONE"}, correctionLedgerId:${correctionResult?.ledgerId || "NONE"}`,
    leg
  );
  logGridRuntimeTrace("GRID_EXCHANGE_FLAT_RECONCILE", {
    uid: current.uid,
    pid: current.id,
    symbol: current.symbol,
    positionSide: leg,
    regimeStatusBefore: current.regimeStatus || null,
    legStatusBefore: current?.[`${prefix}LegStatus`] || null,
    legStatusAfter: (synced || refreshed)?.[`${prefix}LegStatus`] || null,
    snapshotOpenQtyBefore: snapshotBeforeState.qty,
    snapshotOpenQtyAfter: snapshotAfterState.qty,
    exchangePositionQty: exchangeQty,
    activeProtectionCountBefore: protectionBefore.activeReservationCount,
    activeProtectionCountAfter: protectionAfter.activeReservationCount,
    canceledProtectionCount,
    recoveredCloseClientOrderId: recoveredExecution?.clientOrderId || null,
    recoveredOrderId: recoveredExecution?.orderId || null,
    correctionLedgerId: correctionResult?.ledgerId || null,
    reason: correctionEventType,
    finalized,
  });

  return true;
};

const reconcileEndedGridLegIfExchangeFlat = async (
  row,
  leg,
  logScope,
  logCode,
  message,
  fallbackReason = "MANUAL_OFF",
  exchangeSnapshotCache = null
) => {
  const coin = getCoin();
  const cacheKey = `${row.uid}:${row.symbol}`;
  let exchangeSnapshot = null;
  if (exchangeSnapshotCache?.has(cacheKey)) {
    exchangeSnapshot = exchangeSnapshotCache.get(cacheKey);
  } else if (exchangeSnapshotCache) {
    exchangeSnapshot = await coin.getExchangePositionSnapshot(row.uid, row.symbol);
    exchangeSnapshotCache.set(cacheKey, exchangeSnapshot);
  }
  const exchangePosition = await coin.getGridLegExchangePosition({
    uid: row.uid,
    symbol: row.symbol,
    leg,
    exchangeSnapshot,
  });
  if (exchangePosition?.readOk === false) {
    logGridRuntimeTrace("GRID_RECONCILE_ENDED_LEG_SKIPPED_READ_FAILED", {
      uid: row.uid,
      pid: row.id,
      symbol: row.symbol,
      positionSide: leg,
      readError: exchangePosition.readError || null,
    });
    return false;
  }
  const exchangeQty = toNumber(exchangePosition?.qty);
  if (exchangeQty > 0) {
    return false;
  }

  const recoveredExecution = await coin.recoverGridExitFillFromExchange({
    uid: row.uid,
    row,
    leg,
    issue: {
      issues: [logCode],
    },
  });
  return await convergeLiveGridLegToExchangeFlat(row, leg, {
    logScope,
    logCode,
    message,
    fallbackReason,
    recoveredExecution,
    allowLocalFlatten: true,
    exchangeSnapshotCache,
  });
};

const handleEndedLiveGridLegExchangeFlatBeforeClose = async (
  row,
  leg,
  logScope,
  logCode,
  message,
  fallbackReason = "BOX_BREAK",
  exchangeSnapshotCache = null
) => {
  const coin = getCoin();
  const cacheKey = `${row.uid}:${row.symbol}`;
  let exchangeSnapshot = null;
  if (exchangeSnapshotCache?.has(cacheKey)) {
    exchangeSnapshot = exchangeSnapshotCache.get(cacheKey);
  } else if (exchangeSnapshotCache) {
    exchangeSnapshot = await coin.getExchangePositionSnapshot(row.uid, row.symbol);
    exchangeSnapshotCache.set(cacheKey, exchangeSnapshot);
  }
  const exchangePosition = await coin.getGridLegExchangePosition({
    uid: row.uid,
    symbol: row.symbol,
    leg,
    exchangeSnapshot,
  });
  if (exchangePosition?.readOk === false) {
    return false;
  }
  if (toNumber(exchangePosition?.qty) > 0) {
    return false;
  }

  const protectionState = await loadLiveGridLegProtectionState(row, leg);
  if (protectionState.activeReservationCount > 0) {
    await cleanupLiveGridProtectionAfterFlatClose(
      row,
      leg,
      "ENDED_EXCHANGE_FLAT_PROTECTION_CLEANUP"
    );
    await appendGridRuntimeLog(
      row,
      logScope,
      `${logCode}_PROTECTION_CLEANUP_QUEUED`,
      `${message}, leg:${leg}, exchangeQty:0, activeProtection:${protectionState.activeReservationCount}, closeIntent:N`,
      leg
    );
    return true;
  }

  return await convergeLiveGridLegToExchangeFlat(row, leg, {
    logScope,
    logCode,
    message,
    fallbackReason,
    recoveredExecution: null,
    allowLocalFlatten: true,
    exchangeSnapshotCache,
  });
};

const reconcileLiveGridRuntimeIssue = async ({ row, issue } = {}) => {
  if (!row?.id || !row?.uid || !issue) {
    return null;
  }

  const issueSet = new Set([].concat(issue.issues || []));
  const coin = getCoin();
  const repaired = [];

  for (const leg of ["LONG", "SHORT"]) {
    const exchangeQty = leg === "LONG"
      ? toNumber(issue?.exchangeLongQty)
      : toNumber(issue?.exchangeShortQty);
    const openNoPositionCode = `${leg}_OPEN_NO_POSITION`;
    const incompleteExitCode = `${leg}_OPEN_INCOMPLETE_EXIT_ORDERS`;
    const entryPendingWithPositionCode = `${leg}_ENTRY_PENDING_WITH_OPEN_POSITION`;

    if (
      exchangeQty > 0 &&
      (
        issueSet.has(entryPendingWithPositionCode) ||
        issueSet.has("WAITING_WITH_EXCHANGE_ACTIVITY") ||
        issueSet.has("ENDED_WITH_EXCHANGE_ACTIVITY")
      )
    ) {
      const recoveredEntry = await coin.recoverGridEntryFillFromExchange({
        uid: row.uid,
        row,
        leg,
        issue,
      });
      if (recoveredEntry) {
        const refreshed = (await loadGridItem("LIVE", row.id)) || row;
        const convergence = await applyGridEntryFillConvergence(
          refreshed,
          leg,
          recoveredEntry,
          issue,
          {
            source: "RUNTIME_ISSUE_REST",
            eventType: "GRID_EXCHANGE_RECONCILED_ENTRY_FILL",
            note: "exchange-entry-reconcile",
          }
        );
        if (convergence.converged) {
          repaired.push({
            leg,
            action: "RECOVER_ENTRY_FILL",
            clientOrderId: recoveredEntry.clientOrderId,
            orderId: recoveredEntry.orderId,
          });
          continue;
        }
      }
    }

    if (issueSet.has(openNoPositionCode)) {
      const recoveredExecution = await coin.recoverGridExitFillFromExchange({
        uid: row.uid,
        row,
        leg,
        issue,
      });

      if (recoveredExecution) {
        const flattened = await convergeLiveGridLegToExchangeFlat(row, leg, {
          logScope: "gridReconcile",
          logCode: "EXIT_FILL_RECOVERED",
          message: `leg:${leg}, clientOrderId:${recoveredExecution.clientOrderId}, orderId:${recoveredExecution.orderId}, qty:${recoveredExecution.qty}, price:${recoveredExecution.price}`,
          fallbackReason: row.regimeEndReason || "MANUAL_OFF",
          recoveredExecution,
          allowLocalFlatten: false,
        });
        repaired.push({
          leg,
          action: flattened ? "RECOVER_EXIT_FILL_FLATTENED" : "RECOVER_EXIT_FILL",
          clientOrderId: recoveredExecution.clientOrderId,
          orderId: recoveredExecution.orderId,
        });
        continue;
      }

      const orphanClosed = await reconcileEndedGridLegIfExchangeFlat(
        row,
        leg,
        "gridReconcile",
        "OPEN_NO_POSITION",
        `leg:${leg}, issues:${[].concat(issue.issues || []).join(",")}`,
        row.regimeEndReason || "MANUAL_OFF"
      );
      if (orphanClosed) {
        repaired.push({
          leg,
          action: "ORPHAN_CLOSE",
        });
      }
    }

    if (issueSet.has(incompleteExitCode)) {
      const refreshed = (await loadGridItem("LIVE", row.id)) || row;
      const recoveredExecution = await coin.recoverGridExitFillFromExchange({
        uid: row.uid,
        row: refreshed,
        leg,
        issue,
      });
      if (recoveredExecution) {
        const syncedRecovery = await syncLiveGridLegAfterRecoveredExitFill(
          refreshed,
          leg,
          recoveredExecution,
          refreshed.regimeEndReason || "TRUTH_SYNC"
        );
        repaired.push({
          leg,
          action: syncedRecovery.closed
            ? "RECOVER_EXIT_FILL"
            : "RECOVER_EXIT_FILL_PARTIAL",
          clientOrderId: recoveredExecution.clientOrderId,
          orderId: recoveredExecution.orderId,
        });
        continue;
      }

      const repairedExits = await armMissingLiveExits(refreshed);
      if (repairedExits) {
        repaired.push({
          leg,
          action: "RESTORE_EXIT_ORDERS",
        });
      }
    }
  }

  if (repaired.length === 0) {
    return null;
  }

  return {
    pid: row.id,
    symbol: row.symbol || null,
    repairs: repaired,
  };
};

const truthSyncLiveGridRow = async ({ row, exchangeSnapshotCache = null } = {}) => {
  if (!row?.id || !row?.uid) {
    return null;
  }

  const rowStartedAt = Date.now();
  let refreshed = (await loadGridItem("LIVE", row.id)) || row;
  const coin = getCoin();
  const repaired = [];
  logGridRuntimeTrace("GRID_REST_TRUTH_SYNC_ROW_START", {
    uid: refreshed.uid,
    pid: refreshed.id,
    symbol: refreshed.symbol || null,
    enabled: refreshed.enabled || null,
    regimeStatus: refreshed.regimeStatus || null,
    longLegStatus: refreshed.longLegStatus || null,
    shortLegStatus: refreshed.shortLegStatus || null,
  });

  for (const leg of ["LONG", "SHORT"]) {
    const legStartedAt = Date.now();
    const prefix = getLegFieldPrefix(leg);
    const snapshotState = await loadLiveGridLegSnapshotState(refreshed, leg);
    const protectionState = await loadLiveGridLegProtectionState(refreshed, leg);
    const cacheKey = `${refreshed.uid}:${refreshed.symbol}`;
    let exchangeSnapshot = null;
    if (exchangeSnapshotCache?.has(cacheKey)) {
      exchangeSnapshot = exchangeSnapshotCache.get(cacheKey);
    } else if (exchangeSnapshotCache) {
      exchangeSnapshot = await coin.getExchangePositionSnapshot(refreshed.uid, refreshed.symbol);
      exchangeSnapshotCache.set(cacheKey, exchangeSnapshot);
    }
    const exchangePosition = await coin.getGridLegExchangePosition({
      uid: refreshed.uid,
      symbol: refreshed.symbol,
      leg,
      exchangeSnapshot,
    });
    if (exchangePosition?.readOk === false) {
      logGridRuntimeTrace("GRID_REST_TRUTH_SYNC_ROW_SKIP", {
        uid: refreshed.uid,
        pid: refreshed.id,
        symbol: refreshed.symbol,
        positionSide: leg,
        snapshotQty: snapshotState.qty,
        activeReservationCount: protectionState.activeReservationCount,
        skipReason: "EXCHANGE_READ_FAILED",
        readError: exchangePosition.readError || null,
        elapsedMs: Date.now() - legStartedAt,
      });
      logGridRuntimeTrace("GRID_TRUTH_SYNC_SKIPPED_EXCHANGE_READ_FAILED", {
        uid: refreshed.uid,
        pid: refreshed.id,
        symbol: refreshed.symbol,
        positionSide: leg,
        readError: exchangePosition.readError || null,
      });
      return null;
    }
    const exchangeQty = toNumber(exchangePosition?.qty);
    const localRowQty = toNumber(refreshed?.[`${prefix}Qty`]);
    const hasLocalOpen =
      snapshotState.qty > 0 ||
      localRowQty > 0 ||
      refreshed?.[`${prefix}LegStatus`] === "OPEN";
    logGridRuntimeTrace("GRID_REST_TRUTH_SYNC_ROW_START", {
      uid: refreshed.uid,
      pid: refreshed.id,
      symbol: refreshed.symbol || null,
      positionSide: leg,
      enabled: refreshed.enabled || null,
      regimeStatus: refreshed.regimeStatus || null,
      legStatus: refreshed?.[`${prefix}LegStatus`] || null,
      snapshotQty: snapshotState.qty,
      rowQty: localRowQty,
      exchangeQty,
      hasActiveReservation: protectionState.activeReservationCount > 0,
      activeReservationCount: protectionState.activeReservationCount,
    });

    if (exchangeQty > 0) {
      if (
        snapshotState.qty > 0 ||
        protectionState.activeReservationCount > 0 ||
        refreshed.regimeStatus === "ENDED"
      ) {
        const recoveredExecution = await coin.recoverGridExitFillFromExchange({
          uid: refreshed.uid,
          row: refreshed,
          leg,
          issue: {
            issues: ["TRUTH_SYNC_RESERVATION_OWNED_EXIT"],
          },
        });
        if (recoveredExecution) {
          const syncedRecovery = await syncLiveGridLegAfterRecoveredExitFill(
            refreshed,
            leg,
            recoveredExecution,
            refreshed.regimeEndReason || "TRUTH_SYNC"
          );
          repaired.push({
            leg,
            action: syncedRecovery.closed
              ? "RECOVER_EXIT_FILL"
              : "RECOVER_EXIT_FILL_PARTIAL",
            clientOrderId: recoveredExecution.clientOrderId,
            orderId: recoveredExecution.orderId,
          });
          refreshed = syncedRecovery.row || (await loadGridItem("LIVE", refreshed.id)) || refreshed;
          if (syncedRecovery.closed) {
            logGridRuntimeTrace("GRID_REST_TRUTH_SYNC_LATENCY", {
              uid: refreshed.uid,
              pid: refreshed.id,
              symbol: refreshed.symbol || null,
              positionSide: leg,
              action: "RECOVER_EXIT_FILL",
              elapsedMs: Date.now() - legStartedAt,
              truthSyncRecoveryLatencyMs: buildLatencyMs(recoveredExecution.tradeTime, Date.now()),
            });
            continue;
          }
        }
      }

      if (!(snapshotState.qty > 0)) {
        const recoveredEntry = await coin.recoverGridEntryFillFromExchange({
          uid: refreshed.uid,
          row: refreshed,
          leg,
          issue: {
            issues: ["TRUTH_SYNC_WITH_EXCHANGE_POSITION"],
          },
        });
        if (recoveredEntry) {
          const latest = (await loadGridItem("LIVE", refreshed.id)) || refreshed;
          const convergence = await applyGridEntryFillConvergence(
            latest,
            leg,
            recoveredEntry,
            {
              issues: ["TRUTH_SYNC_WITH_EXCHANGE_POSITION"],
            },
            {
              source: "TRUTH_SYNC",
              eventType: "GRID_EXCHANGE_RECONCILED_ENTRY_FILL",
              note: "exchange-entry-reconcile",
            }
          );
          if (convergence.converged) {
            repaired.push({
              leg,
              action: "RECOVER_ENTRY_FILL",
              clientOrderId: recoveredEntry.clientOrderId,
              orderId: recoveredEntry.orderId,
            });
            logGridRuntimeTrace("GRID_REST_TRUTH_SYNC_LATENCY", {
              uid: refreshed.uid,
              pid: refreshed.id,
              symbol: refreshed.symbol || null,
              positionSide: leg,
              action: "RECOVER_ENTRY_FILL",
              clientOrderId: recoveredEntry.clientOrderId,
              orderId: recoveredEntry.orderId,
              elapsedMs: Date.now() - legStartedAt,
              truthSyncRecoveryLatencyMs: buildLatencyMs(recoveredEntry.tradeTime, Date.now()),
            });
            refreshed = (await loadGridItem("LIVE", refreshed.id)) || latest;
            continue;
          }
          logGridRuntimeTrace("GRID_REST_TRUTH_SYNC_ROW_SKIP", {
            uid: refreshed.uid,
            pid: refreshed.id,
            symbol: refreshed.symbol || null,
            positionSide: leg,
            skipReason: "ENTRY_RECOVERY_CONVERGENCE_FAILED",
            clientOrderId: recoveredEntry.clientOrderId || null,
            orderId: recoveredEntry.orderId || null,
            elapsedMs: Date.now() - legStartedAt,
          });
        }
      }

      if (snapshotState.qty > 0 && protectionState.activeReservationCount === 0) {
        const latest = (await loadGridItem("LIVE", refreshed.id)) || refreshed;
        const repairedExits = await armMissingLiveExits(latest);
        if (repairedExits) {
          repaired.push({
            leg,
            action: "RESTORE_EXIT_ORDERS",
          });
          logGridRuntimeTrace("GRID_REST_TRUTH_SYNC_LATENCY", {
            uid: refreshed.uid,
            pid: refreshed.id,
            symbol: refreshed.symbol || null,
            positionSide: leg,
            action: "RESTORE_EXIT_ORDERS",
            elapsedMs: Date.now() - legStartedAt,
          });
          refreshed = (await loadGridItem("LIVE", refreshed.id)) || latest;
        }
      }
      continue;
    }

    if (!(hasLocalOpen || protectionState.activeReservationCount > 0 || refreshed.regimeStatus === "ENDED")) {
      logGridRuntimeTrace("GRID_REST_TRUTH_SYNC_ROW_SKIP", {
        uid: refreshed.uid,
        pid: refreshed.id,
        symbol: refreshed.symbol || null,
        positionSide: leg,
        snapshotQty: snapshotState.qty,
        rowQty: localRowQty,
        exchangeQty,
        activeReservationCount: protectionState.activeReservationCount,
        skipReason: "NO_LOCAL_OR_PROTECTION_STATE",
        elapsedMs: Date.now() - legStartedAt,
      });
      continue;
    }

    const recoveredExecution = await coin.recoverGridExitFillFromExchange({
      uid: refreshed.uid,
      row: refreshed,
      leg,
      issue: {
        issues: ["TRUTH_SYNC_EXCHANGE_FLAT"],
      },
    });
    const flattened = await convergeLiveGridLegToExchangeFlat(refreshed, leg, {
      logScope: "gridTruthSync",
      logCode: recoveredExecution ? "TRUTH_SYNC_EXIT_RECOVERED" : "TRUTH_SYNC_EXCHANGE_FLAT",
      message: recoveredExecution
        ? `leg:${leg}, clientOrderId:${recoveredExecution.clientOrderId}, orderId:${recoveredExecution.orderId}, qty:${recoveredExecution.qty}, price:${recoveredExecution.price}`
        : `leg:${leg}, exchange flat while local state remained open`,
      fallbackReason: refreshed.regimeEndReason || "TRUTH_SYNC",
      recoveredExecution,
      allowLocalFlatten: true,
      exchangeSnapshotCache,
    });
      if (flattened) {
      repaired.push({
        leg,
        action: recoveredExecution
          ? "RECOVER_EXIT_FILL_FLATTENED"
          : "LOCAL_STALE_FLATTENED",
        clientOrderId: recoveredExecution?.clientOrderId || null,
        orderId: recoveredExecution?.orderId || null,
        });
      logGridRuntimeTrace("GRID_REST_TRUTH_SYNC_LATENCY", {
        uid: refreshed.uid,
        pid: refreshed.id,
        symbol: refreshed.symbol || null,
        positionSide: leg,
        action: recoveredExecution ? "RECOVER_EXIT_FILL_FLATTENED" : "LOCAL_STALE_FLATTENED",
        clientOrderId: recoveredExecution?.clientOrderId || null,
        orderId: recoveredExecution?.orderId || null,
        elapsedMs: Date.now() - legStartedAt,
        truthSyncRecoveryLatencyMs: recoveredExecution
          ? buildLatencyMs(recoveredExecution.tradeTime, Date.now())
          : null,
      });
      refreshed = (await loadGridItem("LIVE", refreshed.id)) || refreshed;
    }
  }

  if (repaired.length === 0) {
    logGridRuntimeTrace("GRID_REST_TRUTH_SYNC_LATENCY", {
      uid: refreshed.uid,
      pid: refreshed.id,
      symbol: refreshed.symbol || null,
      repairedCount: 0,
      elapsedMs: Date.now() - rowStartedAt,
    });
    return null;
  }

  logGridRuntimeTrace("GRID_REST_TRUTH_SYNC_LATENCY", {
    uid: refreshed.uid,
    pid: refreshed.id,
    symbol: refreshed.symbol || null,
    repairedCount: repaired.length,
    elapsedMs: Date.now() - rowStartedAt,
  });

  return {
    pid: refreshed.id,
    symbol: refreshed.symbol || null,
    repairs: repaired,
  };
};

const emergencyCloseLiveGridLeg = async (row, leg, qty, logCode, message) => {
  const snapshotState = await loadLiveGridLegSnapshotState(row, leg).catch(() => null);
  const closeQty = Math.max(toNumber(qty), toNumber(snapshotState?.qty));
  if (!(closeQty > 0)) {
    const refreshed = (await loadGridItem("LIVE", row.id)) || row;
    const synced = await syncLiveGridRowFromPidState(refreshed, {
      regimeStatus: "ENDED",
      regimeEndReason: refreshed.regimeEndReason || logCode,
      clearOpenLegOrderRefs: false,
    });
    await appendGridRuntimeLog(
      synced || refreshed,
      "gridLiveSafety",
      `${logCode}_NOOP_FLAT`,
      `${message}, leg:${leg}, closeQty:0, snapshotQty:${toNumber(snapshotState?.qty)}, protectionCancel:N`,
      leg
    );
    await finalizeEndedGridRegimeIfIdle(
      "LIVE",
      synced || refreshed,
      (synced || refreshed)?.regimeEndReason || logCode
    );
    return true;
  }

  const protectionState = await loadLiveGridLegProtectionState(row, leg);
  const closeIntent = await enqueueLiveGridCloseIntent(row, leg, closeQty, logCode, {
    routePath: "grid-emergency-close",
  });
  const refreshed = (await loadGridItem("LIVE", row.id)) || row;
  const synced = await syncLiveGridRowFromPidState(refreshed, {
    regimeStatus: closeIntent.pending
      ? GRID_CANCEL_CLOSE_STATE.CONTROLLED_CLOSE_QUEUED
      : "CLOSE_FAILED",
    regimeEndReason: logCode,
    clearOpenLegOrderRefs: false,
  });
  await appendGridRuntimeLog(
    synced || refreshed,
    "gridLiveSafety",
    closeIntent.pending ? `${logCode}_QUEUED` : `${logCode}_QUEUE_FAILED`,
    `${message}, closeQty:${closeQty}, closeIntent:${closeIntent.intentSummary?.intent?.intentKey || "NONE"}, closeClientOrderId:${closeIntent.closeClientOrderId || "NONE"}, activeProtectionRetained:${protectionState.activeReservationCount}`,
    leg
  );
  return closeIntent.pending;
};

const collectMissingGridProtection = (exits = {}) => {
  if (Array.isArray(exits.missingProtection)) {
    return exits.missingProtection;
  }
  return gridProtectionGuarantee.classifyProtectionOutcome({
    takeProfit: {
      clientOrderId: exits.takeProfitOrderId || null,
      errorCode: exits.takeProfitErrorCode || null,
      errorMessage: exits.takeProfitErrorMessage || null,
      immediateTrigger: exits.takeProfitImmediateTrigger || false,
    },
    stop: {
      clientOrderId: exits.stopOrderId || null,
      errorCode: exits.stopErrorCode || null,
      errorMessage: exits.stopErrorMessage || null,
      immediateTrigger: exits.stopImmediateTrigger || false,
    },
  }).missing;
};

const placeLiveEntryOrderForLeg = async (row, leg, options = {}) => {
  const coin = getCoin();
  const triggerPrice = getGridLegTriggerPrice(row, leg);
  const qty = computeGridEntryQty(row, triggerPrice);
  if (!(qty > 0)) {
    return null;
  }

  return await coin.placeGridEntryOrder({
    uid: row.uid,
    pid: row.id,
    symbol: row.symbol,
    leg,
    triggerPrice,
    qty,
    marginType: row.marginType,
    leverage: row.leverage,
    clientOrderId: options.clientOrderId || null,
  });
};

const buildProtectionFailureOrder = ({ kind, clientOrderId, price, risk }) => ({
  ok: false,
  requestedClientOrderId: clientOrderId,
  errorCode: risk?.code || "PROTECTION_BLOCKED",
  errorMessage: risk?.reason || `${kind} protection blocked`,
  immediateTrigger: risk?.code === gridProtectionGuarantee.PROTECTION_REJECTION_CODE.LOCAL_IMMEDIATE_TRIGGER,
  priceSourceStale: risk?.code === gridProtectionGuarantee.PROTECTION_REJECTION_CODE.PRICE_SOURCE_STALE,
  price,
});

const placeLiveExitOrdersForLeg = async (row, leg, qty, entryPrice, options = {}) => {
  const coin = getCoin();
  const takeProfitPrice = computeLegTakeProfitPrice(row, leg, entryPrice);
  const stopPrice = computeLegStopPrice(row, leg);
  const price = await loadFreshGridDecisionPrice(row.symbol, { includeMark: true });
  const takeProfitClientOrderId = gridProtectionGuarantee.deriveProtectionClientOrderId({
    entryClientOrderId: options.entryOrderId || row?.[`${getLegFieldPrefix(leg)}EntryOrderId`] || null,
    prefix: "GTP",
  });
  const stopClientOrderId = gridProtectionGuarantee.deriveProtectionClientOrderId({
    entryClientOrderId: options.entryOrderId || row?.[`${getLegFieldPrefix(leg)}EntryOrderId`] || null,
    prefix: "GSTOP",
  });
  const result = {
    takeProfitPrice,
    stopPrice,
    takeProfitOrderId: null,
    stopOrderId: null,
    takeProfitSourceOrderId: null,
    stopSourceOrderId: null,
    takeProfitErrorCode: null,
    stopErrorCode: null,
    takeProfitErrorMessage: null,
    stopErrorMessage: null,
    takeProfitImmediateTrigger: false,
    stopImmediateTrigger: false,
    missingProtection: [],
    protectionState: null,
    protectionReason: null,
    protectionQty: 0,
  };

  const ownershipQty = await positionOwnership.resolveOwnedCloseQty({
    uid: row.uid,
    pid: row.id,
    strategyCategory: "grid",
    symbol: row.symbol,
    positionSide: leg,
    requestedQty: qty,
  });
  const protectionQty = Number(ownershipQty?.finalCloseQty || 0);
  result.protectionQty = protectionQty;
  if (!ownershipQty.allowed || !(protectionQty > 0)) {
    result.takeProfitErrorCode = ownershipQty.reason || "OWNERSHIP_CLOSE_QTY_BLOCKED";
    result.stopErrorCode = ownershipQty.reason || "OWNERSHIP_CLOSE_QTY_BLOCKED";
    result.takeProfitErrorMessage = `grid protection blocked by PID ownership:${ownershipQty.reason || "UNKNOWN"}`;
    result.stopErrorMessage = `grid protection blocked by PID ownership:${ownershipQty.reason || "UNKNOWN"}`;
    await appendGridRuntimeLog(
      row,
      "gridProtect",
      "PROTECTION_OWNERSHIP_QTY_BLOCKED",
      `leg:${leg}, requestedQty:${qty}, ownedQty:${ownershipQty.pidOwnedQty || 0}, availableQty:${ownershipQty.availableCloseQty || 0}, reason:${ownershipQty.reason || "UNKNOWN"}`,
      leg
    );
    const outcome = gridProtectionGuarantee.classifyProtectionOutcome({
      takeProfit: {
        clientOrderId: null,
        errorCode: result.takeProfitErrorCode,
        errorMessage: result.takeProfitErrorMessage,
      },
      stop: {
        clientOrderId: null,
        errorCode: result.stopErrorCode,
        errorMessage: result.stopErrorMessage,
      },
      oneLegEmergency: options.oneLegEmergency === true,
    });
    result.missingProtection = outcome.missing;
    result.protectionState = outcome.state;
    result.protectionReason = outcome.reason;
    result.protectionOutcome = outcome;
    return result;
  }

  if (takeProfitPrice > 0) {
    try {
      const risk = gridProtectionGuarantee.getProtectionImmediateTriggerRisk({
        leg,
        boundType: "GTP",
        triggerPrice: takeProfitPrice,
        price,
      });
      const takeProfitOrder = risk.blocked
        ? buildProtectionFailureOrder({
            kind: "TP",
            clientOrderId: takeProfitClientOrderId,
            price: takeProfitPrice,
            risk,
          })
        : await coin.placeGridTakeProfitOrder({
            uid: row.uid,
            pid: row.id,
            symbol: row.symbol,
            leg,
            qty: protectionQty,
            triggerPrice: takeProfitPrice,
            clientOrderId: takeProfitClientOrderId,
          });
      result.takeProfitOrderId = takeProfitOrder?.clientOrderId || null;
      result.takeProfitSourceOrderId = takeProfitOrder?.orderId || null;
      result.takeProfitErrorCode = takeProfitOrder?.errorCode || null;
      result.takeProfitErrorMessage = takeProfitOrder?.errorMessage || null;
      result.takeProfitImmediateTrigger = Boolean(takeProfitOrder?.immediateTrigger);
    } catch (error) {
      result.takeProfitErrorCode = error?.code || null;
      result.takeProfitErrorMessage = error?.message || String(error);
      await appendGridRuntimeLog(
        row,
        "gridLiveOpen",
        "TAKE_PROFIT_ORDER_ERROR",
        `leg:${leg}, qty:${protectionQty}, requestedQty:${qty}, entryPrice:${entryPrice}, targetPrice:${takeProfitPrice}, message:${error?.message || error}`,
        leg
      );
    }
    if (!result.takeProfitOrderId) {
      await appendGridRuntimeLog(
        row,
        "gridLiveOpen",
        "TAKE_PROFIT_ORDER_MISSING",
        `leg:${leg}, qty:${protectionQty}, requestedQty:${qty}, entryPrice:${entryPrice}, targetPrice:${takeProfitPrice}`,
        leg
      );
    }
  }

  if (stopPrice > 0) {
    try {
      const risk = gridProtectionGuarantee.getProtectionImmediateTriggerRisk({
        leg,
        boundType: "GSTOP",
        triggerPrice: stopPrice,
        price,
      });
      const stopOrder = risk.blocked
        ? buildProtectionFailureOrder({
            kind: "STOP",
            clientOrderId: stopClientOrderId,
            price: stopPrice,
            risk,
          })
        : await coin.placeGridStopOrder({
            uid: row.uid,
            pid: row.id,
            symbol: row.symbol,
            leg,
            qty: protectionQty,
            triggerPrice: stopPrice,
            clientOrderId: stopClientOrderId,
          });
      result.stopOrderId = stopOrder?.clientOrderId || null;
      result.stopSourceOrderId = stopOrder?.orderId || null;
      result.stopErrorCode = stopOrder?.errorCode || null;
      result.stopErrorMessage = stopOrder?.errorMessage || null;
      result.stopImmediateTrigger = Boolean(stopOrder?.immediateTrigger);
    } catch (error) {
      result.stopErrorCode = error?.code || null;
      result.stopErrorMessage = error?.message || String(error);
      await appendGridRuntimeLog(
        row,
        "gridLiveOpen",
        "STOP_ORDER_ERROR",
        `leg:${leg}, qty:${protectionQty}, requestedQty:${qty}, entryPrice:${entryPrice}, stopPrice:${stopPrice}, message:${error?.message || error}`,
        leg
      );
    }
    if (!result.stopOrderId) {
      await appendGridRuntimeLog(
        row,
        "gridLiveOpen",
        "STOP_ORDER_MISSING",
        `leg:${leg}, qty:${protectionQty}, requestedQty:${qty}, entryPrice:${entryPrice}, stopPrice:${stopPrice}`,
        leg
      );
    }
  }

  const outcome = gridProtectionGuarantee.classifyProtectionOutcome({
    takeProfit: {
      clientOrderId: result.takeProfitOrderId,
      sourceOrderId: result.takeProfitSourceOrderId,
      errorCode: result.takeProfitErrorCode,
      errorMessage: result.takeProfitErrorMessage,
      immediateTrigger: result.takeProfitImmediateTrigger,
    },
    stop: {
      clientOrderId: result.stopOrderId,
      sourceOrderId: result.stopSourceOrderId,
      errorCode: result.stopErrorCode,
      errorMessage: result.stopErrorMessage,
      immediateTrigger: result.stopImmediateTrigger,
    },
    oneLegEmergency: options.oneLegEmergency === true,
  });
  result.missingProtection = outcome.missing;
  result.protectionState = outcome.state;
  result.protectionReason = outcome.reason;
  result.protectionOutcome = outcome;
  return result;
};

const enqueueLiveProtectionIntentForLeg = async (row, leg, qty, entryPrice, options = {}) => {
  const prefix = getLegFieldPrefix(leg);
  const takeProfitPrice = computeLegTakeProfitPrice(row, leg, entryPrice);
  const stopPrice = computeLegStopPrice(row, leg);
  const sideTriggerMetadata = getGridSideTriggerMetadata(row);
  const entryOrderId = options.entryOrderId || row?.[`${prefix}EntryOrderId`] || null;
  const ownershipQty = await positionOwnership.resolveOwnedCloseQty({
    uid: row.uid,
    pid: row.id,
    strategyCategory: "grid",
    symbol: row.symbol,
    positionSide: leg,
    requestedQty: qty,
  });
  const protectionQty = Number(ownershipQty?.finalCloseQty || 0);
  const baseExits = {
    takeProfitPrice,
    stopPrice,
    takeProfitOrderId: null,
    stopOrderId: null,
    takeProfitSourceOrderId: null,
    stopSourceOrderId: null,
    takeProfitErrorCode: null,
    stopErrorCode: null,
    takeProfitErrorMessage: null,
    stopErrorMessage: null,
    takeProfitImmediateTrigger: false,
    stopImmediateTrigger: false,
    missingProtection: [],
    protectionState: "PROTECTION_INTENT_PENDING",
    protectionReason: "PROTECTION_INTENT_PENDING",
    protectionQty,
  };

  if (!ownershipQty.allowed || !(protectionQty > 0)) {
    const exits = {
      ...baseExits,
      takeProfitErrorCode: ownershipQty.reason || "OWNERSHIP_CLOSE_QTY_BLOCKED",
      stopErrorCode: ownershipQty.reason || "OWNERSHIP_CLOSE_QTY_BLOCKED",
      takeProfitErrorMessage: `grid protection intent blocked by PID ownership:${ownershipQty.reason || "UNKNOWN"}`,
      stopErrorMessage: `grid protection intent blocked by PID ownership:${ownershipQty.reason || "UNKNOWN"}`,
    };
    const outcome = gridProtectionGuarantee.classifyProtectionOutcome({
      takeProfit: {
        errorCode: exits.takeProfitErrorCode,
        errorMessage: exits.takeProfitErrorMessage,
      },
      stop: {
        errorCode: exits.stopErrorCode,
        errorMessage: exits.stopErrorMessage,
      },
      oneLegEmergency: options.oneLegEmergency === true,
    });
    exits.missingProtection = outcome.missing;
    exits.protectionState = "PROTECTION_BLOCKED_OWNERSHIP";
    exits.protectionReason = ownershipQty.reason || "OWNERSHIP_BLOCKED";
    exits.protectionOutcome = outcome;
    await markGridProtectionCriticalState({
      row,
      leg,
      qty,
      entryPrice,
      entryOrderId,
      exits,
      oneLegEmergency: options.oneLegEmergency === true,
      reason: "PROTECTION_BLOCKED_OWNERSHIP",
    });
    return {
      protected: false,
      pending: false,
      queued: false,
      exits,
      outcome,
      closed: false,
      reason: "PROTECTION_BLOCKED_OWNERSHIP",
    };
  }

  const summary = await orderIntentQueue.enqueueGridProtectionCreateIntent({
    routePath: options.routePath || "grid-runtime-protection",
    sourceEventId: options.sourceEventId || null,
    payload: {
      uid: row.uid,
      pid: row.id,
      gridRowId: row.id,
      regimeId: row.id,
      symbol: row.symbol,
      positionSide: leg,
      qty,
      ownedQty: protectionQty,
      entryPrice,
      entryOrderId,
      sourceOrderId: options.sourceOrderId || null,
      sourceTradeId: options.sourceTradeId || null,
      takeProfitPrice,
      stopPrice,
      supportPrice: sideTriggerMetadata.supportPrice || null,
      resistancePrice: sideTriggerMetadata.resistancePrice || null,
      payloadTriggerPrice: sideTriggerMetadata.payloadTriggerPrice || null,
      longTriggerPrice: sideTriggerMetadata.longTriggerPrice || null,
      shortTriggerPrice: sideTriggerMetadata.shortTriggerPrice || null,
      triggerProfile: sideTriggerMetadata.triggerProfile || null,
      gridRegimeKey: sideTriggerMetadata.gridRegimeKey || null,
      contextMissingReason: !(stopPrice > 0) ? "GRID_PROTECTION_CONTEXT_MISSING" : null,
      oneLegEmergency: options.oneLegEmergency === true,
      fillEvidence: options.fillEvidence || null,
    },
  });
  const outcome = {
    protected: false,
    partial: false,
    pending: true,
    state: "PROTECTION_INTENT_PENDING",
    reason: "PROTECTION_INTENT_PENDING",
    missing: [],
  };
  const exits = {
    ...baseExits,
    protectionOutcome: outcome,
  };
  await applyGridPatch("live_grid_strategy_list", row.id, {
    ...buildGridProtectedLegPatch({
      row,
      leg,
      entryOrderId,
      entryPrice,
      qty: protectionQty,
      exits,
      regimeStatus: "PROTECTION_INTENT_PENDING",
      regimeEndReason: "PROTECTION_INTENT_PENDING",
    }),
  });
  await appendGridRuntimeLog(
    row,
    "gridProtectQueue",
    summary.inserted ? "PROTECTION_INTENT_ENQUEUED" : "PROTECTION_INTENT_DUPLICATE",
    `leg:${leg}, entryOrderId:${entryOrderId || "NONE"}, qty:${protectionQty}, tp:${takeProfitPrice}, stop:${stopPrice}, intent:${summary.intent?.intentKey || "NONE"}`,
    leg
  );
  return {
    protected: false,
    pending: true,
    queued: true,
    exits,
    outcome,
    closed: false,
    intentSummary: summary,
  };
};

const buildGridProtectedLegPatch = ({
  row,
  leg,
  entryOrderId,
  entryPrice,
  qty,
  exits,
  regimeStatus = "ACTIVE",
  regimeEndReason = null,
}) => buildOpenLegPatch({
  leg,
  entryOrderId,
  entryPrice,
  qty,
  takeProfitPrice: exits.takeProfitPrice,
  stopPrice: exits.stopPrice,
  takeProfitOrderId: exits.takeProfitOrderId,
  stopOrderId: exits.stopOrderId,
  regimeStatus,
  regimeEndReason,
});

const markGridProtectionCriticalState = async ({
  row,
  leg,
  qty,
  entryPrice,
  entryOrderId,
  exits,
  oneLegEmergency = false,
  reason = null,
} = {}) => {
  const outcome = exits?.protectionOutcome || gridProtectionGuarantee.classifyProtectionOutcome({
    takeProfit: {
      clientOrderId: exits?.takeProfitOrderId || null,
      errorCode: exits?.takeProfitErrorCode || null,
      errorMessage: exits?.takeProfitErrorMessage || null,
      immediateTrigger: exits?.takeProfitImmediateTrigger || false,
    },
    stop: {
      clientOrderId: exits?.stopOrderId || null,
      errorCode: exits?.stopErrorCode || null,
      errorMessage: exits?.stopErrorMessage || null,
      immediateTrigger: exits?.stopImmediateTrigger || false,
    },
    oneLegEmergency,
  });
  const state = oneLegEmergency
    ? gridProtectionGuarantee.GRID_PROTECTION_STATE.ONE_LEG_UNPROTECTED
    : outcome.state;
  await applyGridPatch("live_grid_strategy_list", row.id, {
    ...buildGridProtectedLegPatch({
      row,
      leg,
      entryOrderId,
      entryPrice,
      qty,
      exits,
      regimeStatus: state,
      regimeEndReason: reason || outcome.reason,
    }),
  });
  await appendGridRuntimeLog(
    row,
    "gridProtect",
    outcome.partial ? "PROTECTION_PARTIAL_CRITICAL" : "PROTECTION_UNPROTECTED_CRITICAL",
    `leg:${leg}, entryOrderId:${entryOrderId || "NONE"}, qty:${qty}, missing:${outcome.missing.join("+") || "NONE"}, reason:${reason || outcome.reason}, tpCode:${outcome.takeProfit.errorCode || "OK"}, stopCode:${outcome.stop.errorCode || "OK"}`,
    leg
  );
  return outcome;
};

const protectGridOpenLegOrClose = async ({
  row,
  leg,
  qty,
  entryPrice,
  entryOrderId,
  normalRegimeStatus = "ACTIVE",
  normalRegimeEndReason = null,
  oneLegEmergency = false,
  failureLogCode = "ENTRY_PROTECTION_MISSING_CLOSED",
  failureMessage = null,
  useDurableProtectionQueue = true,
  routePath = null,
  sourceEventId = null,
  sourceOrderId = null,
  sourceTradeId = null,
  fillEvidence = null,
} = {}) => {
  if (useDurableProtectionQueue !== false) {
    return await enqueueLiveProtectionIntentForLeg(row, leg, qty, entryPrice, {
      entryOrderId,
      oneLegEmergency,
      routePath,
      sourceEventId,
      sourceOrderId,
      sourceTradeId,
      fillEvidence,
    });
  }

  const exits = await placeLiveExitOrdersForLeg(row, leg, qty, entryPrice, {
    entryOrderId,
    oneLegEmergency,
  });
  const protectedQty = Number(exits.protectionQty || qty);
  await syncGridExitReservationsForLeg(row, leg, exits, protectedQty);
  const outcome = exits.protectionOutcome || gridProtectionGuarantee.classifyProtectionOutcome({
    takeProfit: { clientOrderId: exits.takeProfitOrderId },
    stop: { clientOrderId: exits.stopOrderId },
    oneLegEmergency,
  });

  if (outcome.protected) {
    await applyGridPatch("live_grid_strategy_list", row.id, {
      ...buildGridProtectedLegPatch({
        row,
        leg,
        entryOrderId,
        entryPrice,
        qty: protectedQty,
        exits,
        regimeStatus: oneLegEmergency
          ? gridProtectionGuarantee.GRID_PROTECTION_STATE.ONE_LEG_PROTECTED
          : normalRegimeStatus,
        regimeEndReason: oneLegEmergency
          ? "PAIR_ONE_LEG_PROTECTED"
          : normalRegimeEndReason,
      }),
    });
    return {
      protected: true,
      exits,
      outcome,
      closed: false,
    };
  }

  await markGridProtectionCriticalState({
    row,
    leg,
    qty,
    entryPrice,
    entryOrderId,
    exits,
    oneLegEmergency,
    reason: outcome.reason,
  });
  const closed = await emergencyCloseLiveGridLeg(
    row,
    leg,
    qty,
    failureLogCode,
    failureMessage || `leg:${leg}, entryOrderId:${entryOrderId || "NONE"}, qty:${qty}, entryPrice:${entryPrice}, missing:${outcome.missing.join("+") || "NONE"}, reason:${outcome.reason}`
  );
  return {
    protected: false,
    exits,
    outcome,
    closed,
  };
};

const syncGridExitReservationsForLeg = async (row, leg, exits, qty) => {
  if (!row?.uid || !row?.id || !row?.symbol || !leg) {
    return false;
  }

  const reservations = [];
  if (exits?.takeProfitOrderId) {
    reservations.push({
      clientOrderId: exits.takeProfitOrderId,
      sourceOrderId: exits.takeProfitSourceOrderId || null,
      reservationKind: "GRID_TP",
      reservedQty: Number(exits?.protectionQty || qty),
      note: `grid leg:${leg} take-profit`,
    });
  }

  if (exits?.stopOrderId) {
    reservations.push({
      clientOrderId: exits.stopOrderId,
      sourceOrderId: exits.stopSourceOrderId || null,
      reservationKind: "GRID_STOP",
      reservedQty: Number(exits?.protectionQty || qty),
      note: `grid leg:${leg} stop-loss`,
    });
  }

  return await pidPositionLedger.replaceExitReservations({
    uid: row.uid,
    pid: row.id,
    strategyCategory: "grid",
    symbol: row.symbol,
    positionSide: leg,
    reservations,
  });
};

const normalizeGridEntryFillUnits = (execution = {}) => {
  const fills = Array.isArray(execution.fills) && execution.fills.length > 0
    ? execution.fills
    : [execution];
  return fills
    .map((fill) => ({
      clientOrderId: fill.clientOrderId || execution.clientOrderId || null,
      orderId: fill.orderId || execution.orderId || null,
      tradeId: fill.tradeId || execution.tradeId || null,
      qty: toNumber(fill.qty || execution.qty),
      price: toNumber(fill.price || execution.price),
      fee: fill.fee ?? execution.fee ?? null,
      tradeTime: fill.tradeTime || execution.tradeTime || null,
    }))
    .filter((fill) => fill.clientOrderId && fill.qty > 0 && fill.price > 0);
};

const applyGridEntryFillConvergence = async (row, leg, execution, issue = null, options = {}) => {
  if (!row?.id || !row?.uid || !row?.symbol || !leg || !execution?.clientOrderId) {
    return { converged: false, reason: "ENTRY_FILL_CONVERGENCE_INVALID_INPUT" };
  }

  const deps = options.deps || {};
  const findRecordedFill = deps.findRecordedFill || pidPositionLedger.findRecordedFill;
  const applyEntryFill = deps.applyEntryFill || pidPositionLedger.applyEntryFill;
  const syncGridLegSnapshot = deps.syncGridLegSnapshot || pidPositionLedger.syncGridLegSnapshot;
  const normalizedLeg = String(leg || "").trim().toUpperCase();
  const eventType = options.eventType || "GRID_EXCHANGE_RECONCILED_ENTRY_FILL";
  const note = options.note || `grid-entry-convergence:${options.source || "UNKNOWN"}`;
  const fillUnits = normalizeGridEntryFillUnits(execution);
  let appliedFillCount = 0;
  let duplicateFillCount = 0;

  for (const fill of fillUnits) {
    const existingFill = await findRecordedFill({
      uid: row.uid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: normalizedLeg,
      sourceClientOrderId: fill.clientOrderId,
      sourceOrderId: fill.orderId,
      sourceTradeId: fill.tradeId,
      fillQty: fill.qty,
      fillPrice: fill.price,
      tradeTime: fill.tradeTime,
    });
    if (existingFill) {
      duplicateFillCount += 1;
      continue;
    }

    await applyEntryFill({
      uid: row.uid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: normalizedLeg,
      sourceClientOrderId: fill.clientOrderId,
      sourceOrderId: fill.orderId,
      sourceTradeId: fill.tradeId,
      fillQty: fill.qty,
      fillPrice: fill.price,
      fee: fill.fee,
      tradeTime: fill.tradeTime,
      eventType,
      note,
    });
    appliedFillCount += 1;
  }

  await syncGridLegSnapshot(row.id, normalizedLeg);
  const restored = await restoreLiveGridLegAfterRecoveredEntryFill(row, normalizedLeg, execution, issue, options);
  return {
    converged: Boolean(restored),
    appliedFillCount,
    duplicateFillCount,
    fillUnitCount: fillUnits.length,
    source: options.source || "UNKNOWN",
  };
};

const restoreLiveGridLegAfterRecoveredEntryFill = async (row, leg, execution, issue = null, options = {}) => {
  if (!row?.id || !row?.uid || !row?.symbol || !leg || !execution?.clientOrderId) {
    return false;
  }

  const deps = options.deps || {};
  const syncGridLegSnapshot = deps.syncGridLegSnapshot || pidPositionLedger.syncGridLegSnapshot;
  const loadSnapshot = deps.loadSnapshot || pidPositionLedger.loadSnapshot;
  const loadGridItemForRecovery = deps.loadGridItem || loadGridItem;
  const applyGridPatchForRecovery = deps.applyGridPatch || applyGridPatch;
  const touchGridLegPositionOwnershipForRecovery =
    deps.touchGridLegPositionOwnership || touchGridLegPositionOwnership;
  const appendGridRuntimeLogForRecovery = deps.appendGridRuntimeLog || appendGridRuntimeLog;
  const cancelAllGridOrdersForRecovery = deps.cancelAllGridOrders || cancelAllGridOrders;
  const protectGridOpenLegOrCloseForRecovery =
    deps.protectGridOpenLegOrClose || protectGridOpenLegOrClose;
  const emergencyCloseLiveGridLegForRecovery =
    deps.emergencyCloseLiveGridLeg || emergencyCloseLiveGridLeg;
  const enqueueLiveGridCloseIntentForRecovery =
    deps.enqueueLiveGridCloseIntent || enqueueLiveGridCloseIntent;
  const prefix = getLegFieldPrefix(leg);
  await syncGridLegSnapshot(row.id, leg);
  const snapshot = await loadSnapshot({
    uid: row.uid,
    pid: row.id,
    strategyCategory: "grid",
    positionSide: leg,
  });
  const qty = toNumber(snapshot?.openQty);
  const entryPrice = toNumber(snapshot?.avgEntryPrice);

  if (!(qty > 0) || !(entryPrice > 0)) {
    return false;
  }

  const current = (await loadGridItemForRecovery("LIVE", row.id)) || row;
  const currentQty = toNumber(current?.[`${prefix}Qty`]);
  const hasExistingExits = Boolean(current?.[`${prefix}ExitOrderId`] || current?.[`${prefix}StopOrderId`]);
  const canReuseExistingProtection =
    current?.[`${prefix}EntryOrderId`] === execution.clientOrderId &&
    currentQty >= qty &&
    hasExistingExits;
  if (
    current?.[`${prefix}LegStatus`] === "OPEN" &&
    canReuseExistingProtection
  ) {
    return true;
  }

  if (canReuseExistingProtection) {
    await applyGridPatchForRecovery("live_grid_strategy_list", current.id, {
      ...buildOpenLegPatch({
        leg,
        entryOrderId: execution.clientOrderId,
        entryPrice,
        qty: currentQty,
        takeProfitPrice: current?.[`${prefix}TakeProfitPrice`] || null,
        stopPrice: current?.[`${prefix}StopPrice`] || null,
        takeProfitOrderId: current?.[`${prefix}ExitOrderId`] || null,
        stopOrderId: current?.[`${prefix}StopOrderId`] || null,
        regimeStatus: "ACTIVE",
        regimeEndReason: null,
      }),
    });
    await touchGridLegPositionOwnershipForRecovery(current, leg, {
      ownerState: "OPEN",
      sourceClientOrderId: execution.clientOrderId,
      sourceOrderId: execution.orderId || null,
      note: "exchange-entry-reconcile-reuse-protection",
    });
    await appendGridRuntimeLogForRecovery(
      current,
      "gridReconcile",
      "ENTRY_FILL_RECOVERED_REUSED_PROTECTION",
      `leg:${leg}, clientOrderId:${execution.clientOrderId}, qty:${currentQty}, entryPrice:${entryPrice}, issues:${[].concat(issue?.issues || []).join(",")}`,
      leg
    );
    return true;
  }

  if (current?.regimeStatus === "ENDED") {
    return await emergencyCloseLiveGridLegForRecovery(
      current,
      leg,
      qty,
      "ENTRY_FILL_RECOVERED_AFTER_END_CLOSED",
      `leg:${leg}, clientOrderId:${execution.clientOrderId}, qty:${qty}, entryPrice:${entryPrice}, reason:regime-ended, issues:${[].concat(issue?.issues || []).join(",")}`
    );
  }

  if (
    current?.[`${prefix}LegStatus`] === "OPEN"
    && currentQty > 0
    && current?.[`${prefix}EntryOrderId`]
    && current?.[`${prefix}EntryOrderId`] !== execution.clientOrderId
  ) {
    const cleanupIntent = await enqueueLiveGridCloseIntentForRecovery(
      current,
      leg,
      qty,
      "DUPLICATE_ENTRY_CONTROLLED_CLOSE",
      {
        routePath: options.routePath || "grid-runtime-entry-fill",
        sourceOrderId: execution.orderId || null,
        sourceTradeId: execution.tradeId || null,
        sourceClientOrderId: execution.clientOrderId,
        ownedQtyBasis: qty,
      }
    );
    await appendGridRuntimeLogForRecovery(
      current,
      "gridLiveOpen",
      cleanupIntent.pending ? "ENTRY_FILLED_DUPLICATE_CLOSE_QUEUED" : "ENTRY_FILLED_DUPLICATE_CLOSE_FAILED",
      `leg:${leg}, entryOrderId:${execution.clientOrderId}, existingEntryOrderId:${current?.[`${prefix}EntryOrderId`]}, qty:${qty}, closeIntent:${cleanupIntent.intentSummary?.intent?.intentKey || "NONE"}`,
      leg
    );
    return cleanupIntent.pending;
  }

  if (hasExistingExits) {
    await cancelAllGridOrdersForRecovery("LIVE", current, {
      leg,
      includeEntries: false,
      includeExits: true,
    });
  }

  const protection = await protectGridOpenLegOrCloseForRecovery({
    row: current,
    leg,
    qty,
    entryPrice,
    entryOrderId: execution.clientOrderId,
    routePath: options.routePath || null,
    sourceOrderId: execution.orderId || null,
    sourceTradeId: execution.tradeId || null,
    fillEvidence: options.fillEvidence || null,
    failureLogCode: options.failureLogCode || "ENTRY_FILL_RECOVERED_PROTECTION_MISSING_CLOSED",
    failureMessage: options.failureMessage || `leg:${leg}, clientOrderId:${execution.clientOrderId}, qty:${qty}, entryPrice:${entryPrice}, issues:${[].concat(issue?.issues || []).join(",")}`,
  });
  if (protection.pending) {
    await touchGridLegPositionOwnershipForRecovery(current, leg, {
      ownerState: "PROTECTION_INTENT_PENDING",
      sourceClientOrderId: execution.clientOrderId,
      sourceOrderId: execution.orderId || null,
      note: "exchange-entry-reconcile-protection-intent",
    });
    await appendGridRuntimeLogForRecovery(
      current,
      "gridReconcile",
      "ENTRY_FILL_RECOVERED_PROTECTION_INTENT_PENDING",
      `leg:${leg}, clientOrderId:${execution.clientOrderId}, orderId:${execution.orderId}, qty:${qty}, entryPrice:${entryPrice}, issues:${[].concat(issue?.issues || []).join(",")}`,
      leg
    );
    return true;
  }
  if (!protection.protected) {
    return protection.closed;
  }

  await touchGridLegPositionOwnershipForRecovery(current, leg, {
    ownerState: "OPEN",
    sourceClientOrderId: execution.clientOrderId,
    sourceOrderId: execution.orderId || null,
    note: "exchange-entry-reconcile",
  });
  await appendGridRuntimeLogForRecovery(
    current,
    "gridReconcile",
    "ENTRY_FILL_RECOVERED",
    `leg:${leg}, clientOrderId:${execution.clientOrderId}, orderId:${execution.orderId}, qty:${qty}, entryPrice:${entryPrice}, tp:${protection.exits.takeProfitOrderId}, stop:${protection.exits.stopOrderId}, issues:${[].concat(issue?.issues || []).join(",")}`,
    leg
  );
  return true;
};

const armMissingLiveExits = async (row) => {
  let changed = false;
  let current = row;

  for (const leg of ["LONG", "SHORT"]) {
    const prefix = getLegFieldPrefix(leg);
    if (current[`${prefix}LegStatus`] !== "OPEN") {
      continue;
    }

    const qty = toNumber(current[`${prefix}Qty`]);
    const entryPrice = toNumber(current[`${prefix}EntryPrice`]);
    if (!(qty > 0) || !(entryPrice > 0)) {
      continue;
    }

    if (current[`${prefix}ExitOrderId`] && current[`${prefix}StopOrderId`]) {
      continue;
    }

    const protection = await protectGridOpenLegOrClose({
      row: current,
      leg,
      qty,
      entryPrice,
      entryOrderId: current[`${prefix}EntryOrderId`] || null,
      routePath: "grid-live-exit-repair",
      failureLogCode: "EXIT_REPAIR_INCOMPLETE_CLOSED",
      failureMessage: `leg:${leg}, qty:${qty}, reason:missing-live-exit-repair`,
    });
    if (!protection.protected && !protection.pending) {
      return protection.closed;
    }
    current = (await loadGridItem("LIVE", current.id)) || current;
    changed = true;
  }

  return changed;
};

const GRID_ENTRY_PAIR_LEGS = ["LONG", "SHORT"];

const getPairEntryPatch = (leg, patch) => {
  const prefix = getLegFieldPrefix(leg);
  return Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [`${prefix}${key}`, value])
  );
};

const isInitialGridEntryPairCandidate = (row) =>
  canArmEntriesForRow(row)
  && GRID_ENTRY_PAIR_LEGS.every((leg) => {
    const prefix = getLegFieldPrefix(leg);
    return row?.[`${prefix}LegStatus`] === "ENTRY_ARMED" && !row?.[`${prefix}EntryOrderId`];
  });

const isOneSidedEntryArmWithoutOppositeContext = (row) => {
  if (!canArmEntriesForRow(row)) {
    return false;
  }

  const armedLegs = GRID_ENTRY_PAIR_LEGS.filter((leg) => {
    const prefix = getLegFieldPrefix(leg);
    return row?.[`${prefix}LegStatus`] === "ENTRY_ARMED" && !row?.[`${prefix}EntryOrderId`];
  });
  if (armedLegs.length !== 1) {
    return false;
  }

  const hasOpenLegContext = GRID_ENTRY_PAIR_LEGS.some((leg) => hasOpenLeg(row, leg));
  return !hasOpenLegContext && !gridPairAtomicity.hasAnyGridEntryOrderRef(row);
};

const GRID_LIVE_ARM_PAIR_PRIMING_STATES = new Set(["", "WAITING_WEBHOOK", "QA_ARM_READY"]);

const normalizeGridArmSymbol = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_]+:/, "");

const pickFirstNonEmpty = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
};

const toMysqlDate = (value) => {
  if (!value) {
    return new Date();
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const getTargetGridPayload = (targetItem = {}) => {
  if (targetItem.gridPayload && typeof targetItem.gridPayload === "object") {
    return targetItem.gridPayload;
  }
  return targetItem;
};

const getTargetGridRegimeKey = (targetItem = {}) => {
  const payload = getTargetGridPayload(targetItem);
  return pickFirstNonEmpty(
    targetItem.gridRegimeKey,
    targetItem.regimeKey,
    payload.gridRegimeKey,
    payload.regimeKey,
    payload.rawPayload?.gridRegimeKey,
    payload.rawPayload?.regimeKey
  );
};

const buildGridArmLastPayloadJson = (targetItem = {}, plan = {}) => {
  const payload = getTargetGridPayload(targetItem);
  const rawPayload = payload.rawPayload && typeof payload.rawPayload === "object"
    ? payload.rawPayload
    : {};
  return JSON.stringify({
    ...rawPayload,
    ...payload,
    gridRegimeKey: plan.gridRegimeKey,
    supportPrice: plan.supportPrice,
    resistancePrice: plan.resistancePrice,
    triggerPrice: plan.triggerPrice,
    longTriggerPrice: plan.longTriggerPrice,
    shortTriggerPrice: plan.shortTriggerPrice,
    triggerProfile: plan.triggerProfile || null,
    signalTime: plan.signalTime,
    pairPrimingSource: "GRID_LIVE_ARM_WORKER_TARGET",
  });
};

const buildLiveGridArmPairPrimingPlan = ({ row = {}, targetItem = {} } = {}) => {
  if (!row?.id || !row?.uid) {
    return { ok: false, reason: "GRID_LIVE_ARM_ROW_MISSING" };
  }
  if (!isGridControlEnabled(row)) {
    return { ok: false, reason: "GRID_LIVE_ARM_ROW_DISABLED" };
  }

  const currentState = String(row.regimeStatus || "").trim().toUpperCase();
  if (!GRID_LIVE_ARM_PAIR_PRIMING_STATES.has(currentState)) {
    return {
      ok: false,
      reason: "GRID_LIVE_ARM_ROW_STATE_NOT_PRIMEABLE",
      regimeStatus: row.regimeStatus || null,
    };
  }
  if (
    hasOpenPosition(row) ||
    hasAnyEntryArmed(row) ||
    gridPairAtomicity.hasAnyGridEntryOrderRef(row)
  ) {
    return { ok: false, reason: "GRID_LIVE_ARM_EXISTING_LEG_CONTEXT" };
  }

  const rowSymbol = normalizeGridArmSymbol(row.symbol);
  const targetSymbol = normalizeGridArmSymbol(
    pickFirstNonEmpty(targetItem.symbol, getTargetGridPayload(targetItem).symbol)
  );
  if (rowSymbol && targetSymbol && rowSymbol !== targetSymbol) {
    return {
      ok: false,
      reason: "GRID_LIVE_ARM_SYMBOL_MISMATCH",
      rowSymbol,
      targetSymbol,
    };
  }

  const hydration = gridLiveArmHydration.hydrateGridLiveArmRowForPairPriming({
    row,
    targetItem,
  });
  if (!hydration.ok) {
    return { ok: false, reason: hydration.reason || "GRID_LIVE_ARM_PAIR_CONTEXT_MISSING" };
  }

  const hydratedRow = hydration.row;
  const gridRegimeKey = getTargetGridRegimeKey(targetItem);
  if (!gridRegimeKey) {
    return { ok: false, reason: "GRID_LIVE_ARM_REGIME_KEY_MISSING" };
  }

  const supportPrice = toNumber(hydratedRow.supportPrice);
  const resistancePrice = toNumber(hydratedRow.resistancePrice);
  const triggerPrice = toNumber(hydratedRow.triggerPrice);
  const longTriggerPrice = getGridLegTriggerPrice(hydratedRow, "LONG");
  const shortTriggerPrice = getGridLegTriggerPrice(hydratedRow, "SHORT");
  const triggerProfile = getGridTriggerProfile(hydratedRow);
  if (!(supportPrice > 0) || !(resistancePrice > 0) || !(triggerPrice > 0) || !(longTriggerPrice > 0) || !(shortTriggerPrice > 0)) {
    return { ok: false, reason: "GRID_LIVE_ARM_PRICE_CONTEXT_MISSING" };
  }
  if (!(supportPrice < triggerPrice && triggerPrice < resistancePrice)) {
    return { ok: false, reason: "GRID_LIVE_ARM_PRICE_CONTEXT_INVALID" };
  }
  if (longTriggerPrice < supportPrice || longTriggerPrice > resistancePrice) {
    return { ok: false, reason: "GRID_LIVE_ARM_LONG_TRIGGER_OUTSIDE_BOX" };
  }
  if (shortTriggerPrice < supportPrice || shortTriggerPrice > resistancePrice) {
    return { ok: false, reason: "GRID_LIVE_ARM_SHORT_TRIGGER_OUTSIDE_BOX" };
  }
  if (longTriggerPrice > shortTriggerPrice) {
    return { ok: false, reason: "GRID_LIVE_ARM_SIDE_TRIGGER_ORDER_INVALID" };
  }

  const tradeValue = getTradeValue(hydratedRow);
  const qty = computeGridEntryQty(hydratedRow, triggerPrice);
  const legPlans = GRID_ENTRY_PAIR_LEGS.map((leg) => {
    const legTriggerPrice = getGridLegTriggerPrice(hydratedRow, leg);
    const legQty = computeGridEntryQty(hydratedRow, legTriggerPrice);
    return {
      leg,
      orderType: "LIMIT",
      side: getLegMeta(leg).signalSide,
      positionSide: getLegPositionSide(leg),
      triggerPrice: legTriggerPrice,
      qty: legQty,
      notional: legQty * legTriggerPrice,
      clientOrderId: gridPairAtomicity.buildGridPairClientOrderId(hydratedRow, leg),
    };
  });
  if (!(tradeValue > 0) || !(qty > 0) || legPlans.some((legPlan) => !(legPlan.qty > 0))) {
    return { ok: false, reason: "GRID_LIVE_ARM_NOTIONAL_MISSING" };
  }

  if (!isInitialGridEntryPairCandidate(hydratedRow)) {
    return { ok: false, reason: "GRID_LIVE_ARM_PAIR_CONTEXT_NOT_INITIAL_PAIR" };
  }

  const signalTime = pickFirstNonEmpty(
    targetItem.signalTime,
    getTargetGridPayload(targetItem).signalTime,
    getTargetGridPayload(targetItem).rawPayload?.signalTime,
    hydratedRow.signalTime
  );

  return {
    ok: true,
    reason: null,
    row: hydratedRow,
    pairPrimingPatch: hydratedRow.__gridLiveArmPairPrimingPatch || {},
    gridRegimeKey,
    supportPrice,
    resistancePrice,
    triggerPrice,
    longTriggerPrice,
    shortTriggerPrice,
    triggerProfile: triggerProfile || null,
    signalTime: signalTime || null,
    qty,
    notional: qty * triggerPrice,
    tradeValue,
    legs: legPlans,
  };
};

const applyLiveGridArmPairPrimingPatch = async (row, targetItem, plan) => {
  if (!row?.id || !row?.uid || !plan?.ok) {
    return null;
  }

  const signalTime = toMysqlDate(plan.signalTime);
  const payloadJson = buildGridArmLastPayloadJson(targetItem, plan);
  const [result] = await db.query(
    `UPDATE live_grid_strategy_list
        SET regimeStatus = 'ACTIVE',
            regimeEndReason = NULL,
            regimeReceivedAt = NOW(),
            signalTime = ?,
            supportPrice = ?,
            resistancePrice = ?,
            triggerPrice = ?,
            longLegStatus = 'ENTRY_ARMED',
            longEntryOrderId = NULL,
            longExitOrderId = NULL,
            longStopOrderId = NULL,
            longQty = 0,
            longEntryPrice = NULL,
            longTakeProfitPrice = NULL,
            longStopPrice = NULL,
            shortLegStatus = 'ENTRY_ARMED',
            shortEntryOrderId = NULL,
            shortExitOrderId = NULL,
            shortStopOrderId = NULL,
            shortQty = 0,
            shortEntryPrice = NULL,
            shortTakeProfitPrice = NULL,
            shortStopPrice = NULL,
            lastWebhookPayloadJson = ?,
            updatedAt = NOW()
      WHERE id = ?
        AND uid = ?
        AND enabled = 'Y'
        AND (regimeStatus IS NULL OR regimeStatus = '' OR regimeStatus IN ('WAITING_WEBHOOK', 'QA_ARM_READY'))
      LIMIT 1`,
    [
      signalTime,
      plan.supportPrice,
      plan.resistancePrice,
      plan.triggerPrice,
      payloadJson,
      row.id,
      row.uid,
    ]
  );

  if (result?.affectedRows !== 1) {
    return null;
  }
  return (await loadGridItem("LIVE", row.id)) || null;
};

const markGridPairArmFailed = async (row, reason, message) => {
  const patch = {
    regimeStatus: gridPairAtomicity.GRID_PAIR_STATE.FAILED,
    regimeEndReason: reason,
    ...getPairEntryPatch("LONG", {
      LegStatus: gridPairAtomicity.GRID_PAIR_LEG_STATUS.FAILED,
      EntryOrderId: null,
    }),
    ...getPairEntryPatch("SHORT", {
      LegStatus: gridPairAtomicity.GRID_PAIR_LEG_STATUS.FAILED,
      EntryOrderId: null,
    }),
  };
  await applyGridPatch("live_grid_strategy_list", row.id, patch);
  await releaseGridLegPositionOwnership(row, "LONG").catch(() => {});
  await releaseGridLegPositionOwnership(row, "SHORT").catch(() => {});
  await appendGridRuntimeLog(row, "gridLiveArm", reason, message);
  return true;
};

const findGridEntryOrderForLeg = async (row, leg, { orderId = null, clientOrderId = null } = {}) => {
  if (!clientOrderId && !orderId) {
    return null;
  }

  const coin = getCoin();
  if (typeof coin.findGridEntryOrder !== "function") {
    return null;
  }

  return await coin.findGridEntryOrder({
    uid: row.uid,
    symbol: row.symbol,
    orderId,
    clientOrderId,
  }).catch(() => null);
};

const resolveGridPairPlacementResult = async (row, leg, result, requestedClientOrderId) => {
  if (result?.clientOrderId) {
    return {
      leg,
      ok: true,
      clientOrderId: result.clientOrderId,
      orderId: result.orderId || null,
      exchangeOrder: result.raw || null,
      source: "ACK",
    };
  }

  if (gridPairAtomicity.shouldVerifyAfterWriteResult(result)) {
    const exchangeOrder = await findGridEntryOrderForLeg(row, leg, {
      clientOrderId: requestedClientOrderId || result?.requestedClientOrderId || null,
    });
    if (exchangeOrder) {
      return {
        leg,
        ok: true,
        clientOrderId: String(exchangeOrder.clientOrderId || exchangeOrder.origClientOrderId || requestedClientOrderId),
        orderId: exchangeOrder.orderId || null,
        exchangeOrder,
        source: gridPairAtomicity.isDuplicateOrderResult(result) ? "DUPLICATE_VERIFIED" : "READ_AFTER_WRITE",
      };
    }
  }

  return {
    leg,
    ok: false,
    clientOrderId: requestedClientOrderId || result?.requestedClientOrderId || null,
    orderId: result?.orderId || null,
    errorCode: result?.errorCode || null,
    errorMessage: result?.errorMessage || null,
    source: "FAILED",
  };
};

const markGridReentryFailed = async ({
  row,
  leg,
  reason,
  message,
  state = gridReentrySlPolicy.GRID_REENTRY_STATE.FAILED,
  sourceClientOrderId = null,
} = {}) => {
  await applyGridPatch("live_grid_strategy_list", row.id, {
    ...getLegPatchForClosed(leg),
    regimeStatus: state,
    regimeEndReason: reason,
  });
  await releaseGridLegPositionOwnership(row, leg).catch(() => {});
  await appendGridRuntimeLog(
    row,
    "gridReentry",
    reason,
    message || `leg:${leg}, clientOrderId:${sourceClientOrderId || "NONE"}`,
    leg
  );
  return {
    ok: false,
    state,
    reason,
    clientOrderId: sourceClientOrderId,
  };
};

const enqueueLiveReentryIntentAfterTakeProfit = async (row, parsed, reData) => {
  const leg = parsed.leg;
  const source = {
    takeProfitClientOrderId: parsed.clientOrderId,
    orderId: reData?.i || null,
    tradeId: reData?.t || null,
    tradeTime: reData?.T || null,
  };
  const requestedClientOrderId = gridReentrySlPolicy.buildGridReentryClientOrderId(row, leg, source);
  const priceDecision = await loadFreshGridDecisionPrice(row.symbol)
    .then((price) => gridReentrySlPolicy.getReentryPriceDecision(price))
    .catch((error) => ({
      usable: false,
      source: "ERROR",
      reason: error?.message || String(error),
    }));
  const triggerPrice = getGridLegTriggerPrice(row, leg);
  const reentryQty = computeGridEntryQty(row, triggerPrice);
  const closedQty = toNumber(reData?.l || reData?.z);
  const sideTriggerMetadata = getGridSideTriggerMetadata(row);
  const summary = await orderIntentQueue.enqueueGridReentryCreateIntent({
    routePath: "grid-runtime-tp-reentry",
    payload: {
      uid: row.uid,
      pid: row.id,
      gridRowId: row.id,
      regimeId: row.id,
      symbol: row.symbol,
      timeframe: row.bunbong,
      positionSide: leg,
      triggerPrice,
      payloadTriggerPrice: sideTriggerMetadata.payloadTriggerPrice,
      supportPrice: sideTriggerMetadata.supportPrice,
      resistancePrice: sideTriggerMetadata.resistancePrice,
      longTriggerPrice: sideTriggerMetadata.longTriggerPrice,
      shortTriggerPrice: sideTriggerMetadata.shortTriggerPrice,
      triggerProfile: sideTriggerMetadata.triggerProfile,
      gridRegimeKey: sideTriggerMetadata.gridRegimeKey,
      reentryQty,
      ownedQtyBasis: closedQty,
      sourceTakeProfitClientOrderId: parsed.clientOrderId,
      sourceOrderId: reData?.i || null,
      sourceTradeId: reData?.t || null,
      tradeTime: reData?.T || null,
      reentryClientOrderId: requestedClientOrderId,
      priceFreshnessEvidence: priceDecision,
    },
  });

  await applyGridPatch("live_grid_strategy_list", row.id, {
    ...getLegPatchForClosed(leg),
    regimeStatus: gridReentrySlPolicy.GRID_REENTRY_STATE.INTENT_PENDING,
    regimeEndReason: gridReentrySlPolicy.GRID_REENTRY_REASON.INTENT_PENDING,
  });
  await appendGridRuntimeLog(
    row,
    "gridReentryQueue",
    summary.inserted ? "REENTRY_INTENT_ENQUEUED" : "REENTRY_INTENT_DUPLICATE",
    `leg:${leg}, clientOrderId:${requestedClientOrderId}, trigger:${triggerPrice}, qty:${reentryQty}, priceUsable:${priceDecision.usable ? "Y" : "N"}, intent:${summary.intent?.intentKey || "NONE"}`,
    leg
  );

  return {
    ok: true,
    pending: true,
    clientOrderId: requestedClientOrderId,
    state: gridReentrySlPolicy.GRID_REENTRY_STATE.INTENT_PENDING,
    reason: gridReentrySlPolicy.GRID_REENTRY_REASON.INTENT_PENDING,
    intentSummary: summary,
    priceDecision,
  };
};

const armLiveReentryAfterTakeProfit = async (row, parsed, reData) => {
  const leg = parsed.leg;
  const priceDecision = gridReentrySlPolicy.getReentryPriceDecision(
    await loadFreshGridDecisionPrice(row.symbol)
  );
  const source = {
    takeProfitClientOrderId: parsed.clientOrderId,
    orderId: reData?.i || null,
    tradeId: reData?.t || null,
    tradeTime: reData?.T || null,
  };
  const requestedClientOrderId = gridReentrySlPolicy.buildGridReentryClientOrderId(row, leg, source);

  if (!priceDecision.usable) {
    return await markGridReentryFailed({
      row,
      leg,
      state: gridReentrySlPolicy.GRID_REENTRY_STATE.STALE_PRICE,
      reason: gridReentrySlPolicy.GRID_REENTRY_REASON.PRICE_STALE,
      sourceClientOrderId: requestedClientOrderId,
      message: `leg:${leg}, clientOrderId:${requestedClientOrderId}, priceSource:${priceDecision.source}, reason:${priceDecision.reason}, quoteAgeMs:${Number.isFinite(priceDecision.quoteAgeMs) ? priceDecision.quoteAgeMs : "UNKNOWN"}`,
    });
  }

  let ownershipReservation = null;
  let reservedOrderId = null;
  try {
    ownershipReservation = await acquireGridLegPositionOwnership(row, leg, {
      ownerState: "ENTRY_ARMED",
      sourceClientOrderId: requestedClientOrderId,
      note: "grid take-profit reentry arm",
    });
    if (!ownershipReservation?.ok) {
      throw new Error(`REENTRY_OWNERSHIP_FAILED:${ownershipReservation?.reason || "UNKNOWN"}`);
    }

    reservedOrderId = await reserveLiveGridEntrySlot(row, leg);
    if (!reservedOrderId) {
      throw new Error("REENTRY_ENTRY_SLOT_BUSY");
    }

    const result = await placeLiveEntryOrderForLeg(row, leg, {
      clientOrderId: requestedClientOrderId,
    });
    const placement = await resolveGridPairPlacementResult(
      row,
      leg,
      result,
      requestedClientOrderId
    );

    if (!placement.ok) {
      await finalizeLiveGridEntrySlot(row, leg, reservedOrderId, null).catch(() => {});
      return await markGridReentryFailed({
        row,
        leg,
        reason: gridReentrySlPolicy.GRID_REENTRY_REASON.SUBMIT_FAILED,
        sourceClientOrderId: requestedClientOrderId,
        message: `leg:${leg}, clientOrderId:${requestedClientOrderId}, errorCode:${placement.errorCode || "UNKNOWN"}, message:${placement.errorMessage || "reentry submit failed"}`,
      });
    }

    await finalizeLiveGridEntrySlot(row, leg, reservedOrderId, placement.clientOrderId);
    await touchGridLegPositionOwnership(row, leg, {
      ownerState: "ENTRY_ARMED",
      sourceClientOrderId: placement.clientOrderId,
      sourceOrderId: placement.orderId || null,
      note: "grid take-profit reentry order placed",
    });
    await applyGridPatch("live_grid_strategy_list", row.id, {
      ...getLegPatchForEntryArmed(leg, placement.clientOrderId),
      regimeStatus: "ACTIVE",
      regimeEndReason: null,
    });
    await appendGridRuntimeLog(
      row,
      "gridReentry",
      "TP_REENTRY_ARMED",
      `leg:${leg}, clientOrderId:${placement.clientOrderId}, source:${placement.source || "ACK"}, quoteAgeMs:${priceDecision.quoteAgeMs}`,
      leg
    );
    return {
      ok: true,
      clientOrderId: placement.clientOrderId,
      orderId: placement.orderId || null,
      state: "ACTIVE",
      reason: null,
    };
  } catch (error) {
    if (reservedOrderId) {
      await finalizeLiveGridEntrySlot(row, leg, reservedOrderId, null).catch(() => {});
    }
    if (ownershipReservation?.ok) {
      await releaseGridLegPositionOwnership(row, leg).catch(() => {});
    }
    return await markGridReentryFailed({
      row,
      leg,
      reason: gridReentrySlPolicy.GRID_REENTRY_REASON.SUBMIT_FAILED,
      sourceClientOrderId: requestedClientOrderId,
      message: `leg:${leg}, clientOrderId:${requestedClientOrderId}, message:${error?.message || error}`,
    });
  }
};

const getOppositeGridLeg = (leg) => String(leg || "").toUpperCase() === "LONG" ? "SHORT" : "LONG";

const terminateLiveGridRegimeAfterStopFill = async ({
  row,
  stoppedLeg,
  remainingStoppedQty = 0,
  reData,
  stoppedClientOrderId = null,
} = {}) => {
  const oppositeLeg = getOppositeGridLeg(stoppedLeg);
  const cleanupOrderRefsBefore = [
    row?.longEntryOrderId,
    row?.shortEntryOrderId,
    row?.longExitOrderId,
    row?.shortExitOrderId,
    row?.longStopOrderId,
    row?.shortStopOrderId,
  ]
    .filter(Boolean)
    .filter((clientOrderId) => String(clientOrderId) !== String(stoppedClientOrderId || ""));
  await cancelAllGridOrders("LIVE", row, {
    includeEntries: true,
    includeExits: false,
    reason: "GRID_STOP_TERMINAL_ENTRY_CLEANUP",
  });

  if (remainingStoppedQty > 0) {
    await applyGridPatch("live_grid_strategy_list", row.id, {
      regimeStatus: gridReentrySlPolicy.GRID_SL_STATE.OPPOSITE_CRITICAL,
      regimeEndReason: gridReentrySlPolicy.GRID_SL_REASON.TERMINATED,
    });
    const closed = await emergencyCloseLiveGridLeg(
      row,
      stoppedLeg,
      remainingStoppedQty,
      "STOP_PARTIAL_REMAINING_CLOSED",
      `leg:${stoppedLeg}, remainingQty:${remainingStoppedQty}, stopExitPrice:${toNumber(reData.ap || reData.L)}`
    );
    return {
      state: gridReentrySlPolicy.GRID_SL_STATE.OPPOSITE_CRITICAL,
      reason: "STOP_PARTIAL_REMAINING",
      canceledCount: 0,
      closed,
    };
  }

  await pidPositionLedger.syncGridLegSnapshot(row.id, oppositeLeg);
  const refreshed = (await loadGridItem("LIVE", row.id)) || row;
  const oppositePrefix = getLegFieldPrefix(oppositeLeg);
  const oppositeQty = toNumber(refreshed?.[`${oppositePrefix}Qty`]);
  if (oppositeQty > 0) {
    await applyGridPatch("live_grid_strategy_list", row.id, {
      ...getLegPatchForClosed(stoppedLeg),
      regimeStatus: gridReentrySlPolicy.GRID_SL_STATE.OPPOSITE_CRITICAL,
      regimeEndReason: gridReentrySlPolicy.GRID_SL_REASON.OPPOSITE_CLOSE_REQUIRED,
    });
    await releaseGridLegPositionOwnership(row, stoppedLeg).catch(() => {});
    const closed = await emergencyCloseLiveGridLeg(
      refreshed,
      oppositeLeg,
      oppositeQty,
      "SL_OPPOSITE_LEG_CLOSE_REQUIRED",
      `stoppedLeg:${stoppedLeg}, oppositeLeg:${oppositeLeg}, oppositeQty:${oppositeQty}, reason:sl-terminates-regime`
    );
    await appendGridRuntimeLog(
      row,
      "gridLiveStop",
      "SL_OPPOSITE_CLOSE_REQUIRED",
      `stoppedLeg:${stoppedLeg}, oppositeLeg:${oppositeLeg}, oppositeQty:${oppositeQty}, closed:${closed ? "Y" : "N"}`,
      oppositeLeg
    );
    return {
      state: gridReentrySlPolicy.GRID_SL_STATE.OPPOSITE_CRITICAL,
      reason: gridReentrySlPolicy.GRID_SL_REASON.OPPOSITE_CLOSE_REQUIRED,
      canceledCount: 0,
      closed,
    };
  }

  const protectionCleanup = await cleanupLiveGridProtectionAfterFlatClose(
    refreshed,
    stoppedLeg,
    "GRID_STOP_FLAT_PROTECTION_CLEANUP",
    stoppedClientOrderId
  );

  await applyGridPatch("live_grid_strategy_list", row.id, {
    ...buildEndedRegimePatch(refreshed, gridReentrySlPolicy.GRID_SL_REASON.TERMINATED),
    ...getLegPatchForClosed(stoppedLeg),
  });
  await releaseGridLegPositionOwnership(row, stoppedLeg).catch(() => {});
  await appendGridRuntimeLog(
    row,
    "gridLiveStop",
    gridReentrySlPolicy.GRID_SL_REASON.TERMINATED,
    `leg:${stoppedLeg}, stopExitPrice:${toNumber(reData.ap || reData.L)}, refsBefore:${cleanupOrderRefsBefore.join("+") || "NONE"}, protectionCleanup:${protectionCleanup.reason}`,
    stoppedLeg
  );
  const latest = (await loadGridItem("LIVE", row.id)) || refreshed;
  await finalizeEndedGridRegimeIfIdle(
    "LIVE",
    latest,
    gridReentrySlPolicy.GRID_SL_REASON.TERMINATED
  );
  return {
    state: "ENDED",
    reason: gridReentrySlPolicy.GRID_SL_REASON.TERMINATED,
    canceledCount: 0,
    closed: true,
  };
};

const rollbackGridPairSuccessfulLeg = async (row, leg, placement) => {
  const prefix = getLegFieldPrefix(leg);
  const clientOrderId = placement?.clientOrderId || null;
  const exchangeOrder = placement?.exchangeOrder || await findGridEntryOrderForLeg(row, leg, {
    orderId: placement?.orderId || null,
    clientOrderId,
  });

  if (gridPairAtomicity.isOrderFilledOrPartiallyFilled(exchangeOrder || {})) {
    const qty = gridPairAtomicity.getOrderExecutedQty(exchangeOrder);
    const entryPrice = toNumber(exchangeOrder?.avgPrice || exchangeOrder?.price || 0);
    await touchGridLegPositionOwnership(row, leg, {
      ownerState: "OPEN",
      sourceClientOrderId: clientOrderId,
      sourceOrderId: placement?.orderId || exchangeOrder?.orderId || null,
      note: "grid pair arm sibling failed after fill",
    });
    await applyGridPatch("live_grid_strategy_list", row.id, {
      regimeStatus: gridPairAtomicity.GRID_PAIR_STATE.ONE_LEG_FILLED,
      regimeEndReason: "PAIR_ARM_SIBLING_FAILED",
      [`${prefix}LegStatus`]: gridPairAtomicity.GRID_PAIR_LEG_STATUS.ONE_LEG_FILLED,
      [`${prefix}EntryOrderId`]: clientOrderId,
      [`${prefix}Qty`]: qty,
      [`${prefix}EntryPrice`]: entryPrice > 0 ? entryPrice : null,
    });
    const protectedOrClosed = await protectGridOpenLegOrClose({
      row: { ...row, regimeStatus: gridPairAtomicity.GRID_PAIR_STATE.ONE_LEG_FILLED },
      leg,
      qty,
      entryPrice,
      entryOrderId: clientOrderId,
      oneLegEmergency: true,
      failureLogCode: "PAIR_ONE_LEG_PROTECTION_MISSING_CLOSED",
      failureMessage: `leg:${leg}, clientOrderId:${clientOrderId}, qty:${qty}, entryPrice:${entryPrice}, sibling:failed`,
    });
    await appendGridRuntimeLog(
      row,
      "gridLiveArm",
      protectedOrClosed.protected
        ? "PAIR_ONE_LEG_PROTECTED"
        : protectedOrClosed.pending
          ? "PAIR_ONE_LEG_PROTECTION_INTENT_PENDING"
          : "PAIR_ONE_LEG_PROTECTION_CRITICAL",
      `leg:${leg}, clientOrderId:${clientOrderId}, qty:${qty}, sibling:failed, protected:${protectedOrClosed.protected ? "Y" : "N"}, pending:${protectedOrClosed.pending ? "Y" : "N"}`,
      leg
    );
    return {
      state: protectedOrClosed.protected
        ? gridProtectionGuarantee.GRID_PROTECTION_STATE.ONE_LEG_PROTECTED
        : protectedOrClosed.pending
          ? "PROTECTION_INTENT_PENDING"
        : gridProtectionGuarantee.GRID_PROTECTION_STATE.ONE_LEG_UNPROTECTED,
      cancelVerified: false,
      filled: true,
      protected: protectedOrClosed.protected,
      pending: Boolean(protectedOrClosed.pending),
    };
  }

  let cancelVerified = false;
  try {
    const rowWithOrder = {
      ...row,
      [`${prefix}EntryOrderId`]: clientOrderId,
    };
    const canceledCount = await cancelAllGridOrders("LIVE", rowWithOrder, {
      leg,
      includeEntries: true,
      includeExits: false,
    });
    cancelVerified = canceledCount > 0;
  } catch (error) {
    cancelVerified = false;
  }

  if (!cancelVerified) {
    const afterCancel = await findGridEntryOrderForLeg(row, leg, {
      orderId: placement?.orderId || null,
      clientOrderId,
    });
    cancelVerified = gridPairAtomicity.isOrderTerminalCanceled(afterCancel || {});
  }

  if (cancelVerified) {
    await releaseGridLegPositionOwnership(row, leg).catch(() => {});
    return {
      state: gridPairAtomicity.GRID_PAIR_STATE.FAILED,
      cancelVerified: true,
      filled: false,
    };
  }

  await applyGridPatch("live_grid_strategy_list", row.id, {
    regimeStatus: gridPairAtomicity.GRID_PAIR_STATE.ROLLBACK_PENDING,
    regimeEndReason: "PAIR_ARM_ROLLBACK_PENDING",
    [`${prefix}LegStatus`]: gridPairAtomicity.GRID_PAIR_LEG_STATUS.ROLLBACK_PENDING,
    [`${prefix}EntryOrderId`]: clientOrderId,
  });
  await appendGridRuntimeLog(
    row,
    "gridLiveArm",
    "PAIR_ROLLBACK_PENDING",
    `leg:${leg}, clientOrderId:${clientOrderId}, sibling:failed`,
    leg
  );
  return {
    state: gridPairAtomicity.GRID_PAIR_STATE.ROLLBACK_PENDING,
    cancelVerified: false,
    filled: false,
  };
};

const handleGridPairArmFailure = async (row, placements, reservedSlots, ownershipReservations) => {
  const successLegs = GRID_ENTRY_PAIR_LEGS.filter((leg) => placements[leg]?.ok);
  const failedLegs = GRID_ENTRY_PAIR_LEGS.filter((leg) => !placements[leg]?.ok);

  for (const leg of GRID_ENTRY_PAIR_LEGS) {
    if (reservedSlots[leg]) {
      await finalizeLiveGridEntrySlot(
        row,
        leg,
        reservedSlots[leg],
        placements[leg]?.ok ? placements[leg].clientOrderId : null
      ).catch(() => {});
    }
  }

  if (successLegs.length === 0) {
    await markGridPairArmFailed(
      row,
      "PAIR_ARM_BOTH_FAILED",
      `long:${placements.LONG?.errorCode || "FAIL"}, short:${placements.SHORT?.errorCode || "FAIL"}`
    );
    return true;
  }

  const rollbackResults = {};
  for (const leg of successLegs) {
    rollbackResults[leg] = await rollbackGridPairSuccessfulLeg(row, leg, placements[leg]);
  }

  for (const leg of failedLegs) {
    const prefix = getLegFieldPrefix(leg);
    await releaseGridLegPositionOwnership(row, leg).catch(() => {});
    await applyGridPatch("live_grid_strategy_list", row.id, {
      [`${prefix}LegStatus`]: gridPairAtomicity.GRID_PAIR_LEG_STATUS.FAILED,
      [`${prefix}EntryOrderId`]: null,
    });
  }

  const hasFilled = Object.values(rollbackResults).some((item) => item?.filled);
  const hasPendingRollback = Object.values(rollbackResults).some((item) => item?.state === gridPairAtomicity.GRID_PAIR_STATE.ROLLBACK_PENDING);
  if (!hasFilled && !hasPendingRollback) {
    await applyGridPatch("live_grid_strategy_list", row.id, {
      regimeStatus: gridPairAtomicity.GRID_PAIR_STATE.FAILED,
      regimeEndReason: "PAIR_ARM_ROLLBACK_CONFIRMED",
      ...Object.assign({}, ...successLegs.map((leg) => getPairEntryPatch(leg, {
        LegStatus: gridPairAtomicity.GRID_PAIR_LEG_STATUS.FAILED,
        EntryOrderId: null,
      }))),
    });
  }

  await appendGridRuntimeLog(
    row,
    "gridLiveArm",
    hasFilled ? "PAIR_ONE_LEG_FILLED" : hasPendingRollback ? "PAIR_ROLLBACK_PENDING" : "PAIR_ARM_FAILED",
    `success:${successLegs.join("+") || "NONE"}, failed:${failedLegs.join("+") || "NONE"}`
  );
  return true;
};

const recoverImmediateLiveArmFillsAfterPairAck = async (row, placements = {}) => {
  if (!row?.uid || !row?.id || !row?.symbol) {
    return { recoveredCount: 0, results: [] };
  }

  const coin = getCoin();
  const results = [];
  const maxAttempts = getLiveArmEntryFillRecoveryAttempts();
  const retryDelayMs = getLiveArmEntryFillRecoveryDelayMs();
  for (const leg of GRID_ENTRY_PAIR_LEGS) {
    const placement = placements[leg] || {};
    if (!placement?.ok || !placement?.clientOrderId) {
      continue;
    }

    let exchangeOrder = placement.exchangeOrder || null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        await sleep(retryDelayMs);
      }
      if (!gridPairAtomicity.isOrderFilledOrPartiallyFilled(exchangeOrder || {})) {
        exchangeOrder = await findGridEntryOrderForLeg(row, leg, {
          orderId: placement.orderId || exchangeOrder?.orderId || null,
          clientOrderId: placement.clientOrderId,
        });
      }
      if (gridPairAtomicity.isOrderFilledOrPartiallyFilled(exchangeOrder || {})) {
        break;
      }
      await appendGridRuntimeLog(
        row,
        "gridLiveArm",
        "GRID_LIVE_ARM_ENTRY_FILL_RECOVERY_WAITING",
        `leg:${leg}, clientOrderId:${placement.clientOrderId}, orderId:${placement.orderId || exchangeOrder?.orderId || "NONE"}, attempt:${attempt}/${maxAttempts}, status:${exchangeOrder?.status || "NOT_FOUND"}, bounded:${isBoundedLiveArmEntryFillRecoveryEnabled() ? "Y" : "N"}`,
        leg
      );
    }
    if (!gridPairAtomicity.isOrderFilledOrPartiallyFilled(exchangeOrder || {})) {
      results.push({
        leg,
        clientOrderId: placement.clientOrderId,
        recovered: false,
        reason: "ORDER_NOT_FILLED_AFTER_ACK",
        status: exchangeOrder?.status || null,
        attempts: maxAttempts,
      });
      continue;
    }

    const prefix = getLegFieldPrefix(leg);
    const rowWithEntry = {
      ...row,
      [`${prefix}EntryOrderId`]: placement.clientOrderId,
      regimeStatus: row.regimeStatus || "ACTIVE",
    };
    const execution = await coin.recoverGridEntryFillFromExchange({
      uid: row.uid,
      row: rowWithEntry,
      leg,
      candidateClientOrderIds: [placement.clientOrderId],
      requireCandidateClientOrderId: true,
      issue: {
        issues: [
          "GRID_LIVE_ARM_IMMEDIATE_FILL_RECOVERY",
          `status:${exchangeOrder?.status || "UNKNOWN"}`,
        ],
      },
    });
    const convergence = execution
      ? await applyGridEntryFillConvergence(
          rowWithEntry,
          leg,
          execution,
          {
            issues: [
              "GRID_LIVE_ARM_IMMEDIATE_FILL_RECOVERY",
              `status:${exchangeOrder?.status || "UNKNOWN"}`,
            ],
          },
          {
            source: isBoundedLiveArmEntryFillRecoveryEnabled() ? "BOUNDED_REST" : "IMMEDIATE_REST",
            eventType: "GRID_EXCHANGE_RECONCILED_ENTRY_FILL",
            note: "exchange-entry-reconcile",
          }
        )
      : null;
    const restored = Boolean(convergence?.converged);
    await appendGridRuntimeLog(
      row,
      "gridLiveArm",
      restored
        ? "GRID_LIVE_ARM_IMMEDIATE_FILL_RECOVERED"
        : "GRID_LIVE_ARM_IMMEDIATE_FILL_RECOVERY_FAILED",
      `leg:${leg}, clientOrderId:${placement.clientOrderId}, orderId:${placement.orderId || exchangeOrder?.orderId || "NONE"}, status:${exchangeOrder?.status || "UNKNOWN"}, restored:${restored ? "Y" : "N"}`,
      leg
    );
    results.push({
      leg,
      clientOrderId: placement.clientOrderId,
      orderId: placement.orderId || exchangeOrder?.orderId || null,
      status: exchangeOrder?.status || null,
      recovered: Boolean(execution),
      restored: Boolean(restored),
    });
  }

  return {
    recoveredCount: results.filter((item) => item.recovered).length,
    restoredCount: results.filter((item) => item.restored).length,
    results,
  };
};

const armInitialLiveEntryPair = async (row) => {
  const current = (await loadGridItem("LIVE", row.id)) || row;
  if (!isInitialGridEntryPairCandidate(current)) {
    return false;
  }

  const reservedSlots = {};
  const ownershipReservations = {};
  const placements = {};
  const requestedClientOrderIds = Object.fromEntries(
    GRID_ENTRY_PAIR_LEGS.map((leg) => [
      leg,
      gridPairAtomicity.buildGridPairClientOrderId(current, leg),
    ])
  );

  await applyGridPatch("live_grid_strategy_list", current.id, {
    regimeStatus: gridPairAtomicity.GRID_PAIR_STATE.PENDING,
    regimeEndReason: null,
  });

  try {
    for (const leg of GRID_ENTRY_PAIR_LEGS) {
      ownershipReservations[leg] = await acquireGridLegPositionOwnership(current, leg, {
        ownerState: "ENTRY_ARMED",
        sourceClientOrderId: requestedClientOrderIds[leg],
        note: "grid pair entry arm",
      });
      if (!ownershipReservations[leg]?.ok) {
        throw new Error(`PAIR_OWNERSHIP_FAILED:${leg}:${ownershipReservations[leg]?.reason || "UNKNOWN"}`);
      }
    }

    for (const leg of GRID_ENTRY_PAIR_LEGS) {
      reservedSlots[leg] = await reserveLiveGridEntrySlot(current, leg);
      if (!reservedSlots[leg]) {
        throw new Error(`PAIR_ENTRY_SLOT_BUSY:${leg}`);
      }
    }

    for (const leg of GRID_ENTRY_PAIR_LEGS) {
      const result = await placeLiveEntryOrderForLeg(current, leg, {
        clientOrderId: requestedClientOrderIds[leg],
      });
      placements[leg] = await resolveGridPairPlacementResult(
        current,
        leg,
        result,
        requestedClientOrderIds[leg]
      );
    }

    if (GRID_ENTRY_PAIR_LEGS.every((leg) => placements[leg]?.ok)) {
      for (const leg of GRID_ENTRY_PAIR_LEGS) {
        await finalizeLiveGridEntrySlot(current, leg, reservedSlots[leg], placements[leg].clientOrderId);
        await touchGridLegPositionOwnership(current, leg, {
          ownerState: "ENTRY_ARMED",
          sourceClientOrderId: placements[leg].clientOrderId,
          sourceOrderId: placements[leg].orderId || null,
          note: "grid pair entry order placed",
        });
      }
      await applyGridPatch("live_grid_strategy_list", current.id, {
        regimeStatus: "ACTIVE",
        regimeEndReason: null,
      });
      await appendGridRuntimeLog(
        current,
        "gridLiveArm",
        "ENTRY_PAIR_ARMED",
        `long:${placements.LONG.clientOrderId}, short:${placements.SHORT.clientOrderId}`
      );
      const armedRow = (await loadGridItem("LIVE", current.id)) || {
        ...current,
        longEntryOrderId: placements.LONG.clientOrderId,
        shortEntryOrderId: placements.SHORT.clientOrderId,
        regimeStatus: "ACTIVE",
      };
      const immediateRecovery = await recoverImmediateLiveArmFillsAfterPairAck(armedRow, placements);
      if (immediateRecovery.recoveredCount > 0) {
        await appendGridRuntimeLog(
          armedRow,
          "gridLiveArm",
          "GRID_LIVE_ARM_IMMEDIATE_FILL_RECOVERY_SUMMARY",
          `recovered:${immediateRecovery.recoveredCount}, restored:${immediateRecovery.restoredCount}`,
        );
      }
      return true;
    }

    return await handleGridPairArmFailure(current, placements, reservedSlots, ownershipReservations);
  } catch (error) {
    if (Object.values(placements).some((placement) => placement?.ok)) {
      await appendGridRuntimeLog(
        current,
        "gridLiveArm",
        "PAIR_ARM_EXCEPTION",
        `message:${error?.message || error}`
      );
      return await handleGridPairArmFailure(current, placements, reservedSlots, ownershipReservations);
    }

    for (const leg of GRID_ENTRY_PAIR_LEGS) {
      if (reservedSlots[leg]) {
        await finalizeLiveGridEntrySlot(current, leg, reservedSlots[leg], null).catch(() => {});
      }
      if (ownershipReservations[leg]?.ok) {
        await releaseGridLegPositionOwnership(current, leg).catch(() => {});
      }
    }
    await markGridPairArmFailed(
      current,
      "PAIR_ARM_SETUP_FAILED",
      `message:${error?.message || error}`
    );
    return true;
  }
};

const armMissingLiveEntries = async (row) => {
  if (!canArmEntriesForRow(row)) {
    return false;
  }

  if (isInitialGridEntryPairCandidate(row)) {
    return await armInitialLiveEntryPair(row);
  }

  if (isOneSidedEntryArmWithoutOppositeContext(row)) {
    return await markGridPairArmFailed(
      row,
      "PAIR_ARM_ONE_SIDED",
      "one-sided entry arm without opposite open/order context"
    );
  }

  let changed = false;
  let current = row;

  for (const leg of ["LONG", "SHORT"]) {
    const prefix = getLegFieldPrefix(leg);
    if (current[`${prefix}LegStatus`] !== "ENTRY_ARMED" || current[`${prefix}EntryOrderId`]) {
      continue;
    }
    let ownershipReservation = null;
    let reservedOrderId = null;

    try {
      ownershipReservation = await acquireGridLegPositionOwnership(current, leg, {
        ownerState: "ENTRY_ARMED",
        sourceClientOrderId: current[`${prefix}EntryOrderId`] || null,
        note: "grid entry arm",
      });
      if (!ownershipReservation.ok) {
        await appendGridRuntimeLog(
          current,
          "gridLiveArm",
          "POSITION_TRACKING_ERROR",
          `leg:${leg}, reservationFailed:${ownershipReservation.reason || "UNKNOWN"}`,
          leg
        );
        continue;
      }

      reservedOrderId = await reserveLiveGridEntrySlot(current, leg);
      if (!reservedOrderId) {
        await releaseGridLegPositionOwnership(current, leg);
        await appendGridRuntimeLog(
          current,
          "gridLiveArm",
          "ENTRY_SLOT_BUSY",
          `leg:${leg}, triggerPrice:${getGridLegTriggerPrice(current, leg)}`,
          leg
        );
        continue;
      }

      const order = await placeLiveEntryOrderForLeg(current, leg);
      if (!order?.clientOrderId) {
        await finalizeLiveGridEntrySlot(current, leg, reservedOrderId, null);
        await releaseGridLegPositionOwnership(current, leg);
        continue;
      }

      await finalizeLiveGridEntrySlot(current, leg, reservedOrderId, order.clientOrderId);
      await touchGridLegPositionOwnership(current, leg, {
        ownerState: "ENTRY_ARMED",
        sourceClientOrderId: order.clientOrderId,
        sourceOrderId: order.orderId || null,
        note: "grid entry order placed",
      });
      await appendGridRuntimeLog(
        current,
        "gridLiveArm",
        "ENTRY_ARMED",
        `leg:${leg}, triggerPrice:${current.triggerPrice}, orderId:${order.clientOrderId}`
      );
      current = { ...current, regimeStatus: "ACTIVE", [`${prefix}EntryOrderId`]: order.clientOrderId };
      changed = true;
    } catch (error) {
      if (reservedOrderId) {
        await finalizeLiveGridEntrySlot(current, leg, reservedOrderId, null).catch(() => {});
      }
      if (ownershipReservation?.ok) {
        await releaseGridLegPositionOwnership(current, leg).catch(() => {});
      }
      await appendGridRuntimeLog(
        current,
        "gridLiveArm",
        "ENTRY_ARM_FATAL",
        `leg:${leg}, triggerPrice:${getGridLegTriggerPrice(current, leg)}, message:${error?.message || error}`,
        leg
      );
    }
  }

  return changed;
};

const enqueueLiveGridArmIntentForRuntimeRow = async (row) => {
  if (!row?.uid || !row?.id || !row?.symbol) {
    return false;
  }

  const sideTriggerMetadata = getGridSideTriggerMetadata(row);
  const payload = {
    strategySignal: row.strategySignal || "SQZ+GRID",
    symbol: row.symbol,
    bunbong: row.bunbong || row.timeframe || null,
    supportPrice: row.supportPrice,
    resistancePrice: row.resistancePrice,
    triggerPrice: row.triggerPrice,
    longTriggerPrice: sideTriggerMetadata.longTriggerPrice,
    shortTriggerPrice: sideTriggerMetadata.shortTriggerPrice,
    triggerProfile: sideTriggerMetadata.triggerProfile,
    signalTime: row.regimeReceivedAt || row.signalTime || row.updatedAt || null,
  };
  const previewResult = {
    targetItems: [
      {
        uid: row.uid,
        pid: row.id,
        strategyCategory: "grid",
        strategyMode: "live",
        strategyName: row.a_name || null,
        strategySignal: row.strategySignal || payload.strategySignal,
        symbol: row.symbol,
        bunbong: row.bunbong || row.timeframe || null,
        resultCode: "GRID_ARM_PREVIEW",
        regimeStatus: row.regimeStatus || null,
      },
    ],
  };
  const summary = await orderIntentQueue.enqueueGridLiveArmIntents({
    payload,
    previewResult,
    routePath: "grid-runtime-live-cycle",
  });
  await appendGridRuntimeLog(
    row,
    "gridArmQueue",
    summary.inserted ? "GRID_ARM_INTENT_ENQUEUED" : "GRID_ARM_INTENT_DUPLICATE",
    `intent:${summary.intents?.[0]?.intentKey || "NONE"}, duplicate:${summary.duplicate || 0}`
  );
  return summary.inserted > 0 || summary.duplicate > 0;
};

const protectExistingOneLegEmergency = async (row) => {
  let handled = false;
  for (const leg of GRID_ENTRY_PAIR_LEGS) {
    const prefix = getLegFieldPrefix(leg);
    const qty = toNumber(row?.[`${prefix}Qty`]);
    const entryPrice = toNumber(row?.[`${prefix}EntryPrice`]);
    const entryOrderId = row?.[`${prefix}EntryOrderId`] || null;
    if (!(qty > 0) || !(entryPrice > 0) || !entryOrderId) {
      continue;
    }

    if (row?.[`${prefix}ExitOrderId`] && row?.[`${prefix}StopOrderId`]) {
      continue;
    }

    await protectGridOpenLegOrClose({
      row,
      leg,
      qty,
      entryPrice,
      entryOrderId,
      oneLegEmergency: true,
      failureLogCode: "PAIR_ONE_LEG_PROTECTION_MISSING_CLOSED",
      failureMessage: `leg:${leg}, clientOrderId:${entryOrderId}, qty:${qty}, entryPrice:${entryPrice}, reason:existing-one-leg-emergency`,
    });
    handled = true;
  }

  return handled;
};

const handleGridBoundaryReset = async (mode, row, reason, message) => {
  if (mode === "LIVE") {
    await cancelAllGridOrders(mode, row, {
      reason,
      targetType: "REGIME_CLEANUP",
    });
    await applyGridPatch(getTableName(mode), row.id, {
      regimeStatus: GRID_CANCEL_CLOSE_STATE.CANCEL_INTENT_PENDING,
      regimeEndReason: reason,
    });
    await appendGridRuntimeLog(row, "gridReset", `${reason}_CANCEL_QUEUED`, message);
    return;
  }
  await cancelAllGridOrders(mode, row);
  await applyGridPatch(getTableName(mode), row.id, buildResetRegimePatch(reason));
  await appendGridRuntimeLog(row, "gridReset", reason, message);
};

const markGridRegimeEnded = async (mode, row, reason, message) => {
  await cancelAllGridOrders(mode, row, {
    includeEntries: true,
    includeExits: false,
  });
  await applyGridPatch(getTableName(mode), row.id, buildEndedRegimePatch(row, reason));
  if (mode === "LIVE") {
    for (const leg of ["LONG", "SHORT"]) {
      if (!hasOpenLeg(row, leg)) {
        await releaseGridLegPositionOwnership(row, leg);
      }
    }
  }
  await appendGridRuntimeLog(row, "gridEnded", reason, message);
};

const finalizeEndedGridRegimeIfIdle = async (mode, row, reason = "BOX_BREAK") => {
  let refreshed = (await loadGridItem(mode, row.id)) || row;
  if (mode === "LIVE") {
    await pidPositionLedger.syncGridLegSnapshot(row.id, "LONG");
    await pidPositionLedger.syncGridLegSnapshot(row.id, "SHORT");
    refreshed = (await loadGridItem(mode, row.id)) || refreshed;
    const hasOpenQty = await hasLiveGridOpenSnapshotQty(refreshed);
    const hasActiveReservations = await hasLiveGridActiveReservations(refreshed);
    if (
      hasOpenQty
      || hasAnyEntryArmed(refreshed)
      || gridPairAtomicity.hasAnyGridEntryOrderRef(refreshed)
      || hasActiveReservations
    ) {
      return false;
    }
  } else if (hasOpenPosition(refreshed) || hasAnyEntryArmed(refreshed)) {
    return false;
  }

  await applyGridPatch(getTableName(mode), row.id, buildResetRegimePatch(reason));
  if (mode === "LIVE") {
    await releaseAllGridPositionOwnership(refreshed);
  }
  await appendGridRuntimeLog(
    refreshed,
    "gridFinalize",
    reason,
    `mode:${mode}, regime reset after all legs became idle`
  );
  return true;
};

const syncLiveGridLegAfterRecoveredExitFill = async (
  row,
  leg,
  recoveredExecution,
  reason = "TRUTH_SYNC"
) => {
  if (!row?.id || !row?.uid || !leg || !recoveredExecution) {
    return {
      row: row || null,
      closed: false,
    };
  }

  await pidPositionLedger.syncGridLegSnapshot(row.id, leg);
  const refreshed = (await loadGridItem("LIVE", row.id)) || row;
  const synced = await syncLiveGridRowFromPidState(refreshed, {
    regimeStatus: refreshed.regimeStatus || null,
    regimeEndReason:
      refreshed.regimeEndReason === undefined
        ? undefined
        : refreshed.regimeEndReason || reason,
    clearOpenLegOrderRefs: false,
  });
  const latest = (await loadGridItem("LIVE", row.id)) || synced || refreshed;
  await finalizeEndedGridRegimeIfIdle(
    "LIVE",
    latest,
    latest?.regimeEndReason || reason
  );

  const finalRow = (await loadGridItem("LIVE", row.id)) || latest;
  const snapshotState = await loadLiveGridLegSnapshotState(finalRow, leg);
  return {
    row: finalRow,
    closed: !(toNumber(snapshotState?.qty) > 0),
  };
};

const suspendGridStrategy = async (mode, row, reason = "POLICY_AUTO_OFF_USER") => {
  const tableName = getTableName(mode);
  if (!tableName || !row?.id) {
    return false;
  }

  if (mode === "LIVE") {
    await cancelAllGridOrders("LIVE", row, {
      includeEntries: true,
      includeExits: false,
      reason,
      targetType: "REGIME_CLEANUP",
    });
    await applyGridPatch(tableName, row.id, {
      regimeStatus: GRID_CANCEL_CLOSE_STATE.CANCEL_INTENT_PENDING,
      regimeEndReason: reason,
    });
    await appendGridRuntimeLog(
      row,
      "gridControl",
      `${reason}_CANCEL_QUEUED`,
      `mode:${mode}, strategy suspended by policy auto-off; cleanup intents queued`
    );
    return true;
  }

  const refreshed = (await loadGridItem(mode, row.id)) || row;
  const hasLiveOpenExposure = hasOpenPosition(refreshed);
  const patch = hasLiveOpenExposure
    ? {
        regimeStatus: "ENDED",
        regimeEndReason: reason,
        ...(hasOpenLeg(refreshed, "LONG")
          ? { longEntryOrderId: null }
          : getLegPatchForReset("LONG")),
        ...(hasOpenLeg(refreshed, "SHORT")
          ? { shortEntryOrderId: null }
          : getLegPatchForReset("SHORT")),
      }
    : {
        ...buildResetRegimePatch(reason),
      };

  await applyGridPatch(tableName, row.id, patch);
  await appendGridRuntimeLog(
    refreshed,
    "gridControl",
    reason,
    `mode:${mode}, strategy suspended by policy auto-off`
  );
  return true;
};

const deactivateGridStrategy = async (mode, row, reason = "MANUAL_OFF") => {
  const tableName = getTableName(mode);
  if (!tableName || !row?.id) {
    return false;
  }

  if (mode === "LIVE") {
    await cancelAllGridOrders("LIVE", row, {
      includeEntries: true,
      includeExits: false,
      reason,
      targetType: "REGIME_CLEANUP",
    });
    const baseline = await syncLiveGridRowFromPidState(row, {
      regimeStatus: GRID_CANCEL_CLOSE_STATE.CANCEL_INTENT_PENDING,
      regimeEndReason: reason,
      clearOpenLegOrderRefs: false,
    });

    for (const leg of ["LONG", "SHORT"]) {
      const snapshotState = await loadLiveGridLegSnapshotState(baseline || row, leg);
      const qty = toNumber(snapshotState?.qty);
      if (!(qty > 0)) {
        continue;
      }

      await enqueueLiveGridCloseIntent(row, leg, qty, reason, {
        routePath: "grid-manual-off",
      });
    }
    const refreshed = (await loadGridItem("LIVE", row.id)) || baseline || row;
    const synced = await syncLiveGridRowFromPidState(refreshed, {
      regimeStatus: GRID_CANCEL_CLOSE_STATE.GMANUAL_QUEUED,
      regimeEndReason: reason,
      clearOpenLegOrderRefs: false,
    });
    await appendGridRuntimeLog(
      synced || refreshed,
      "gridControl",
      `${reason}_QUEUED`,
      `mode:${mode}, strategy manually turned off; cleanup intents queued`
    );
    return true;
  }

  await applyGridPatch(tableName, row.id, {
    ...buildResetRegimePatch(reason),
  });
  await appendGridRuntimeLog(row, "gridControl", reason, `mode:${mode}, strategy manually turned off`);
  return true;
};

const handleTestLegOpen = async (row, leg, price) => {
  const qty = computeGridEntryQty(row, price);
  if (!(qty > 0)) {
    return false;
  }

  const takeProfitPrice = computeLegTakeProfitPrice(row, leg, price);
  const stopPrice = computeLegStopPrice(row, leg);
  await applyGridPatch("test_grid_strategy_list", row.id, {
    ...buildOpenLegPatch({
      leg,
      entryOrderId: buildGridClientOrderId("GENTRY", leg, row.uid, row.id),
      entryPrice: price,
      qty,
      takeProfitPrice,
      stopPrice,
      takeProfitOrderId: buildGridClientOrderId("GTP", leg, row.uid, row.id),
      stopOrderId: buildGridClientOrderId("GSTOP", leg, row.uid, row.id),
    }),
  });

  await appendGridRuntimeLog(
    row,
    "gridTestOpen",
    "ENTRY_FILLED",
    `leg:${leg}, entryPrice:${price}, qty:${qty}, tp:${takeProfitPrice}, stop:${stopPrice}`,
    leg
  );
  return true;
};

const handleTestLegTakeProfit = async (row, leg, price) => {
  const shouldRearm = canArmEntriesForRow(row);
  await applyGridPatch("test_grid_strategy_list", row.id, shouldRearm
    ? {
        ...getLegPatchForEntryArmed(leg, buildGridClientOrderId("GENTRY", leg, row.uid, row.id)),
        regimeStatus: "ACTIVE",
        regimeEndReason: null,
      }
    : {
        ...getLegPatchForClosed(leg),
        regimeStatus: "ENDED",
      });

  await appendGridRuntimeLog(
    row,
    "gridTestExit",
    "TAKE_PROFIT",
    `leg:${leg}, exitPrice:${price}, trigger:${row[`${getLegFieldPrefix(leg)}TakeProfitPrice`]}, rearm:${shouldRearm ? "Y" : "N"}`,
    leg
  );
};

const handleTestLegStop = async (row, leg, price) => {
  await applyGridPatch("test_grid_strategy_list", row.id, {
    ...buildEndedRegimePatch(row, "BOX_BREAK"),
    ...getLegPatchForClosed(leg),
  });
  await appendGridRuntimeLog(
    row,
    "gridTestStop",
    "BOX_BREAK",
    `leg:${leg}, stopPrice:${row[`${getLegFieldPrefix(leg)}StopPrice`]}, exitPrice:${price}`,
    leg
  );
  await finalizeEndedGridRegimeIfIdle("TEST", row, "BOX_BREAK");
};

const runTestCycleForItem = async (row) => {
  const price = dt.getPrice(row.symbol);
  const priceDecision = gridPriceSource.requireFreshGridQuote(price);
  if (!priceDecision.usable) {
    return;
  }

  if (isBoundaryBreakWithoutOpenPosition(row, price)) {
    await handleGridBoundaryReset(
      "TEST",
      row,
      "BOX_BREAK_WAITING",
      `support:${row.supportPrice}, resistance:${row.resistancePrice}, bestBid:${price.bestBid}, bestAsk:${price.bestAsk}`
    );
    return;
  }

  if (isBoundaryBreak(row, price) && hasOpenPosition(row) && row.regimeStatus !== "ENDED") {
    await markGridRegimeEnded(
      "TEST",
      row,
      "BOX_BREAK",
      `support:${row.supportPrice}, resistance:${row.resistancePrice}, bestBid:${price.bestBid}, bestAsk:${price.bestAsk}`
    );
    row = (await loadGridItem("TEST", row.id)) || row;
  }

  for (const leg of ["LONG", "SHORT"]) {
    const prefix = getLegFieldPrefix(leg);
    if (row[`${prefix}LegStatus`] !== "OPEN") {
      continue;
    }

    if (isLegStopTriggered(leg, row, price)) {
      await handleTestLegStop(row, leg, getExitFillPriceFromTicker(leg, "stop-loss", price));
      return;
    }

    if (isLegTakeProfitTriggered(leg, row, price)) {
      await handleTestLegTakeProfit(row, leg, getExitFillPriceFromTicker(leg, "take-profit", price));
      row = (await loadGridItem("TEST", row.id)) || row;
    }
  }

  row = (await loadGridItem("TEST", row.id)) || row;
  if (row.regimeStatus === "ENDED") {
    await finalizeEndedGridRegimeIfIdle("TEST", row, row.regimeEndReason || "BOX_BREAK");
    return;
  }

  for (const leg of ["LONG", "SHORT"]) {
    const prefix = getLegFieldPrefix(leg);
    if (row[`${prefix}LegStatus`] !== "ENTRY_ARMED") {
      continue;
    }

    if (!isLegEntryTriggered(leg, row, price)) {
      continue;
    }

    const filled = await handleTestLegOpen(row, leg, getEntryFillPriceFromTicker(leg, price));
    if (filled) {
      row = (await loadGridItem("TEST", row.id)) || row;
    }
  }
};

const runLiveCycleForItem = async (row) => {
  const price = await loadFreshGridDecisionPrice(row.symbol);
  const priceDecision = gridPriceSource.requireFreshGridQuote(price);
  if (!priceDecision.usable) {
    return;
  }

  if (row.regimeStatus === gridPairAtomicity.GRID_PAIR_STATE.ONE_LEG_FILLED) {
    await protectExistingOneLegEmergency(row);
    return;
  }

  if (gridPairAtomicity.isPairArmDefectState(row) || gridProtectionGuarantee.isProtectionCriticalState(row)) {
    return;
  }

  await armMissingLiveExits(row);
  row = (await loadGridItem("LIVE", row.id)) || row;

  if (isBoundaryBreakWithoutOpenPosition(row, price)) {
    await handleGridBoundaryReset(
      "LIVE",
      row,
      "BOX_BREAK_WAITING",
      `support:${row.supportPrice}, resistance:${row.resistancePrice}, bestBid:${price.bestBid}, bestAsk:${price.bestAsk}`
    );
    return;
  }

  if (isBoundaryBreak(row, price) && hasOpenPosition(row) && row.regimeStatus !== "ENDED") {
    await markGridRegimeEnded(
      "LIVE",
      row,
      "BOX_BREAK",
      `support:${row.supportPrice}, resistance:${row.resistancePrice}, bestBid:${price.bestBid}, bestAsk:${price.bestAsk}`
    );
    return;
  }

  if (row.regimeStatus === "ENDED") {
    const exchangeSnapshotCache = new Map();
    for (const leg of ["LONG", "SHORT"]) {
      const prefix = getLegFieldPrefix(leg);
      if (row[`${prefix}LegStatus`] !== "OPEN" && !(toNumber(row[`${prefix}Qty`]) > 0)) {
        continue;
      }

      const exchangeFlatHandled = await handleEndedLiveGridLegExchangeFlatBeforeClose(
        row,
        leg,
        "gridEnded",
        "ENDED_EXCHANGE_FLAT_BEFORE_CLOSE",
        `regime already ended:${row.regimeEndReason || "BOX_BREAK"}`,
        row.regimeEndReason || "BOX_BREAK",
        exchangeSnapshotCache
      );
      if (exchangeFlatHandled) {
        row = (await loadGridItem("LIVE", row.id)) || row;
        continue;
      }

      await emergencyCloseLiveGridLeg(
        row,
        leg,
        toNumber(row[`${prefix}Qty`]),
        "ENDED_STALE_POSITION_CLOSED",
        `regime already ended:${row.regimeEndReason || "BOX_BREAK"}`
      );
      row = (await loadGridItem("LIVE", row.id)) || row;
    }

    await finalizeEndedGridRegimeIfIdle("LIVE", row, row.regimeEndReason || "BOX_BREAK");
    return;
  }

  await withLiveGridArmLock(row.id, async () => {
    const refreshed = (await loadGridItem("LIVE", row.id)) || row;
    if (refreshed.regimeStatus === "ENDED") {
      return false;
    }

    if (!canArmInitialLiveEntriesForRow(refreshed)) {
      return false;
    }
    return await enqueueLiveGridArmIntentForRuntimeRow(refreshed);
  });
};

const runMode = async (mode) => {
  if (RUN_LOCK[mode]) {
    return;
  }

  RUN_LOCK[mode] = true;
  try {
    const rows = await loadRunnableGridItems(mode);
    for (const row of rows) {
      if (mode === "LIVE") {
        await runLiveCycleForItem(row);
      } else {
        await runTestCycleForItem(row);
      }
    }
  } catch (error) {
    console.log(`[gridEngine:${mode}]`, error);
  } finally {
    RUN_LOCK[mode] = false;
  }
};

const primeLiveEntriesForTargetItems = async (targetItems = []) => {
  const items = Array.isArray(targetItems) ? targetItems : [];
  let primed = 0;

  for (const item of items) {
    if (!item || item.strategyCategory !== "grid" || item.strategyMode !== "live") {
      continue;
    }

    const pid = Number(item.pid || 0);
    if (!pid) {
      continue;
    }

    await withLiveGridArmLock(pid, async () => {
      const row = await loadGridItem("LIVE", pid);
      if (!row || row.uid !== Number(item.uid || 0)) {
        return false;
      }

      const plan = buildLiveGridArmPairPrimingPlan({ row, targetItem: item });
      if (!plan.ok) {
        await appendGridRuntimeLog(
          row,
          "gridLiveArm",
          plan.reason || "PAIR_PRIMING_PLAN_BLOCKED",
          `pid:${pid}, reason:${plan.reason || "UNKNOWN"}`
        );
        return false;
      }

      const primingRow = await applyLiveGridArmPairPrimingPatch(row, item, plan);
      if (!primingRow) {
        await appendGridRuntimeLog(
          row,
          "gridLiveArm",
          "GRID_LIVE_ARM_PAIR_PRIMING_PATCH_CONFLICT",
          `pid:${pid}, status:${row.regimeStatus || "UNKNOWN"}`
        );
        return false;
      }

      const changed = await armMissingLiveEntries(primingRow);
      if (changed) {
        primed += Number(plan.legs?.length || 1);
      }
      return changed;
    });
  }

  return primed;
};

const handleLiveGridEntryFill = async (parsed, reData) => {
  return await withQueuedLiveGridEventLock("ENTRY", parsed.clientOrderId, async () => {
    return await withGridRuntimeTraceScope("GRID_ENTRY_FILL_HANDLER", parsed, reData, async ({ setOutcome }) => {
    const handlerEnteredAt = Date.now();
    logGridRuntimeTrace("GRID_PRIVATE_SOCKET_GRID_HANDLER_ENTER", {
      ...buildGridRuntimeTracePayload("GRID_ENTRY_FILL_HANDLER", parsed, reData),
      ...buildPrivateSocketLatencyPayload(reData),
    });
    const row = await loadGridItem("LIVE", parsed.pid);
    if (!row || row.uid !== parsed.uid) {
      logGridRuntimeTrace("GRID_PRIVATE_SOCKET_GRID_HANDLER_SKIP", {
        ...buildGridRuntimeTracePayload("GRID_ENTRY_FILL_HANDLER", parsed, reData),
        reason: "ROW_NOT_FOUND",
        ...buildPrivateSocketLatencyPayload(reData),
      });
      setOutcome("ROW_NOT_FOUND");
      return false;
    }

    const prefix = getLegFieldPrefix(parsed.leg);
    const existingLegQty = toNumber(row?.[`${prefix}Qty`]);
    const reportedQty = toNumber(reData.z);
    const entryFillQty = toNumber(reData.l || reData.z);
    const entryFillPrice = toNumber(reData.L || reData.ap || reData.p);
    const hasExistingExits = Boolean(row?.[`${prefix}ExitOrderId`] || row?.[`${prefix}StopOrderId`]);
    if (
      row?.[`${prefix}LegStatus`] === "OPEN"
      && row?.[`${prefix}EntryOrderId`] === parsed.clientOrderId
      && existingLegQty >= reportedQty
      && hasExistingExits
    ) {
      await appendGridRuntimeLog(
        row,
        "gridLiveOpen",
        "ENTRY_FILLED_SKIP",
        `leg:${parsed.leg}, entryOrderId:${parsed.clientOrderId}, reason:already-open-with-exits`,
        parsed.leg
      );
      logGridRuntimeTrace("GRID_PRIVATE_SOCKET_GRID_HANDLER_SKIP", {
        ...buildGridRuntimeTracePayload("GRID_ENTRY_FILL_HANDLER", parsed, reData),
        reason: "ENTRY_SKIP_ALREADY_OPEN_WITH_EXITS",
        existingLegQty,
        reportedQty,
        ...buildPrivateSocketLatencyPayload(reData),
      });
      setOutcome("ENTRY_SKIP_ALREADY_OPEN_WITH_EXITS");
      return true;
    }

    if (!(entryFillQty > 0) || !(entryFillPrice > 0)) {
      logGridRuntimeTrace("GRID_PRIVATE_SOCKET_GRID_HANDLER_SKIP", {
        ...buildGridRuntimeTracePayload("GRID_ENTRY_FILL_HANDLER", parsed, reData),
        reason: "ENTRY_INVALID_FILL",
        entryFillQty,
        entryFillPrice,
        ...buildPrivateSocketLatencyPayload(reData),
      });
      setOutcome("ENTRY_INVALID_FILL");
      return true;
    }

    const convergence = await applyGridEntryFillConvergence(
      row,
      parsed.leg,
      {
        clientOrderId: parsed.clientOrderId,
        orderId: reData.i || null,
        tradeId: reData.t || null,
        qty: entryFillQty,
        price: entryFillPrice,
        fee: reData.n,
        tradeTime: reData.T || null,
      },
      {
        issues: ["SOCKET_ORDER_TRADE_UPDATE"],
      },
      {
        source: "SOCKET",
        eventType: "GRID_ENTRY_FILL",
        note: `grid-entry:${reData.X || "FILLED"}`,
        routePath: "grid-runtime-entry-fill",
        fillEvidence: {
          eventType: reData.x || null,
          endStatus: reData.X || null,
          lastFillQty: reData.l || null,
          cumulativeFillQty: reData.z || null,
          tradeTime: reData.T || null,
        },
        failureLogCode: "ENTRY_PROTECTION_MISSING_CLOSED",
        failureMessage: `leg:${parsed.leg}, entryOrderId:${parsed.clientOrderId}, qty:${entryFillQty}, entryPrice:${entryFillPrice}`,
      }
    );
    logGridRuntimeTrace("GRID_PRIVATE_SOCKET_GRID_HANDLER_APPLIED", {
      ...buildGridRuntimeTracePayload("GRID_ENTRY_FILL_HANDLER", parsed, reData),
      converged: Boolean(convergence.converged),
      entryFillQty,
      entryFillPrice,
      ...buildPrivateSocketLatencyPayload(reData),
      socketConvergenceLatencyMs: Date.now() - handlerEnteredAt,
    });
    logGridRuntimeTrace("GRID_FILL_TO_PROTECTION_LATENCY", {
      uid: row.uid,
      pid: row.id,
      symbol: row.symbol,
      leg: parsed.leg,
      clientOrderId: parsed.clientOrderId,
      orderId: reData.i || null,
      tradeTime: reData.T || null,
      source: "SOCKET",
      converged: Boolean(convergence.converged),
      fillToProtectionLatencyMs: Date.now() - handlerEnteredAt,
      socketIngressLatencyMs: buildPrivateSocketLatencyPayload(reData).socketIngressLatencyMs,
      socketHandlerLatencyMs: buildPrivateSocketLatencyPayload(reData).socketHandlerLatencyMs,
    });
    setOutcome(convergence.converged ? "ENTRY_FILL_CONVERGED" : "ENTRY_FILL_CONVERGENCE_FAILED");
    return convergence.converged;
    });
  });
};

const handleLiveGridTakeProfitFill = async (parsed, reData) => {
  return await withQueuedLiveGridEventLock("TP", parsed.clientOrderId, async () => {
  return await withGridRuntimeTraceScope("GRID_TP_FILL_HANDLER", parsed, reData, async ({ setOutcome }) => {
  const row = await loadGridItem("LIVE", parsed.pid);
  if (!row || row.uid !== parsed.uid) {
    setOutcome("ROW_NOT_FOUND");
    return false;
  }

  await pidPositionLedger.applyExitFill({
    uid: row.uid,
    pid: row.id,
    strategyCategory: "grid",
    symbol: row.symbol,
    positionSide: parsed.leg,
    sourceClientOrderId: parsed.clientOrderId,
    sourceOrderId: reData.i || null,
    sourceTradeId: reData.t || null,
    fillQty: toNumber(reData.l || reData.z),
    fillPrice: toNumber(reData.L || reData.ap || reData.p),
    fee: reData.n,
    realizedPnl: reData.rp,
    tradeTime: reData.T || null,
    eventType: "GRID_TP_FILL",
    note: `grid-tp:${reData.X || "FILLED"}`,
  });
  const snapshot = await pidPositionLedger.loadSnapshot({
    uid: row.uid,
    pid: row.id,
    strategyCategory: "grid",
    positionSide: parsed.leg,
  });
  const remainingQty = toNumber(snapshot?.openQty);
  const remainingEntryPrice = toNumber(snapshot?.avgEntryPrice);
  await pidPositionLedger.syncGridLegSnapshot(row.id, parsed.leg);

  if (reData.X === "PARTIALLY_FILLED" && remainingQty > 0) {
    const protectionBeforeCleanup = await loadLiveGridLegProtectionState(row, parsed.leg);
    await cancelAllGridOrders("LIVE", row, buildSiblingProtectionCancelOptions({
      leg: parsed.leg,
      filledClientOrderId: parsed.clientOrderId,
      activeReservations: protectionBeforeCleanup.activeReservations,
      reason: "GRID_TP_SIBLING_PROTECTION_CLEANUP",
    }));
    const protection = await protectGridOpenLegOrClose({
      row,
      leg: parsed.leg,
      qty: remainingQty,
      entryPrice: remainingEntryPrice,
      entryOrderId: row[`${getLegFieldPrefix(parsed.leg)}EntryOrderId`] || null,
      sourceOrderId: reData.i || null,
      sourceTradeId: reData.t || null,
      routePath: "grid-tp-partial-reprotect",
      failureLogCode: "TAKE_PROFIT_PARTIAL_REPROTECT_FAILED_CLOSED",
      failureMessage: `leg:${parsed.leg}, remainingQty:${remainingQty}, reason:tp-partial-reprotect`,
    });
    if (protection.pending) {
      await appendGridRuntimeLog(
        row,
        "gridLiveExit",
        "TAKE_PROFIT_PARTIAL_REPROTECT_INTENT_PENDING",
        `leg:${parsed.leg}, remainingQty:${remainingQty}, exitPrice:${toNumber(reData.L || reData.ap)}, intent:${protection.intentSummary?.intent?.intentKey || "NONE"}`,
        parsed.leg
      );
      setOutcome("TP_PARTIAL_REPROTECT_INTENT_PENDING");
      return true;
    }
    if (!protection.protected) {
      setOutcome(protection.outcome.partial ? "TP_PARTIAL_REPROTECT_PARTIAL_CRITICAL" : "TP_PARTIAL_REPROTECT_FAILED");
      return protection.closed;
    }
    const exits = protection.exits;
    await applyGridPatch("live_grid_strategy_list", row.id, {
      ...buildOpenLegPatch({
        leg: parsed.leg,
        entryOrderId: row[`${getLegFieldPrefix(parsed.leg)}EntryOrderId`],
        entryPrice: remainingEntryPrice,
        qty: remainingQty,
        takeProfitPrice: exits.takeProfitPrice,
        stopPrice: exits.stopPrice,
        takeProfitOrderId: exits.takeProfitOrderId,
        stopOrderId: exits.stopOrderId,
        regimeStatus: row.regimeStatus,
        regimeEndReason: row.regimeEndReason || null,
      }),
    });
    await appendGridRuntimeLog(
      row,
      "gridLiveExit",
      "TAKE_PROFIT_PARTIAL",
      `leg:${parsed.leg}, remainingQty:${remainingQty}, exitPrice:${toNumber(reData.L || reData.ap)}`,
      parsed.leg
    );
    setOutcome("TP_PARTIAL");
    return true;
  }

  await cancelAllGridOrders("LIVE", row, {
    includeEntries: true,
    includeExits: false,
  });
  const protectionBeforeCleanup = await loadLiveGridLegProtectionState(row, parsed.leg);
  await cancelAllGridOrders("LIVE", row, buildSiblingProtectionCancelOptions({
    leg: parsed.leg,
    filledClientOrderId: parsed.clientOrderId,
    activeReservations: protectionBeforeCleanup.activeReservations,
    reason: "GRID_TP_SIBLING_PROTECTION_CLEANUP",
  }));

  if (remainingQty > 0) {
    const protection = await protectGridOpenLegOrClose({
      row,
      leg: parsed.leg,
      qty: remainingQty,
      entryPrice: remainingEntryPrice,
      entryOrderId: row[`${getLegFieldPrefix(parsed.leg)}EntryOrderId`] || null,
      sourceOrderId: reData.i || null,
      sourceTradeId: reData.t || null,
      routePath: "grid-tp-remaining-reprotect",
      failureLogCode: "TAKE_PROFIT_REMAINING_REPROTECT_FAILED_CLOSED",
      failureMessage: `leg:${parsed.leg}, remainingQty:${remainingQty}, reason:tp-remaining-reprotect`,
    });
    if (protection.pending) {
      await appendGridRuntimeLog(
        row,
        "gridLiveExit",
        "TAKE_PROFIT_REMAINING_REPROTECT_INTENT_PENDING",
        `leg:${parsed.leg}, remainingQty:${remainingQty}, exitPrice:${toNumber(reData.ap || reData.L)}, intent:${protection.intentSummary?.intent?.intentKey || "NONE"}`,
        parsed.leg
      );
      setOutcome("TP_REMAINING_REPROTECT_INTENT_PENDING");
      return true;
    }
    if (!protection.protected) {
      setOutcome(protection.outcome.partial ? "TP_REMAINING_REPROTECT_PARTIAL_CRITICAL" : "TP_REMAINING_REPROTECT_FAILED");
      return protection.closed;
    }
    const exits = protection.exits;
    await applyGridPatch("live_grid_strategy_list", row.id, {
      ...buildOpenLegPatch({
        leg: parsed.leg,
        entryOrderId: row[`${getLegFieldPrefix(parsed.leg)}EntryOrderId`],
        entryPrice: remainingEntryPrice,
        qty: remainingQty,
        takeProfitPrice: exits.takeProfitPrice,
        stopPrice: exits.stopPrice,
        takeProfitOrderId: exits.takeProfitOrderId,
        stopOrderId: exits.stopOrderId,
        regimeStatus: row.regimeStatus,
        regimeEndReason: row.regimeEndReason || null,
      }),
    });
    await appendGridRuntimeLog(
      row,
      "gridLiveExit",
      "TAKE_PROFIT_REMAINING_OPEN",
      `leg:${parsed.leg}, remainingQty:${remainingQty}, exitPrice:${toNumber(reData.ap || reData.L)}`,
      parsed.leg
    );
    setOutcome("TP_REMAINING_OPEN");
    return true;
  }

  const shouldRearm = canArmEntriesForRow(row);
  if (shouldRearm) {
    const reentry = await enqueueLiveReentryIntentAfterTakeProfit(row, parsed, reData);
    await appendGridRuntimeLog(
      row,
      "gridLiveExit",
      reentry.pending ? "TAKE_PROFIT_REENTRY_INTENT_PENDING" : reentry.reason,
      `leg:${parsed.leg}, exitPrice:${toNumber(reData.ap || reData.L)}, reentry:${reentry.clientOrderId || "NONE"}, state:${reentry.state || "UNKNOWN"}, intent:${reentry.intentSummary?.intent?.intentKey || "NONE"}`,
      parsed.leg
    );
    setOutcome(reentry.pending ? "TP_REENTRY_INTENT_PENDING" : reentry.reason);
    return true;
  }

  await applyGridPatch("live_grid_strategy_list", row.id, {
    ...getLegPatchForClosed(parsed.leg),
    regimeStatus: "ENDED",
    regimeEndReason: row.regimeEndReason || "BOX_BREAK",
  });
  await releaseGridLegPositionOwnership(row, parsed.leg);
  await appendGridRuntimeLog(
    row,
    "gridLiveExit",
    "TAKE_PROFIT",
    `leg:${parsed.leg}, exitPrice:${toNumber(reData.ap || reData.L)}, reentry:NONE, rearm:N`,
    parsed.leg
  );
  await finalizeEndedGridRegimeIfIdle("LIVE", row, row.regimeEndReason || "BOX_BREAK");
  setOutcome("TP_FILLED");
  return true;
  });
  });
};

const handleLiveGridStopFill = async (parsed, reData) => {
  return await withQueuedLiveGridEventLock("STOP", parsed.clientOrderId, async () => {
  return await withGridRuntimeTraceScope("GRID_STOP_FILL_HANDLER", parsed, reData, async ({ setOutcome }) => {
  const row = await loadGridItem("LIVE", parsed.pid);
  if (!row || row.uid !== parsed.uid) {
    setOutcome("ROW_NOT_FOUND");
    return false;
  }

  await pidPositionLedger.applyExitFill({
    uid: row.uid,
    pid: row.id,
    strategyCategory: "grid",
    symbol: row.symbol,
    positionSide: parsed.leg,
    sourceClientOrderId: parsed.clientOrderId,
    sourceOrderId: reData.i || null,
    sourceTradeId: reData.t || null,
    fillQty: toNumber(reData.l || reData.z),
    fillPrice: toNumber(reData.L || reData.ap || reData.p),
    fee: reData.n,
    realizedPnl: reData.rp,
    tradeTime: reData.T || null,
    eventType: "GRID_STOP_FILL",
    note: `grid-stop:${reData.X || "FILLED"}`,
  });
  const snapshot = await pidPositionLedger.loadSnapshot({
    uid: row.uid,
    pid: row.id,
    strategyCategory: "grid",
    positionSide: parsed.leg,
  });
  const remainingQty = toNumber(snapshot?.openQty);
  await pidPositionLedger.syncGridLegSnapshot(row.id, parsed.leg);

  const termination = await terminateLiveGridRegimeAfterStopFill({
    row,
    stoppedLeg: parsed.leg,
    remainingStoppedQty: remainingQty,
    reData,
    stoppedClientOrderId: parsed.clientOrderId,
  });
  setOutcome(
    termination.reason === gridReentrySlPolicy.GRID_SL_REASON.TERMINATED
      ? "STOP_REGIME_TERMINATED"
      : termination.reason
  );
  return true;
  });
  });
};

const handleLiveGridManualCloseFill = async (parsed, reData) => {
  return await withQueuedLiveGridEventLock("MANUAL", parsed.clientOrderId, async () => {
    return await withGridRuntimeTraceScope("GRID_MANUAL_CLOSE_HANDLER", parsed, reData, async ({ setOutcome }) => {
    const row = await loadGridItem("LIVE", parsed.pid);
    if (!row || row.uid !== parsed.uid) {
      setOutcome("ROW_NOT_FOUND");
      return false;
    }

    await pidPositionLedger.applyExitFill({
      uid: row.uid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: parsed.leg,
      sourceClientOrderId: parsed.clientOrderId,
      sourceOrderId: reData.i || null,
      sourceTradeId: reData.t || null,
      fillQty: toNumber(reData.l || reData.z),
      fillPrice: toNumber(reData.L || reData.ap || reData.p),
      fee: reData.n,
      realizedPnl: reData.rp,
      tradeTime: reData.T || null,
      eventType: "GRID_MANUAL_CLOSE_FILL",
      note: `grid-manual-close:${reData.X || "FILLED"}`,
    });
    const snapshotState = await loadLiveGridLegSnapshotState(row, parsed.leg);
    const remainingQty = toNumber(snapshotState?.qty);
    await pidPositionLedger.syncGridLegSnapshot(row.id, parsed.leg);

    const refreshed = (await loadGridItem("LIVE", row.id)) || row;
    if (remainingQty > 0) {
      const retryIntent = await enqueueLiveGridCloseIntent(refreshed, parsed.leg, remainingQty, "GMANUAL_RETRY_CLOSE", {
        routePath: "grid-manual-close-retry",
        sourceClientOrderId: parsed.clientOrderId,
        sourceOrderId: reData.i || null,
        sourceTradeId: reData.t || null,
      });
      const synced = await syncLiveGridRowFromPidState(refreshed, {
        regimeStatus: GRID_CANCEL_CLOSE_STATE.GMANUAL_QUEUED,
        regimeEndReason: refreshed.regimeEndReason || "MANUAL_OFF",
        clearOpenLegOrderRefs: false,
      });
      await appendGridRuntimeLog(
        synced || refreshed,
        "gridLiveManualClose",
        retryIntent.pending ? "MANUAL_CLOSE_RETRY_QUEUED" : "MANUAL_CLOSE_RETRY_QUEUE_FAILED",
        `leg:${parsed.leg}, exitPrice:${toNumber(reData.ap || reData.L)}, filledQty:${toNumber(reData.l || reData.z)}, remainingQty:${remainingQty}, closeClientOrderId:${retryIntent.closeClientOrderId || "NONE"}`,
        parsed.leg
      );
      setOutcome(retryIntent.pending ? "MANUAL_CLOSE_RETRY_QUEUED" : "MANUAL_CLOSE_RETRY_QUEUE_FAILED");
      return retryIntent.pending;
    }

    const protectionCleanup = await cleanupLiveGridProtectionAfterFlatClose(
      refreshed,
      parsed.leg,
      "GRID_CLOSE_CONVERGED_PROTECTION_CLEANUP",
      parsed.clientOrderId
    );
    await releaseGridLegPositionOwnership(row, parsed.leg);
    const synced = await syncLiveGridRowFromPidState(refreshed, {
      regimeStatus: "ENDED",
      regimeEndReason: refreshed.regimeEndReason || "MANUAL_OFF",
      clearOpenLegOrderRefs: false,
    });

    await appendGridRuntimeLog(
      synced || refreshed,
      "gridLiveManualClose",
      "MANUAL_CLOSE_FILLED",
      `leg:${parsed.leg}, exitPrice:${toNumber(reData.ap || reData.L)}, qty:${toNumber(reData.l || reData.z)}, protectionCleanup:${protectionCleanup.reason}`,
      parsed.leg
    );
    await finalizeEndedGridRegimeIfIdle(
      "LIVE",
      synced || refreshed,
      (synced || refreshed)?.regimeEndReason || "MANUAL_OFF"
    );
    setOutcome("MANUAL_CLOSE_FILLED");
    return true;
  });
  });
};

const handleLiveOrderTradeUpdate = async (uid, data) => {
  const reData = data?.o;
  if (!reData?.c) {
    return false;
  }

  const parsed = parseGridClientOrderId(reData.c);
  if (!parsed || parsed.uid !== Number(uid)) {
    return false;
  }

  return await withGridRuntimeTraceScope("GRID_ORDER_RUNTIME_UPDATE", parsed, reData, async ({ setOutcome }) => {
    if (shouldSkipDuplicateGridRuntimeEvent(parsed, reData)) {
      setOutcome("DUPLICATE_SKIPPED");
      return true;
    }

    const execType = reData.x;
    const endStatus = reData.X;
    if (endStatus === "CANCELED" || endStatus === "EXPIRED" || endStatus === "EXPIRED_IN_MATCH" || endStatus === "REJECTED") {
      const terminalExecutedQty = toNumber(reData.z || reData.l);
      if (terminalExecutedQty > 0) {
        const row = await loadGridItem("LIVE", parsed.pid);
        if (row && row.uid === parsed.uid) {
          const repairedRow = await truthSyncLiveGridRow({
            row,
            exchangeSnapshotCache: new Map(),
          }).catch(() => null);
          await appendGridRuntimeLog(
            repairedRow || row,
            "gridRuntimeOrder",
            "ORDER_TERMINAL_WITH_FILL_RECOVERY",
            `leg:${parsed.leg}, type:${parsed.type}, status:${endStatus}, executedQty:${terminalExecutedQty}, clientOrderId:${parsed.clientOrderId}, repaired:${Boolean(repairedRow)}`,
            parsed.leg
          );
          setOutcome(`ORDER_${endStatus}_WITH_FILL_RECOVERY`);
          return true;
        }
      }
      if (parsed.type === "GTP" || parsed.type === "GSTOP" || parsed.type === "GMANUAL") {
        await pidPositionLedger.markReservationsCanceled([parsed.clientOrderId]);
      }
      if (parsed.type === "GENTRY" && !(terminalExecutedQty > 0)) {
        const row = await loadGridItem("LIVE", parsed.pid);
        if (row && row.uid === parsed.uid) {
          const prefix = getLegFieldPrefix(parsed.leg);
          if (prefix && row[`${prefix}EntryOrderId`] === parsed.clientOrderId) {
            await applyGridPatch("live_grid_strategy_list", row.id, {
              [`${prefix}EntryOrderId`]: null,
            });
            await appendGridRuntimeLog(
              row,
              "gridLiveEntry",
              "ENTRY_ORDER_TERMINATED_NO_FILL",
              `leg:${parsed.leg}, status:${endStatus}, clientOrderId:${parsed.clientOrderId}, terminal:N, refCleared:Y`,
              parsed.leg
            );
          }
        }
      }
      if (parsed.type === "GSTOP" && !(toNumber(reData.z || reData.l) > 0)) {
        const row = await loadGridItem("LIVE", parsed.pid);
        if (row && row.uid === parsed.uid) {
          await appendGridRuntimeLog(
            row,
            "gridLiveStop",
            "STOP_ORDER_TERMINATED_NO_FILL",
            `leg:${parsed.leg}, status:${endStatus}, clientOrderId:${parsed.clientOrderId}, terminal:N`,
            parsed.leg
          );
        }
      }
      if (parsed.type === "GMANUAL") {
        const row = await loadGridItem("LIVE", parsed.pid);
        if (row && row.uid === parsed.uid) {
          const synced = await syncLiveGridRowFromPidState(row, {
            regimeStatus: "ENDED",
            regimeEndReason: row.regimeEndReason || "MANUAL_OFF",
            clearOpenLegOrderRefs: false,
          });
          await appendGridRuntimeLog(
            synced || row,
            "gridLiveManualClose",
            "MANUAL_CLOSE_ORDER_TERMINATED",
            `leg:${parsed.leg}, status:${endStatus}, clientOrderId:${parsed.clientOrderId}`,
            parsed.leg
          );
          await finalizeEndedGridRegimeIfIdle(
            "LIVE",
            synced || row,
            (synced || row)?.regimeEndReason || "MANUAL_OFF"
          );
        }
      }
      setOutcome(`ORDER_${endStatus}`);
      return true;
    }

    if (
      execType !== "TRADE"
      || (endStatus !== "FILLED" && endStatus !== "PARTIALLY_FILLED")
    ) {
      setOutcome("IGNORED_NON_TRADE");
      return true;
    }

    if (parsed.type === "GENTRY") {
      return await handleLiveGridEntryFill(parsed, reData);
    }

    if (parsed.type === "GTP") {
      return await handleLiveGridTakeProfitFill(parsed, reData);
    }

    if (parsed.type === "GSTOP") {
      return await handleLiveGridStopFill(parsed, reData);
    }

    if (parsed.type === "GMANUAL") {
      return await handleLiveGridManualCloseFill(parsed, reData);
    }

    setOutcome("UNKNOWN_GRID_ORDER_TYPE");
    return false;
  });
};

module.exports = {
  parseGridClientOrderId,
  getGridLegTriggerPrice,
  buildLiveGridArmPairPrimingPlan,
  runLive: () => runMode("LIVE"),
  runTest: () => runMode("TEST"),
  primeLiveEntriesForTargetItems,
  reconcileLiveGridRuntimeIssue,
  truthSyncLiveGridRow,
  handleLiveOrderTradeUpdate,
  suspendGridStrategy,
  deactivateGridStrategy,
  __qa: {
    applyGridEntryFillConvergence,
    restoreLiveGridLegAfterRecoveredEntryFill,
    buildSiblingProtectionCancelOptions,
    computeLegStopPrice,
    getGridSideTriggerMetadata,
  },
};
