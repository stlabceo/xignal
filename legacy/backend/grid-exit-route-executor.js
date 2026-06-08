"use strict";

const defaultDb = require("./database/connect/config");
const positionOwnership = require("./position-ownership");

const normalizeSymbol = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\.P$/i, "");

const normalizeText = (value) => String(value || "").trim();
const normalizeUpper = (value) => normalizeText(value).toUpperCase();
const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const parseJsonSafe = (value, fallback = null) => {
  if (value == null || value === "") {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch (error) {
    return fallback;
  }
};

const getStoredGridRegimeKey = (row = {}) => {
  const payload = parseJsonSafe(row.lastWebhookPayloadJson, {});
  return normalizeText(payload?.gridRegimeKey || payload?.regimeKey || "");
};

const isGridExitRouteExecutionEnabled = ({ env = process.env, featureFlags = {} } = {}) => {
  const routeMode = normalizeUpper(env.GRID_EXIT_ROUTE_EXECUTION_MODE);
  const enabled =
    routeMode === "ACTUAL" ||
    routeMode === "EXECUTE" ||
    routeMode === "ENABLED";

  const blockers = [];
  if (!enabled) {
    blockers.push("GRID_EXIT_ROUTE_EXECUTION_MODE_NOT_ACTUAL");
  }
  if (String(featureFlags.GRID_EXIT_ORCHESTRATOR_ENABLED || env.GRID_EXIT_ORCHESTRATOR_ENABLED || "0").trim() !== "1") {
    blockers.push("GRID_EXIT_ORCHESTRATOR_DISABLED");
  }
  if (normalizeUpper(featureFlags.GRID_EXIT_CONTRACT_MODE || env.GRID_EXIT_CONTRACT_MODE) !== "ENFORCE") {
    blockers.push("GRID_EXIT_CONTRACT_MODE_NOT_ENFORCE");
  }
  if (String(env.GRID_EXIT_ACTUAL_CANCEL_ENABLED || "0").trim() !== "1") {
    blockers.push("GRID_EXIT_ACTUAL_CANCEL_DISABLED");
  }
  if (String(env.GRID_EXIT_ACTUAL_CANCEL_HARD_CONFIRM || "0").trim() !== "1") {
    blockers.push("GRID_EXIT_ACTUAL_CANCEL_HARD_CONFIRM_REQUIRED");
  }
  if (Number(env.GRID_EXIT_ACTUAL_CANCEL_MAX_TARGETS || 0) !== 1) {
    blockers.push("GRID_EXIT_ACTUAL_CANCEL_MAX_TARGETS_MUST_BE_1");
  }
  if (String(env.GRID_EXIT_ACTUAL_MARKET_CLOSE_ENABLED || "0").trim() !== "1") {
    blockers.push("GRID_EXIT_ACTUAL_MARKET_CLOSE_DISABLED");
  }
  if (String(env.GRID_EXIT_ACTUAL_MARKET_CLOSE_HARD_CONFIRM || "0").trim() !== "1") {
    blockers.push("GRID_EXIT_ACTUAL_MARKET_CLOSE_HARD_CONFIRM_REQUIRED");
  }
  if (Number(env.GRID_EXIT_ACTUAL_MARKET_CLOSE_MAX_TARGETS || 0) !== 1) {
    blockers.push("GRID_EXIT_ACTUAL_MARKET_CLOSE_MAX_TARGETS_MUST_BE_1");
  }

  return {
    enabled: blockers.length === 0,
    mode: enabled ? "ACTUAL" : "AUDIT_ONLY",
    blockers,
  };
};

const collectEligibleExitTargets = ({ previewResult = {}, payload = {}, maxTargets = 1 } = {}) => {
  const targetItems = Array.isArray(previewResult.targetItems) ? previewResult.targetItems : [];
  const expectedKey = normalizeText(payload.gridRegimeKey);
  const expectedSymbol = normalizeSymbol(payload.symbol);
  const expectedTimeframe = normalizeUpper(payload.bunbong || payload.timeframe);
  const eligible = targetItems.filter((item) =>
    normalizeUpper(item.strategyMode) === "LIVE" &&
    normalizeUpper(item.resultCode) === "GRID_EXIT_ALERT_PREVIEW" &&
    normalizeSymbol(item.symbol) === expectedSymbol &&
    normalizeUpper(item.bunbong || item.timeframe) === expectedTimeframe &&
    normalizeText(item.strategySignal) === normalizeText(payload.strategySignal)
  );

  const blockers = [];
  if (!expectedKey) {
    blockers.push("GRID_EXIT_ROUTE_GRID_REGIME_KEY_REQUIRED");
  }
  if (eligible.length === 0) {
    blockers.push("GRID_EXIT_ROUTE_NO_ELIGIBLE_ACTIVE_TARGET");
  }
  if (eligible.length > Number(maxTargets || 1)) {
    blockers.push("GRID_EXIT_ROUTE_TARGET_COUNT_EXCEEDED");
  }

  return {
    eligible,
    eligibleCount: eligible.length,
    maxTargets: Number(maxTargets || 1),
    blocked: blockers.length > 0,
    blockers,
  };
};

const queryRows = async (db, sql, params = []) => {
  const [rows] = await db.query(sql, params);
  return rows || [];
};

const loadLiveGridRowForExit = async ({ db, target, payload }) => {
  const rows = await queryRows(
    db,
    `SELECT *
       FROM live_grid_strategy_list
      WHERE id = ?
        AND uid = ?
        AND symbol = ?
        AND bunbong = ?
        AND enabled = 'Y'
      LIMIT 1`,
    [Number(target.pid || 0), Number(target.uid || 0), normalizeSymbol(payload.symbol), payload.bunbong]
  );
  return rows[0] || null;
};

const loadPidLocalExitState = async ({ db, uid, pid, symbol }) => {
  const [owners, snapshots, reservations] = await Promise.all([
    queryRows(
      db,
      `SELECT positionSide, status, ownerState, ownedQty, reservedCloseQty
         FROM live_position_bucket_owner
        WHERE uid = ?
          AND ownerPid = ?
          AND ownerStrategyCategory = 'grid'
          AND symbol = ?`,
      [uid, pid, normalizeSymbol(symbol)]
    ),
    queryRows(
      db,
      `SELECT positionSide, status, openQty
         FROM live_pid_position_snapshot
        WHERE uid = ?
          AND pid = ?
          AND strategyCategory = 'grid'
          AND symbol = ?`,
      [uid, pid, normalizeSymbol(symbol)]
    ),
    queryRows(
      db,
      `SELECT positionSide, status, reservedQty, filledQty, clientOrderId
         FROM live_pid_exit_reservation
        WHERE uid = ?
          AND pid = ?
          AND strategyCategory = 'grid'
          AND symbol = ?`,
      [uid, pid, normalizeSymbol(symbol)]
    ),
  ]);

  const ownerOpenQtyByLeg = {};
  for (const row of owners) {
    const leg = normalizeUpper(row.positionSide);
    ownerOpenQtyByLeg[leg] = Math.max(
      toNumber(ownerOpenQtyByLeg[leg]),
      Math.max(0, toNumber(row.ownedQty) - toNumber(row.reservedCloseQty))
    );
  }

  const snapshotOpenQtyByLeg = {};
  for (const row of snapshots) {
    const leg = normalizeUpper(row.positionSide);
    snapshotOpenQtyByLeg[leg] = Math.max(toNumber(snapshotOpenQtyByLeg[leg]), toNumber(row.openQty));
  }

  const activeReservationCount = reservations.filter((row) =>
    [
      "ACTIVE",
      "PARTIAL",
      "PENDING",
      "RUNNING",
      "RETRY",
      "CANCEL_REQUESTED",
      "CANCEL_PENDING",
      "UNKNOWN_CANCEL_STATE",
    ].includes(normalizeUpper(row.status))
  ).length;
  const ownerResidueCount = owners.filter((row) => {
    if (toNumber(row.ownedQty) > 0 || toNumber(row.reservedCloseQty) > 0) {
      return true;
    }
    const state = normalizeUpper(row.ownerState);
    const status = normalizeUpper(row.status);
    return Boolean(state || status) && state !== "RELEASED" && status !== "CLOSED";
  }).length;

  return {
    owners,
    snapshots,
    reservations,
    ownerOpenQtyByLeg,
    snapshotOpenQtyByLeg,
    activeReservationCount,
    ownerResidueCount,
    ownerNonzeroCount: owners.filter((row) => toNumber(row.ownedQty) > 0 || toNumber(row.reservedCloseQty) > 0).length,
    snapshotOpenCount: snapshots.filter((row) => toNumber(row.openQty) > 0 || normalizeUpper(row.status) === "OPEN").length,
  };
};

const readExchangeLegQty = async ({ coin, uid, symbol, leg }) => {
  if (!coin || typeof coin.getGridLegExchangePosition !== "function") {
    return 0;
  }
  const position = await coin.getGridLegExchangePosition({ uid, symbol, leg });
  if (position?.readOk === false) {
    throw new Error(`GRID_EXIT_EXCHANGE_READ_FAILED:${leg}:${position.readError || "UNKNOWN"}`);
  }
  return toNumber(position?.qty);
};

const finalizeGridExitIfConverged = async ({ db, row, payload, finalState }) => {
  const longExchangeQty = toNumber(finalState.exchangeQtyByLeg.LONG);
  const shortExchangeQty = toNumber(finalState.exchangeQtyByLeg.SHORT);
  const clean =
    longExchangeQty <= 0 &&
    shortExchangeQty <= 0 &&
    finalState.local.ownerNonzeroCount === 0 &&
    finalState.local.ownerResidueCount === 0 &&
    finalState.local.snapshotOpenCount === 0 &&
    finalState.local.activeReservationCount === 0;

  if (!clean) {
    return { terminalized: false, reason: "GRID_EXIT_FINAL_CONVERGENCE_NOT_CLEAN" };
  }

  const [result] = await db.query(
    `UPDATE live_grid_strategy_list
        SET enabled = 'N',
            regimeStatus = 'ENDED',
            regimeEndReason = 'EXPLICIT_GRID_EXIT',
            longLegStatus = 'IDLE',
            shortLegStatus = 'IDLE',
            longEntryOrderId = NULL,
            shortEntryOrderId = NULL,
            longExitOrderId = NULL,
            shortExitOrderId = NULL,
            longStopOrderId = NULL,
            shortStopOrderId = NULL,
            longQty = 0,
            shortQty = 0,
            updatedAt = NOW()
      WHERE id = ?
        AND uid = ?
        AND symbol = ?
        AND bunbong = ?
        AND enabled = 'Y'
      LIMIT 1`,
    [row.id, row.uid, normalizeSymbol(payload.symbol), payload.bunbong]
  );

  return {
    terminalized: result?.affectedRows === 1,
    reason: result?.affectedRows === 1 ? "GRID_EXIT_CONVERGED_TERMINALIZED" : "GRID_EXIT_TERMINALIZE_NO_ROW_UPDATED",
  };
};

const executeGridExitForRoute = async ({
  payload = {},
  previewResult = {},
  featureFlags = {},
  env = process.env,
  db = defaultDb,
  coin = require("./coin"),
  gridEngine = require("./grid-engine"),
  positionOwnershipApi = positionOwnership,
} = {}) => {
  const executionGate = isGridExitRouteExecutionEnabled({ env, featureFlags });
  const targetPlan = collectEligibleExitTargets({
    previewResult,
    payload,
    maxTargets: Number(env.GRID_EXIT_ROUTE_EXECUTION_MAX_TARGETS || 1),
  });

  if (!executionGate.enabled || targetPlan.blocked) {
    return {
      ok: !targetPlan.blocked,
      mode: "AUDIT_ONLY",
      requested: 0,
      processed: 0,
      ignoredActive: Number(previewResult.ignoredActive || 0),
      executionGate,
      targetPlan,
      resultCode: executionGate.enabled ? "GRID_EXIT_ROUTE_NO_EXECUTABLE_TARGET" : "GRID_EXIT_ALERT_AUDIT_ONLY",
    };
  }

  const target = targetPlan.eligible[0];
  const row = await loadLiveGridRowForExit({ db, target, payload });
  if (!row) {
    return {
      ok: false,
      mode: "EXECUTION_BLOCKED",
      requested: 0,
      processed: 0,
      ignoredActive: Number(previewResult.ignoredActive || 0),
      executionGate,
      targetPlan,
      resultCode: "GRID_EXIT_ROUTE_TARGET_ROW_NOT_FOUND",
    };
  }

  const storedKey = getStoredGridRegimeKey(row);
  if (!storedKey || storedKey !== normalizeText(payload.gridRegimeKey)) {
    return {
      ok: false,
      mode: "EXECUTION_BLOCKED",
      requested: 0,
      processed: 0,
      ignoredActive: Number(previewResult.ignoredActive || 0),
      executionGate,
      targetPlan,
      resultCode: storedKey ? "GRID_EXIT_ROUTE_KEY_MISMATCH" : "GRID_EXIT_ROUTE_ROW_KEY_MISSING",
      storedGridRegimeKey: storedKey || null,
    };
  }

  const preCancelLocal = await loadPidLocalExitState({ db, uid: row.uid, pid: row.id, symbol: row.symbol });

  await db.query(
    `UPDATE live_grid_strategy_list
        SET regimeStatus = 'CANCEL_INTENT_PENDING',
            regimeEndReason = 'EXPLICIT_GRID_EXIT',
            updatedAt = NOW()
      WHERE id = ?
        AND uid = ?
        AND symbol = ?
        AND enabled = 'Y'
      LIMIT 1`,
    [row.id, row.uid, normalizeSymbol(row.symbol)]
  );

  const cancelCount = await coin.cancelGridOrders({
    uid: row.uid,
    symbol: row.symbol,
    pid: row.id,
    leg: null,
    includeEntries: true,
    includeExits: true,
  });

  let synced = null;
  if (typeof gridEngine.truthSyncLiveGridRow === "function") {
    synced = await gridEngine.truthSyncLiveGridRow({ row });
  }

  const afterCancelLocal = await loadPidLocalExitState({ db, uid: row.uid, pid: row.id, symbol: row.symbol });
  const closeResults = [];
  for (const leg of ["LONG", "SHORT"]) {
    const localQty = Math.max(
      toNumber(afterCancelLocal.snapshotOpenQtyByLeg[leg]),
      toNumber(afterCancelLocal.ownerOpenQtyByLeg[leg]),
      toNumber(preCancelLocal.snapshotOpenQtyByLeg[leg]),
      toNumber(preCancelLocal.ownerOpenQtyByLeg[leg])
    );
    const exchangeQty = await readExchangeLegQty({ coin, uid: row.uid, symbol: row.symbol, leg });
    const closeQty = Math.min(Math.max(localQty, 0), Math.max(exchangeQty, 0));
    if (!(closeQty > 0)) {
      continue;
    }

    const closeResult = await coin.closeGridLegMarketOrder({
      uid: row.uid,
      pid: row.id,
      symbol: row.symbol,
      leg,
      qty: closeQty,
      gridRegimeKey: payload.gridRegimeKey,
      closeReason: "EXPLICIT_GRID_EXIT",
      reservationKind: "GRID_EXIT_MARKET_CLOSE",
      closeNote: "explicit-grid-exit-route",
    });
    closeResults.push({ leg, closeQty, closeResult });
  }

  if (typeof gridEngine.truthSyncLiveGridRow === "function") {
    synced = await gridEngine.truthSyncLiveGridRow({ row });
  }

  const postCloseExchange = {
    LONG: await readExchangeLegQty({ coin, uid: row.uid, symbol: row.symbol, leg: "LONG" }),
    SHORT: await readExchangeLegQty({ coin, uid: row.uid, symbol: row.symbol, leg: "SHORT" }),
  };
  if (toNumber(postCloseExchange.LONG) <= 0 && toNumber(postCloseExchange.SHORT) <= 0) {
    if (positionOwnershipApi && typeof positionOwnershipApi.releaseAllPositionBucketOwnersByPid === "function") {
      await positionOwnershipApi.releaseAllPositionBucketOwnersByPid({
        ownerPid: row.id,
        ownerStrategyCategory: "grid",
      });
    }
    if (typeof gridEngine.truthSyncLiveGridRow === "function") {
      synced = await gridEngine.truthSyncLiveGridRow({ row });
    }
  }

  const finalLocal = await loadPidLocalExitState({ db, uid: row.uid, pid: row.id, symbol: row.symbol });
  const finalExchange = {
    LONG: await readExchangeLegQty({ coin, uid: row.uid, symbol: row.symbol, leg: "LONG" }),
    SHORT: await readExchangeLegQty({ coin, uid: row.uid, symbol: row.symbol, leg: "SHORT" }),
  };
  const terminalize = await finalizeGridExitIfConverged({
    db,
    row,
    payload,
    finalState: {
      local: finalLocal,
      exchangeQtyByLeg: finalExchange,
    },
  });

  const finalConverged =
    terminalize.terminalized === true &&
    toNumber(finalExchange.LONG) <= 0 &&
    toNumber(finalExchange.SHORT) <= 0 &&
    finalLocal.ownerNonzeroCount === 0 &&
    finalLocal.ownerResidueCount === 0 &&
    finalLocal.snapshotOpenCount === 0 &&
    finalLocal.activeReservationCount === 0;

  return {
    ok: true,
    mode: "ACTUAL",
    requested: 1,
    processed: finalConverged ? 1 : 0,
    ignoredActive: 0,
    resultCode: finalConverged ? "GRID_EXIT_CONVERGED" : "GRID_EXIT_EXECUTED_CONVERGENCE_PENDING",
    target: {
      uid: row.uid,
      pid: row.id,
      symbol: row.symbol,
      timeframe: row.bunbong,
      strategySignal: row.strategySignal,
      gridRegimeKey: payload.gridRegimeKey,
    },
    cancelCount,
    closeResults,
    closeDecisionLocal: {
      preCancelOwnerOpenQtyByLeg: preCancelLocal.ownerOpenQtyByLeg,
      preCancelSnapshotOpenQtyByLeg: preCancelLocal.snapshotOpenQtyByLeg,
      afterCancelOwnerOpenQtyByLeg: afterCancelLocal.ownerOpenQtyByLeg,
      afterCancelSnapshotOpenQtyByLeg: afterCancelLocal.snapshotOpenQtyByLeg,
    },
    truthSync: synced,
    finalLocal: {
      ownerNonzeroCount: finalLocal.ownerNonzeroCount,
      ownerResidueCount: finalLocal.ownerResidueCount,
      snapshotOpenCount: finalLocal.snapshotOpenCount,
      activeReservationCount: finalLocal.activeReservationCount,
    },
    finalExchange,
    terminalize,
    finalConverged,
    executionGate,
    targetPlan,
  };
};

module.exports = {
  isGridExitRouteExecutionEnabled,
  collectEligibleExitTargets,
  executeGridExitForRoute,
};
