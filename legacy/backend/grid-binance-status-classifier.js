"use strict";

const ORDER_STATUSES = Object.freeze([
  "NEW",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
  "EXPIRED_IN_MATCH",
]);

const ORDER_TRADE_EXECUTION_TYPES = Object.freeze([
  "NEW",
  "CANCELED",
  "CALCULATED",
  "EXPIRED",
  "TRADE",
  "AMENDMENT",
]);

const ALGO_ORDER_STATUSES = Object.freeze([
  "NEW",
  "CANCELED",
  "TRIGGERING",
  "TRIGGERED",
  "FINISHED",
  "REJECTED",
  "EXPIRED",
]);

const TERMINAL_ORDER_STATUSES = Object.freeze([
  "CANCELED",
  "REJECTED",
  "EXPIRED",
  "EXPIRED_IN_MATCH",
]);

const FILL_ORDER_STATUSES = Object.freeze([
  "PARTIALLY_FILLED",
  "FILLED",
]);

const CONDITIONAL_ORDER_EVENTS = Object.freeze([
  "CONDITIONAL_ORDER_TRIGGER_REJECT",
]);

const ORDER_STATUS_SET = new Set(ORDER_STATUSES);
const ORDER_TRADE_EXECUTION_TYPE_SET = new Set(ORDER_TRADE_EXECUTION_TYPES);
const ALGO_ORDER_STATUS_SET = new Set(ALGO_ORDER_STATUSES);
const TERMINAL_ORDER_STATUS_SET = new Set(TERMINAL_ORDER_STATUSES);
const FILL_ORDER_STATUS_SET = new Set(FILL_ORDER_STATUSES);

const normalizeToken = (value) => String(value || "").trim().toUpperCase();

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const pickFirst = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
};

const classifyOrderTradeUpdate = (input = {}) => {
  const order = input.o && typeof input.o === "object" ? input.o : input;
  const executionType = normalizeToken(pickFirst(order.x, order.executionType));
  const orderStatus = normalizeToken(pickFirst(order.X, order.status, order.orderStatus));
  const lastFilledQty = toNumber(pickFirst(order.l, order.lastFilledQty), 0);
  const executedQty = toNumber(pickFirst(order.z, order.executedQty, order.cumQty), 0);
  const originalQty = toNumber(pickFirst(order.q, order.origQty, order.originalQty), 0);
  const isOfficialExecutionType = ORDER_TRADE_EXECUTION_TYPE_SET.has(executionType);
  const isOfficialOrderStatus = ORDER_STATUS_SET.has(orderStatus);
  const isTradeExecution = executionType === "TRADE";
  const isTerminalOrderStatus = TERMINAL_ORDER_STATUS_SET.has(orderStatus);
  const hasFillEvidence = isTradeExecution && (lastFilledQty > 0 || executedQty > 0);
  const hasAnyExecutedQty = executedQty > 0;
  const isPartial = orderStatus === "PARTIALLY_FILLED";
  const isFullFill = orderStatus === "FILLED";
  const isPartialTerminal =
    isTerminalOrderStatus &&
    hasAnyExecutedQty &&
    (!originalQty || executedQty < originalQty);

  let canonicalAction = "OBSERVE_ONLY";
  if (isTradeExecution && isPartial) {
    canonicalAction = "APPLY_PARTIAL_FILL";
  } else if (isTradeExecution && isFullFill) {
    canonicalAction = "APPLY_FULL_FILL";
  } else if (isPartialTerminal) {
    canonicalAction = "APPLY_FILL_THEN_TERMINALIZE_REMAINDER";
  } else if (isTerminalOrderStatus) {
    canonicalAction = "TERMINALIZE_NO_FILL";
  } else if (orderStatus === "NEW") {
    canonicalAction = "OBSERVE_OPEN";
  }

  return {
    executionType,
    orderStatus,
    isOfficialExecutionType,
    isOfficialOrderStatus,
    isTradeExecution,
    isTerminalOrderStatus,
    isFillOrderStatus: FILL_ORDER_STATUS_SET.has(orderStatus),
    isPartial,
    isFullFill,
    isPartialTerminal,
    hasFillEvidence,
    hasAnyExecutedQty,
    executedQty,
    lastFilledQty,
    originalQty,
    canonicalAction,
    source: "ORDER_TRADE_UPDATE",
  };
};

const classifyAlgoUpdate = (input = {}) => {
  const order = input.o && typeof input.o === "object" ? input.o : input;
  const algoStatus = normalizeToken(pickFirst(order.X, order.algoStatus, order.status));
  const executedQty = toNumber(pickFirst(order.aq, order.executedQty), 0);
  const isOfficialAlgoStatus = ALGO_ORDER_STATUS_SET.has(algoStatus);

  let canonicalAction = "OBSERVE_ONLY";
  let fillEvidence = false;
  let requiresOrderTradeUpdateOrRestEvidence = false;

  if (algoStatus === "NEW") {
    canonicalAction = "OBSERVE_OPEN";
  } else if (algoStatus === "TRIGGERING" || algoStatus === "TRIGGERED") {
    canonicalAction = "OBSERVE_TRIGGER_PROGRESS";
  } else if (algoStatus === "FINISHED") {
    canonicalAction = "VERIFY_MATCHING_ENGINE_RESULT";
    requiresOrderTradeUpdateOrRestEvidence = true;
  } else if (algoStatus === "CANCELED" || algoStatus === "REJECTED" || algoStatus === "EXPIRED") {
    canonicalAction = "TERMINALIZE_RESERVATION_NO_FILL";
  }

  return {
    algoStatus,
    isOfficialAlgoStatus,
    isAlgoTerminal: algoStatus === "FINISHED" || algoStatus === "CANCELED" || algoStatus === "REJECTED" || algoStatus === "EXPIRED",
    executedQty,
    fillEvidence,
    requiresOrderTradeUpdateOrRestEvidence,
    canonicalAction,
    source: "ALGO_UPDATE",
  };
};

const classifyConditionalOrderTriggerReject = (input = {}) => {
  const eventType = normalizeToken(pickFirst(input.e, input.eventType, "CONDITIONAL_ORDER_TRIGGER_REJECT"));
  return {
    eventType,
    isOfficialConditionalEvent: CONDITIONAL_ORDER_EVENTS.includes(eventType),
    fillEvidence: false,
    strategyTerminal: false,
    reservationTerminal: true,
    canonicalAction: "TERMINALIZE_REJECTED_PROTECTION_ORDER",
    source: "CONDITIONAL_ORDER_TRIGGER_REJECT",
  };
};

module.exports = {
  ORDER_STATUSES,
  ORDER_TRADE_EXECUTION_TYPES,
  ALGO_ORDER_STATUSES,
  TERMINAL_ORDER_STATUSES,
  FILL_ORDER_STATUSES,
  CONDITIONAL_ORDER_EVENTS,
  classifyOrderTradeUpdate,
  classifyAlgoUpdate,
  classifyConditionalOrderTriggerReject,
};
