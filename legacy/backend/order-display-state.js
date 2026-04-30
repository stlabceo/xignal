"use strict";

const TERMINAL_STATUSES = new Set([
  "FILLED",
  "CANCELED",
  "EXPIRED",
  "EXPIRED_IN_MATCH",
  "REJECTED",
]);

const PARTIAL_STATUS = "PARTIALLY_FILLED";

const EXPECTED_EVENT_CODES = new Set([
  "NO_MATCHING_STRATEGY",
  "GRID_ACTIVE_IGNORED",
  "RUNTIME_NOT_READY_EXPECTED",
  "DUPLICATE_FILL_IGNORED",
  "DUPLICATE_EXIT_RECOVERY_IGNORED",
  "DUPLICATE_OLD_EXIT_RECOVERY_IGNORED",
  "SMOKE_UNMATCHED_WEBHOOK",
  "SYSTEM_RESET_READY_SKIPPED_ALREADY_READY",
  "SYSTEM_RESET_READY_SKIPPED_DISABLED",
  "SYSTEM_RESET_READY_SKIPPED_ROW_MISSING",
  "ORDER_TERMINAL_WITHOUT_FILL",
  "ORDER_EXPIRED_IN_MATCH_NO_FILL",
  "ORDER_REJECTED_NO_FILL",
]);

const CRITICAL_EVENT_PATTERNS = [
  "WITHOUT_EFFECTIVE_PROTECTION",
  "MISSING_PROTECTION",
  "LOCAL_CANCELED_BUT_BINANCE_ACTIVE",
  "BINANCE_OPEN_LOCAL_FLAT",
  "LOCAL_OPEN_BINANCE_FLAT",
  "MANDATORY_CLOSE_FAILED",
  "UNKNOWN_PARTIAL_STATE",
  "WITH_FILL_NO_RECOVERY",
  "PHYSICAL_ROW_ABSENT",
  "ACTIVE_ORPHAN_PROTECTION",
];

const firstDefined = (row = {}, keys = []) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return null;
};

const normalizeStatus = (value) => String(value || "").trim().toUpperCase();

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const isEnabled = (value) => ["Y", "TRUE", "1", "ON"].includes(normalizeStatus(value));

const lifecycleToExpectedOrAbnormal = (lifecycleResult) => {
  const normalized = normalizeStatus(lifecycleResult);
  if (normalized === "CRITICAL") {
    return "ABNORMAL";
  }
  if (normalized === "WARN") {
    return "REVIEW";
  }
  return "EXPECTED";
};

const buildState = ({
  displayStatus = "UNKNOWN",
  riskStatus = "OK",
  lifecycleResult = "INFO",
  severity = null,
  expectedOrAbnormal = null,
  isExpectedIgnore = false,
  requiresUserAction = false,
  systemAction = "NONE",
  nextUserAction = "No action required.",
  restoreStatus = "NONE",
  cleanupGuardReason = null,
  lastOrderIssue = {},
  normalizedReason = null,
  remainingQty = 0,
} = {}) => {
  const normalizedLifecycle = normalizeStatus(lifecycleResult) || "INFO";
  const normalizedSeverity = normalizeStatus(severity || normalizedLifecycle);
  return {
    displayStatus,
    orderDisplayState: displayStatus,
    riskStatus,
    lifecycleResult: normalizedLifecycle,
    severity: normalizedSeverity === "EXPECTED" ? "INFO" : normalizedSeverity,
    expectedOrAbnormal: expectedOrAbnormal || lifecycleToExpectedOrAbnormal(normalizedLifecycle),
    isExpectedIgnore: Boolean(isExpectedIgnore),
    remainingQty,
    requiresUserAction: Boolean(requiresUserAction),
    systemAction,
    nextUserAction,
    normalizedReason,
    restoreStatus,
    cleanupGuardReason,
    lastOrderIssue,
  };
};

const deriveOrderTerminalDisplayState = (row = {}) => {
  const status = normalizeStatus(
    firstDefined(row, [
      "orderStatus",
      "order_status",
      "algoStatus",
      "algo_status",
      "executionType",
      "execution_type",
      "status",
    ])
  );
  const origQty = toNumber(firstDefined(row, ["origQty", "orig_qty", "quantity", "qty"]));
  const executedQty = toNumber(firstDefined(row, ["executedQty", "executed_qty", "cumQty", "cum_qty"]));
  const remainingQty = Math.max(0, origQty - executedQty);
  const hasFill = executedQty > 0;
  const eventCode = normalizeStatus(firstDefined(row, ["eventCode", "event_code", "code"]));
  const sourceLifecycle = normalizeStatus(firstDefined(row, ["lifecycleResult", "lifecycle_result"]));
  const sourceSeverity = String(firstDefined(row, ["severity"]) || "").trim().toLowerCase();
  const isExpectedIgnore = EXPECTED_EVENT_CODES.has(eventCode);
  const isCriticalEvent = CRITICAL_EVENT_PATTERNS.some((pattern) => eventCode.includes(pattern));
  const normalizedReason =
    firstDefined(row, ["rejectReason", "reject_reason", "expireReason", "expire_reason"]) ||
    firstDefined(row, ["note", "message"]) ||
    null;

  let displayStatus = status || "UNKNOWN";
  let riskStatus = "OK";
  let lifecycleResult = isExpectedIgnore ? "EXPECTED" : "INFO";
  let severity = isExpectedIgnore ? "INFO" : "INFO";
  let systemAction = "NONE";
  let nextUserAction = "No action required.";
  let requiresUserAction = false;

  if (sourceLifecycle) {
    lifecycleResult = sourceLifecycle;
    severity = sourceLifecycle === "EXPECTED" ? "INFO" : sourceLifecycle;
  } else if (status === "NEW") {
    displayStatus = "PENDING_ORDER";
  } else if (status === PARTIAL_STATUS) {
    displayStatus = "PARTIAL_FILL_PENDING";
    riskStatus = "WATCH";
    lifecycleResult = "WARN";
    severity = "WARN";
    systemAction = "ORDER_PARTIAL_STATE_REST_CHECK";
    nextUserAction = "Monitor REST/userTrades reconciliation and protection for executed quantity.";
  } else if (TERMINAL_STATUSES.has(status)) {
    if (status === "FILLED") {
      displayStatus = "FILLED_FINAL";
      lifecycleResult = "EXPECTED";
      severity = "INFO";
    } else if (hasFill) {
      displayStatus = "PARTIAL_TERMINAL_WITH_EXPOSURE";
      riskStatus = "USER_ACTION_REQUIRED";
      lifecycleResult = "CRITICAL";
      severity = "CRITICAL";
      systemAction = "VERIFY_PROTECTION_FOR_FILLED_QTY";
      nextUserAction = "Verify local ledger/snapshot and TP/STOP coverage for the executed quantity.";
      requiresUserAction = true;
    } else {
      displayStatus = "TERMINAL_NO_FILL";
      riskStatus = status === "REJECTED" ? "WARN" : "OK";
      lifecycleResult = status === "REJECTED" ? "WARN" : "EXPECTED";
      severity = status === "REJECTED" ? "WARN" : "INFO";
      systemAction =
        status === "EXPIRED_IN_MATCH"
          ? "ORDER_EXPIRED_IN_MATCH_NO_FILL"
          : status === "REJECTED"
            ? "ORDER_REJECTED_NO_FILL"
            : "ORDER_TERMINAL_WITHOUT_FILL";
    }
  } else if (!status) {
    displayStatus = "UNKNOWN_ORDER_STATUS";
    riskStatus = "WATCH";
    lifecycleResult = isExpectedIgnore ? "EXPECTED" : "WARN";
    severity = isExpectedIgnore ? "INFO" : "WARN";
    systemAction = "CHECK_RUNTIME_EVENT";
  }

  if (isCriticalEvent || sourceSeverity === "high") {
    lifecycleResult = "CRITICAL";
    severity = "CRITICAL";
    requiresUserAction = true;
  } else if (sourceSeverity === "medium" && lifecycleResult !== "CRITICAL") {
    lifecycleResult = "WARN";
    severity = "WARN";
  }

  return buildState({
    displayStatus,
    riskStatus,
    lifecycleResult,
    severity,
    isExpectedIgnore,
    remainingQty,
    requiresUserAction,
    systemAction,
    nextUserAction,
    normalizedReason,
    lastOrderIssue: {
      intent: firstDefined(row, ["intent", "eventCode", "event_code", "eventType", "event_type"]),
      clientOrderId: firstDefined(row, ["clientOrderId", "client_order_id", "clientAlgoId", "client_algo_id"]),
      orderId: firstDefined(row, ["orderId", "order_id", "actualOrderId", "actual_order_id", "algoId", "algo_id"]),
      status: status || null,
      origQty,
      executedQty,
      remainingQty,
      errorCode: firstDefined(row, ["errorCode", "error_code"]),
      errorMessage: firstDefined(row, ["errorMessage", "error_message", "rejectReason", "reject_reason"]),
      normalizedReason,
    },
    restoreStatus: firstDefined(row, ["restoreStatus", "restore_status"]) || "NONE",
    cleanupGuardReason: firstDefined(row, ["cleanupGuardReason", "cleanup_guard_reason"]) || null,
  });
};

const classifyOrderLifecycleEvent = (row = {}) => deriveOrderTerminalDisplayState(row);

const classifyStrategyControlEvent = (row = {}) => {
  const actionCode = normalizeStatus(firstDefined(row, ["actionCode", "action_code", "eventCode", "event_code"]));
  const note = String(firstDefined(row, ["note", "message"]) || "");

  if (actionCode === "CONTROLLED_RESTORE_QA_CLEANUP" || actionCode === "SYSTEM_CONTROLLED_RESTORE_QA_CLEANUP_COLLISION") {
    return buildState({
      displayStatus: "CONTROLLED_RESTORE_COMPLETED",
      riskStatus: "OK",
      lifecycleResult: "INFO",
      severity: "INFO",
      expectedOrAbnormal: "EXPECTED",
      systemAction: "RESTORED",
      restoreStatus: "RESTORED",
      normalizedReason: note || "QA cleanup collision controlled restore completed.",
      lastOrderIssue: {
        intent: "RESTORE",
        normalizedReason: note || "QA cleanup collision controlled restore completed.",
      },
    });
  }

  if (actionCode === "USER_DELETE_STRATEGY") {
    return buildState({
      displayStatus: "USER_DELETED_STRATEGY",
      riskStatus: "OK",
      lifecycleResult: "INFO",
      severity: "INFO",
      expectedOrAbnormal: "EXPECTED",
      systemAction: "NONE",
      restoreStatus: "NONE",
      lastOrderIssue: { intent: "OFF", normalizedReason: note || "User-requested delete audit." },
    });
  }

  if (actionCode.startsWith("SYSTEM_RESET_READY_SKIPPED")) {
    return buildState({
      displayStatus: actionCode,
      riskStatus: "OK",
      lifecycleResult: "EXPECTED",
      severity: "INFO",
      expectedOrAbnormal: "EXPECTED",
      isExpectedIgnore: true,
      systemAction: "NONE",
      lastOrderIssue: { intent: "OFF", normalizedReason: note || actionCode },
    });
  }

  if (actionCode === "PHYSICAL_ROW_ABSENT_NO_DELETE_AUDIT") {
    return buildState({
      displayStatus: "PHYSICAL_ROW_ABSENT",
      riskStatus: "CONTROLLED_RESTORE_REQUIRED",
      lifecycleResult: "CRITICAL",
      severity: "CRITICAL",
      expectedOrAbnormal: "ABNORMAL",
      requiresUserAction: true,
      systemAction: "CONTROLLED_RESTORE_REQUIRED",
      restoreStatus: "RESTORE_REQUIRED",
      nextUserAction: "Review restore evidence and approve controlled restore before resuming P2.",
      lastOrderIssue: { intent: "RESTORE", normalizedReason: note || "Physical row absent without USER_DELETE_STRATEGY audit." },
    });
  }

  return buildState({
    displayStatus: actionCode || "STRATEGY_CONTROL_EVENT",
    riskStatus: "OK",
    lifecycleResult: "INFO",
    severity: "INFO",
    expectedOrAbnormal: "EXPECTED",
    lastOrderIssue: { intent: "OFF", normalizedReason: note || null },
  });
};

const classifyCleanupEvent = (row = {}) => {
  const guardReason = firstDefined(row, ["cleanupGuardReason", "guard", "guardReason"]);
  const eventCode = normalizeStatus(firstDefined(row, ["eventCode", "event_code", "actionCode"]));
  const note = String(firstDefined(row, ["note", "message"]) || "");

  if (guardReason === "QA_MARKER_REQUIRED") {
    return buildState({
      displayStatus: "CLEANUP_BLOCKED_BY_QA_MARKER_GUARD",
      riskStatus: "OK",
      lifecycleResult: "EXPECTED",
      severity: "INFO",
      expectedOrAbnormal: "EXPECTED",
      isExpectedIgnore: true,
      cleanupGuardReason: "QA_MARKER_REQUIRED",
      systemAction: "NONE",
      lastOrderIssue: { intent: "CLEANUP", normalizedReason: note || "QA cleanup skipped non-QA production row." },
    });
  }

  if (eventCode.includes("CLEANUP_COLLISION") || eventCode.includes("NUMERIC_COLLISION")) {
    return buildState({
      displayStatus: "QA_CLEANUP_COLLISION",
      riskStatus: "CONTROLLED_RESTORE_REQUIRED",
      lifecycleResult: "CRITICAL",
      severity: "CRITICAL",
      expectedOrAbnormal: "ABNORMAL",
      requiresUserAction: true,
      systemAction: "CONTROLLED_RESTORE_REQUIRED",
      restoreStatus: "RESTORE_REQUIRED",
      cleanupGuardReason: guardReason || "UNKNOWN",
      lastOrderIssue: { intent: "CLEANUP", normalizedReason: note || "QA cleanup numeric PID collision." },
    });
  }

  return buildState({
    displayStatus: eventCode || "CLEANUP_EVENT",
    riskStatus: "OK",
    lifecycleResult: "INFO",
    severity: "INFO",
    expectedOrAbnormal: "EXPECTED",
    cleanupGuardReason: guardReason || null,
    lastOrderIssue: { intent: "CLEANUP", normalizedReason: note || null },
  });
};

const classifyRestoreState = (row = {}) => {
  const restoreStatus = normalizeStatus(firstDefined(row, ["restoreStatus", "restore_status"]));
  const note = String(firstDefined(row, ["note", "message"]) || "");

  if (restoreStatus === "RESTORED") {
    return buildState({
      displayStatus: "RESTORED_OFF_READY",
      riskStatus: "OK",
      lifecycleResult: "INFO",
      severity: "INFO",
      expectedOrAbnormal: "EXPECTED",
      restoreStatus: "RESTORED",
      systemAction: "RESTORED",
      lastOrderIssue: { intent: "RESTORE", normalizedReason: note || "Controlled restore completed." },
    });
  }

  if (restoreStatus === "RESTORE_REQUIRED") {
    return buildState({
      displayStatus: "CONTROLLED_RESTORE_REQUIRED",
      riskStatus: "CONTROLLED_RESTORE_REQUIRED",
      lifecycleResult: "CRITICAL",
      severity: "CRITICAL",
      expectedOrAbnormal: "ABNORMAL",
      requiresUserAction: true,
      restoreStatus: "RESTORE_REQUIRED",
      systemAction: "CONTROLLED_RESTORE_REQUIRED",
      nextUserAction: "Approve controlled restore after clean gate and high-confidence source verification.",
      lastOrderIssue: { intent: "RESTORE", normalizedReason: note || "Restore required." },
    });
  }

  if (restoreStatus === "RESTORE_BLOCKED") {
    return buildState({
      displayStatus: "RESTORE_BLOCKED",
      riskStatus: "REVIEW",
      lifecycleResult: "WARN",
      severity: "WARN",
      expectedOrAbnormal: "REVIEW",
      restoreStatus: "RESTORE_BLOCKED",
      systemAction: "USER_ACTION_REQUIRED",
      nextUserAction: "Review blocked restore evidence before changing production rows.",
      lastOrderIssue: { intent: "RESTORE", normalizedReason: note || "Restore blocked." },
    });
  }

  return buildState({
    displayStatus: "NO_RESTORE_STATE",
    riskStatus: "OK",
    lifecycleResult: "INFO",
    severity: "INFO",
    expectedOrAbnormal: "EXPECTED",
    restoreStatus: "NONE",
    lastOrderIssue: { intent: "RESTORE", normalizedReason: note || null },
  });
};

const deriveUserDisplayStatus = (row = {}) => {
  const enabled = isEnabled(firstDefined(row, ["enabled", "nextEnabled", "controlState"]));
  const legacyStatus = normalizeStatus(firstDefined(row, ["status", "legacyStatus", "runtimeStatus"]));
  const openQty = toNumber(firstDefined(row, ["openQty", "r_qty", "localOpenQty", "localPidOpenQtySum"]));
  const missingProtectionCount = toNumber(firstDefined(row, ["missingProtectionCount", "missing_protection_count"]));
  const activeProtectionCount = toNumber(firstDefined(row, ["activeProtectionCount", "active_protection_count"]));
  const restoreStatus = normalizeStatus(firstDefined(row, ["restoreStatus", "restore_status"]));

  if (restoreStatus === "RESTORE_REQUIRED") {
    return "관리자 확인 필요";
  }
  if (!enabled && openQty <= 0) {
    return "OFF / 대기중";
  }
  if (openQty > 0 && missingProtectionCount > 0) {
    return "보호주문 확인 필요";
  }
  if (openQty > 0 && activeProtectionCount > 0) {
    return legacyStatus === "PARTIALLY_FILLED" ? "부분 진입 / 보호중" : "포지션 보유중";
  }
  if (legacyStatus.includes("MANDATORY_CLOSE_FAILED")) {
    return "청산 실패 / 확인 필요";
  }
  if (legacyStatus.includes("AUTO_PAUSED") || legacyStatus.includes("REJECTED")) {
    return "자동중지 / 진입 실패";
  }
  return enabled ? "운용중 / 신호대기" : "OFF / 대기중";
};

const deriveAdminLifecycleSeverity = (row = {}) => {
  const restoreStatus = normalizeStatus(firstDefined(row, ["restoreStatus", "restore_status"]));
  const cleanupGuardReason = firstDefined(row, ["cleanupGuardReason", "guard", "guardReason"]);
  const actionCode = normalizeStatus(firstDefined(row, ["actionCode", "action_code"]));
  const eventCode = normalizeStatus(firstDefined(row, ["eventCode", "event_code"]));

  if (restoreStatus) {
    return classifyRestoreState(row);
  }
  if (cleanupGuardReason || eventCode.includes("CLEANUP")) {
    return classifyCleanupEvent(row);
  }
  if (actionCode) {
    return classifyStrategyControlEvent(row);
  }
  return deriveOrderTerminalDisplayState(row);
};

module.exports = {
  TERMINAL_STATUSES,
  PARTIAL_STATUS,
  EXPECTED_EVENT_CODES,
  deriveOrderTerminalDisplayState,
  classifyOrderLifecycleEvent,
  classifyStrategyControlEvent,
  classifyCleanupEvent,
  classifyRestoreState,
  deriveUserDisplayStatus,
  deriveAdminLifecycleSeverity,
};
