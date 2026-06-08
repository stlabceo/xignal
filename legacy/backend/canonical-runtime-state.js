const db = require("./database/connect/config");
const pidPositionLedger = require("./pid-position-ledger");

const SIGNAL_RUNTIME_LABELS = {
  READY: "대기중",
  EXACT_WAIT: "진입중",
  EXACT: "포지션 보유중",
};

const GRID_RUNTIME_LABELS = {
  READY: "대기중",
  GRIDDING: "횡보공략중",
};

const CONTROL_STATE_LABELS = {
  ON: "운용중",
  OFF: "중지",
};

const normalizeStatus = (value) => String(value || "").trim().toUpperCase();

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const GRID_TERMINAL_SAFE_CLASSIFICATION = "DISABLED_NO_EXPOSURE";
const GRID_TERMINAL_SAFE_EXCHANGE_UNKNOWN = "EXCHANGE_EVIDENCE_NOT_PROVIDED";

const GRID_TERMINAL_LEG_STATES = new Set([
  "",
  "IDLE",
  "CLOSED",
  "ENDED",
  "CANCELED",
  "CANCELLED",
  "CANCEL_VERIFIED_GONE",
  "EXPIRED",
  "REJECTED",
]);

const GRID_ORDER_REF_FIELDS = [
  "longEntryOrderId",
  "shortEntryOrderId",
  "longExitOrderId",
  "shortExitOrderId",
  "longStopOrderId",
  "shortStopOrderId",
  "longEntryClientOrderId",
  "shortEntryClientOrderId",
  "longExitClientOrderId",
  "shortExitClientOrderId",
  "longStopClientOrderId",
  "shortStopClientOrderId",
];

const GRID_ACTIVE_RESERVATION_STATES = new Set([
  "ACTIVE",
  "PARTIAL",
  "CANCEL_REQUESTED",
  "CANCEL_PENDING",
  "UNKNOWN_CANCEL_STATE",
  "PENDING",
  "RUNNING",
  "RETRY",
]);

const normalizeSignalType = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const hasOpenSnapshotRows = (rows = []) =>
  rows.some((row) => normalizeStatus(row?.status) === "OPEN" && toNumber(row?.openQty) > 0);

const hasActiveReservations = (rows = []) =>
  rows.some((row) => ["ACTIVE", "PARTIAL"].includes(normalizeStatus(row?.status)));

const hasOrderRefValue = (value) => {
  if (value === null || value === undefined) {
    return false;
  }
  const raw = String(value).trim();
  return Boolean(raw && raw !== "0");
};

const getGridExchangeOrderCount = (exchangeEvidence = {}, field) => {
  const direct = exchangeEvidence?.[`${field}Count`];
  if (direct !== undefined && direct !== null) {
    return toNumber(direct);
  }
  const rows = exchangeEvidence?.[field];
  return Array.isArray(rows) ? rows.length : 0;
};

const getGridExchangeOpenQty = (exchangeEvidence = {}) => {
  const directLong = exchangeEvidence.longPositionAmt ?? exchangeEvidence.longQty;
  const directShort = exchangeEvidence.shortPositionAmt ?? exchangeEvidence.shortQty;
  if (directLong !== undefined || directShort !== undefined) {
    return Math.abs(toNumber(directLong)) + Math.abs(toNumber(directShort));
  }
  const positions = exchangeEvidence.positions || exchangeEvidence.positionRisk || [];
  return (Array.isArray(positions) ? positions : []).reduce(
    (sum, row) => sum + Math.abs(toNumber(row?.positionAmt ?? row?.openQty ?? row?.qty)),
    0
  );
};

const hasProvidedExchangeEvidence = (exchangeEvidence) =>
  exchangeEvidence && typeof exchangeEvidence === "object";

const classifyGridTerminalSafeProjection = (item = {}, options = {}) => {
  const snapshots = options.snapshots || item.pidSnapshots || [];
  const reservations = options.reservations || item.pidReservations || [];
  const ownerRows = options.ownerRows || item.pidOwners || item.ownerRows || [];
  const exchangeEvidence = options.exchangeEvidence || item.exchangeEvidence || null;
  const requireExchange = options.requireExchange === true;
  const blockers = [];

  if (getItemEnabled(item)) {
    blockers.push("ENABLED");
  }

  const longLegStatus = normalizeStatus(item.longLegStatus);
  const shortLegStatus = normalizeStatus(item.shortLegStatus);
  if (!GRID_TERMINAL_LEG_STATES.has(longLegStatus)) {
    blockers.push("LONG_LEG_NONTERMINAL");
  }
  if (!GRID_TERMINAL_LEG_STATES.has(shortLegStatus)) {
    blockers.push("SHORT_LEG_NONTERMINAL");
  }

  if (toNumber(item.longQty) !== 0) {
    blockers.push("LONG_QTY_NONZERO");
  }
  if (toNumber(item.shortQty) !== 0) {
    blockers.push("SHORT_QTY_NONZERO");
  }

  if (GRID_ORDER_REF_FIELDS.some((field) => hasOrderRefValue(item?.[field]))) {
    blockers.push("ORDER_REF_PRESENT");
  }

  if ((ownerRows || []).some((row) => toNumber(row?.ownedQty) !== 0 || toNumber(row?.reservedCloseQty) !== 0)) {
    blockers.push("OWNER_NONZERO");
  }

  if ((snapshots || []).some((row) => normalizeStatus(row?.status) === "OPEN" || toNumber(row?.openQty) !== 0)) {
    blockers.push("SNAPSHOT_OPEN");
  }

  if ((reservations || []).some((row) => GRID_ACTIVE_RESERVATION_STATES.has(normalizeStatus(row?.status)))) {
    blockers.push("ACTIVE_RESERVATION");
  }

  if (hasProvidedExchangeEvidence(exchangeEvidence)) {
    if (getGridExchangeOpenQty(exchangeEvidence) !== 0) {
      blockers.push("EXCHANGE_POSITION_OPEN");
    }
    if (getGridExchangeOrderCount(exchangeEvidence, "openOrders") !== 0) {
      blockers.push("OPEN_ORDERS_PRESENT");
    }
    if (getGridExchangeOrderCount(exchangeEvidence, "openAlgoOrders") !== 0) {
      blockers.push("OPEN_ALGO_ORDERS_PRESENT");
    }
  } else if (requireExchange) {
    blockers.push(GRID_TERMINAL_SAFE_EXCHANGE_UNKNOWN);
  }

  const terminalSafe = blockers.length === 0;
  return {
    terminalSafe,
    classification: terminalSafe ? GRID_TERMINAL_SAFE_CLASSIFICATION : null,
    blockers,
    exchangeVerified: hasProvidedExchangeEvidence(exchangeEvidence),
  };
};

const sumSnapshotField = (rows = [], field) =>
  (rows || []).reduce((sum, row) => sum + toNumber(row?.[field]), 0);

const getSignalEntryPrice = (item = {}, snapshots = []) => {
  if (toNumber(item?.r_exactPrice) > 0) {
    return toNumber(item.r_exactPrice);
  }

  const openSnapshot = (snapshots || []).find((row) => toNumber(row?.openQty) > 0);
  if (toNumber(openSnapshot?.avgEntryPrice) > 0) {
    return toNumber(openSnapshot.avgEntryPrice);
  }

  if (normalizeStatus(item?.status) === "EXACT_WAIT" && toNumber(item?.r_signalPrice) > 0) {
    return toNumber(item.r_signalPrice);
  }

  return 0;
};

const getSignalTargetTakeProfitPrice = (item = {}, entryPrice = 0) => {
  const profitPercent = toNumber(item?.profit);
  if (!(entryPrice > 0) || !(profitPercent > 0)) {
    return null;
  }

  const signalType = normalizeSignalType(item?.signalType || item?.r_signalType);
  if (signalType === "SELL") {
    return entryPrice * (1 - profitPercent / 100);
  }

  return entryPrice * (1 + profitPercent / 100);
};

const buildSignalStopConditionLabel = (item = {}) => {
  const labels = [];
  const stopLossPercent = toNumber(item?.stopLoss);
  if (stopLossPercent > 0) {
    labels.push(`${stopLossPercent}%`);
  }
  return labels.length ? labels.join(" or ") : "-";
};

const toPidIndexMap = (rows = []) => {
  const map = new Map();
  rows.forEach((row) => {
    const pid = Number(row?.pid || 0);
    if (!pid) {
      return;
    }

    if (!map.has(pid)) {
      map.set(pid, []);
    }

    map.get(pid).push(row);
  });
  return map;
};

const getItemPid = (item = {}) => Number(item?.id || item?.pid || item?.playId || 0);

const getItemEnabled = (item = {}) => {
  if (typeof item.enabled === "boolean") {
    return item.enabled;
  }

  if (item.enabled !== undefined && item.enabled !== null) {
    const enabled = String(item.enabled).trim().toUpperCase();
    if (enabled === "Y" || enabled === "TRUE" || enabled === "1" || enabled === "ON") {
      return true;
    }
    if (enabled === "N" || enabled === "FALSE" || enabled === "0" || enabled === "OFF") {
      return false;
    }
  }

  return false;
};

const deriveFlatDisplayLabel = (enabled) => (enabled ? "운용중 / 신호대기" : "OFF / 대기중");

const deriveSignalUserStatusLabel = ({ enabled, runtimeState, openQty }) => {
  if (runtimeState === "EXACT" || toNumber(openQty) > 0) {
    return "포지션 보유중";
  }
  if (runtimeState === "EXACT_WAIT") {
    return "진입중";
  }
  return deriveFlatDisplayLabel(enabled);
};

const deriveGridUserStatusLabel = ({ enabled, runtimeState, longOpen, shortOpen }) => {
  if (runtimeState === "GRIDDING") {
    if (longOpen && shortOpen) {
      return "양방향 보유";
    }
    if (longOpen) {
      return "LONG 보유";
    }
    if (shortOpen) {
      return "SHORT 보유";
    }
    return enabled ? "횡보공략중" : "확인 필요";
  }
  return deriveFlatDisplayLabel(enabled);
};

const deriveSignalRuntimeState = (item = {}, options = {}) => {
  const snapshots = options.snapshots || item.pidSnapshots || [];

  if (hasOpenSnapshotRows(snapshots)) {
    return "EXACT";
  }

  const hasEntryPending =
    normalizeStatus(item?.status) === "EXACT_WAIT" ||
    normalizeStatus(item?.runtimeState) === "EXACT_WAIT";

  if (hasEntryPending) {
    return "EXACT_WAIT";
  }

  return "READY";
};

const deriveGridRuntimeState = (item = {}, options = {}) => {
  const snapshots = options.snapshots || item.pidSnapshots || [];
  const reservations = options.reservations || item.pidReservations || [];
  const regimeStatus = normalizeStatus(item?.regimeStatus);

  if (hasOpenSnapshotRows(snapshots) || hasActiveReservations(reservations)) {
    return "GRIDDING";
  }

  if (item?.longEntryOrderId || item?.shortEntryOrderId) {
    return "GRIDDING";
  }

  if (
    regimeStatus === "ACTIVE" ||
    regimeStatus === "PAIR_ARM_PENDING" ||
    regimeStatus === "PAIR_ARM_FAILED" ||
    regimeStatus === "PAIR_ROLLBACK_PENDING" ||
    regimeStatus === "PAIR_ONE_LEG_FILLED" ||
    regimeStatus === "PAIR_ONE_LEG_PROTECTED" ||
    regimeStatus === "PAIR_ONE_LEG_UNPROTECTED" ||
    regimeStatus === "GRID_PARTIAL_PROTECTION" ||
    regimeStatus === "GRID_UNPROTECTED" ||
    regimeStatus === "REENTRY_INTENT_PENDING" ||
    regimeStatus === "REENTRY_CREATE_RUNNING" ||
    regimeStatus === "REENTRY_PENDING" ||
    regimeStatus === "REENTRY_FAILED" ||
    regimeStatus === "REENTRY_BLOCKED_PRICE_STALE" ||
    regimeStatus === "REENTRY_BLOCKED_OWNERSHIP" ||
    regimeStatus === "REENTRY_BLOCKED_REDIS" ||
    regimeStatus === "CANCEL_INTENT_PENDING" ||
    regimeStatus === "CANCEL_RUNNING" ||
    regimeStatus === "CANCEL_VERIFY_PENDING" ||
    regimeStatus === "CANCEL_FAILED_ACTIVE_ORDER_REMAINS" ||
    regimeStatus === "CANCEL_VERIFIED_GONE" ||
    regimeStatus === "CANCEL_BLOCKED_REDIS" ||
    regimeStatus === "CLOSE_INTENT_PENDING" ||
    regimeStatus === "CLOSE_RUNNING" ||
    regimeStatus === "CLOSE_FAILED" ||
    regimeStatus === "CLOSE_BLOCKED_OWNERSHIP" ||
    regimeStatus === "CLOSE_RESERVED_DUPLICATE" ||
    regimeStatus === "CLOSE_BLOCKED_REDIS" ||
    regimeStatus === "GMANUAL_QUEUED" ||
    regimeStatus === "CONTROLLED_CLOSE_QUEUED" ||
    regimeStatus === "GRID_REENTRY_STALE" ||
    regimeStatus === "GRID_REENTRY_FAILED" ||
    regimeStatus === "GRID_SL_CLEANUP_PENDING" ||
    regimeStatus === "GRID_SL_OPPOSITE_CRITICAL"
  ) {
    return "GRIDDING";
  }

  return "READY";
};

const GRID_CRITICAL_REGIME_STATES = new Set([
  "PAIR_ARM_FAILED",
  "PAIR_ROLLBACK_PENDING",
  "PAIR_ONE_LEG_FILLED",
  "PAIR_ONE_LEG_PROTECTED",
  "PAIR_ONE_LEG_UNPROTECTED",
  "GRID_PARTIAL_PROTECTION",
  "GRID_UNPROTECTED",
  "REENTRY_INTENT_PENDING",
  "REENTRY_CREATE_RUNNING",
  "REENTRY_PENDING",
  "REENTRY_FAILED",
  "REENTRY_BLOCKED_PRICE_STALE",
  "REENTRY_BLOCKED_OWNERSHIP",
  "REENTRY_BLOCKED_REDIS",
  "CANCEL_INTENT_PENDING",
  "CANCEL_RUNNING",
  "CANCEL_VERIFY_PENDING",
  "CANCEL_FAILED_ACTIVE_ORDER_REMAINS",
  "CANCEL_VERIFIED_GONE",
  "CANCEL_BLOCKED_REDIS",
  "CLOSE_INTENT_PENDING",
  "CLOSE_RUNNING",
  "CLOSE_FAILED",
  "CLOSE_BLOCKED_OWNERSHIP",
  "CLOSE_RESERVED_DUPLICATE",
  "CLOSE_BLOCKED_REDIS",
  "GMANUAL_QUEUED",
  "CONTROLLED_CLOSE_QUEUED",
  "GRID_REENTRY_STALE",
  "GRID_REENTRY_FAILED",
  "GRID_SL_CLEANUP_PENDING",
  "GRID_SL_OPPOSITE_CRITICAL",
]);

const decorateSignalItemSync = (item = {}, options = {}) => {
  if (!item || typeof item !== "object") {
    return item;
  }

  const enabled = getItemEnabled(item);
  const snapshots = options.snapshots || item.pidSnapshots || [];
  const runtimeState = deriveSignalRuntimeState(item, options);
  const openQty = sumSnapshotField(snapshots, "openQty") || toNumber(item?.r_qty);
  const entryPrice = getSignalEntryPrice(item, snapshots);
  const targetTakeProfitPrice = getSignalTargetTakeProfitPrice(item, entryPrice);
  const tradeAmount = toNumber(item?.margin) * toNumber(item?.leverage);
  const realizedPnlTotal =
    toNumber(item?.r_splitRealizedPnl) !== 0 ? toNumber(item?.r_splitRealizedPnl) : toNumber(item?.r_pol_sum);

  return {
    ...item,
    enabled,
    controlState: enabled ? "ON" : "OFF",
    controlStateLabel: enabled ? CONTROL_STATE_LABELS.ON : CONTROL_STATE_LABELS.OFF,
    runtimeState,
    runtimeStateLabel: SIGNAL_RUNTIME_LABELS[runtimeState] || runtimeState,
    userStatusLabel: runtimeState === "EXACT" ? "포지션 보유중" : enabled ? "운용중" : "대기중",
    openQty,
    entryPrice: entryPrice > 0 ? entryPrice : null,
    targetTakeProfitPrice: targetTakeProfitPrice && targetTakeProfitPrice > 0 ? targetTakeProfitPrice : null,
    tradeAmount,
    stopConditionLabel: buildSignalStopConditionLabel(item),
    realizedPnlTotal,
    legacyStatus: item.status || null,
    userStatusLabel: deriveSignalUserStatusLabel({ enabled, runtimeState, openQty }),
    displayStatus: deriveSignalUserStatusLabel({ enabled, runtimeState, openQty }),
  };
};

const decorateGridItemSync = (item = {}, options = {}) => {
  if (!item || typeof item !== "object") {
    return item;
  }

  const enabled = getItemEnabled(item);
  const runtimeState = deriveGridRuntimeState(item, options);
  const regimeStatus = normalizeStatus(item?.regimeStatus);
  const gridProtectionCritical = GRID_CRITICAL_REGIME_STATES.has(regimeStatus);
  const snapshots = options.snapshots || item.pidSnapshots || [];
  const terminalSafeProjection = classifyGridTerminalSafeProjection(item, options);
  const longOpen = snapshots.some(
    (row) => normalizeStatus(row?.positionSide) === "LONG" && toNumber(row?.openQty) > 0
  );
  const shortOpen = snapshots.some(
    (row) => normalizeStatus(row?.positionSide) === "SHORT" && toNumber(row?.openQty) > 0
  );

  const userOverallStatusLabel =
    runtimeState === "GRIDDING"
      ? longOpen && shortOpen
        ? "양방향 보유"
        : longOpen
          ? "LONG 보유"
          : shortOpen
            ? "SHORT 보유"
            : "횡보공략중"
      : "대기중";

  return {
    ...item,
    strategyCategory: "GRID",
    enabled,
    controlState: enabled ? "ON" : "OFF",
    controlStateLabel: enabled ? CONTROL_STATE_LABELS.ON : CONTROL_STATE_LABELS.OFF,
    runtimeState,
    runtimeStateLabel: GRID_RUNTIME_LABELS[runtimeState] || runtimeState,
    gridRuntimeState: runtimeState,
    gridRuntimeStateLabel: GRID_RUNTIME_LABELS[runtimeState] || runtimeState,
    userOverallStatusLabel,
    longPositionStatusLabel: longOpen ? "LONG 보유" : "진입 대기",
    shortPositionStatusLabel: shortOpen ? "SHORT 보유" : "진입 대기",
    tradeAmount: toNumber(item?.margin) * toNumber(item?.leverage),
    legacyRegimeStatus: item.regimeStatus || null,
    gridProtectionState: gridProtectionCritical ? regimeStatus : null,
    gridProtectionCritical,
    terminalSafeDisplay: terminalSafeProjection.terminalSafe,
    terminalSafeClassification: terminalSafeProjection.classification,
    terminalSafeBlockers: terminalSafeProjection.blockers,
    terminalSafeExchangeVerified: terminalSafeProjection.exchangeVerified,
    displayRegimeStatus: terminalSafeProjection.terminalSafe
      ? terminalSafeProjection.classification
      : item.regimeStatus || item.status || null,
    status: terminalSafeProjection.terminalSafe
      ? terminalSafeProjection.classification
      : item.status,
    userOverallStatusLabel: deriveGridUserStatusLabel({ enabled, runtimeState, longOpen, shortOpen }),
    displayStatus: terminalSafeProjection.terminalSafe
      ? terminalSafeProjection.classification
      : deriveGridUserStatusLabel({ enabled, runtimeState, longOpen, shortOpen }),
  };
};

const decorateSignalCollectionSync = (items = [], context = {}) => {
  const snapshotMap = context.snapshotMap || new Map();
  const reservationMap = context.reservationMap || new Map();

  return (items || []).map((item) =>
    decorateSignalItemSync(item, {
      snapshots: snapshotMap.get(getItemPid(item)) || [],
      reservations: reservationMap.get(getItemPid(item)) || [],
    })
  );
};

const decorateGridCollectionSync = (items = [], context = {}) => {
  const snapshotMap = context.snapshotMap || new Map();
  const reservationMap = context.reservationMap || new Map();
  const ownerMap = context.ownerMap || new Map();

  return (items || []).map((item) =>
    decorateGridItemSync(item, {
      snapshots: snapshotMap.get(getItemPid(item)) || [],
      reservations: reservationMap.get(getItemPid(item)) || [],
      ownerRows: ownerMap.get(getItemPid(item)) || [],
    })
  );
};

const loadGridOwnerRowsByPids = async ({ uid, pids = [] } = {}) => {
  if (!uid || !Array.isArray(pids) || pids.length === 0) {
    return [];
  }
  const placeholders = pids.map(() => "?").join(",");
  const [rows] = await db.query(
    `SELECT ownerPid AS pid, positionSide, ownerState, status, ownedQty, reservedCloseQty
       FROM live_position_bucket_owner
      WHERE uid = ?
        AND ownerStrategyCategory = 'grid'
        AND ownerPid IN (${placeholders})`,
    [uid, ...pids]
  );
  return rows || [];
};

const loadStrategyContext = async ({ uid, strategyCategory, items = [] } = {}) => {
  const pids = (items || [])
    .map((item) => getItemPid(item))
    .filter((pid) => pid > 0);

  if (!uid || !strategyCategory || pids.length === 0) {
    return {
      snapshotMap: new Map(),
      reservationMap: new Map(),
      ownerMap: new Map(),
    };
  }

  const normalizedStrategyCategory = String(strategyCategory || "").trim().toLowerCase();
  const [snapshotRows, reservationRows, ownerRows] = await Promise.all([
    pidPositionLedger.loadSnapshotsByPids({ uid, strategyCategory, pids }),
    pidPositionLedger.loadActiveReservationsByPids({ uid, strategyCategory, pids }),
    normalizedStrategyCategory === "grid"
      ? loadGridOwnerRowsByPids({ uid, pids })
      : Promise.resolve([]),
  ]);

  return {
    snapshotMap: toPidIndexMap(snapshotRows),
    reservationMap: toPidIndexMap(reservationRows),
    ownerMap: toPidIndexMap(ownerRows),
  };
};

const decorateSignalCollection = async (items = [], { uid } = {}) => {
  const context = await loadStrategyContext({
    uid,
    strategyCategory: "signal",
    items,
  });
  return decorateSignalCollectionSync(items, context);
};

const decorateSignalItem = async (item = {}, { uid } = {}) => {
  const rows = await decorateSignalCollection(item ? [item] : [], { uid });
  return rows[0] || null;
};

const decorateGridCollection = async (items = [], { uid } = {}) => {
  const context = await loadStrategyContext({
    uid,
    strategyCategory: "grid",
    items,
  });
  return decorateGridCollectionSync(items, context);
};

const decorateGridItem = async (item = {}, { uid } = {}) => {
  const rows = await decorateGridCollection(item ? [item] : [], { uid });
  return rows[0] || null;
};

module.exports = {
  CONTROL_STATE_LABELS,
  SIGNAL_RUNTIME_LABELS,
  GRID_RUNTIME_LABELS,
  GRID_TERMINAL_SAFE_CLASSIFICATION,
  getItemEnabled,
  classifyGridTerminalSafeProjection,
  deriveSignalRuntimeState,
  deriveGridRuntimeState,
  decorateSignalItemSync,
  decorateSignalCollectionSync,
  decorateGridItemSync,
  decorateGridCollectionSync,
  decorateSignalCollection,
  decorateSignalItem,
  decorateGridCollection,
  decorateGridItem,
};
