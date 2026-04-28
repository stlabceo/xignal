const normalizeStatus = (value) => String(value || "").trim().toUpperCase();

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const resolveSignalPositionSide = (item = {}) => {
  const signalType = normalizeStatus(item.r_signalType || item.signalType);
  if (signalType === "SELL" || signalType === "SHORT") {
    return "SHORT";
  }
  if (signalType === "BUY" || signalType === "LONG") {
    return "LONG";
  }
  return "";
};

const isActiveReservation = (row = {}) =>
  ["ACTIVE", "PARTIAL"].includes(normalizeStatus(row.status));

const getSnapshotOpenQty = (snapshots = [], positionSide = "") => {
  const normalizedSide = normalizeStatus(positionSide);
  return (snapshots || [])
    .filter((row) => !normalizedSide || normalizeStatus(row.positionSide) === normalizedSide)
    .filter((row) => normalizeStatus(row.status) === "OPEN")
    .reduce((sum, row) => sum + toNumber(row.openQty), 0);
};

const getExchangeOpenQty = (exchangePositions = [], symbol = "", positionSide = "") => {
  const normalizedSymbol = normalizeStatus(symbol);
  const normalizedSide = normalizeStatus(positionSide);
  return (exchangePositions || [])
    .filter((row) => !normalizedSymbol || normalizeStatus(row.symbol) === normalizedSymbol)
    .filter((row) => !normalizedSide || normalizeStatus(row.positionSide) === normalizedSide)
    .reduce((sum, row) => sum + Math.abs(toNumber(row.positionAmt)), 0);
};

const detectSignalForceOffCloseRequirement = ({
  item = {},
  runtimeStatus = "",
  snapshots = [],
  reservations = [],
  exchangePositions = [],
} = {}) => {
  const positionSide = resolveSignalPositionSide(item)
    || normalizeStatus((snapshots || []).find((row) => toNumber(row.openQty) > 0)?.positionSide);
  const legacyStatus = normalizeStatus(item.status || item.legacyStatus);
  const normalizedRuntimeStatus = normalizeStatus(runtimeStatus);
  const snapshotOpenQty = getSnapshotOpenQty(snapshots, positionSide);
  const exchangeOpenQty = getExchangeOpenQty(exchangePositions, item.symbol, positionSide);
  const legacyQty = toNumber(item.r_qty);
  const activeReservationCount = (reservations || []).filter(isActiveReservation).length;

  if (snapshotOpenQty > 0) {
    return {
      closeRequired: true,
      reason: normalizedRuntimeStatus === "READY"
        ? "RUNTIME_READY_BUT_SNAPSHOT_OPEN"
        : "SNAPSHOT_OPEN",
      positionSide,
      snapshotStatus: "OPEN",
      openQty: snapshotOpenQty,
      exchangeOpenQty,
      activeReservationCount,
    };
  }

  if (legacyStatus === "EXACT" && legacyQty > 0) {
    return {
      closeRequired: true,
      reason: "LEGACY_EXACT_WITH_QTY",
      positionSide,
      snapshotStatus: "",
      openQty: legacyQty,
      exchangeOpenQty,
      activeReservationCount,
    };
  }

  if (exchangeOpenQty > 0) {
    return {
      closeRequired: true,
      reason: "BINANCE_POSITION_OPEN",
      positionSide,
      snapshotStatus: "",
      openQty: exchangeOpenQty,
      exchangeOpenQty,
      activeReservationCount,
    };
  }

  return {
    closeRequired: false,
    reason: "NO_POSITION",
    positionSide,
    snapshotStatus: "",
    openQty: 0,
    exchangeOpenQty,
    activeReservationCount,
  };
};

const shouldScheduleSignalForceOffClose = ({ runtimeStatus = "", closeRequired = false } = {}) =>
  normalizeStatus(runtimeStatus) === "EXACT" || Boolean(closeRequired);

const evaluateSignalForceOffProtectionAction = ({
  closeRequired = false,
  closeAttempted = false,
  closeAccepted = false,
  closeFilled = false,
  exchangeFlat = false,
  closeFailed = false,
  protectionAlreadyCanceled = false,
} = {}) => {
  if (!closeRequired) {
    return {
      action: "OFF_CLOSE_SKIPPED_NO_POSITION",
      cancelProtectionNow: true,
      userActionRequired: false,
    };
  }

  if (closeFilled || exchangeFlat) {
    return {
      action: "OFF_PROTECTION_CANCEL_AFTER_CLOSE",
      cancelProtectionNow: true,
      userActionRequired: false,
    };
  }

  if (closeFailed) {
    return {
      action: protectionAlreadyCanceled
        ? "OFF_USER_ACTION_REQUIRED"
        : "OFF_CLOSE_FAILED_POSITION_STILL_OPEN",
      cancelProtectionNow: false,
      userActionRequired: Boolean(protectionAlreadyCanceled),
    };
  }

  if (!closeAttempted || !closeAccepted) {
    return {
      action: "OFF_PROTECTION_CANCEL_DEFERRED",
      cancelProtectionNow: false,
      userActionRequired: false,
    };
  }

  return {
    action: "OFF_PROTECTION_CANCEL_DEFERRED",
    cancelProtectionNow: false,
    userActionRequired: false,
  };
};

module.exports = {
  detectSignalForceOffCloseRequirement,
  evaluateSignalForceOffProtectionAction,
  resolveSignalPositionSide,
  shouldScheduleSignalForceOffClose,
};
