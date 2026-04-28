const pidPositionLedger = require("./pid-position-ledger");

const SIGNAL_RUNTIME_LABELS = {
  READY: "대기중",
  EXACT_WAIT: "진입중",
  EXACT: "포지션 보유중",
};

const GRID_RUNTIME_LABELS = {
  READY: "대기중",
  GRIDDING: "횡보 공략중",
};

const CONTROL_STATE_LABELS = {
  ON: "사용중",
  OFF: "중지",
};

const normalizeStatus = (value) => String(value || "").trim().toUpperCase();

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const normalizeSignalType = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const hasOpenSnapshotRows = (rows = []) =>
  rows.some((row) => normalizeStatus(row?.status) === "OPEN" && toNumber(row?.openQty) > 0);

const hasActiveReservations = (rows = []) =>
  rows.some((row) => ["ACTIVE", "PARTIAL"].includes(normalizeStatus(row?.status)));

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

  if (hasOpenSnapshotRows(snapshots) || hasActiveReservations(reservations)) {
    return "GRIDDING";
  }

  if (item?.longEntryOrderId || item?.shortEntryOrderId) {
    return "GRIDDING";
  }

  return "READY";
};

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
    userStatusLabel: runtimeState === "EXACT" ? "포지션 보유중" : "대기중",
    openQty,
    entryPrice: entryPrice > 0 ? entryPrice : null,
    targetTakeProfitPrice: targetTakeProfitPrice && targetTakeProfitPrice > 0 ? targetTakeProfitPrice : null,
    tradeAmount,
    stopConditionLabel: buildSignalStopConditionLabel(item),
    realizedPnlTotal,
    legacyStatus: item.status || null,
  };
};

const decorateGridItemSync = (item = {}, options = {}) => {
  if (!item || typeof item !== "object") {
    return item;
  }

  const enabled = getItemEnabled(item);
  const runtimeState = deriveGridRuntimeState(item, options);
  const snapshots = options.snapshots || item.pidSnapshots || [];
  const longOpen = snapshots.some(
    (row) => normalizeStatus(row?.positionSide) === "LONG" && toNumber(row?.openQty) > 0
  );
  const shortOpen = snapshots.some(
    (row) => normalizeStatus(row?.positionSide) === "SHORT" && toNumber(row?.openQty) > 0
  );

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
    userOverallStatusLabel: runtimeState === "GRIDDING" ? "횡보 공략중" : "대기중",
    longPositionStatusLabel: longOpen ? "포지션 보유중" : "Ready",
    shortPositionStatusLabel: shortOpen ? "포지션 보유중" : "Ready",
    tradeAmount: toNumber(item?.margin) * toNumber(item?.leverage),
    legacyRegimeStatus: item.regimeStatus || null,
  };
};

const decorateSignalCollectionSync = (items = [], context = {}) => {
  const snapshotMap = context.snapshotMap || new Map();
  const reservationMap = context.reservationMap || new Map();

  return (items || []).map((item) =>
    decorateSignalItemSync(item, {
      snapshots: snapshotMap.get(Number(item?.id || 0)) || [],
      reservations: reservationMap.get(Number(item?.id || 0)) || [],
    })
  );
};

const decorateGridCollectionSync = (items = [], context = {}) => {
  const snapshotMap = context.snapshotMap || new Map();
  const reservationMap = context.reservationMap || new Map();

  return (items || []).map((item) =>
    decorateGridItemSync(item, {
      snapshots: snapshotMap.get(Number(item?.id || 0)) || [],
      reservations: reservationMap.get(Number(item?.id || 0)) || [],
    })
  );
};

const loadStrategyContext = async ({ uid, strategyCategory, items = [] } = {}) => {
  const pids = (items || [])
    .map((item) => Number(item?.id || 0))
    .filter((pid) => pid > 0);

  if (!uid || !strategyCategory || pids.length === 0) {
    return {
      snapshotMap: new Map(),
      reservationMap: new Map(),
    };
  }

  const [snapshotRows, reservationRows] = await Promise.all([
    pidPositionLedger.loadSnapshotsByPids({ uid, strategyCategory, pids }),
    pidPositionLedger.loadActiveReservationsByPids({ uid, strategyCategory, pids }),
  ]);

  return {
    snapshotMap: toPidIndexMap(snapshotRows),
    reservationMap: toPidIndexMap(reservationRows),
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
  getItemEnabled,
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
