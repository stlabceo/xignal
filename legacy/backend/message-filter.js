"use strict";

const ACTIONABLE_PATTERNS = [
  "API",
  "PERMISSION",
  "FUTURES",
  "BALANCE",
  "INSUFFICIENT",
  "MIN_NOTIONAL",
  "MARGIN",
  "REJECTED",
  "EXPIRED",
  "EXPIRED_IN_MATCH",
  "CANCELED",
  "PARTIALLY_FILLED",
  "PARTIAL_TERMINAL",
  "WITHOUT_EFFECTIVE_PROTECTION",
  "MISSING_PROTECTION",
  "PROTECTION_MISMATCH",
  "MANDATORY_CLOSE_FAILED",
  "LOCAL_CANCELED_BUT_BINANCE_ACTIVE",
  "BINANCE_OPEN_LOCAL_FLAT",
  "LOCAL_OPEN_BINANCE_FLAT",
];

const INTERNAL_PATTERNS = [
  "NGROK",
  "SMOKE",
  "REPLAY",
  "RUN-ALL",
  "RUN_ALL",
  "NO_MATCHING_STRATEGY",
  "GRID_ACTIVE_IGNORED",
  "DUPLICATE",
  "SYSTEM_RESET_READY",
  "RECONCILE_SUCCESS",
  "RUNTIME_NOT_READY_EXPECTED",
  "EXPECTED_IGNORE",
];

const normalize = (value) => String(value || "").trim();
const upper = (value) => normalize(value).toUpperCase();

const textBlob = (row = {}) =>
  [
    row.fun,
    row.code,
    row.msg,
    row.eventCode,
    row.event_code,
    row.eventType,
    row.event_type,
    row.orderStatus,
    row.order_status,
    row.note,
    row.errorCode,
    row.errorMessage,
  ]
    .map(upper)
    .filter(Boolean)
    .join(" ");

const hasAnyPattern = (blob, patterns) => patterns.some((pattern) => blob.includes(pattern));

const classifyUserMessage = (row = {}) => {
  const blob = textBlob(row);
  const rawStatus = upper(row.orderStatus || row.order_status || row.status);
  const errorCode = normalize(row.errorCode || row.error_code);
  const errorMessage = normalize(row.errorMessage || row.error_message || row.msg || row.note);

  if (!blob || hasAnyPattern(blob, INTERNAL_PATTERNS)) {
    return {
      visible: false,
      hiddenReason: "INTERNAL_OR_EXPECTED_EVENT",
    };
  }

  if (!hasAnyPattern(blob, ACTIONABLE_PATTERNS)) {
    return {
      visible: false,
      hiddenReason: "NOT_USER_ACTIONABLE",
    };
  }

  let category = "ORDER_TERMINAL";
  let severity = "WARN";
  let userMessage = "Binance 주문 상태를 확인해주세요.";
  let actionText = "Binance API 권한, 선물 지갑 잔고, 주문 가능 수량을 확인해주세요.";

  if (blob.includes("BALANCE") || blob.includes("INSUFFICIENT") || blob.includes("MARGIN")) {
    category = "FUTURES_BALANCE";
    userMessage = "선물 지갑에 사용 가능한 USDT가 부족합니다.";
    actionText = "Binance에서 현물 지갑에서 선물 지갑으로 USDT를 이동한 뒤 다시 운용을 켜주세요.";
  } else if (blob.includes("PERMISSION") || blob.includes("API")) {
    category = "API_PERMISSION";
    userMessage = "Binance API 연결 또는 권한 확인이 필요합니다.";
    actionText = "API Key, Futures 권한, IP 허용 목록을 확인해주세요.";
  } else if (blob.includes("WITHOUT_EFFECTIVE_PROTECTION") || blob.includes("MISSING_PROTECTION") || blob.includes("PROTECTION_MISMATCH")) {
    category = "PROTECTION";
    severity = "CRITICAL";
    userMessage = "보유 포지션의 보호주문 확인이 필요합니다.";
    actionText = "포지션과 TP/STOP 주문 상태를 확인해주세요.";
  } else if (blob.includes("MANDATORY_CLOSE_FAILED")) {
    category = "CLOSE_FAILED";
    severity = "CRITICAL";
    userMessage = "청산 주문이 완료되지 않았습니다.";
    actionText = "Binance 포지션 상태를 확인하고 필요하면 수동 조치를 진행해주세요.";
  } else if (blob.includes("REJECTED")) {
    userMessage = "Binance가 주문을 거절했습니다.";
    actionText = "API 권한, 선물 지갑 잔고, 최소 주문 금액을 확인해주세요.";
  } else if (blob.includes("EXPIRED")) {
    userMessage = "주문이 체결되지 않고 만료되었습니다.";
    actionText = "잔고 또는 주문 가능 수량을 확인해주세요.";
  } else if (blob.includes("PARTIALLY_FILLED") || blob.includes("PARTIAL_TERMINAL")) {
    category = "PARTIAL_TERMINAL";
    userMessage = "일부만 체결된 뒤 나머지 주문이 종료되었습니다.";
    actionText = "체결된 포지션은 기준 수량으로 반영되었는지 확인해주세요.";
  }

  return {
    visible: true,
    severity,
    source: "BINANCE",
    category,
    userMessage,
    rawStatus: rawStatus || null,
    errorCode: errorCode || null,
    errorMessage: errorMessage || null,
    actionText,
    hiddenReason: null,
  };
};

const filterUserFacingMessages = (rows = []) =>
  (rows || [])
    .map((row) => {
      const classification = classifyUserMessage(row);
      return {
        ...row,
        ...classification,
      };
    })
    .filter((row) => row.visible);

module.exports = {
  classifyUserMessage,
  filterUserFacingMessages,
};
