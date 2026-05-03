const crypto = require("crypto");
const db = require("./database/connect/config");
const dbcon = require("./dbcon");
const dt = require("./data");
const gridRuntime = require("./grid-runtime");
const positionOwnership = require("./position-ownership");
const pidPositionLedger = require("./pid-position-ledger");
const redisClient = require("./util/redis.util");

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

const computeLegTakeProfitPrice = (row, leg, entryPrice) => {
  const profitPercent = toNumber(row.profit);
  if (!(profitPercent > 0) || !(entryPrice > 0)) {
    return 0;
  }

  const rate = profitPercent * 0.01;
  return leg === "LONG" ? entryPrice * (1 + rate) : entryPrice * (1 - rate);
};

const computeLegStopPrice = (row, leg) =>
  leg === "LONG" ? toNumber(row.supportPrice) : toNumber(row.resistancePrice);

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
  const triggerPrice = toNumber(row.triggerPrice);
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
  && row?.regimeEndReason !== "BOX_BREAK"
  && row?.regimeEndReason !== "BOX_BREAK_WAITING";

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

const applyGridPatch = async (tableName, id, patch = {}) => {
  const entries = Object.entries(patch);
  if (entries.length === 0) {
    return false;
  }

  const sql = `UPDATE ${tableName} SET ${buildSqlSetClause(patch)}, updatedAt = NOW() WHERE id = ? LIMIT 1`;
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

const cancelAllGridOrders = async (mode, row, options = {}) => {
  if (mode !== "LIVE") {
    return 0;
  }

  const coin = getCoin();
  return await coin.cancelGridOrders({
    uid: row.uid,
    symbol: row.symbol,
    pid: row.id,
    leg: options.leg || null,
    includeEntries: options.includeEntries !== false,
    includeExits: options.includeExits !== false,
  });
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

  if (!recoveredExecution && snapshotBeforeState.qty <= 0 && localProtectionClientIds.length === 0) {
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

  const canceledProtectionCount = await cancelAllGridOrders("LIVE", current, {
    leg,
    includeEntries: false,
    includeExits: true,
  });
  const protectionAfter = await loadLiveGridLegProtectionState(current, leg);
  const shouldFlatten =
    Boolean(recoveredExecution) ||
    (allowLocalFlatten && protectionAfter.activeReservationCount === 0);

  if (!shouldFlatten) {
    return false;
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
        const restored = await restoreLiveGridLegAfterRecoveredEntryFill(
          refreshed,
          leg,
          recoveredEntry,
          issue
        );
        if (restored) {
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

  let refreshed = (await loadGridItem("LIVE", row.id)) || row;
  const coin = getCoin();
  const repaired = [];

  for (const leg of ["LONG", "SHORT"]) {
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
          const restored = await restoreLiveGridLegAfterRecoveredEntryFill(
            latest,
            leg,
            recoveredEntry,
            {
              issues: ["TRUTH_SYNC_WITH_EXCHANGE_POSITION"],
            }
          );
          if (restored) {
            repaired.push({
              leg,
              action: "RECOVER_ENTRY_FILL",
              clientOrderId: recoveredEntry.clientOrderId,
              orderId: recoveredEntry.orderId,
            });
            refreshed = (await loadGridItem("LIVE", refreshed.id)) || latest;
            continue;
          }
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
          refreshed = (await loadGridItem("LIVE", refreshed.id)) || latest;
        }
      }
      continue;
    }

    if (!(hasLocalOpen || protectionState.activeReservationCount > 0 || refreshed.regimeStatus === "ENDED")) {
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
      refreshed = (await loadGridItem("LIVE", refreshed.id)) || refreshed;
    }
  }

  if (repaired.length === 0) {
    return null;
  }

  return {
    pid: refreshed.id,
    symbol: refreshed.symbol || null,
    repairs: repaired,
  };
};

const emergencyCloseLiveGridLeg = async (row, leg, qty, logCode, message) => {
  const coin = getCoin();
  let cleanupOrderId = null;
  let closeAttempt = null;

  try {
    await cancelAllGridOrders("LIVE", row, {
      leg,
      includeEntries: false,
      includeExits: true,
    });

    const cleanupOrder = await coin.closeGridLegMarketOrder({
      uid: row.uid,
      pid: row.id,
      symbol: row.symbol,
      leg,
      qty,
    });
    closeAttempt = cleanupOrder || null;
    cleanupOrderId = cleanupOrder?.clientOrderId || null;
  } catch (error) {
    const reconciled = await reconcileEndedGridLegIfExchangeFlat(
      row,
      leg,
      "gridLiveSafety",
      logCode,
      `${message}, closeError:${error?.message || error}`,
      row.regimeEndReason || "BOX_BREAK"
    );
    if (reconciled) {
      return true;
    }
    await appendGridRuntimeLog(
      row,
      "gridLiveSafety",
      `${logCode}_CLOSE_ERROR`,
      `${message}, closeError:${error?.message || error}`,
      leg
    );
    return false;
  }

  if (!cleanupOrderId) {
    const reconciled = await reconcileEndedGridLegIfExchangeFlat(
      row,
      leg,
      "gridLiveSafety",
      logCode,
      message,
      row.regimeEndReason || "BOX_BREAK"
    );
    if (!reconciled) {
      const exchangePosition = await coin.getGridLegExchangePosition({
        uid: row.uid,
        symbol: row.symbol,
        leg,
      });
      const exchangeQty = toNumber(exchangePosition?.qty);
      await appendGridRuntimeLog(
        row,
        "gridLiveSafety",
        `${logCode}_CLOSE_MISSING`,
        `${message}, closeAttempt:${closeAttempt ? "UNKNOWN" : "NONE"}, exchangeQty:${exchangeQty}`,
        leg
      );
      return false;
    }
  }

  const refreshed = (await loadGridItem("LIVE", row.id)) || row;
  const synced = await syncLiveGridRowFromPidState(refreshed, {
    regimeStatus: "ENDED",
    regimeEndReason: refreshed.regimeEndReason || "BOX_BREAK",
    clearOpenLegOrderRefs: false,
  });
  await appendGridRuntimeLog(
    synced || refreshed,
    "gridLiveSafety",
    logCode,
    `${message}, cleanupOrderId:${cleanupOrderId || "NONE"}`,
    leg
  );
  await finalizeEndedGridRegimeIfIdle(
    "LIVE",
    synced || refreshed,
    (synced || refreshed)?.regimeEndReason || "BOX_BREAK"
  );
  return true;
};

const collectMissingGridProtection = (exits = {}) => {
  const missingProtection = [];
  if (toNumber(exits.takeProfitPrice) > 0 && !exits.takeProfitOrderId) {
    missingProtection.push("TP");
  }
  if (toNumber(exits.stopPrice) > 0 && !exits.stopOrderId) {
    missingProtection.push("STOP");
  }
  return missingProtection;
};

const placeLiveEntryOrderForLeg = async (row, leg) => {
  const coin = getCoin();
  const triggerPrice = toNumber(row.triggerPrice);
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
  });
};

const placeLiveExitOrdersForLeg = async (row, leg, qty, entryPrice) => {
  const coin = getCoin();
  const takeProfitPrice = computeLegTakeProfitPrice(row, leg, entryPrice);
  const stopPrice = computeLegStopPrice(row, leg);
  const result = {
    takeProfitPrice,
    stopPrice,
    takeProfitOrderId: null,
    stopOrderId: null,
    takeProfitSourceOrderId: null,
    stopSourceOrderId: null,
  };

  if (takeProfitPrice > 0) {
    try {
      const takeProfitOrder = await coin.placeGridTakeProfitOrder({
        uid: row.uid,
        pid: row.id,
        symbol: row.symbol,
        leg,
        qty,
        triggerPrice: takeProfitPrice,
      });
      result.takeProfitOrderId = takeProfitOrder?.clientOrderId || null;
      result.takeProfitSourceOrderId = takeProfitOrder?.orderId || null;
    } catch (error) {
      await appendGridRuntimeLog(
        row,
        "gridLiveOpen",
        "TAKE_PROFIT_ORDER_ERROR",
        `leg:${leg}, qty:${qty}, entryPrice:${entryPrice}, targetPrice:${takeProfitPrice}, message:${error?.message || error}`,
        leg
      );
    }
    if (!result.takeProfitOrderId) {
      await appendGridRuntimeLog(
        row,
        "gridLiveOpen",
        "TAKE_PROFIT_ORDER_MISSING",
        `leg:${leg}, qty:${qty}, entryPrice:${entryPrice}, targetPrice:${takeProfitPrice}`,
        leg
      );
    }
  }

  if (stopPrice > 0) {
    try {
      const stopOrder = await coin.placeGridStopOrder({
        uid: row.uid,
        pid: row.id,
        symbol: row.symbol,
        leg,
        qty,
        triggerPrice: stopPrice,
      });
      result.stopOrderId = stopOrder?.clientOrderId || null;
      result.stopSourceOrderId = stopOrder?.orderId || null;
    } catch (error) {
      await appendGridRuntimeLog(
        row,
        "gridLiveOpen",
        "STOP_ORDER_ERROR",
        `leg:${leg}, qty:${qty}, entryPrice:${entryPrice}, stopPrice:${stopPrice}, message:${error?.message || error}`,
        leg
      );
    }
    if (!result.stopOrderId) {
      await appendGridRuntimeLog(
        row,
        "gridLiveOpen",
        "STOP_ORDER_MISSING",
        `leg:${leg}, qty:${qty}, entryPrice:${entryPrice}, stopPrice:${stopPrice}`,
        leg
      );
    }
  }

  return result;
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
      reservedQty: qty,
      note: `grid leg:${leg} take-profit`,
    });
  }

  if (exits?.stopOrderId) {
    reservations.push({
      clientOrderId: exits.stopOrderId,
      sourceOrderId: exits.stopSourceOrderId || null,
      reservationKind: "GRID_STOP",
      reservedQty: qty,
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

const restoreLiveGridLegAfterRecoveredEntryFill = async (row, leg, execution, issue = null) => {
  if (!row?.id || !row?.uid || !row?.symbol || !leg || !execution?.clientOrderId) {
    return false;
  }

  const prefix = getLegFieldPrefix(leg);
  await pidPositionLedger.syncGridLegSnapshot(row.id, leg);
  const snapshot = await pidPositionLedger.loadSnapshot({
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

  const current = (await loadGridItem("LIVE", row.id)) || row;
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
    await applyGridPatch("live_grid_strategy_list", current.id, {
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
    await touchGridLegPositionOwnership(current, leg, {
      ownerState: "OPEN",
      sourceClientOrderId: execution.clientOrderId,
      sourceOrderId: execution.orderId || null,
      note: "exchange-entry-reconcile-reuse-protection",
    });
    await appendGridRuntimeLog(
      current,
      "gridReconcile",
      "ENTRY_FILL_RECOVERED_REUSED_PROTECTION",
      `leg:${leg}, clientOrderId:${execution.clientOrderId}, qty:${currentQty}, entryPrice:${entryPrice}, issues:${[].concat(issue?.issues || []).join(",")}`,
      leg
    );
    return true;
  }

  if (current?.regimeStatus === "ENDED") {
    return await emergencyCloseLiveGridLeg(
      current,
      leg,
      qty,
      "ENTRY_FILL_RECOVERED_AFTER_END_CLOSED",
      `leg:${leg}, clientOrderId:${execution.clientOrderId}, qty:${qty}, entryPrice:${entryPrice}, reason:regime-ended, issues:${[].concat(issue?.issues || []).join(",")}`
    );
  }

  if (hasExistingExits) {
    await cancelAllGridOrders("LIVE", current, {
      leg,
      includeEntries: false,
      includeExits: true,
    });
  }

  const exits = await placeLiveExitOrdersForLeg(current, leg, qty, entryPrice);
  await syncGridExitReservationsForLeg(current, leg, exits, qty);
  const missingProtection = collectMissingGridProtection(exits);
  if (missingProtection.length > 0) {
    return await emergencyCloseLiveGridLeg(
      current,
      leg,
      qty,
      "ENTRY_FILL_RECOVERED_PROTECTION_MISSING_CLOSED",
      `leg:${leg}, clientOrderId:${execution.clientOrderId}, qty:${qty}, entryPrice:${entryPrice}, missing:${missingProtection.join("+")}, issues:${[].concat(issue?.issues || []).join(",")}`
    );
  }

  await applyGridPatch("live_grid_strategy_list", current.id, {
    ...buildOpenLegPatch({
      leg,
      entryOrderId: execution.clientOrderId,
      entryPrice,
      qty,
      takeProfitPrice: exits.takeProfitPrice,
      stopPrice: exits.stopPrice,
      takeProfitOrderId: exits.takeProfitOrderId,
      stopOrderId: exits.stopOrderId,
      regimeStatus: "ACTIVE",
      regimeEndReason: null,
    }),
  });
  await touchGridLegPositionOwnership(current, leg, {
    ownerState: "OPEN",
    sourceClientOrderId: execution.clientOrderId,
    sourceOrderId: execution.orderId || null,
    note: "exchange-entry-reconcile",
  });
  await appendGridRuntimeLog(
    current,
    "gridReconcile",
    "ENTRY_FILL_RECOVERED",
    `leg:${leg}, clientOrderId:${execution.clientOrderId}, orderId:${execution.orderId}, qty:${qty}, entryPrice:${entryPrice}, issues:${[].concat(issue?.issues || []).join(",")}`,
    leg
  );
  return true;
};

const armMissingLiveExits = async (row) => {
  let changed = false;
  let current = row;
  const coin = getCoin();

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

    const patch = {};
    if (!current[`${prefix}ExitOrderId`] && toNumber(current[`${prefix}TakeProfitPrice`]) > 0) {
      const order = await coin.placeGridTakeProfitOrder({
        uid: current.uid,
        pid: current.id,
        symbol: current.symbol,
        leg,
        qty,
        triggerPrice: current[`${prefix}TakeProfitPrice`],
      });
      patch[`${prefix}ExitOrderId`] = order?.clientOrderId || null;
      if (!patch[`${prefix}ExitOrderId`]) {
        await appendGridRuntimeLog(
          current,
          "gridLiveRepair",
          "TAKE_PROFIT_REPAIR_MISSING",
          `leg:${leg}, qty:${qty}, targetPrice:${current[`${prefix}TakeProfitPrice`]}`,
          leg
        );
      }
    }

    if (!current[`${prefix}StopOrderId`] && toNumber(current[`${prefix}StopPrice`]) > 0) {
      const order = await coin.placeGridStopOrder({
        uid: current.uid,
        pid: current.id,
        symbol: current.symbol,
        leg,
        qty,
        triggerPrice: current[`${prefix}StopPrice`],
      });
      patch[`${prefix}StopOrderId`] = order?.clientOrderId || null;
      if (!patch[`${prefix}StopOrderId`]) {
        await appendGridRuntimeLog(
          current,
          "gridLiveRepair",
          "STOP_REPAIR_MISSING",
          `leg:${leg}, qty:${qty}, stopPrice:${current[`${prefix}StopPrice`]}`,
          leg
        );
      }
    }

    if (Object.keys(patch).length === 0) {
      continue;
    }

    await syncGridExitReservationsForLeg(
      current,
      leg,
      {
        takeProfitOrderId: patch[`${prefix}ExitOrderId`] || current[`${prefix}ExitOrderId`] || null,
        stopOrderId: patch[`${prefix}StopOrderId`] || current[`${prefix}StopOrderId`] || null,
        takeProfitSourceOrderId: null,
        stopSourceOrderId: null,
      },
      qty
    );
    await applyGridPatch("live_grid_strategy_list", current.id, patch);
    await appendGridRuntimeLog(
      current,
      "gridLiveRepair",
      "EXITS_REPAIRED",
      `leg:${leg}, tp:${patch[`${prefix}ExitOrderId`] || current[`${prefix}ExitOrderId`] || "KEEP"}, stop:${patch[`${prefix}StopOrderId`] || current[`${prefix}StopOrderId`] || "KEEP"}`,
      leg
    );
    const missingProtection = collectMissingGridProtection({
      takeProfitPrice: current[`${prefix}TakeProfitPrice`],
      stopPrice: current[`${prefix}StopPrice`],
      takeProfitOrderId: patch[`${prefix}ExitOrderId`] || current[`${prefix}ExitOrderId`] || null,
      stopOrderId: patch[`${prefix}StopOrderId`] || current[`${prefix}StopOrderId`] || null,
    });
    if (missingProtection.length > 0) {
      return await emergencyCloseLiveGridLeg(
        current,
        leg,
        qty,
        "EXIT_REPAIR_INCOMPLETE_CLOSED",
        `leg:${leg}, qty:${qty}, missing:${missingProtection.join("+")}`
      );
    }
    current = { ...current, ...patch };
    changed = true;
  }

  return changed;
};

const armMissingLiveEntries = async (row) => {
  if (!canArmEntriesForRow(row)) {
    return false;
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
          `leg:${leg}, triggerPrice:${current.triggerPrice}`,
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
        `leg:${leg}, triggerPrice:${current.triggerPrice}, message:${error?.message || error}`,
        leg
      );
    }
  }

  return changed;
};

const handleGridBoundaryReset = async (mode, row, reason, message) => {
  await cancelAllGridOrders(mode, row);
  await applyGridPatch(getTableName(mode), row.id, buildResetRegimePatch(reason));
  if (mode === "LIVE") {
    await releaseAllGridPositionOwnership(row);
  }
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
    if (hasOpenQty || hasAnyEntryArmed(refreshed) || hasActiveReservations) {
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
    });
  }

  const refreshed = (await loadGridItem(mode, row.id)) || row;
  const hasLiveOpenExposure = mode === "LIVE"
    ? await hasLiveGridOpenSnapshotQty(refreshed)
    : hasOpenPosition(refreshed);
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
  if (mode === "LIVE" && !hasLiveOpenExposure) {
    await releaseAllGridPositionOwnership(refreshed);
  }
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
    await cancelAllGridOrders("LIVE", row);
    const coin = getCoin();
    const baseline = await syncLiveGridRowFromPidState(row, {
      regimeStatus: "ENDED",
      regimeEndReason: reason,
      clearOpenLegOrderRefs: true,
    });

    for (const leg of ["LONG", "SHORT"]) {
      const snapshotState = await loadLiveGridLegSnapshotState(baseline || row, leg);
      const qty = toNumber(snapshotState?.qty);
      if (!(qty > 0)) {
        continue;
      }

      try {
        const closeAttempt = await coin.closeGridLegMarketOrder({
          uid: row.uid,
          pid: row.id,
          symbol: row.symbol,
          leg,
          qty,
        });
        if (!closeAttempt?.clientOrderId) {
          const exchangePosition = await coin.getGridLegExchangePosition({
            uid: row.uid,
            symbol: row.symbol,
            leg,
          });
          if (!(toNumber(exchangePosition?.qty) > 0)) {
            await pidPositionLedger.closeSnapshotAsOrphan({
              uid: row.uid,
              pid: row.id,
              strategyCategory: "grid",
              symbol: row.symbol,
              positionSide: leg,
              eventType: "GRID_ORPHAN_CLOSE",
              note: `manual-off: exchange-flat-orphan-close`,
            });
            await appendGridRuntimeLog(
              baseline || row,
              "gridControl",
              "MANUAL_CLOSE_ORPHAN_CLOSED",
              `leg:${leg}, qty:${qty}, exchange flat while pid snapshot remained open`,
              leg
            );
          }
        }
      } catch (error) {
        await appendGridRuntimeLog(
          baseline || row,
          "gridControl",
          "MANUAL_CLOSE_ERROR",
          `leg:${leg}, qty:${qty}, message:${error?.message || error}`,
          leg
        );
      }
    }
    const refreshed = (await loadGridItem("LIVE", row.id)) || baseline || row;
    const synced = await syncLiveGridRowFromPidState(refreshed, {
      regimeStatus: "ENDED",
      regimeEndReason: reason,
      clearOpenLegOrderRefs: true,
    });
    await finalizeEndedGridRegimeIfIdle("LIVE", synced || refreshed, reason);
    await appendGridRuntimeLog(
      synced || refreshed,
      "gridControl",
      reason,
      `mode:${mode}, strategy manually turned off`
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
  if (!price.st) {
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
  const price = dt.getPrice(row.symbol);
  if (!price.st) {
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
    for (const leg of ["LONG", "SHORT"]) {
      const prefix = getLegFieldPrefix(leg);
      if (row[`${prefix}LegStatus`] !== "OPEN" && !(toNumber(row[`${prefix}Qty`]) > 0)) {
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

    return await armMissingLiveEntries(refreshed);
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

      const changed = await armMissingLiveEntries(row);
      if (changed) {
        primed += 1;
      }
      return changed;
    });
  }

  return primed;
};

const handleLiveGridEntryFill = async (parsed, reData) => {
  return await withQueuedLiveGridEventLock("ENTRY", parsed.clientOrderId, async () => {
    return await withGridRuntimeTraceScope("GRID_ENTRY_FILL_HANDLER", parsed, reData, async ({ setOutcome }) => {
    const row = await loadGridItem("LIVE", parsed.pid);
    if (!row || row.uid !== parsed.uid) {
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
      setOutcome("ENTRY_SKIP_ALREADY_OPEN_WITH_EXITS");
      return true;
    }

    if (!(entryFillQty > 0) || !(entryFillPrice > 0)) {
      setOutcome("ENTRY_INVALID_FILL");
      return true;
    }

    const ledgerEntry = await pidPositionLedger.applyEntryFill({
      uid: row.uid,
      pid: row.id,
      strategyCategory: "grid",
      symbol: row.symbol,
      positionSide: parsed.leg,
      sourceClientOrderId: parsed.clientOrderId,
      sourceOrderId: reData.i || null,
      sourceTradeId: reData.t || null,
      fillQty: entryFillQty,
      fillPrice: entryFillPrice,
      fee: reData.n,
      tradeTime: reData.T || null,
      eventType: "GRID_ENTRY_FILL",
      note: `grid-entry:${reData.X || "FILLED"}`,
    });
    const snapshot =
      ledgerEntry?.snapshot ||
      (await pidPositionLedger.loadSnapshot({
        uid: row.uid,
        pid: row.id,
        strategyCategory: "grid",
        positionSide: parsed.leg,
      }));
    const qty = toNumber(snapshot?.openQty);
    const entryPrice = toNumber(snapshot?.avgEntryPrice);
    await pidPositionLedger.syncGridLegSnapshot(row.id, parsed.leg);

    if (row?.regimeStatus === "ENDED") {
      setOutcome("ENTRY_FILLED_AFTER_END");
      return await emergencyCloseLiveGridLeg(
        row,
        parsed.leg,
        qty,
        "ENTRY_FILLED_AFTER_END_CLOSED",
        `leg:${parsed.leg}, entryOrderId:${parsed.clientOrderId}, qty:${qty}, entryPrice:${entryPrice}, reason:regime-ended`
      );
    }

    if (row?.[`${prefix}LegStatus`] === "OPEN" && existingLegQty > 0) {
      let cleanupOrderId = null;
      try {
        const cleanupOrder = await getCoin().closeGridLegMarketOrder({
          uid: row.uid,
          pid: row.id,
          symbol: row.symbol,
          leg: parsed.leg,
          qty,
        });
        cleanupOrderId = cleanupOrder?.clientOrderId || null;
      } catch (error) {
        await appendGridRuntimeLog(
          row,
          "gridLiveOpen",
          "ENTRY_FILLED_DUPLICATE_CLEANUP_ERROR",
          `leg:${parsed.leg}, duplicateEntryOrderId:${parsed.clientOrderId}, qty:${qty}, message:${error?.message || error}`,
          parsed.leg
        );
        setOutcome("ENTRY_DUPLICATE_CLEANUP_ERROR");
        return false;
      }

      await appendGridRuntimeLog(
        row,
        "gridLiveOpen",
        "ENTRY_FILLED_DUPLICATE",
        `leg:${parsed.leg}, duplicateEntryOrderId:${parsed.clientOrderId}, qty:${qty}, cleanupOrderId:${cleanupOrderId || "NONE"}`,
        parsed.leg
      );
      setOutcome("ENTRY_DUPLICATE");
      return true;
    }

    if (
      row?.[`${prefix}EntryOrderId`] === parsed.clientOrderId &&
      hasExistingExits &&
      reportedQty > existingLegQty
    ) {
      await cancelAllGridOrders("LIVE", row, {
        leg: parsed.leg,
        includeEntries: false,
        includeExits: true,
      });
    }

    const exits = await placeLiveExitOrdersForLeg(row, parsed.leg, qty, entryPrice);
    await syncGridExitReservationsForLeg(row, parsed.leg, exits, qty);
    const missingProtection = collectMissingGridProtection(exits);
    if (missingProtection.length > 0) {
      setOutcome("ENTRY_PROTECTION_MISSING");
      return await emergencyCloseLiveGridLeg(
        row,
        parsed.leg,
        qty,
        "ENTRY_PROTECTION_MISSING_CLOSED",
        `leg:${parsed.leg}, entryOrderId:${parsed.clientOrderId}, qty:${qty}, entryPrice:${entryPrice}, missing:${missingProtection.join("+")}`
      );
    }

    await applyGridPatch("live_grid_strategy_list", row.id, {
      ...buildOpenLegPatch({
        leg: parsed.leg,
        entryOrderId: parsed.clientOrderId,
        entryPrice,
        qty,
        takeProfitPrice: exits.takeProfitPrice,
        stopPrice: exits.stopPrice,
        takeProfitOrderId: exits.takeProfitOrderId,
        stopOrderId: exits.stopOrderId,
        regimeStatus: row.regimeStatus === "ENDED" ? "ENDED" : "ACTIVE",
        regimeEndReason: row.regimeStatus === "ENDED" ? row.regimeEndReason || "BOX_BREAK" : null,
      }),
    });
    await touchGridLegPositionOwnership(row, parsed.leg, {
      ownerState: "OPEN",
      sourceClientOrderId: parsed.clientOrderId,
      sourceOrderId: reData.i || null,
      note: `entry-filled:${reData.X || "FILLED"}`,
    });
    await appendGridRuntimeLog(
      row,
      "gridLiveOpen",
      "ENTRY_FILLED",
      `leg:${parsed.leg}, entryPrice:${entryPrice}, qty:${qty}, tp:${exits.takeProfitPrice}, stop:${exits.stopPrice}`,
      parsed.leg
    );
    setOutcome("ENTRY_FILLED");
    return true;
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
    await cancelAllGridOrders("LIVE", row, {
      leg: parsed.leg,
      includeEntries: false,
      includeExits: true,
    });
    const exits = await placeLiveExitOrdersForLeg(row, parsed.leg, remainingQty, remainingEntryPrice);
    await syncGridExitReservationsForLeg(row, parsed.leg, exits, remainingQty);
    const missingProtection = collectMissingGridProtection(exits);
    if (missingProtection.length > 0) {
      setOutcome("TP_PARTIAL_REPROTECT_FAILED");
      return await emergencyCloseLiveGridLeg(
        row,
        parsed.leg,
        remainingQty,
        "TAKE_PROFIT_PARTIAL_REPROTECT_FAILED_CLOSED",
        `leg:${parsed.leg}, remainingQty:${remainingQty}, missing:${missingProtection.join("+")}`
      );
    }
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
  await cancelAllGridOrders("LIVE", row, {
    leg: parsed.leg,
    includeEntries: false,
    includeExits: true,
  });

  if (remainingQty > 0) {
    const exits = await placeLiveExitOrdersForLeg(row, parsed.leg, remainingQty, remainingEntryPrice);
    await syncGridExitReservationsForLeg(row, parsed.leg, exits, remainingQty);
    const missingProtection = collectMissingGridProtection(exits);
    if (missingProtection.length > 0) {
      setOutcome("TP_REMAINING_REPROTECT_FAILED");
      return await emergencyCloseLiveGridLeg(
        row,
        parsed.leg,
        remainingQty,
        "TAKE_PROFIT_REMAINING_REPROTECT_FAILED_CLOSED",
        `leg:${parsed.leg}, remainingQty:${remainingQty}, missing:${missingProtection.join("+")}`
      );
    }
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
  const entryOrder = shouldRearm ? await placeLiveEntryOrderForLeg(row, parsed.leg) : null;
  await applyGridPatch(
    "live_grid_strategy_list",
    row.id,
    shouldRearm
      ? {
          ...getLegPatchForEntryArmed(parsed.leg, entryOrder?.clientOrderId || null),
          regimeStatus: "ACTIVE",
          regimeEndReason: null,
        }
      : {
          ...getLegPatchForClosed(parsed.leg),
          regimeStatus: "ENDED",
          regimeEndReason: row.regimeEndReason || "BOX_BREAK",
        }
  );
  if (shouldRearm) {
    await touchGridLegPositionOwnership(row, parsed.leg, {
      ownerState: "ENTRY_ARMED",
      sourceClientOrderId: entryOrder?.clientOrderId || null,
      sourceOrderId: entryOrder?.orderId || null,
      note: "grid take-profit rearm",
    });
  } else {
    await releaseGridLegPositionOwnership(row, parsed.leg);
  }

  await appendGridRuntimeLog(
    row,
    "gridLiveExit",
    "TAKE_PROFIT",
    `leg:${parsed.leg}, exitPrice:${toNumber(reData.ap || reData.L)}, reentry:${entryOrder?.clientOrderId || "NONE"}, rearm:${shouldRearm ? "Y" : "N"}`,
    parsed.leg
  );
  if (!shouldRearm) {
    await finalizeEndedGridRegimeIfIdle("LIVE", row, row.regimeEndReason || "BOX_BREAK");
  }
  setOutcome(shouldRearm ? "TP_REARMED" : "TP_FILLED");
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

  await cancelAllGridOrders("LIVE", row, {
    leg: parsed.leg,
    includeEntries: false,
    includeExits: true,
  });
  if (remainingQty > 0) {
    setOutcome("STOP_PARTIAL_REMAINING");
    return await emergencyCloseLiveGridLeg(
      row,
      parsed.leg,
      remainingQty,
      "STOP_PARTIAL_REMAINING_CLOSED",
      `leg:${parsed.leg}, remainingQty:${remainingQty}, stopExitPrice:${toNumber(reData.ap || reData.L)}`
    );
  }
  await applyGridPatch("live_grid_strategy_list", row.id, {
    ...buildEndedRegimePatch(row, "BOX_BREAK"),
    ...getLegPatchForClosed(parsed.leg),
  });
  await releaseGridLegPositionOwnership(row, parsed.leg);
  await appendGridRuntimeLog(
    row,
    "gridLiveStop",
    "BOX_BREAK",
    `leg:${parsed.leg}, stopExitPrice:${toNumber(reData.ap || reData.L)}`,
    parsed.leg
  );
  await finalizeEndedGridRegimeIfIdle("LIVE", row, "BOX_BREAK");
  setOutcome("STOP_FILLED");
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
      let retryOrderId = null;
      let retryReconciled = false;
      try {
        const retryOrder = await getCoin().closeGridLegMarketOrder({
          uid: row.uid,
          pid: row.id,
          symbol: row.symbol,
          leg: parsed.leg,
          qty: remainingQty,
        });
        retryOrderId = retryOrder?.clientOrderId || null;
      } catch (error) {
        retryReconciled = await reconcileEndedGridLegIfExchangeFlat(
          refreshed,
          parsed.leg,
          "gridLiveManualClose",
          "MANUAL_CLOSE_RETRY",
          `leg:${parsed.leg}, remainingQty:${remainingQty}, message:${error?.message || error}`,
          refreshed.regimeEndReason || "MANUAL_OFF"
        );
        if (!retryReconciled) {
          await appendGridRuntimeLog(
            refreshed,
            "gridLiveManualClose",
            "MANUAL_CLOSE_RETRY_ERROR",
            `leg:${parsed.leg}, remainingQty:${remainingQty}, message:${error?.message || error}`,
            parsed.leg
          );
        }
      }

      if (!retryReconciled && !retryOrderId) {
        retryReconciled = await reconcileEndedGridLegIfExchangeFlat(
          refreshed,
          parsed.leg,
          "gridLiveManualClose",
          "MANUAL_CLOSE_RETRY",
          `leg:${parsed.leg}, remainingQty:${remainingQty}, retryOrderId:NONE`,
          refreshed.regimeEndReason || "MANUAL_OFF"
        );
      }

      if (retryReconciled) {
        setOutcome("MANUAL_CLOSE_RECONCILED");
        return true;
      }

      const synced = await syncLiveGridRowFromPidState(refreshed, {
        regimeStatus: "ENDED",
        regimeEndReason: refreshed.regimeEndReason || "MANUAL_OFF",
        clearOpenLegOrderRefs: false,
      });
      await appendGridRuntimeLog(
        synced || refreshed,
        "gridLiveManualClose",
        "MANUAL_CLOSE_PARTIAL_RETRY",
        `leg:${parsed.leg}, exitPrice:${toNumber(reData.ap || reData.L)}, filledQty:${toNumber(reData.l || reData.z)}, remainingQty:${remainingQty}, retryOrderId:${retryOrderId || "NONE"}`,
        parsed.leg
      );
      setOutcome("MANUAL_CLOSE_PARTIAL_RETRY");
      return true;
    }

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
      `leg:${parsed.leg}, exitPrice:${toNumber(reData.ap || reData.L)}, qty:${toNumber(reData.l || reData.z)}`,
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
      if (parsed.type === "GTP" || parsed.type === "GSTOP" || parsed.type === "GMANUAL") {
        await pidPositionLedger.markReservationsCanceled([parsed.clientOrderId]);
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
  runLive: () => runMode("LIVE"),
  runTest: () => runMode("TEST"),
  primeLiveEntriesForTargetItems,
  reconcileLiveGridRuntimeIssue,
  truthSyncLiveGridRow,
  handleLiveOrderTradeUpdate,
  suspendGridStrategy,
  deactivateGridStrategy,
};
