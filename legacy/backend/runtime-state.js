const canonicalRuntimeState = require("./canonical-runtime-state");

const LEGACY_MARKET_EXIT_ORDER_TYPES = new Set(["MANUAL", "FORCING", "TIME", "REVERSE"]);
const LEGACY_CONDITIONAL_EXIT_ORDER_TYPES = new Set(["PROFIT", "STOP", "TS", "SPLITTP"]);

const EXIT_REASON_CODE = {
  "bound-profit": "TAKE_PROFIT",
  "bound-stop": "STOP_LOSS_PRICE",
  "time-expire": "TIME_EXPIRE",
  "reverse-signal": "REVERSE_SIGNAL",
  "manual-off": "MANUAL_OFF",
  "external-close": "EXTERNAL_CLOSE",
  "entry-fail": "ENTRY_FAIL",
  "exit-fail": "EXIT_FAIL",
};

const EXIT_REASON_LABEL = {
  TAKE_PROFIT: "익절",
  STOP_LOSS_PRICE: "손절 가격 청산",
  TIME_EXPIRE: "시간 경과 청산",
  REVERSE_SIGNAL: "반대 신호 청산",
  MANUAL_OFF: "수동 OFF 청산",
  EXTERNAL_CLOSE: "외부 수동 청산",
  ENTRY_FAIL: "진입 실패",
  EXIT_FAIL: "청산 실패",
};

const EXIT_MODE_LABEL = {
  CONDITIONAL: "조건부 주문",
  MARKET: "시장가 주문",
  EXTERNAL: "외부 주문",
  SYSTEM: "시스템 처리",
};

const getControlState = (play = {}) =>
  canonicalRuntimeState.getItemEnabled(play) ? "ON" : "OFF";

const getRuntimeState = (playOrStatus) => {
  if (typeof playOrStatus === "string") {
    const normalized = String(playOrStatus || "").trim().toUpperCase();
    if (normalized === "EXACT_WAIT") {
      return "EXACT_WAIT";
    }
    if (normalized === "EXACT") {
      return "EXACT";
    }
    return "READY";
  }

  return canonicalRuntimeState.decorateSignalItemSync(playOrStatus || {}).runtimeState;
};

const isLegacyEntryPendingStatus = (status) =>
  String(status || "").toUpperCase() === "EXACT_WAIT";

const isLegacyOpenStatus = (status) => {
  const normalized = String(status || "").toUpperCase();
  return normalized === "EXACT";
};

const isLegacyExitPendingStatus = () => false;

const getLegacyExitPendingStatus = () => "EXACT";

const getLegacyResumeStatusAfterExitDispatchFailure = () => "EXACT";

const getExitReasonCode = (reason) => {
  if (!reason) {
    return null;
  }

  return EXIT_REASON_CODE[reason] || String(reason).toUpperCase().replace(/-/g, "_");
};

const getExitMode = (reason, endType = null) => {
  const normalizedReason = String(reason || "").toLowerCase();
  const normalizedEndType = String(endType || "").toUpperCase();

  if (normalizedReason === "external-close") {
    return "EXTERNAL";
  }

  if (normalizedReason === "entry-fail" || normalizedReason === "exit-fail") {
    return "SYSTEM";
  }

  if (
    normalizedReason === "time-expire" ||
    normalizedReason === "reverse-signal" ||
    normalizedReason === "manual-off"
  ) {
    return "MARKET";
  }

  if (
    normalizedReason === "bound-profit" ||
    normalizedReason === "bound-stop" ||
    normalizedEndType === "PROFIT" ||
    normalizedEndType === "STOP"
  ) {
    return "CONDITIONAL";
  }

  return "MARKET";
};

const getCloseOrderType = (reason) => {
  const normalizedReason = String(reason || "").toLowerCase();

  if (normalizedReason === "time-expire") {
    return "TIME";
  }

  if (normalizedReason === "reverse-signal") {
    return "REVERSE";
  }

  return "MANUAL";
};

const isConditionalExitOrderType = (type) =>
  LEGACY_CONDITIONAL_EXIT_ORDER_TYPES.has(String(type || "").toUpperCase());

const isMarketExitOrderType = (type) =>
  LEGACY_MARKET_EXIT_ORDER_TYPES.has(String(type || "").toUpperCase());

const getExitReasonFromCloseOrderType = (type) => {
  const normalizedType = String(type || "").toUpperCase();

  if (normalizedType === "TIME") {
    return "time-expire";
  }

  if (normalizedType === "REVERSE") {
    return "reverse-signal";
  }

  if (normalizedType === "MANUAL" || normalizedType === "FORCING") {
    return "manual-off";
  }

  return null;
};

const getRuntimeStateLabel = (item = {}) =>
  canonicalRuntimeState.decorateSignalItemSync(item).runtimeStateLabel;

const formatRuntimeSnapshot = (play = {}, options = {}) => {
  const decorated = canonicalRuntimeState.decorateSignalItemSync(play);
  const exitReasonCode = getExitReasonCode(options.exitReason);
  const exitMode =
    options.exitReason || options.endType
      ? getExitMode(options.exitReason, options.endType)
      : null;

  const parts = [
    `control:${decorated.controlState}`,
    `runtime:${decorated.runtimeState}`,
    `runtimeLabel:${decorated.runtimeStateLabel}`,
    `legacyStatus:${play?.status || "null"}`,
  ];

  if (exitReasonCode) {
    parts.push(`exitReason:${exitReasonCode}`);
    parts.push(`exitReasonLabel:${EXIT_REASON_LABEL[exitReasonCode] || exitReasonCode}`);
  }

  if (exitMode) {
    parts.push(`exitMode:${exitMode}`);
    parts.push(`exitModeLabel:${EXIT_MODE_LABEL[exitMode] || exitMode}`);
  }

  if (options.endType) {
    parts.push(`legacyEndType:${options.endType}`);
  }

  return parts.join(", ");
};

const decorateRuntimeFields = (item = {}) => {
  if (!item || typeof item !== "object") {
    return item;
  }

  const decorated = canonicalRuntimeState.decorateSignalItemSync(item);
  const exitReasonCode = item.exitReason || null;
  const exitMode = item.exitMode || null;

  return {
    ...decorated,
    exitReasonLabel: exitReasonCode
      ? EXIT_REASON_LABEL[exitReasonCode] || exitReasonCode
      : null,
    exitModeLabel: exitMode ? EXIT_MODE_LABEL[exitMode] || exitMode : null,
  };
};

module.exports = {
  getControlState,
  getRuntimeState,
  getRuntimeStateLabel,
  isLegacyEntryPendingStatus,
  isLegacyOpenStatus,
  isLegacyExitPendingStatus,
  getLegacyExitPendingStatus,
  getLegacyResumeStatusAfterExitDispatchFailure,
  getExitReasonCode,
  getExitMode,
  getCloseOrderType,
  isConditionalExitOrderType,
  isMarketExitOrderType,
  getExitReasonFromCloseOrderType,
  formatRuntimeSnapshot,
  decorateRuntimeFields,
};
