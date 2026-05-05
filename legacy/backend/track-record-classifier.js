const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalize = (value) => String(value || "").trim().toUpperCase();

const joinEvidenceText = (processRow = {}) =>
  [
    processRow.targetResultCode,
    processRow.resultCode,
    processRow.webhookResultCode,
    processRow.issueCode,
    processRow.issueReason,
    processRow.problemDetail,
    processRow.currentStepLabel,
    processRow.summaryText,
    processRow.processStatus,
    processRow.lifecycleStatus,
    processRow.lifecycleResult,
    processRow.reconciliationOrigin,
    processRow.recoveryReason,
    processRow.latestRuntimeIssue?.detail,
    processRow.entryStage?.detail,
    processRow.waitingStage?.detail,
    processRow.exitPendingStage?.detail,
    processRow.exitStage?.detail,
  ]
    .map((value) => String(value || ""))
    .join(" ")
    .toUpperCase();

const hasAny = (haystack, tokens = []) => tokens.some((token) => haystack.includes(token));

const getTrackRecordCycleRealizedPnl = (processRow = {}) => {
  if (String(processRow.strategyCategory || "").trim().toLowerCase() === "grid") {
    return toNumber(processRow?.gridMeta?.currentRegimeRealizedPnl, 0);
  }

  return toNumber(processRow?.algorithmMeta?.realizedPnl, 0);
};

const getTrackRecordDenominator = (processRow = {}) => {
  const meta =
    String(processRow.strategyCategory || "").trim().toLowerCase() === "grid"
      ? processRow.gridMeta || {}
      : processRow.algorithmMeta || {};
  return toNumber(
    meta.actualEntryNotional ??
      meta.tradeAmount ??
      processRow.actualEntryNotional ??
      processRow.tradeAmount ??
      0,
    0
  );
};

const detectReconciliationOrigin = (processRow = {}) => {
  const explicit = normalize(processRow.reconciliationOrigin);
  if (explicit) {
    return explicit;
  }

  const text = joinEvidenceText(processRow);
  if (
    hasAny(text, [
      "GRID_EXCHANGE_RECONCILED",
      "TRUTH_SYNC",
      "RECONCILED_ENTRY",
      "RECOVERED",
      "ENDED_STALE_POSITION",
      "STALE",
      "SAFETY",
      "GMANUAL",
      "GRID_MANUAL_CLOSE",
    ])
  ) {
    if (
      hasAny(text, [
        "PROTECTION MISSING",
        "PROTECTION_MISSING",
        "ENTRY ORDER LOG MISSING",
        "ENTRY_ORDER_LOG_MISSING",
        "PROJECTION",
        "RESERVATION_MISSING",
        "보호주문",
        "진입 주문 로그",
      ])
    ) {
      return "RECONCILED_AFTER_PROJECTION_DEFECT";
    }
    if (
      hasAny(text, [
        "ENTRY_FAIL",
        "DISPATCH-TIMEOUT",
        "EXACT_WAIT",
        "SOURCE_DEFECT",
        "OVER_CLOSE",
        "WRONG_OWNER",
      ])
    ) {
      return "RECONCILED_AFTER_SOURCE_DEFECT";
    }
    if (
      hasAny(text, [
        "PARTIALLY_FILLED",
        "WEBSOCKET_LOSS_EXPECTED",
        "USER_MANUAL_EXTERNAL_ACTION",
        "EXPECTED_RECOVERY",
        "RESTART_GAP",
      ])
    ) {
      return "NORMAL_WITH_EXPECTED_RECOVERY";
    }
    return "RECONCILED_AFTER_UNKNOWN_DEFECT";
  }

  return "NORMAL_NO_RECONCILIATION";
};

const hasHardFailureEvidence = (processRow = {}) => {
  if (processRow?.isExpectedIgnore) {
    return false;
  }
  const text = joinEvidenceText(processRow);
  const directFailure = hasAny(text, [
    "ENTRY_FAIL",
    "ENTRY_FAIL",
    "DISPATCH-TIMEOUT",
    "DISPATCH TIMEOUT",
    "ENTRY_ORDER_LOG_MISSING",
    "ENTRY ORDER LOG MISSING",
    "ENTRY_REQUIRED_BUT_NO_ORDER",
    "NO ORDER",
    "NO_FILL",
    "NO FILL",
  ]);
  const suspiciousExactWait =
    text.includes("EXACT_WAIT") &&
    (text.includes("DISPATCH") ||
      processRow.completed === true ||
      (normalize(processRow.processStatus) !== "ACTIVE" &&
        toNumber(processRow.entryLedgerCount, 0) === 0 &&
        toNumber(processRow.activeEntryOrderCount, 0) === 0));
  return directFailure || suspiciousExactWait;
};

const hasActiveLifecycleEvidence = (processRow = {}) => {
  const lifecycleStatus = normalize(processRow.lifecycleStatus || processRow.lifecycleResult);
  const processStatus = normalize(processRow.processStatus);
  const activeEntryOrderCount = toNumber(processRow.activeEntryOrderCount, 0);
  const activeReservationCount = toNumber(processRow.activeReservationCount ?? processRow.activeProtectionCount, 0);
  const currentPositionQty = Math.abs(toNumber(processRow.currentPositionQty ?? processRow.localOpenQty, 0));
  return (
    processRow.currentRisk === true ||
    processStatus === "ACTIVE" ||
    lifecycleStatus === "CURRENT_RISK" ||
    lifecycleStatus === "OPEN_PROTECTED" ||
    lifecycleStatus === "ACTIVE_ENTRY_PENDING" ||
    lifecycleStatus === "ENTRY_PENDING" ||
    activeEntryOrderCount > 0 ||
    activeReservationCount > 0 ||
    currentPositionQty > 0
  );
};

const getEvidenceCounts = (processRow = {}) => ({
  entryLedgerCount: toNumber(processRow.entryLedgerCount, 0),
  exitLedgerCount: toNumber(processRow.exitLedgerCount, 0),
  ledgerFillCount: toNumber(processRow.ledgerFillCount, 0),
  entryOrderEventCount: toNumber(processRow.entryOrderEventCount, 0),
  exitOrderEventCount: toNumber(processRow.exitOrderEventCount, 0),
});

const hasCompletePerformanceEvidence = (processRow = {}) => {
  const counts = getEvidenceCounts(processRow);
  const denominator = getTrackRecordDenominator(processRow);
  const hasEntryEvidence =
    counts.entryLedgerCount > 0 ||
    toNumber(processRow.entryFillCount, 0) > 0 ||
    denominator > 0;
  const hasExitEvidence =
    counts.exitLedgerCount > 0 ||
    toNumber(processRow.exitFillCount, 0) > 0 ||
    counts.exitOrderEventCount > 0;
  return hasEntryEvidence && hasExitEvidence && denominator > 0;
};

const classifyTrackRecordRow = (processRow = {}) => {
  const lifecycleStatus = normalize(processRow.lifecycleStatus || processRow.lifecycleResult);
  const reconciliationOrigin = detectReconciliationOrigin(processRow);
  const hardFailure = hasHardFailureEvidence(processRow);
  const active = hasActiveLifecycleEvidence(processRow) && !hardFailure;
  const hasPerformanceEvidence = hasCompletePerformanceEvidence(processRow);
  const reconciledWithoutExpectedReason =
    reconciliationOrigin.startsWith("RECONCILED_AFTER_") &&
    reconciliationOrigin !== "RECONCILED_AFTER_EXPECTED_RECOVERY";
  const denominator = getTrackRecordDenominator(processRow);
  const realizedPnl = getTrackRecordCycleRealizedPnl(processRow);

  let bucket = "completed";
  let needsReview = false;
  let performanceEligible = false;
  let evidenceQuality = "COMPLETE";
  let summaryText = processRow.summaryText || null;
  let summaryStatusLabel = processRow.summaryStatusLabel || null;
  let result = "BREAKEVEN";

  if (processRow?.isExpectedIgnore || lifecycleStatus === "EXPECTED") {
    bucket = "completed";
    result = "IGNORED";
    evidenceQuality = "EXPECTED_IGNORE";
  } else if (hardFailure) {
    bucket = "review";
    needsReview = true;
    result = "REVIEW";
    evidenceQuality = "FAILED_OR_NO_ENTRY_EVIDENCE";
    summaryStatusLabel = "확인 필요";
    summaryText = processRow.issueReason || processRow.problemDetail || "진입 실패 / 확인 필요";
  } else if (active) {
    bucket = "active";
    result = "OPEN";
    evidenceQuality = "ACTIVE_LIFECYCLE";
  } else if (reconciledWithoutExpectedReason) {
    bucket = "review";
    needsReview = true;
    result = "REVIEW";
    evidenceQuality = reconciliationOrigin;
    summaryStatusLabel = "확인 필요";
    summaryText = processRow.issueReason || `${reconciliationOrigin} / expected recovery evidence required`;
  } else if (processRow.completed && !hasPerformanceEvidence) {
    bucket = "review";
    needsReview = true;
    result = "REVIEW";
    evidenceQuality = denominator > 0 ? "MISSING_EXIT_EVIDENCE" : "MISSING_DENOMINATOR";
    summaryStatusLabel = "확인 필요";
    summaryText = processRow.issueReason || "성과 계산 근거 부족";
  } else {
    performanceEligible = Boolean(processRow.completed && hasPerformanceEvidence);
    if (realizedPnl > 0) {
      result = "WIN";
    } else if (realizedPnl < 0) {
      result = "LOSS";
    } else {
      result = "BREAKEVEN";
    }
  }

  const returnPct = performanceEligible && denominator > 0 ? (realizedPnl / denominator) * 100 : null;

  return {
    bucket,
    needsReview,
    active,
    performanceEligible,
    result,
    evidenceQuality,
    reconciliationOrigin,
    hasPerformanceEvidence,
    denominator,
    realizedPnl,
    returnPct,
    summaryStatusLabel,
    summaryText,
  };
};

module.exports = {
  classifyTrackRecordRow,
  detectReconciliationOrigin,
  getTrackRecordCycleRealizedPnl,
  getTrackRecordDenominator,
  hasCompletePerformanceEvidence,
  hasHardFailureEvidence,
};
