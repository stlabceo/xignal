var express = require("express");
var router = express.Router();
const redisClient = require("../util/redis.util");
const db = require("../database/connect/config");
const crypto = require("crypto");
// const { check, validationResult } = require("express-validator");
const axios = require("axios");
const seon = require("../seon");
const coin = require("../coin");
const dbcon = require("../dbcon");
const runtimeState = require("../runtime-state");
const gridRuntime = require("../grid-runtime");
const canonicalRuntimeState = require("../canonical-runtime-state");
const orderProcessView = require("../order-process-view");
const orderProcessDetail = require("../order-process-detail");
const gridEngine = require("../grid-engine");
const splitTakeProfit = require("../split-take-profit");
const policyEngine = require("../policy-engine");
const adminManagement = require("../admin-management");
const strategyControlAudit = require("../strategy-control-audit");
const strategyControlState = require("../strategy-control-state");
const signalForceOffControl = require("../signal-force-off-control");
const orderDisplayState = require("../order-display-state");
const { hasExplicitStrategyDeleteIntent } = require("../strategy-delete-intent");
const userPerformanceSummary = require("../user-performance-summary");
const userStrategyRowSummary = require("../user-strategy-row-summary");
const messageFilter = require("../message-filter");
const accountReadiness = require("../account-readiness");
const binanceWriteGuard = require("../binance-write-guard");
const adminOrderMonitor = require("../admin-order-monitor");
const credentialSecrets = require("../credential-secrets");

const dt = require("../data");
const dayjs = require("dayjs");
const fs = require("fs");
const iconv = require("iconv-lite");
const _ = require("lodash")
const {validateItemAdd, validateGridItemAdd} = require('./validation');

const isEmpty = function (value) {
  if (
    value == "" ||
    value == null ||
    value == undefined ||
    (value != null && typeof value == "object" && !Object.keys(value).length)
  ) {
    return null;
  } else {
    return value;
  }
};

const isEmpty2 = function (value) {
  if (
    value == "" ||
    value == null ||
    value == undefined ||
    (value != null && typeof value == "object" && !Object.keys(value).length)
  ) {
    return 0;
  } else {
    return value;
  }
};

const isEmpty3 = function (value) {
  if (
    value == "" ||
    value == null ||
    value == undefined ||
    (value != null && typeof value == "object" && !Object.keys(value).length)
  ) {
    return "";
  } else {
    return value;
  }
};

const maskApiCredential = (value) => {
  return credentialSecrets.maskCredential(value);
};

const sanitizeMemberForClient = (member = {}) => {
  if (!member) {
    return member;
  }

  const { appKey, appSecret, password, ...safeMember } = member;
  return {
    ...safeMember,
    hasAppKey: Boolean(appKey),
    hasAppSecret: Boolean(appSecret),
    appKeyMasked: maskApiCredential(appKey),
  };
};

const normalizeSignalRuntimeTypePayload = (body = {}) => {
  const normalizedType = adminManagement.normalizeSignalStrategyCode(body.type);
  if (normalizedType) {
    body.type = normalizedType;
  }
  return body;
};

const PY_M2_EX = 3.3058;
const M2_PY_EX = 0.3025;

const notifyUserUpdated = (req, userId) => {
  const socketId = req.app.users[userId];
  if (socketId) {
    req.app.io.to(socketId).emit("user-updated", {
      userId,
      message: "회원 정보가 업데이트되었습니다.",
    });
  }
};

const sendRouteError = (res, status, message) =>
  res.status(status).json({
    errors: [
      {
        location: "body",
        msg: message,
        param: "body",
        value: "body",
      },
    ],
  });

const ensureExplicitStrategyDeleteIntent = (res, body = {}) => {
  if (hasExplicitStrategyDeleteIntent(body)) {
    return true;
  }
  sendRouteError(res, 400, "Explicit USER_DELETE_STRATEGY confirmation is required for strategy deletion.");
  return false;
};

const loadOwnedPlayItem = async (detailProcedure, id, userId) => {
  const item = await dbcon.DBOneCall(`CALL ${detailProcedure}(?)`, [id]);
  if (!item) {
    return null;
  }
  if (String(item.uid) !== String(userId)) {
    return false;
  }
  return item;
};

const loadSignalForceOffContext = async (prefix, uid, pid) => {
  if (String(prefix || "").trim().toUpperCase() !== "LIVE") {
    return { snapshots: [], reservations: [] };
  }

  const [snapshotRows, reservationRows] = await Promise.all([
    db.query(
      `SELECT *
         FROM live_pid_position_snapshot
        WHERE uid = ?
          AND pid = ?
          AND strategyCategory = 'signal'`,
      [uid, pid]
    ),
    db.query(
      `SELECT *
         FROM live_pid_exit_reservation
        WHERE uid = ?
          AND pid = ?
          AND strategyCategory = 'signal'`,
      [uid, pid]
    ),
  ]);

  return {
    snapshots: Array.isArray(snapshotRows?.[0]) ? snapshotRows[0] : [],
    reservations: Array.isArray(reservationRows?.[0]) ? reservationRows[0] : [],
  };
};

const logSignalForceOffTrace = (trace, payload = {}) => {
  console.log(
    `[SIGNAL_FORCE_OFF][${trace}]`,
    JSON.stringify({
      pid: payload.pid,
      uid: payload.uid,
      symbol: payload.symbol,
      positionSide: payload.positionSide,
      runtimeStatus: payload.runtimeStatus,
      legacyStatus: payload.legacyStatus,
      snapshotStatus: payload.snapshotStatus,
      openQty: payload.openQty,
      activeReservationCount: payload.activeReservationCount,
      reason: payload.reason,
    })
  );
};

const addPlayEventLog = async (
  prefix,
  uid,
  id,
  tid,
  actionLabel,
  st,
  nextSt,
  prevStatus,
  nextStatus,
  signalType,
  value1,
  value2
) => {
  const signalPrice =
    typeof value1 === "number"
      ? value1
      : Number.isFinite(Number(value1))
        ? Number(value1)
        : null;
  const signalTimeValue = value2 ? new Date(value2) : null;
  const signalTime =
    signalTimeValue && !Number.isNaN(signalTimeValue.getTime())
      ? signalTimeValue
      : null;

  try {
    await dbcon.DBCall(`CALL SP_${prefix}_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
      uid,
      id,
      tid,
      null,
      actionLabel,
      st,
      nextSt,
      prevStatus,
      nextStatus,
      signalType,
      signalPrice,
      signalTime,
    ]);
    return true;
  } catch (error) {
    const safeMessage = error?.sqlMessage || error?.message || String(error);
    console.log(
      `WARN :: addPlayEventLog skipped :: prefix:${prefix}, uid:${uid}, pid:${id}, action:${actionLabel}, message:${safeMessage}`
    );
    return false;
  }
};

const normalizeEnabledValue = strategyControlState.normalizeEnabledValue;
const buildLegacyControlFields = strategyControlState.buildLegacyControlFields;

const resolveRequestedEnabled = (body = {}) => normalizeEnabledValue(body.enabled);

const getRequestIp = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
  req.ip ||
  req.socket?.remoteAddress ||
  null;

const writeControlAudit = async (req, payload = {}) => {
  const result = await strategyControlAudit.writeStrategyControlAudit({
    actorUserId: req?.decoded?.userId || null,
    requestIp: getRequestIp(req),
    ...payload,
  });
  if (!result?.ok || !result?.insertId) {
    throw new Error(`CONTROL_AUDIT_WRITE_FAILED:${result?.reason || "UNKNOWN"}`);
  }
  return result;
};

const shouldDecorateRuntimeItem = (item) => {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }

  return [
    "st",
    "autoST",
    "status",
    "exitReason",
    "exitMode",
  ].some((key) => Object.prototype.hasOwnProperty.call(item, key));
};

const decorateRuntimeItem = (item) => (
  shouldDecorateRuntimeItem(item) ? runtimeState.decorateRuntimeFields(item) : item
);

const decorateRuntimeCollection = (items) => (
  Array.isArray(items) ? items.map((item) => decorateRuntimeItem(item)) : items
);

const decoratePagedResult = (result) => {
  if (!result || typeof result !== "object") {
    return result;
  }

  return {
    ...result,
    item: decorateRuntimeCollection(result.item),
    sumObj: decorateRuntimeItem(result.sumObj),
  };
};

const decorateLogPayload = (payload = {}) => ({
  ...payload,
  item: decorateRuntimeCollection(payload.item),
  sumObj: decorateRuntimeItem(payload.sumObj),
});

const decorateOwnedSignalCollection = async (items, uid) => {
  const canonicalRows = await canonicalRuntimeState.decorateSignalCollection(items || [], { uid });
  return userStrategyRowSummary.decorateStrategyRows(canonicalRows, { uid, category: "signal" });
};

const decorateOwnedSignalItem = async (item, uid) =>
  userStrategyRowSummary.decorateStrategyItem(await canonicalRuntimeState.decorateSignalItem(item, { uid }), {
    uid,
    category: "signal",
  });

const decorateOwnedGridCollection = async (items, uid) => {
  const canonicalRows = await canonicalRuntimeState.decorateGridCollection(items || [], { uid });
  return userStrategyRowSummary.decorateStrategyRows(canonicalRows, { uid, category: "grid" });
};

const decorateOwnedGridItem = async (item, uid) =>
  userStrategyRowSummary.decorateStrategyItem(await canonicalRuntimeState.decorateGridItem(item, { uid }), {
    uid,
    category: "grid",
  });

const WEBHOOK_CATEGORY_LABELS = {
  signal: "알고리즘",
  grid: "그리드",
  backtest: "통계",
};

const WEBHOOK_STATUS_LABELS = {
  RECEIVED: "수신",
  PROCESSED: "처리됨",
  IGNORED: "무시",
  DUPLICATE: "중복",
};

const WEBHOOK_RESULT_LABELS = {
  INVALID_PAYLOAD: "유효성 실패",
  DUPLICATE: "중복 무시",
  KILL_SWITCH_BLOCKED: "kill-switch 차단",
  ENTERED_PENDING: "진입주문 시작",
  REVERSE_SIGNAL_CLOSE: "반대신호 청산 예약",
  REVERSE_SIGNAL_CANCEL: "진입대기 취소",
  NO_MATCHING_STRATEGY: "매칭 전략 없음",
  POSITION_TRACKING_ERROR: "포지션 추적 기록 실패",
  POSITION_BUCKET_CONFLICT: "레거시 포지션 버킷 충돌(과거)",
  SIGNAL_TYPE_MISMATCH: "방향 불일치로 무시",
  RUNTIME_NOT_READY: "전략 상태로 무시",
  GRID_ARMED: "그리드 레짐 활성화",
  GRID_ACTIVE_IGNORED: "기존 활성 레짐 유지",
  GRID_SIGNAL_MISMATCH: "그리드 신호 불일치",
  GRID_SYMBOL_CONFLICT: "레거시 종목 충돌 차단(과거)",
  BACKTEST_PROMOTED: "저장본 승격",
  BACKTEST_DUPLICATE: "통계 중복 무시",
  BACKTEST_STORED_ONLY: "원문만 저장",
  BACKTEST_IMPORTED: "통계 반영",
  NO_NORMALIZED_ROWS: "정규화 결과 없음",
  UNSUPPORTED_SIGNAL_TYPE: "지원하지 않는 신호",
  PRICE_UNAVAILABLE: "현재가 없음",
  RUNTIME_ERROR: "런타임 오류",
};

const WEBHOOK_TARGET_RESULT_LABELS = {
  ENTERED_PENDING: "진입주문 시작",
  ENTRY_REJECTED: "진입 거절",
  POSITION_TRACKING_ERROR: "포지션 추적 기록 실패",
  POSITION_BUCKET_CONFLICT: "레거시 포지션 버킷 충돌(과거)",
  REVERSE_SIGNAL_CLOSE: "반대신호 청산 예약",
  REVERSE_SIGNAL_CANCEL: "진입대기 취소",
  RUNTIME_NOT_READY: "전략 상태로 무시",
  SIGNAL_TYPE_MISMATCH: "방향 불일치로 무시",
  LOCK_SKIPPED: "동시 처리 잠금으로 스킵",
  GRID_ARMED: "그리드 레짐 활성화",
  GRID_ACTIVE_IGNORED: "기존 활성 레짐 유지",
  GRID_SIGNAL_MISMATCH: "그리드 신호 불일치",
  GRID_SYMBOL_CONFLICT: "레거시 종목 충돌 차단(과거)",
};

const WEBHOOK_TARGET_SEVERITY_LABELS = {
  low: "참고",
  medium: "주의",
  high: "즉시 확인",
};

const WEBHOOK_TARGET_SEVERITY_TONES = {
  low: "low",
  medium: "medium",
  high: "high",
};

const WEBHOOK_TARGET_OPS_STATUS_LABELS = {
  OPEN: "미대응",
  ACK: "확인중",
  RESOLVED: "조치완료",
};

const BINANCE_RUNTIME_STATUS_LABELS = {
  DISCONNECTED: "연결 끊김",
  CONNECTING: "연결 중",
  CONNECTED: "정상 연결",
  ERROR: "오류",
  DISABLED: "일시 중지",
  EXCLUDED: "운영 제외",
};

const BINANCE_RUNTIME_ISSUE_META = {
  DB_OPEN_NO_POSITION: { label: "DB는 OPEN인데 거래소 포지션 없음", severity: "high" },
  POSITION_QTY_MISMATCH: { label: "DB 수량과 거래소 수량 불일치", severity: "high" },
  OPEN_WITHOUT_EXIT_ORDERS: { label: "열린 포지션에 exit 주문 없음", severity: "high" },
  ENTRY_PENDING_BUT_POSITION_OPEN: { label: "진입대기인데 이미 포지션 보유", severity: "high" },
  EXIT_PENDING_WITHOUT_POSITION: { label: "청산대기인데 거래소 포지션 없음", severity: "medium" },
  WAITING_WITH_EXCHANGE_ACTIVITY: { label: "대기 상태인데 거래소 주문/포지션 존재", severity: "high" },
  LONG_ARMED_WITHOUT_ENTRY_ORDER: { label: "LONG 진입대기인데 entry 주문 없음", severity: "high" },
  SHORT_ARMED_WITHOUT_ENTRY_ORDER: { label: "SHORT 진입대기인데 entry 주문 없음", severity: "high" },
  LONG_ENTRY_PENDING_WITH_OPEN_POSITION: { label: "LONG 진입대기인데 거래소 포지션이 이미 열림", severity: "high" },
  SHORT_ENTRY_PENDING_WITH_OPEN_POSITION: { label: "SHORT 진입대기인데 거래소 포지션이 이미 열림", severity: "high" },
  LONG_OPEN_NO_POSITION: { label: "LONG OPEN인데 거래소 포지션 없음", severity: "high" },
  SHORT_OPEN_NO_POSITION: { label: "SHORT OPEN인데 거래소 포지션 없음", severity: "high" },
  LONG_OPEN_INCOMPLETE_EXIT_ORDERS: { label: "LONG OPEN인데 TP/SL 주문이 불완전", severity: "high" },
  SHORT_OPEN_INCOMPLETE_EXIT_ORDERS: { label: "SHORT OPEN인데 TP/SL 주문이 불완전", severity: "high" },
  ENDED_WITH_EXCHANGE_ACTIVITY: { label: "레짐 종료인데 거래소 주문/포지션 존재", severity: "high" },
};

const BINANCE_RUNTIME_EVENT_TYPE_LABELS = {
  ORDER_TRADE_UPDATE: "일반 주문 상태",
  ALGO_UPDATE: "조건부 주문 상태",
  CONDITIONAL_ORDER_TRIGGER_REJECT: "조건부 트리거 거절",
};

const BINANCE_RUNTIME_EVENT_SEVERITY_LABELS = {
  low: "정상/참고",
  medium: "주의",
  high: "즉시 확인",
};

const BINANCE_RUNTIME_EVENT_CODE_REPLACEMENTS = [
  ["SPLIT_TAKE_PROFIT", "분할 익절"],
  ["TAKE_PROFIT", "익절"],
  ["STOP_LOSS", "손절"],
  ["MARKET_EXIT", "시장가 청산"],
  ["MANUAL_CLOSE", "수동 청산"],
  ["PARTIALLY_FILLED", "부분 체결"],
  ["PARTIAL_CANCELED", "일부 체결 후 취소"],
  ["PARTIAL_EXPIRED", "일부 체결 후 잔량 취소"],
  ["TRIGGER_REJECT", "트리거 거절"],
  ["FILLED", "체결"],
  ["CANCELED", "취소"],
  ["EXPIRED", "만료"],
  ["REJECTED", "거절"],
  ["FINISHED", "완료"],
  ["UPDATED", "변경"],
  ["SIGNAL", "신호"],
  ["GRID", "그리드"],
  ["ENTRY", "진입"],
  ["UNKNOWN", "미분류"],
  ["NEW", "접수"],
];

const ACCOUNT_RISK_LEVEL_LABELS = {
  SAFE: "안정",
  WATCH: "관심",
  WARNING: "경고",
  DANGER: "위험",
  CRITICAL: "치명적",
  UNKNOWN: "미확정",
};

const ACCOUNT_RISK_LEVEL_TONES = {
  SAFE: "safe",
  WATCH: "watch",
  WARNING: "warning",
  DANGER: "danger",
  CRITICAL: "critical",
  UNKNOWN: "unknown",
};

const POLICY_MATCHED_LABELS = {
  Y: "발동",
  N: "미발동",
};

const POLICY_SEVERITY_LABELS = {
  low: "참고",
  medium: "주의",
  high: "즉시 확인",
};

const POLICY_SEVERITY_TONES = {
  low: "low",
  medium: "medium",
  high: "high",
};

const POLICY_SCOPE_TYPE_LABELS = policyEngine.POLICY_SCOPE_TYPE_LABELS;
const OPS_ADMIN_IDS = new Set(
  String(process.env.XIGNAL_OPS_ADMIN_IDS || "test1")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);

const prettifyWebhookResultCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .split("_")
    .filter(Boolean)
    .join(" ");

const decorateWebhookEventRow = (row = {}) => ({
  ...row,
  hookCategoryLabel:
    WEBHOOK_CATEGORY_LABELS[String(row.hookCategory || "").trim().toLowerCase()] || null,
  statusLabel: WEBHOOK_STATUS_LABELS[String(row.status || "").trim().toUpperCase()] || null,
  resultLabel:
    WEBHOOK_RESULT_LABELS[String(row.resultCode || "").trim().toUpperCase()] ||
    prettifyWebhookResultCode(row.resultCode),
  isDuplicate: String(row.duplicateFlag || "N").trim().toUpperCase() === "Y",
});

const decorateWebhookEventRows = (rows = []) =>
  Array.isArray(rows) ? rows.map((row) => decorateWebhookEventRow(row)) : rows;

const decorateWebhookTargetRow = (row = {}) => ({
  ...row,
  strategyCategoryLabel:
    WEBHOOK_CATEGORY_LABELS[String(row.strategyCategory || "").trim().toLowerCase()] || null,
  resultLabel:
    WEBHOOK_TARGET_RESULT_LABELS[String(row.resultCode || "").trim().toUpperCase()] ||
    prettifyWebhookResultCode(row.resultCode),
  severityLabel:
    WEBHOOK_TARGET_SEVERITY_LABELS[String(row.severity || "").trim().toLowerCase()] || "참고",
  severityTone:
    WEBHOOK_TARGET_SEVERITY_TONES[String(row.severity || "").trim().toLowerCase()] || "low",
  opsStatusLabel:
    WEBHOOK_TARGET_OPS_STATUS_LABELS[String(row.opsStatus || "").trim().toUpperCase()] || "미대응",
  runtimeStateLabel: row.legacyStatus
    ? runtimeState.decorateRuntimeFields({
        enabled: row.controlState === "ON",
        status: row.legacyStatus,
      }).runtimeStateLabel
    : null,
  regimeStatusLabel: row.regimeStatus
    ? canonicalRuntimeState.decorateGridItemSync({
        enabled: row.controlState === "ON",
        regimeStatus: row.regimeStatus,
      }).runtimeStateLabel
    : null,
});

const decorateWebhookTargetRows = (rows = []) =>
  Array.isArray(rows) ? rows.map((row) => decorateWebhookTargetRow(row)) : rows;

const decorateBinanceRuntimeHealth = (health = {}) => ({
  ...health,
  statusLabel:
    BINANCE_RUNTIME_STATUS_LABELS[String(health.status || "").trim().toUpperCase()] ||
    health.status ||
    null,
});

const decorateAccountRiskRow = (row = {}) => {
  const riskLevel = String(row.riskLevel || row.risk_level || "UNKNOWN").trim().toUpperCase();
  const accountMode = String(row.accountMode || row.account_mode || "").trim().toUpperCase();
  const positionMode = String(row.positionMode || row.position_mode || (row.hedgeMode ? "HEDGE" : "")).trim().toUpperCase();
  return {
    ...row,
    riskLevel,
    accountMode,
    accountModeLabel:
      accountMode === "MULTI_ASSET"
        ? "멀티 자산 모드"
        : accountMode === "SINGLE_ASSET"
          ? "단일 자산 모드"
          : row.accountMode || row.account_mode || null,
    hedgeMode: typeof row.hedgeMode === "boolean" ? row.hedgeMode : String(positionMode) === "HEDGE",
    positionMode,
    positionModeLabel:
      positionMode === "HEDGE"
        ? "헤지 모드"
        : positionMode === "ONE_WAY"
          ? "단방향 모드"
          : row.positionMode || row.position_mode || null,
    riskLevelLabel: ACCOUNT_RISK_LEVEL_LABELS[riskLevel] || riskLevel,
    riskTone: ACCOUNT_RISK_LEVEL_TONES[riskLevel] || "unknown",
  };
};

const decorateAccountRiskRows = (rows = []) =>
  Array.isArray(rows) ? rows.map((row) => decorateAccountRiskRow(row)) : rows;

const mergeAccountRiskWithHealth = (risk = {}, health = {}) =>
  decorateAccountRiskRow({
    ...risk,
    hedgeMode:
      String(risk.positionMode || risk.position_mode || "").trim()
        ? risk.hedgeMode
        : health.lastHedgeMode,
    positionMode:
      risk.positionMode ||
      risk.position_mode ||
      (typeof health.lastHedgeMode === "boolean"
        ? health.lastHedgeMode
          ? "HEDGE"
          : "ONE_WAY"
        : ""),
  });

const decoratePolicyRuleRow = (row = {}) => {
  const decorated = policyEngine.decoratePolicyRule(row);
  return {
    ...decorated,
    severityLabel:
      POLICY_SEVERITY_LABELS[String(decorated.severity || "").trim().toLowerCase()] ||
      decorated.severity ||
      null,
    severityTone:
      POLICY_SEVERITY_TONES[String(decorated.severity || "").trim().toLowerCase()] || "low",
  };
};

const decoratePolicyRuleRows = (rows = []) =>
  Array.isArray(rows) ? rows.map((row) => decoratePolicyRuleRow(row)) : rows;

const decoratePolicyEvalRow = (row = {}) => {
  const severity = String(row.severity || "").trim().toLowerCase();
  const matched = String(row.matched || "N").trim().toUpperCase();
  return {
    ...row,
    scopeTypeLabel:
      policyEngine.POLICY_SCOPE_TYPE_LABELS[String(row.scopeType || "").trim().toUpperCase()] ||
      row.scopeType ||
      null,
    recommendedActionLabel:
      policyEngine.POLICY_ACTION_TYPE_LABELS[
        String(row.recommendedAction || "").trim().toUpperCase()
      ] ||
      row.recommendedAction ||
      null,
    actualActionLabel:
      policyEngine.POLICY_ACTION_TYPE_LABELS[
        String(row.actualAction || "").trim().toUpperCase()
      ] ||
      row.actualAction ||
      null,
    reasonLabel: policyEngine.POLICY_REASON_LABELS[row.reasonCode] || row.reasonCode || null,
    matchedLabel: POLICY_MATCHED_LABELS[matched] || matched,
    severityLabel: POLICY_SEVERITY_LABELS[severity] || row.severity || null,
    severityTone: POLICY_SEVERITY_TONES[severity] || "low",
  };
};

const decoratePolicyEvalRows = (rows = []) =>
  Array.isArray(rows) ? rows.map((row) => decoratePolicyEvalRow(row)) : rows;

const decoratePolicyActionRow = (row = {}) => {
  const status = String(row.status || "").trim().toUpperCase();
  const actionType = String(row.actionType || "").trim().toUpperCase();
  const actionMode = String(row.actionMode || "").trim().toUpperCase();

  return {
    ...row,
    scopeTypeLabel:
      policyEngine.POLICY_SCOPE_TYPE_LABELS[String(row.scopeType || "").trim().toUpperCase()] ||
      row.scopeType ||
      null,
    actionTypeLabel:
      policyEngine.POLICY_ACTION_TYPE_LABELS[actionType] ||
      row.actionType ||
      null,
    actionModeLabel:
      policyEngine.POLICY_MODE_LABELS[actionMode] ||
      row.actionMode ||
      null,
    ruleLabel: row.ruleCode ? policyEngine.decoratePolicyRule({ ruleCode: row.ruleCode }).ruleLabel : null,
    statusLabel:
      ({
        QUEUED: "대기",
        EXECUTED: "실행됨",
        SKIPPED: "생략됨",
        FAILED: "실패",
        DRY_RUN: "드라이런",
      }[status] || row.status || null),
  };
};

const decoratePolicyActionRows = (rows = []) =>
  Array.isArray(rows) ? rows.map((row) => decoratePolicyActionRow(row)) : rows;

const buildPolicyWarningCounts = (rows = []) =>
  (Array.isArray(rows) ? rows : []).reduce(
    (acc, row) => {
      const severity = String(row.severity || "").trim().toLowerCase();
      const count = Number(row.warningCount || row.evalCount || 0);
      if (severity === "high") {
        acc.high += count;
      } else if (severity === "medium") {
        acc.medium += count;
      } else {
        acc.low += count;
      }
      acc.total += count;
      if (row.lastCreatedAt && (!acc.lastCreatedAt || new Date(row.lastCreatedAt) > new Date(acc.lastCreatedAt))) {
        acc.lastCreatedAt = row.lastCreatedAt;
      }
      return acc;
    },
    { total: 0, high: 0, medium: 0, low: 0, lastCreatedAt: null }
  );

const getRiskActionSeverity = (riskLevel) => {
  switch (String(riskLevel || "").trim().toUpperCase()) {
    case "CRITICAL":
      return "high";
    case "DANGER":
      return "high";
    case "WARNING":
      return "medium";
    case "WATCH":
      return "low";
    default:
      return "low";
  }
};

const buildRuntimeOpsActionItems = ({
  health = {},
  reconcile = {},
  accountRisk = {},
  eventCounts = {},
  recentHighEvents = [],
  policyWarnings = [],
  policyWarningCounts = {},
  killSwitchState = null,
} = {}) => {
  const items = [];
  const runtimeStatus = String(health.status || "").trim().toUpperCase();
  const totalIssueCount = Number(reconcile?.summary?.totalIssueCount || 0);
  const riskLevel = String(accountRisk.riskLevel || "UNKNOWN").trim().toUpperCase();
  const highSeverityCount24h = Number(eventCounts.highSeverityCount24h || 0);
  const mediumSeverityCount24h = Number(eventCounts.mediumSeverityCount24h || 0);
  const policyHighCount = Number(policyWarningCounts.high || 0);
  const policyMediumCount = Number(policyWarningCounts.medium || 0);

  if (runtimeStatus && runtimeStatus !== "CONNECTED") {
    items.push({
      code: "BINANCE_RUNTIME_UNHEALTHY",
      severity: "high",
      label: "Binance 런타임 연결 점검 필요",
      detail: health.lastErrorMessage || health.lastErrorCode || "listenKey/user stream 상태를 먼저 확인하세요.",
    });
  }

  if (totalIssueCount > 0) {
    items.push({
      code: "BINANCE_RECONCILIATION_ISSUES",
      severity: "high",
      label: "거래소와 DB 상태 불일치 확인 필요",
      detail: `Signal/Grid 불일치 ${totalIssueCount}건이 남아 있습니다.`,
    });
  }

  if (["WATCH", "WARNING", "DANGER", "CRITICAL"].includes(riskLevel)) {
    items.push({
      code: "ACCOUNT_RISK_ELEVATED",
      severity: getRiskActionSeverity(riskLevel),
      label: `계정 리스크 ${ACCOUNT_RISK_LEVEL_LABELS[riskLevel] || riskLevel}`,
      detail: `Margin Ratio ${Number(accountRisk.accountMarginRatio || 0).toFixed(2)}%, Equity ${Number(accountRisk.accountEquity || 0).toFixed(4)} 기준입니다.`,
    });
  }

  if (killSwitchState?.active) {
    items.push({
      code: "GLOBAL_KILL_SWITCH_ACTIVE",
      severity: "high",
      label: `글로벌 kill-switch 활성 (${killSwitchState.mode || "DRY_RUN"})`,
      detail:
        killSwitchState.note ||
        `차단 category: ${(killSwitchState.blockedCategories || []).join(", ") || "all"}`,
    });
  }

  if (policyHighCount > 0) {
    const topWarning = Array.isArray(policyWarnings) && policyWarnings.length ? policyWarnings[0] : null;
    items.push({
      code: "POLICY_HIGH_SEVERITY_WARNINGS",
      severity: "high",
      label: "고심각도 정책 경고 확인 필요",
      detail: topWarning?.reasonText || `고심각도 정책 경고 ${policyHighCount}건이 기록되었습니다.`,
    });
  } else if (policyMediumCount > 0) {
    items.push({
      code: "POLICY_MEDIUM_SEVERITY_WARNINGS",
      severity: "medium",
      label: "정책 경고 확인 필요",
      detail: `주의 정책 경고 ${policyMediumCount}건이 기록되었습니다.`,
    });
  }

  if (highSeverityCount24h > 0) {
    items.push({
      code: "BINANCE_HIGH_SEVERITY_EVENTS",
      severity: "high",
      label: "최근 24시간 고심각도 Binance 이벤트 확인 필요",
      detail: `고심각도 이벤트 ${highSeverityCount24h}건이 기록되었습니다.`,
    });
  } else if (mediumSeverityCount24h > 0) {
    items.push({
      code: "BINANCE_MEDIUM_SEVERITY_EVENTS",
      severity: "medium",
      label: "최근 24시간 주의 이벤트 확인 필요",
      detail: `주의 이벤트 ${mediumSeverityCount24h}건이 기록되었습니다.`,
    });
  }

  if (!items.length && Array.isArray(recentHighEvents) && recentHighEvents.length === 0) {
    items.push({
      code: "OPS_ALL_CLEAR",
      severity: "low",
      label: "현재 즉시 대응이 필요한 운영 이슈가 없습니다",
      detail: "연결 상태, 계정 리스크, Binance 이벤트가 모두 안정 범위입니다.",
    });
  }

  return items;
};

const loadOpsAccessMember = async (userId) => {
  const member = await dbcon.DBOneCall(`CALL SP_A_MEMBER_GET(?)`, [userId]);
  if (!member) {
    return null;
  }

  if (Number(member.grade) > 0) {
    return false;
  }

  if (!OPS_ADMIN_IDS.has(String(member.mem_id || "").trim())) {
    return false;
  }

  return member;
};

const loadAdminConsoleAccessMember = async (userId) => {
  const member = await dbcon.DBOneCall(`CALL SP_A_MEMBER_GET(?)`, [userId]);
  if (!member) {
    return null;
  }
  if (Number(member.grade) > 0) {
    return false;
  }
  return member;
};

const getOpsPriorityScore = ({
  health = {},
  risk = {},
  eventCounts = {},
  issueCount = 0,
  policyCounts = {},
  killSwitchState = null,
} = {}) => {
  let score = 0;
  const runtimeStatus = String(health.status || "").trim().toUpperCase();
  const riskLevel = String(risk.riskLevel || "UNKNOWN").trim().toUpperCase();
  const highSeverityCount = Number(eventCounts.highSeverityCount24h || 0);
  const mediumSeverityCount = Number(eventCounts.mediumSeverityCount24h || 0);
  const highPolicyCount = Number(policyCounts.high || 0);
  const mediumPolicyCount = Number(policyCounts.medium || 0);

  if (killSwitchState?.active) {
    score += 50;
  }

  if (runtimeStatus && runtimeStatus !== "CONNECTED") {
    score += 40;
  }

  score += Math.min(Number(issueCount || 0) * 12, 48);
  score += Math.min(highSeverityCount * 6, 24);
  score += Math.min(mediumSeverityCount * 2, 12);
  score += Math.min(highPolicyCount * 8, 24);
  score += Math.min(mediumPolicyCount * 3, 12);

  switch (riskLevel) {
    case "CRITICAL":
      score += 40;
      break;
    case "DANGER":
      score += 30;
      break;
    case "WARNING":
      score += 20;
      break;
    case "WATCH":
      score += 10;
      break;
    default:
      break;
  }

  return score;
};

const getOpsPriorityLabel = (score) => {
  if (score >= 80) {
    return "즉시 대응";
  }
  if (score >= 50) {
    return "우선 확인";
  }
  if (score >= 20) {
    return "관심 필요";
  }
  return "정상 범위";
};

const buildOpsUserActionItems = ({
  health = {},
  reconcile = {},
  risk = {},
  eventCounts = {},
  policyWarnings = [],
  policyCounts = {},
  killSwitchState = null,
} = {}) => {
  return buildRuntimeOpsActionItems({
    health,
    reconcile: {
      summary: {
        totalIssueCount: Number(reconcile.totalIssueCount || 0),
      },
    },
    accountRisk: risk,
    eventCounts,
    recentHighEvents: [],
    policyWarnings,
    policyWarningCounts: policyCounts,
    killSwitchState,
  });
};

const decorateBinanceRuntimeIssueItem = (item = {}) => {
  const issues = Array.isArray(item.issues) ? item.issues : [];
  const issueDetails = issues.map((code) => ({
    code,
    label: BINANCE_RUNTIME_ISSUE_META[code]?.label || code,
    severity: BINANCE_RUNTIME_ISSUE_META[code]?.severity || "medium",
  }));

  if (item.category === "grid") {
    const canonicalGridItem = canonicalRuntimeState.decorateGridItemSync(item);
    return {
      ...item,
      runtimeStateLabel: canonicalGridItem.runtimeStateLabel,
      regimeStatusLabel: canonicalGridItem.runtimeStateLabel,
      regimeEndReasonLabel: gridRuntime.getGridRegimeEndReasonLabel(item.regimeEndReason),
      longLegStatusLabel: gridRuntime.getGridLegStatusLabel(item.longLegStatus),
      shortLegStatusLabel: gridRuntime.getGridLegStatusLabel(item.shortLegStatus),
      issueDetails,
    };
  }

  return {
    ...item,
    runtimeStateLabel: runtimeState.decorateRuntimeFields({
      enabled: item.controlState === "ON",
      status: item.legacyStatus,
    }).runtimeStateLabel,
    issueDetails,
  };
};

const decorateBinanceRuntimeIssueCollection = (items = []) =>
  Array.isArray(items) ? items.map((item) => decorateBinanceRuntimeIssueItem(item)) : [];

const decorateBinanceRuntimeReconciliation = (payload = {}) => ({
  ...payload,
  health: decorateBinanceRuntimeHealth(payload.health || {}),
  signalIssues: decorateBinanceRuntimeIssueCollection(payload.signalIssues),
  gridIssues: decorateBinanceRuntimeIssueCollection(payload.gridIssues),
});

const prettifyBinanceRuntimeEventCode = (value) => {
  let normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  BINANCE_RUNTIME_EVENT_CODE_REPLACEMENTS.forEach(([from, to]) => {
    normalized = normalized.replaceAll(from, to);
  });

  return normalized.replaceAll("_", " ").replace(/\s+/g, " ").trim();
};

const decorateBinanceRuntimeEventRow = (row = {}) => ({
  ...row,
  eventTypeLabel:
    BINANCE_RUNTIME_EVENT_TYPE_LABELS[String(row.eventType || "").trim().toUpperCase()] ||
    row.eventType ||
    null,
  severityLabel:
    BINANCE_RUNTIME_EVENT_SEVERITY_LABELS[String(row.severity || "").trim().toLowerCase()] ||
    row.severity ||
    null,
  eventCodeLabel: prettifyBinanceRuntimeEventCode(row.eventCode),
  ...orderDisplayState.deriveOrderTerminalDisplayState(row),
});

const decorateBinanceRuntimeEventRows = (rows = []) =>
  Array.isArray(rows) ? rows.map((row) => decorateBinanceRuntimeEventRow(row)) : rows;

const isBinanceOrderEventAbnormal = (row = {}) => {
  const derived = row.lifecycleResult ? row : orderDisplayState.deriveAdminLifecycleSeverity(row);
  const lifecycleResult = String(derived.lifecycleResult || "").trim().toUpperCase();
  const expectedOrAbnormal = String(derived.expectedOrAbnormal || "").trim().toUpperCase();

  if (derived.isExpectedIgnore || lifecycleResult === "EXPECTED" || expectedOrAbnormal === "EXPECTED") {
    return false;
  }

  if (derived.requiresUserAction || lifecycleResult === "CRITICAL" || expectedOrAbnormal === "ABNORMAL") {
    return true;
  }

  return false;
};

const decorateBinanceOrderMonitorRows = (rows = []) =>
  decorateBinanceRuntimeEventRows(rows).map((row) => {
    const abnormal = isBinanceOrderEventAbnormal(row);
    const review = !abnormal && String(row.expectedOrAbnormal || "").trim().toUpperCase() === "REVIEW";
    return {
      ...row,
      attentionRequired: abnormal,
      reviewRequired: review,
      normalityLabel: abnormal ? "비정상" : review ? "검토" : "예상/정상",
    };
  });

const ORDER_PROCESS_STAGE_STATE_LABELS = {
  NORMAL: "정상",
  ABNORMAL: "비정상",
  ACTIVE: "",
  NA: "",
};

const ORDER_PROCESS_STATUS_LABELS = {
  NORMAL: "완료",
  ABNORMAL: "완료",
  ACTIVE: "진행중",
};

const SYSTEM_LOG_CATEGORY_LABELS = {
  TV_STATS_WEBHOOK: "트뷰 통계 웹훅",
  SERVER: "서버",
  PROGRAM: "자체 프로그램 오류",
};

const SERVER_SYSTEM_LOG_FUNS = new Set([
  "INITAPI",
  "GETUSERBALANCE",
  "USERSTREAM",
  "ACCOUNTBALANCE",
]);

const ORDER_SYSTEM_LOG_FUNS = new Set([
  "ORDERUPDATE",
  "SYNCLIVEBOUNDEXITORD",
  "SENDENTER",
  "CANCELBOUNDEXITORDER",
  "CLOSEPARTIALFILL",
  "CLOSEDISPATCHLIVE",
  "SENDFORCINGDISPATCH",
  "TIMEEXPIRYCLOSE",
  "GRIDLIVEARM",
  "GRIDTESTOPEN",
  "GRIDLIVEOPEN",
  "GRIDTESTEXIT",
  "GRIDLIVEEXIT",
  "GRIDTESTSTOP",
  "GRIDLIVEMANUALCLOSE",
  "SENDFORCING",
  "SPLITTAKEPROFITADVAN",
  "EXTERNALCLOSERECONCI",
  "TIMEEXPIRYCLOSETEST",
]);

const normalizeDateMs = (value) => {
  if (!value) {
    return null;
  }

  const ms = dayjs(value).valueOf();
  return Number.isFinite(ms) ? ms : null;
};

const buildProcessStage = (state, detail = null, displayLabel = null) => ({
  state,
  label: displayLabel || ORDER_PROCESS_STAGE_STATE_LABELS[state] || state,
  detail: detail || null,
});

const isAbnormalProcessStage = (stage = {}) => String(stage.state || "").trim().toUpperCase() === "ABNORMAL";
const isNormalProcessStage = (stage = {}) => String(stage.state || "").trim().toUpperCase() === "NORMAL";
const isActiveProcessStage = (stage = {}) => String(stage.state || "").trim().toUpperCase() === "ACTIVE";

const buildProcessStateLabel = ({ entryStage, exitPendingStage, exitStage, abnormal }) => {
  if (abnormal) {
    return "비정상";
  }
  if (isNormalProcessStage(exitStage)) {
    return "정상 종료";
  }
  if (isNormalProcessStage(exitPendingStage) || isActiveProcessStage(exitPendingStage)) {
    return "청산 대기/진행";
  }
  if (isNormalProcessStage(entryStage) || isActiveProcessStage(entryStage)) {
    return "진입 진행/보유";
  }
  return "진입 대기";
};

const classifySystemMsgCategory = (fun) => {
  const normalizedFun = String(fun || "").trim().toUpperCase();
  if (!normalizedFun) {
    return null;
  }
  if (SERVER_SYSTEM_LOG_FUNS.has(normalizedFun)) {
    return "SERVER";
  }
  if (ORDER_SYSTEM_LOG_FUNS.has(normalizedFun)) {
    return null;
  }
  return "PROGRAM";
};

const isSystemWebhookAbnormal = (row = {}) => {
  const resultCode = String(row.resultCode || "").trim().toUpperCase();
  return !["BACKTEST_IMPORTED", "BACKTEST_DUPLICATE", "BACKTEST_STORED_ONLY"].includes(resultCode);
};

const decorateSystemLogRows = (rows = []) =>
  rows.map((row) => ({
    ...row,
    categoryLabel:
      SYSTEM_LOG_CATEGORY_LABELS[String(row.category || "").trim().toUpperCase()] ||
      row.category ||
      null,
    normalityLabel: row.abnormal ? "비정상" : "정상",
  }));

const hasEventCode = (rows, matcher) =>
  rows.some((row) => matcher(String(row.eventCode || "").trim().toUpperCase()));

const firstMatchingEvent = (rows, matcher) =>
  rows.find((row) => matcher(String(row.eventCode || "").trim().toUpperCase())) || null;

const getEventPositionSide = (row = {}) =>
  String(row.positionSide || row.position_side || "").trim().toUpperCase();

const normalizeProcessMsgText = (value, maxLength = 220) => {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^\[reject\]\s*/i, "")
    .trim();

  if (!text) {
    return null;
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

const normalizeProcessMsgCode = (value) => String(value || "").trim().toUpperCase();
const normalizeProcessMsgFun = (value) => String(value || "").trim().toUpperCase();

const resolveOrderProcessEntryMsgIssue = ({ category, msgRows = [] } = {}) => {
  const normalizedCategory = String(category || "").trim().toLowerCase();
  const normalizedRows = Array.isArray(msgRows) ? [...msgRows].reverse() : [];

  if (normalizedCategory === "signal") {
    const sendEnterError = normalizedRows
      .filter((row) => normalizeProcessMsgFun(row.fun) === "SENDENTER")
      .find((row) => {
        const code = normalizeProcessMsgCode(row.code);
        return code && !["0", "200", "OK", "SUCCESS"].includes(code);
      });

    if (sendEnterError) {
      return `진입 주문 생성 실패 / ${normalizeProcessMsgText(sendEnterError.msg) || sendEnterError.code}`;
    }
  }

  return null;
};

const resolveOrderProcessExitMsgIssue = ({ category, msgRows = [] } = {}) => {
  const normalizedCategory = String(category || "").trim().toLowerCase();
  const normalizedRows = Array.isArray(msgRows) ? [...msgRows].reverse() : [];

  if (normalizedCategory === "signal") {
    const transientBoundCodes = new Set([
      "BOUND_WAIT_FILLED",
      "BOUND_WAIT_POSITION",
    ]);
    const boundIssue = normalizedRows
      .filter((row) => normalizeProcessMsgFun(row.fun) === "SYNCLIVEBOUNDEXITORD")
      .find((row) => {
        const code = normalizeProcessMsgCode(row.code);
        if (!code) {
          return false;
        }
        if (["BOUND_REGISTERED", "BOUND_DUPLICATE_OK"].includes(code)) {
          return false;
        }
        if (transientBoundCodes.has(code)) {
          return false;
        }
        return true;
      });

    if (boundIssue) {
      return `보호주문 등록 실패 / ${normalizeProcessMsgText(boundIssue.msg) || boundIssue.code}`;
    }

    const forcingIssue = normalizedRows
      .filter((row) => normalizeProcessMsgFun(row.fun) === "SENDFORCING")
      .find((row) => {
        const code = normalizeProcessMsgCode(row.code);
        return code && !["0", "200", "OK", "SUCCESS"].includes(code);
      });

    if (forcingIssue) {
      return `시장가 청산 실패 / ${normalizeProcessMsgText(forcingIssue.msg) || forcingIssue.code}`;
    }
  }

  if (normalizedCategory === "grid") {
    const gridManualCloseIssue = normalizedRows.find(
      (row) =>
        normalizeProcessMsgFun(row.fun) === "GRIDCONTROL" &&
        normalizeProcessMsgCode(row.code).includes("ERROR")
    );

    if (gridManualCloseIssue) {
      return `그리드 수동청산 실패 / ${normalizeProcessMsgText(gridManualCloseIssue.msg) || gridManualCloseIssue.code}`;
    }

    const stalePositionIssue = normalizedRows.find(
      (row) => normalizeProcessMsgFun(row.fun) === "GRIDLIVESAFETY"
    );

    if (stalePositionIssue) {
      return `그리드 안전정리 이슈 / ${normalizeProcessMsgText(stalePositionIssue.msg) || stalePositionIssue.code}`;
    }
  }

  return null;
};

const ORDER_PROCESS_ISSUE_CATEGORY_LABELS = {
  WEBHOOK_INPUT: "웹훅 입력",
  WEBHOOK_RUNTIME: "웹훅 처리",
  INTERNAL_RUNTIME: "서버 런타임",
  EXCHANGE_ACCOUNT: "거래소 계정 권한",
  EXCHANGE_ORDER: "거래소 주문",
  EXIT_RESERVATION: "보호주문",
  PID_LEDGER: "PID Ledger",
  GRID_RUNTIME: "그리드 엔진",
  UNKNOWN: "기타",
};

const ORDER_PROCESS_ISSUE_SOURCE_LABELS = {
  WEBHOOK: "트뷰 웹훅",
  SERVER: "서버 런타임",
  EXCHANGE_ACCOUNT: "거래소/계정",
  EXCHANGE_ORDER: "거래소 주문",
  EXIT_RESERVATION: "보호주문",
  PID_LEDGER: "PID Ledger",
  GRID_ENGINE: "그리드 엔진",
  UNKNOWN: "기타",
};

const buildOrderProcessIssueMeta = ({
  targetRow,
  webhookRow,
  waitingResultCode,
  msgRows = [],
  entryRows = [],
  exitPendingRows = [],
  currentLedgerRows = [],
  currentReservationRows = [],
  currentSnapshotRows = [],
  stages = {},
} = {}) => {
  if (!stages?.abnormal) {
    return {
      issueCode: null,
      issueCategory: null,
      issueCategoryLabel: null,
      issueSource: null,
      issueSourceLabel: null,
      issueLabel: null,
      issueDetail: null,
    };
  }

  const normalizedProblemStage = String(stages.problemStage || "").trim();
  const normalizedProblemDetail = normalizeProcessMsgText(stages.problemDetail, 320) || stages.problemDetail || null;
  const normalizedProblemDetailUpper = String(normalizedProblemDetail || "").trim().toUpperCase();
  const normalizedWebhookResult = String(webhookRow?.resultCode || "").trim().toUpperCase();
  const normalizedWaitingResult = String(waitingResultCode || "").trim().toUpperCase();
  const normalizedCategory = String(targetRow?.strategyCategory || "").trim().toLowerCase();
  const reversedMsgRows = Array.isArray(msgRows) ? [...msgRows].reverse() : [];
  const currentSnapshotSummary = buildSnapshotSummary(currentSnapshotRows);
  const currentActiveReservations = (currentReservationRows || []).filter((row) =>
    ["ACTIVE", "PARTIAL"].includes(String(row?.status || "").trim().toUpperCase())
  );
  const hasReconciledEntryFill = (currentLedgerRows || []).some((row) =>
    String(row?.eventType || "").trim().toUpperCase().includes("RECONCILED_ENTRY_FILL")
  );
  const hasReconciledExitFill = (currentLedgerRows || []).some((row) =>
    String(row?.eventType || "").trim().toUpperCase().includes("RECONCILED_EXIT_FILL")
  );
  const hasManualSafetyCloseFill = (currentLedgerRows || []).some((row) => {
    const eventType = String(row?.eventType || "").trim().toUpperCase();
    const sourceClientOrderId = String(row?.sourceClientOrderId || "").trim().toUpperCase();
    return eventType === "GRID_MANUAL_CLOSE_FILL" || sourceClientOrderId.startsWith("GMANUAL_");
  });

  const buildMeta = ({
    issueCode,
    issueCategory,
    issueSource,
    issueLabel,
    issueDetail,
  }) => ({
    issueCode: issueCode || null,
    issueCategory: issueCategory || "UNKNOWN",
    issueCategoryLabel:
      ORDER_PROCESS_ISSUE_CATEGORY_LABELS[String(issueCategory || "UNKNOWN").trim().toUpperCase()] ||
      issueCategory ||
      null,
    issueSource: issueSource || "UNKNOWN",
    issueSourceLabel:
      ORDER_PROCESS_ISSUE_SOURCE_LABELS[String(issueSource || "UNKNOWN").trim().toUpperCase()] ||
      issueSource ||
      null,
    issueLabel: issueLabel || normalizedProblemDetail || normalizedProblemStage || "원인 미상",
    issueDetail: issueDetail || normalizedProblemDetail || null,
  });

  const exchangePermissionMsg = reversedMsgRows.find((row) => {
    const code = normalizeProcessMsgCode(row.code);
    const text = String(row.msg || "").toUpperCase();
    return ["-2014", "-2015"].includes(code) || text.includes("INVALID API-KEY") || text.includes("IP, OR PERMISSIONS");
  });

  if (exchangePermissionMsg) {
    return buildMeta({
      issueCode: "EXCHANGE_API_PERMISSION",
      issueCategory: "EXCHANGE_ACCOUNT",
      issueSource: "EXCHANGE_ACCOUNT",
      issueLabel: "API 키/IP 권한 오류",
      issueDetail: normalizeProcessMsgText(exchangePermissionMsg.msg, 320) || normalizedProblemDetail,
    });
  }

  if (["INVALID_PAYLOAD", "NO_MATCHING_STRATEGY", "UNSUPPORTED_SIGNAL_TYPE", "PRICE_UNAVAILABLE"].includes(normalizedWebhookResult)) {
    return buildMeta({
      issueCode: normalizedWebhookResult,
      issueCategory: "WEBHOOK_INPUT",
      issueSource: "WEBHOOK",
      issueLabel: webhookRow?.resultLabel || normalizedWebhookResult,
    });
  }

  if (normalizedWebhookResult === "RUNTIME_ERROR") {
    return buildMeta({
      issueCode: "WEBHOOK_RUNTIME_ERROR",
      issueCategory: "WEBHOOK_RUNTIME",
      issueSource: "SERVER",
      issueLabel: "웹훅 처리 중 런타임 오류",
    });
  }

  if (normalizedWaitingResult === "LOCK_SKIPPED") {
    return buildMeta({
      issueCode: "RUNTIME_LOCK_SKIPPED",
      issueCategory: "INTERNAL_RUNTIME",
      issueSource: "SERVER",
      issueLabel: "동시 처리 잠금 충돌",
    });
  }

  if (normalizedWaitingResult === "POSITION_TRACKING_ERROR" || normalizedProblemDetailUpper.includes("포지션 추적")) {
    return buildMeta({
      issueCode: "PID_POSITION_TRACKING_ERROR",
      issueCategory: "PID_LEDGER",
      issueSource: "PID_LEDGER",
      issueLabel: "PID 포지션 추적 실패",
    });
  }

  const entryRejectEvent =
    firstMatchingEvent(entryRows, (code) => code.includes("REJECT")) ||
    firstMatchingEvent(entryRows, (code) => code.includes("EXPIRED")) ||
    firstMatchingEvent(entryRows, (code) => code.includes("CANCELED")) ||
    null;
  if (entryRejectEvent || normalizedWaitingResult === "ENTRY_REJECTED") {
    const decorated = entryRejectEvent ? decorateBinanceRuntimeEventRow(entryRejectEvent) : null;
    return buildMeta({
      issueCode: "ENTRY_ORDER_REJECTED",
      issueCategory: "EXCHANGE_ORDER",
      issueSource: "EXCHANGE_ORDER",
      issueLabel: decorated?.eventCodeLabel || "진입 주문 거절",
    });
  }

  const triggerRejectEvent = firstMatchingEvent(exitPendingRows, (code) => code.includes("TRIGGER_REJECT"));
  if (triggerRejectEvent) {
    const decorated = decorateBinanceRuntimeEventRow(triggerRejectEvent);
    return buildMeta({
      issueCode: "EXIT_TRIGGER_REJECT",
      issueCategory: "EXCHANGE_ORDER",
      issueSource: "EXCHANGE_ORDER",
      issueLabel: decorated?.eventCodeLabel || "조건부 주문 트리거 거절",
    });
  }

  if (normalizedProblemDetailUpper.includes("보호주문 등록 실패")) {
    return buildMeta({
      issueCode: "EXIT_RESERVATION_REGISTER_FAILED",
      issueCategory: "EXIT_RESERVATION",
      issueSource: "EXIT_RESERVATION",
      issueLabel: "보호주문 등록 실패",
    });
  }

  if (
    normalizedProblemDetailUpper.includes("청산 주문 취소") ||
    normalizedProblemDetailUpper.includes("청산 주문이 확인되지 않음") ||
    normalizedProblemDetailUpper.includes("손절 취소") ||
    normalizedProblemDetailUpper.includes("익절 취소")
  ) {
    return buildMeta({
      issueCode: "EXIT_RESERVATION_BROKEN",
      issueCategory: "EXIT_RESERVATION",
      issueSource: "EXIT_RESERVATION",
      issueLabel: "보호주문 상태 비정상",
    });
  }

  if (
    normalizedProblemDetailUpper.includes("시장가 청산 실패") ||
    normalizedProblemDetailUpper.includes("수동청산 실패")
  ) {
    return buildMeta({
      issueCode: normalizedCategory === "grid" ? "GRID_MANUAL_CLOSE_FAILED" : "FORCED_EXIT_FAILED",
      issueCategory: normalizedCategory === "grid" ? "GRID_RUNTIME" : "EXCHANGE_ORDER",
      issueSource: normalizedCategory === "grid" ? "GRID_ENGINE" : "EXCHANGE_ORDER",
      issueLabel: normalizedCategory === "grid" ? "그리드 수동청산 실패" : "시장가 청산 실패",
    });
  }

  if (normalizedProblemDetailUpper.includes("안전정리")) {
    return buildMeta({
      issueCode: "GRID_RUNTIME_SAFETY_CLEANUP",
      issueCategory: "GRID_RUNTIME",
      issueSource: "GRID_ENGINE",
      issueLabel: "그리드 안전정리 이슈",
    });
  }

  if (normalizedProblemDetailUpper.includes("진입 주문 로그가 확인되지 않음") && hasReconciledEntryFill) {
    if (normalizedCategory === "grid" && (hasReconciledExitFill || hasManualSafetyCloseFill)) {
      return buildMeta({
        issueCode: "GRID_EXIT_RESERVATION_MISSING_RECONCILED",
        issueCategory: "EXIT_RESERVATION",
        issueSource: "GRID_ENGINE",
        issueLabel: "보호주문 누락 후 안전정리",
        issueDetail:
          "거래소에서는 진입 체결이 있었지만 런타임이 체결을 놓쳐 보호주문이 제때 생성되지 않았고, 이후 거래소 이력 복구 후 안전정리로 종료됨",
      });
    }

    if (currentSnapshotSummary.hasOpenQty && currentActiveReservations.length > 0) {
      return buildMeta({
        issueCode: "EXIT_RESERVATION_RECOVERED_AFTER_RECONCILED_ENTRY",
        issueCategory: "EXIT_RESERVATION",
        issueSource: normalizedCategory === "grid" ? "GRID_ENGINE" : "EXIT_RESERVATION",
        issueLabel: "거래소 체결 복구 후 보호주문 재등록",
        issueDetail:
          "원래 진입 체결 로그를 놓쳤지만 거래소 이력으로 체결을 복구한 뒤, 현재 보호주문은 다시 등록된 상태",
      });
    }

    return buildMeta({
      issueCode: "EXIT_RESERVATION_MISSING_AFTER_RECONCILED_ENTRY",
      issueCategory: "EXIT_RESERVATION",
      issueSource: normalizedCategory === "grid" ? "GRID_ENGINE" : "EXIT_RESERVATION",
      issueLabel: "보호주문 누락",
      issueDetail:
        "거래소에는 진입 체결이 있었지만 런타임이 이를 놓쳐 보호주문이 제때 생성되지 않음",
    });
  }

  if (normalizedProblemDetailUpper.includes("진입 주문 로그가 확인되지 않음")) {
    return buildMeta({
      issueCode: "ENTRY_ORDER_LOG_MISSING",
      issueCategory: "INTERNAL_RUNTIME",
      issueSource: "SERVER",
      issueLabel: "진입 주문 로그 누락",
    });
  }

  if (normalizedProblemDetailUpper.includes("PID 기준 청산 주문이 확인되지 않음")) {
    return buildMeta({
      issueCode: "EXIT_ORDER_LOG_MISSING",
      issueCategory: "EXIT_RESERVATION",
      issueSource: "EXIT_RESERVATION",
      issueLabel: "PID 기준 청산 주문 누락",
    });
  }

  return buildMeta({
    issueCode: "UNKNOWN_ABNORMAL",
    issueCategory: normalizedProblemStage === "웹훅 수신" ? "WEBHOOK_RUNTIME" : "UNKNOWN",
    issueSource: normalizedProblemStage === "웹훅 수신" ? "WEBHOOK" : "UNKNOWN",
    issueLabel: normalizedProblemStage ? `${normalizedProblemStage} 비정상` : "원인 미상",
  });
};

const PID_ENTRY_LEDGER_EVENTS = new Set(["ENTRY_FILL", "GRID_ENTRY_FILL"]);
const PID_EXIT_LEDGER_EVENT_LABELS = {
  SPLIT_TAKE_PROFIT_FILL: "분할 익절 체결",
  BOUND_PROFIT_FILL: "익절 체결",
  BOUND_STOP_FILL: "손절 체결",
  GRID_TAKE_PROFIT_FILL: "그리드 익절 체결",
  GRID_STOP_FILL: "그리드 손절 체결",
  GRID_MANUAL_CLOSE_FILL: "그리드 수동청산 체결",
  MARKET_EXIT_FILL: "시장가 청산 체결",
  MANUAL_CLOSE_FILL: "수동 청산 체결",
  EXIT_FILL: "청산 체결",
};

const isPidEntryLedgerEvent = (eventType) =>
  PID_ENTRY_LEDGER_EVENTS.has(String(eventType || "").trim().toUpperCase());

const isPidExitLedgerEvent = (eventType) => !isPidEntryLedgerEvent(eventType);

const sumNumericField = (rows = [], field) =>
  rows.reduce((sum, row) => sum + Number(row?.[field] || 0), 0);

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const formatProcessQty = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return numeric.toFixed(12).replace(/\.?0+$/, "");
};

const buildSnapshotSummary = (snapshotRows = []) => {
  const normalizedRows = Array.isArray(snapshotRows) ? snapshotRows : [];
  const openQtyTotal = sumNumericField(normalizedRows, "openQty");
  const openRows = normalizedRows.filter((row) => Number(row?.openQty || 0) > 0);
  const lastUpdateMs = normalizedRows
    .map((row) => normalizeDateMs(row.updatedAt || row.lastExitAt || row.lastEntryAt || row.createdAt))
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || null;

  return {
    rows: normalizedRows,
    openQtyTotal,
    hasOpenQty: openQtyTotal > 0,
    openRows,
    lastUpdateMs,
  };
};

const mapAsyncInBatches = async (items = [], mapper, batchSize = 10) => {
  const rows = Array.isArray(items) ? items : [];
  const normalizedBatchSize = Math.max(Number(batchSize || 10), 1);
  const results = [];

  for (let start = 0; start < rows.length; start += normalizedBatchSize) {
    const chunk = rows.slice(start, start + normalizedBatchSize);
    const chunkResults = await Promise.all(chunk.map(mapper));
    results.push(...chunkResults);
  }

  return results;
};

const ORDER_PROCESS_SKIPPED_TARGET_RESULT_CODES = new Set([
  "GRID_ACTIVE_IGNORED",
  "RUNTIME_NOT_READY",
  "SIGNAL_TYPE_MISMATCH",
]);

const parseOrderProcessPayloadJson = (payloadJson) => {
  try {
    return payloadJson ? JSON.parse(payloadJson) : null;
  } catch (error) {
    return null;
  }
};

const buildOrderProcessTargetRows = (targetRowsRaw = []) =>
  decorateWebhookTargetRows(
    decorateWebhookEventRows(targetRowsRaw).map((row) => ({
      ...row,
      status: row.webhookStatus,
      resultCode: row.resultCode,
    }))
  ).map((row, index, arr) => {
    const key = `${row.uid}:${row.strategyCategory}:${row.pid}`;
    let nextCreatedAt = null;
    for (let i = index - 1; i >= 0; i -= 1) {
      const prev = arr[i];
      const prevKey = `${prev.uid}:${prev.strategyCategory}:${prev.pid}`;
      if (prevKey === key) {
        const prevResultCode = String(prev.resultCode || "").trim().toUpperCase();
        if (ORDER_PROCESS_SKIPPED_TARGET_RESULT_CODES.has(prevResultCode)) {
          continue;
        }
        nextCreatedAt = prev.createdAt;
        break;
      }
    }
    return { ...row, nextCreatedAt };
  });

const loadPreviousOrderProcessTargetCreatedAt = async (targetRow = {}) => {
  if (!targetRow?.uid || !targetRow?.pid || !targetRow?.strategyCategory || !targetRow?.id) {
    return null;
  }

  const [rows] = await db.query(
    `SELECT
        t.created_at AS createdAt,
        t.result_code AS resultCode
      FROM webhook_event_target_log t
      WHERE t.uid = ?
        AND t.pid = ?
        AND t.strategy_category = ?
        AND t.id < ?
      ORDER BY t.id DESC
      LIMIT 20`,
    [targetRow.uid, targetRow.pid, targetRow.strategyCategory, targetRow.id]
  );

  const matched = (rows || []).find((row) => {
    const resultCode = String(row.resultCode || "").trim().toUpperCase();
    return !ORDER_PROCESS_SKIPPED_TARGET_RESULT_CODES.has(resultCode);
  });

  return matched?.createdAt || null;
};

const loadOrderProcessTargetRows = async ({
  limit = 80,
  offset = 0,
  uid = 0,
  pid = 0,
  symbol = "",
  strategyCategory = "",
  strategyMode = "",
  keyword = "",
  createdFrom = "",
  createdTo = "",
  targetId = 0,
} = {}) => {
  const where = [`e.hook_category IN ('signal','grid')`];
  const params = [];

  if (targetId) {
    where.push("t.id = ?");
    params.push(targetId);
  }
  if (uid) {
    where.push("t.uid = ?");
    params.push(uid);
  }
  if (pid) {
    where.push("t.pid = ?");
    params.push(pid);
  }
  if (symbol) {
    where.push("t.symbol = ?");
    params.push(String(symbol).trim().toUpperCase());
  }
  if (strategyCategory) {
    where.push("t.strategy_category = ?");
    params.push(String(strategyCategory).trim().toLowerCase());
  }
  if (strategyMode) {
    where.push("LOWER(COALESCE(t.strategy_mode, 'live')) = ?");
    params.push(String(strategyMode).trim().toLowerCase());
  }
  if (keyword) {
    where.push(
      `(LOWER(COALESCE(t.strategy_name,'')) LIKE ? OR LOWER(COALESCE(t.strategy_key,'')) LIKE ? OR LOWER(COALESCE(t.strategy_uuid,'')) LIKE ?)`
    );
    params.push(`%${String(keyword).trim().toLowerCase()}%`, `%${String(keyword).trim().toLowerCase()}%`, `%${String(keyword).trim().toLowerCase()}%`);
  }
  if (createdFrom) {
    where.push("t.created_at >= ?");
    params.push(createdFrom);
  }
  if (createdTo) {
    where.push("t.created_at <= ?");
    params.push(createdTo);
  }

  const queryParams = targetId ? params : params.concat(offset, limit);
  const limitSql = targetId ? "LIMIT 1" : "LIMIT ?, ?";
  const [targetRowsRaw] = await db.query(
    `SELECT
        t.id,
        t.event_id AS eventId,
        t.uid,
        t.pid,
        t.strategy_category AS strategyCategory,
        t.strategy_mode AS strategyMode,
        t.strategy_name AS strategyName,
        t.strategy_key AS strategyKey,
        t.strategy_uuid AS strategyUuid,
        t.symbol,
        t.bunbong,
        t.legacy_status AS legacyStatus,
        t.regime_status AS regimeStatus,
        t.control_state AS controlState,
        t.auto_st AS autoST,
        t.incoming_signal_type AS incomingSignalType,
        t.runtime_signal_type AS runtimeSignalType,
        t.result_code AS resultCode,
        t.payload_json AS payloadJson,
        t.created_at AS createdAt,
        e.route_path AS routePath,
        e.status AS webhookStatus,
        e.result_code AS webhookResultCode,
        e.http_status AS webhookHttpStatus,
        e.note AS webhookNote
      FROM webhook_event_target_log t
      INNER JOIN webhook_event_log e ON e.id = t.event_id
      WHERE ${where.join(" AND ")}
      ORDER BY t.id DESC
      ${limitSql}`,
    queryParams
  );

  return buildOrderProcessTargetRows(targetRowsRaw || []);
};

const buildOrderProcessRow = async (targetRow, options = {}) => {
  const nowMs = options?.nowMs || Date.now();
  const includeDetail = Boolean(options?.includeDetail);
  const hasCurrentItemOverride = Object.prototype.hasOwnProperty.call(options || {}, "currentItem");
  const currentItemOverride = hasCurrentItemOverride ? options.currentItem : undefined;
  const loadFullHistory = Object.prototype.hasOwnProperty.call(options || {}, "loadFullHistory")
    ? Boolean(options.loadFullHistory)
    : includeDetail;
  const createdAtMs = normalizeDateMs(targetRow.createdAt) || nowMs;
  const fallbackNextCreatedAt = targetRow.nextCreatedAt || (await loadPreviousOrderProcessTargetCreatedAt(targetRow));
  const nextCreatedAtMs = normalizeDateMs(fallbackNextCreatedAt);
  const targetMode = String(targetRow.strategyMode || "").trim().toLowerCase();
  const defaultWindowEndMs =
    nextCreatedAtMs && nextCreatedAtMs > createdAtMs
      ? nextCreatedAtMs - 1
      : createdAtMs + 30 * 60 * 1000;
  const extendedWindowEndMs =
    nextCreatedAtMs && nextCreatedAtMs > createdAtMs ? nextCreatedAtMs - 1 : nowMs;

  const fromTime = dayjs(createdAtMs - 5 * 1000).format("YYYY-MM-DD HH:mm:ss");
  const toTime = dayjs(defaultWindowEndMs).format("YYYY-MM-DD HH:mm:ss");
  const parsedPayloadJson = parseOrderProcessPayloadJson(targetRow.payloadJson);
  const isWithinExtendedLifecycleWindow = (value) => {
    const valueMs = normalizeDateMs(value);
    return Boolean(valueMs && valueMs >= createdAtMs && valueMs <= extendedWindowEndMs);
  };
  const loadCurrentLifecycleWindow = async () => {
    const [currentLedgerRowsResult, currentReservationRowsResult, currentSnapshotRowsResult, currentMsgRowsResult] =
      await Promise.all([
        db.query(
          `SELECT
              id,
              eventType,
              positionSide,
              sourceClientOrderId,
              sourceOrderId,
              fillQty,
              fillPrice,
              fee,
              realizedPnl,
              openQtyAfter,
              avgEntryPriceAfter,
              tradeTime,
              note,
              createdAt
            FROM live_pid_position_ledger
            WHERE uid = ? AND pid = ? AND strategyCategory = ?
            ORDER BY id ASC`,
          [targetRow.uid, targetRow.pid, targetRow.strategyCategory]
        ),
        db.query(
          `SELECT
              id,
              positionSide,
              clientOrderId,
              sourceOrderId,
              actualOrderId,
              reservationKind,
              reservedQty,
              filledQty,
              status,
              note,
              createdAt,
              updatedAt
            FROM live_pid_exit_reservation
            WHERE uid = ? AND pid = ? AND strategyCategory = ?
            ORDER BY id ASC`,
          [targetRow.uid, targetRow.pid, targetRow.strategyCategory]
        ),
        db.query(
          `SELECT
              id,
              symbol,
              positionSide,
              status,
              openQty,
              openCost,
              avgEntryPrice,
              cycleRealizedPnl,
              cycleFees,
              entryFillCount,
              exitFillCount,
              openedAt,
              lastEntryAt,
              lastExitAt,
              createdAt,
              updatedAt
            FROM live_pid_position_snapshot
            WHERE uid = ? AND pid = ? AND strategyCategory = ?
            ORDER BY updatedAt DESC`,
          [targetRow.uid, targetRow.pid, targetRow.strategyCategory]
        ),
        db.query(
          `SELECT
              id,
              fun,
              code,
              msg,
              created_at AS createdAt
            FROM msg_list
            WHERE uid = ? AND pid = ? AND created_at >= ?
            ORDER BY id ASC`,
          [targetRow.uid, targetRow.pid, dayjs(createdAtMs).format("YYYY-MM-DD HH:mm:ss")]
        ),
      ]);

    return {
      ledgerRows: (currentLedgerRowsResult[0] || []).filter((row) =>
        isWithinExtendedLifecycleWindow(row.tradeTime || row.createdAt)
      ),
      reservationRows: (currentReservationRowsResult[0] || []).filter((row) =>
        isWithinExtendedLifecycleWindow(row.updatedAt || row.createdAt)
      ),
      snapshotRows: (currentSnapshotRowsResult[0] || []).filter((row) =>
        isWithinExtendedLifecycleWindow(
          row.lastExitAt || row.lastEntryAt || row.updatedAt || row.createdAt
        )
      ),
      msgRows: (currentMsgRowsResult[0] || []).filter((row) => isWithinExtendedLifecycleWindow(row.createdAt)),
    };
  };

  const [binanceRowsResult, ledgerRowsResult, reservationRowsResult, snapshotRowsResult, allLedgerRowsResult, msgRowsResult, currentItem] = await Promise.all([
    db.query(
      `SELECT
          id,
          strategy_category AS strategyCategory,
          event_type AS eventType,
          event_code AS eventCode,
          severity,
          order_status AS orderStatus,
          algo_status AS algoStatus,
          execution_type AS executionType,
          created_at AS createdAt,
          note
        FROM binance_runtime_event_log
        WHERE uid = ? AND pid = ? AND strategy_category = ? AND created_at BETWEEN ? AND ?
        ORDER BY id ASC`,
      [targetRow.uid, targetRow.pid, targetRow.strategyCategory, fromTime, toTime]
    ),
    db.query(
      `SELECT
          id,
          eventType,
          positionSide,
          sourceClientOrderId,
          sourceOrderId,
          fillQty,
          fillPrice,
          fee,
          realizedPnl,
          openQtyAfter,
          avgEntryPriceAfter,
          tradeTime,
          note,
          createdAt
        FROM live_pid_position_ledger
        WHERE uid = ? AND pid = ? AND strategyCategory = ? AND createdAt BETWEEN ? AND ?
        ORDER BY id ASC`,
      [targetRow.uid, targetRow.pid, targetRow.strategyCategory, fromTime, toTime]
    ),
    db.query(
      `SELECT
          id,
          positionSide,
          clientOrderId,
          sourceOrderId,
          actualOrderId,
          reservationKind,
          reservedQty,
          filledQty,
          status,
          note,
          createdAt,
          updatedAt
        FROM live_pid_exit_reservation
        WHERE uid = ? AND pid = ? AND strategyCategory = ?
          AND createdAt <= ?
          AND updatedAt >= ?
        ORDER BY id ASC`,
      [targetRow.uid, targetRow.pid, targetRow.strategyCategory, toTime, fromTime]
    ),
    db.query(
      `SELECT
          id,
          symbol,
          positionSide,
          status,
          openQty,
          openCost,
          avgEntryPrice,
          cycleRealizedPnl,
          cycleFees,
          entryFillCount,
          exitFillCount,
          openedAt,
          lastEntryAt,
          lastExitAt,
          createdAt,
          updatedAt
        FROM live_pid_position_snapshot
        WHERE uid = ? AND pid = ? AND strategyCategory = ?
          AND createdAt <= ?
          AND updatedAt <= ?
        ORDER BY updatedAt DESC`,
      [targetRow.uid, targetRow.pid, targetRow.strategyCategory, toTime, toTime]
    ),
    loadFullHistory
      ? db.query(
          `SELECT
              id,
              eventType,
              positionSide,
              fillQty,
              fillPrice,
              realizedPnl,
              openQtyAfter,
              avgEntryPriceAfter,
              tradeTime,
              note,
              createdAt
            FROM live_pid_position_ledger
            WHERE uid = ? AND pid = ? AND strategyCategory = ?
            ORDER BY id ASC`,
          [targetRow.uid, targetRow.pid, targetRow.strategyCategory]
        )
      : Promise.resolve([[]]),
    db.query(
      `SELECT
          id,
          fun,
          code,
          msg,
          created_at AS createdAt
        FROM msg_list
        WHERE uid = ? AND pid = ? AND created_at BETWEEN ? AND ?
        ORDER BY id ASC`,
      [targetRow.uid, targetRow.pid, fromTime, toTime]
    ),
    hasCurrentItemOverride
      ? Promise.resolve(currentItemOverride)
      : loadDecoratedProcessItemByPid({
          uid: targetRow.uid,
          pid: targetRow.pid,
          strategyCategory: targetRow.strategyCategory,
          mode: targetMode,
        }),
  ]);

  const binanceRows = decorateBinanceRuntimeEventRows(binanceRowsResult[0] || []);
  const ledgerRows = ledgerRowsResult[0] || [];
  const reservationRows = reservationRowsResult[0] || [];
  const snapshotRows = snapshotRowsResult[0] || [];
  const allLedgerRows = allLedgerRowsResult[0] || [];
  const msgRows = msgRowsResult[0] || [];
  const webhookRow = decorateWebhookEventRow({
    status: targetRow.webhookStatus,
    resultCode: targetRow.webhookResultCode,
    httpStatus: targetRow.webhookHttpStatus,
  });
  const stages = buildOrderProcessStages({
    targetRow,
    webhookRow,
    binanceRows,
    ledgerRows,
    reservationRows,
    snapshotRows,
    msgRows,
    nowMs,
  });

  let normalizedStages = stages;
  let currentLifecycleWindow = null;
  if (stages.processStatus === "ACTIVE" && !stages.abnormal) {
    currentLifecycleWindow = await loadCurrentLifecycleWindow();
    const currentLedgerRows = currentLifecycleWindow.ledgerRows;
    const currentReservationRows = currentLifecycleWindow.reservationRows;
    const currentSnapshotRows = currentLifecycleWindow.snapshotRows;
    const currentSnapshotSummary = buildSnapshotSummary(currentSnapshotRows);
    const currentActiveReservations = currentReservationRows.filter((row) =>
      ["ACTIVE", "PARTIAL"].includes(String(row.status || "").trim().toUpperCase())
    );
    const currentExitLedgerRows = currentLedgerRows.filter((row) =>
      isPidExitLedgerEvent(row.eventType)
    );

    if (
      !currentSnapshotSummary.hasOpenQty &&
      currentActiveReservations.length === 0 &&
      currentExitLedgerRows.length > 0
    ) {
      const latestExitLedger = currentExitLedgerRows[currentExitLedgerRows.length - 1] || null;
      const normalizedExitPendingStage = buildProcessStage("NORMAL", "청산 주문 체결 완료");
      const normalizedExitStage = buildProcessStage(
        "NORMAL",
        latestExitLedger
          ? PID_EXIT_LEDGER_EVENT_LABELS[String(latestExitLedger.eventType || "").trim().toUpperCase()] ||
              "청산 완료"
          : "청산 완료"
      );
      normalizedStages = {
        ...stages,
        stageList: [
          { key: "webhook", ...stages.webhookStage, label: "웹훅 수신" },
          { key: "waiting", ...stages.waitingStage, label: "대기" },
          { key: "entry", ...stages.entryStage, label: "진입" },
          { key: "exitPending", ...normalizedExitPendingStage, label: "청산대기" },
          { key: "exit", ...normalizedExitStage, label: "청산" },
        ],
        exitPendingStage: normalizedExitPendingStage,
        exitStage: normalizedExitStage,
        processStatus: "NORMAL",
        processStatusLabel: ORDER_PROCESS_STATUS_LABELS.NORMAL,
        abnormal: false,
        problemStage: null,
        problemDetail: null,
        currentStepLabel: "정상 종료",
        completed: true,
        completionLabel: "완료",
      };
    }
  }

  if (!currentLifecycleWindow && normalizedStages.abnormal) {
    currentLifecycleWindow = await loadCurrentLifecycleWindow();
  }

  const waitingResultCode = String(targetRow.resultCode || "").trim().toUpperCase();
  const suppressLifecycleAttribution =
    waitingResultCode === "RUNTIME_NOT_READY" ||
    waitingResultCode === "SIGNAL_TYPE_MISMATCH" ||
    waitingResultCode === "GRID_ACTIVE_IGNORED";
  const projectionToTime = suppressLifecycleAttribution
    ? dayjs(createdAtMs).format("YYYY-MM-DD HH:mm:ss")
    : toTime;
  const projectionBinanceRows = suppressLifecycleAttribution ? [] : binanceRows;
  const projectionLedgerRows = suppressLifecycleAttribution ? [] : ledgerRows;
  const projectionReservationRows = suppressLifecycleAttribution ? [] : reservationRows;
  const projectionSnapshotRows = suppressLifecycleAttribution ? [] : snapshotRows;
  const projectionMsgRows = suppressLifecycleAttribution ? [] : msgRows;

  const viewProjection = orderProcessView.buildOrderProcessView({
    strategyCategory: targetRow.strategyCategory,
    createdAt: targetRow.createdAt,
    completed: normalizedStages.completed,
    isAbnormal: normalizedStages.abnormal,
    problemStage: normalizedStages.problemStage,
    problemDetail: normalizedStages.problemDetail,
    webhookStage: normalizedStages.webhookStage,
    waitingStage: normalizedStages.waitingStage,
    entryStage: normalizedStages.entryStage,
    exitPendingStage: normalizedStages.exitPendingStage,
    exitStage: normalizedStages.exitStage,
    binanceRows: projectionBinanceRows,
    ledgerRows: projectionLedgerRows,
    reservationRows: projectionReservationRows,
    snapshotRows: projectionSnapshotRows,
  });
  const detailProjection =
    String(targetRow.strategyCategory || "").trim().toLowerCase() === "grid"
      ? {
          gridMeta: orderProcessDetail.buildGridOrderProcessDetail({
            currentItem,
            targetRow,
            payloadJson: parsedPayloadJson,
            cycleLedgerRows: projectionLedgerRows,
            allLedgerRows,
            snapshotRows: projectionSnapshotRows,
            reservationRows: projectionReservationRows,
          }),
        }
      : {
          algorithmMeta: orderProcessDetail.buildAlgorithmOrderProcessDetail({
            currentItem,
            targetRow,
            cycleLedgerRows: projectionLedgerRows,
            allLedgerRows,
            snapshotRows: projectionSnapshotRows,
            reservationRows: projectionReservationRows,
              }),
            };
  const entryRows = (binanceRows || []).filter((row) =>
    String(row.eventCode || "").trim().toUpperCase().includes("ENTRY")
  );
  const exitPendingRows = (binanceRows || []).filter((row) => {
    const eventCode = String(row.eventCode || "").trim().toUpperCase();
    return (
      eventCode.includes("STOP_LOSS") ||
      eventCode.includes("TAKE_PROFIT") ||
      eventCode.includes("SPLIT_TAKE_PROFIT") ||
      eventCode.includes("MARKET_EXIT") ||
      eventCode.includes("MANUAL_CLOSE")
    );
  });
  const issueMeta = buildOrderProcessIssueMeta({
    targetRow,
    webhookRow,
    waitingResultCode: String(targetRow.resultCode || "").trim().toUpperCase(),
    msgRows,
    entryRows,
    exitPendingRows,
    currentLedgerRows: currentLifecycleWindow?.ledgerRows || [],
    currentReservationRows: currentLifecycleWindow?.reservationRows || [],
    currentSnapshotRows: currentLifecycleWindow?.snapshotRows || [],
    stages: normalizedStages,
  });

  const currentSnapshotRows = currentLifecycleWindow?.snapshotRows || [];
  const currentReservationRows = currentLifecycleWindow?.reservationRows || [];
  const activeProtectionRows = currentReservationRows.filter((row) =>
    ["ACTIVE", "PARTIAL"].includes(String(row.status || "").trim().toUpperCase())
  );
  const currentPositionQty = currentSnapshotRows.reduce((sum, row) => sum + Number(row.openQty || 0), 0);
  const activeProtectionCount = activeProtectionRows.length;
  const expectedProtectionCount = currentPositionQty > 0 ? 2 : 0;
  const protectionStatus =
    currentPositionQty > 0
      ? activeProtectionCount > 0
        ? "PROTECTED"
        : "MISSING"
      : activeProtectionCount > 0
        ? "ORPHAN"
        : "NONE";
  const currentRisk = protectionStatus === "MISSING" || protectionStatus === "ORPHAN";
  const lifecycleStatus = suppressLifecycleAttribution
    ? "EXPECTED"
    : currentRisk
      ? "CURRENT_RISK"
      : currentPositionQty > 0
        ? "OPEN_PROTECTED"
        : normalizedStages.abnormal
          ? "RESOLVED"
          : "CLOSED";
  const severity = currentRisk ? "CRITICAL" : normalizedStages.abnormal ? "INFO" : "INFO";
  const latestOrderEvent = [...projectionBinanceRows]
    .sort((a, b) => new Date(b.eventTime || b.createdAt || 0).getTime() - new Date(a.eventTime || a.createdAt || 0).getTime())[0] || {};
  const realizedPnl = projectionLedgerRows.reduce((sum, row) => sum + Number(row.realizedPnl || 0), 0);

  const baseRow = {
    id: targetRow.id,
    eventId: targetRow.eventId,
    uid: targetRow.uid,
    pid: targetRow.pid,
    category: targetRow.strategyCategory,
    strategyCategory: targetRow.strategyCategory,
    strategyCategoryLabel:
      WEBHOOK_CATEGORY_LABELS[String(targetRow.strategyCategory || "").trim().toLowerCase()] || null,
    categoryLabel:
      WEBHOOK_CATEGORY_LABELS[String(targetRow.strategyCategory || "").trim().toLowerCase()] || null,
    strategyMode: targetRow.strategyMode,
    strategyName: targetRow.strategyName,
    strategyKey: targetRow.strategyKey,
    strategyUuid: targetRow.strategyUuid,
    symbol: targetRow.symbol,
    bunbong: targetRow.bunbong,
    signalType: targetRow.incomingSignalType || targetRow.runtimeSignalType || null,
    createdAt: targetRow.createdAt,
    routePath: targetRow.routePath,
    webhookResultCode: targetRow.webhookResultCode,
    processStatus: normalizedStages.processStatus,
    normalityLabel: normalizedStages.processStatusLabel,
    isAbnormal: normalizedStages.abnormal,
    currentRisk,
    lifecycleStatus,
    lifecycleResult: lifecycleStatus,
    severity,
    expectedOrAbnormal: currentRisk ? "ABNORMAL" : suppressLifecycleAttribution ? "EXPECTED" : "REVIEW",
    isExpectedIgnore: suppressLifecycleAttribution,
    completed: normalizedStages.completed,
    completionLabel: normalizedStages.completionLabel,
    currentStepLabel: normalizedStages.currentStepLabel,
    problemStage: normalizedStages.problemStage,
    problemDetail: normalizedStages.problemDetail,
    latestRuntimeIssue: normalizedStages.latestRuntimeIssue || null,
    webhookStage: normalizedStages.webhookStage,
    waitingStage: normalizedStages.waitingStage,
    entryStage: normalizedStages.entryStage,
    exitPendingStage: normalizedStages.exitPendingStage,
    exitStage: normalizedStages.exitStage,
    openQtyTotal: projectionSnapshotRows.reduce((sum, row) => sum + Number(row.openQty || 0), 0),
    currentPositionQty,
    localOpenQty: currentPositionQty,
    protectionStatus,
    activeProtectionCount,
    expectedProtectionCount,
    lastOrderStatus: latestOrderEvent.status || latestOrderEvent.orderStatus || latestOrderEvent.eventCode || null,
    lastOrderIntent: latestOrderEvent.intent || latestOrderEvent.orderIntent || latestOrderEvent.eventCode || null,
    lastOrderId: latestOrderEvent.orderId || latestOrderEvent.sourceOrderId || null,
    lastClientOrderId: latestOrderEvent.clientOrderId || latestOrderEvent.sourceClientOrderId || null,
    executedQty: latestOrderEvent.executedQty || null,
    remainingQty:
      latestOrderEvent.remainingQty !== undefined
        ? latestOrderEvent.remainingQty
        : latestOrderEvent.origQty !== undefined && latestOrderEvent.executedQty !== undefined
          ? Math.max(Number(latestOrderEvent.origQty || 0) - Number(latestOrderEvent.executedQty || 0), 0)
          : null,
    realizedPnl,
    issueReason: currentRisk ? protectionStatus : issueMeta.issueLabel || normalizedStages.problemDetail || null,
    nextAction: currentRisk ? "현재 포지션/보호주문 정합성 확인" : normalizedStages.abnormal ? "해결된 이력으로 보관" : "없음",
    eventTime: latestOrderEvent.eventTime || latestOrderEvent.createdAt || targetRow.createdAt,
    exitReservationCount: projectionReservationRows.length,
    ledgerFillCount: projectionLedgerRows.length,
    runtimeMessageCount: projectionMsgRows.length,
    ...viewProjection,
    ...detailProjection,
    ...issueMeta,
    summaryText:
      currentRisk
        ? `비정상 / ${issueMeta.issueLabel || normalizedStages.problemDetail || "원인 미상"}`
        : normalizedStages.abnormal
          ? `해결됨 / ${issueMeta.issueLabel || normalizedStages.problemDetail || "이력"}`
        : suppressLifecycleAttribution && normalizedStages.currentStepLabel
          ? `정상 / ${normalizedStages.currentStepLabel}`
          : viewProjection.summaryText,
  };

  if (
    normalizedStages.abnormal &&
    projectionBinanceRows.length === 0 &&
    projectionLedgerRows.length === 0 &&
    projectionReservationRows.length === 0
  ) {
    baseRow.completedAt = targetRow.createdAt || null;
    baseRow.abnormalAt = targetRow.createdAt || null;
  }

  if (!includeDetail) {
    return baseRow;
  }

  return {
    ...baseRow,
    detail: {
      window: {
        fromTime,
        toTime: projectionToTime,
      },
      webhook: {
        eventId: targetRow.eventId,
        routePath: targetRow.routePath || null,
        status: targetRow.webhookStatus || null,
        resultCode: targetRow.webhookResultCode || null,
        httpStatus: targetRow.webhookHttpStatus || null,
        note: targetRow.webhookNote || null,
        occurredAt: targetRow.createdAt,
      },
      issue: issueMeta,
      counts: {
        binanceEvents: projectionBinanceRows.length,
        cycleLedgerEvents: projectionLedgerRows.length,
        allLedgerEvents: allLedgerRows.length,
        reservations: projectionReservationRows.length,
        snapshots: projectionSnapshotRows.length,
        runtimeMessages: projectionMsgRows.length,
      },
      currentItem,
      binanceEvents: projectionBinanceRows,
      cycleLedgerEvents: projectionLedgerRows,
      allLedgerEvents: allLedgerRows,
      reservations: projectionReservationRows,
      snapshots: projectionSnapshotRows,
      runtimeMessages: (projectionMsgRows || []).map((row) => ({
        ...row,
        funLabel: normalizeProcessMsgFun(row.fun),
        codeLabel: normalizeProcessMsgCode(row.code),
        summary: normalizeProcessMsgText(row.msg),
      })),
    },
  };
};

const normalizeTrackRecordMode = (value) =>
  String(value || "live").trim().toLowerCase() === "test" ? "test" : "live";

const normalizeTrackRecordStatusFilter = (value) => {
  const normalized = String(value || "completed").trim().toLowerCase();
  if (normalized === "active" || normalized === "inprogress") {
    return "active";
  }
  if (normalized === "review" || normalized === "needsreview") {
    return "review";
  }
  if (normalized === "all") {
    return "all";
  }
  return "completed";
};

const buildTrackRecordDateRange = ({ sDate = "", eDate = "" } = {}) => ({
  createdFrom: sDate ? `${String(sDate).trim()} 00:00:00` : "",
  createdTo: eDate ? `${String(eDate).trim()} 23:59:59` : "",
});

const matchesTrackRecordCompletion = (processRow, statusFilter) => {
  const needsReview = Boolean(processRow?.isAbnormal && !processRow?.isExpectedIgnore);
  if (statusFilter === "all") {
    return true;
  }
  if (statusFilter === "review") {
    return needsReview;
  }

  if (statusFilter === "active") {
    return !processRow?.completed && !needsReview;
  }

  return Boolean(processRow?.completed) && !needsReview;
};

const getTrackRecordCycleRealizedPnl = (processRow = {}) => {
  if (String(processRow.strategyCategory || "").trim().toLowerCase() === "grid") {
    return toNumber(processRow?.gridMeta?.currentRegimeRealizedPnl, 0);
  }

  return toNumber(processRow?.algorithmMeta?.realizedPnl, 0);
};

const getTrackRecordDirectionLabel = (processRow = {}) => {
  if (String(processRow.strategyCategory || "").trim().toLowerCase() === "grid") {
    return "GRID";
  }

  const normalized = String(
    processRow?.signalType || processRow?.algorithmMeta?.direction || ""
  )
    .trim()
    .toUpperCase();

  if (normalized === "BUY") {
    return "매수";
  }
  if (normalized === "SELL") {
    return "매도";
  }

  return "-";
};

const buildTrackRecordListItem = (processRow = {}) => {
  const isGrid = String(processRow.strategyCategory || "").trim().toLowerCase() === "grid";
  const cycleRealizedPnl = getTrackRecordCycleRealizedPnl(processRow);
  const meta = isGrid ? processRow.gridMeta || {} : processRow.algorithmMeta || {};
  const seriesId = toNumber(processRow.eventId, 0) > 0 ? Number(processRow.eventId) : null;
  const statusLabel = meta.statusLabel || meta.overallStatusLabel || processRow.currentStepLabel || "-";
  const statusSubLabel =
    isGrid && (meta.buyStatusLabel || meta.sellStatusLabel)
      ? `매수 ${meta.buyStatusLabel || "Ready"} / 매도 ${meta.sellStatusLabel || "Ready"}`
      : null;

  return {
    id: processRow.id,
    eventId: processRow.eventId,
    seriesId,
    seriesLabel: seriesId ? `SERIES ${seriesId}` : "-",
    pid: processRow.pid,
    strategyCategory: processRow.strategyCategory,
    strategyCategoryLabel: processRow.strategyCategoryLabel,
    processKind: processRow.processKind,
    processKindLabel: processRow.processKindLabel,
    strategyName: processRow.strategyName || meta.strategyName || "-",
    symbol: processRow.symbol || meta.symbol || "-",
    bunbong: processRow.bunbong || "-",
    signalType: processRow.signalType || meta.direction || null,
    directionLabel: getTrackRecordDirectionLabel(processRow),
    completed: Boolean(processRow.completed),
    needsReview: Boolean(processRow.isAbnormal && !processRow.isExpectedIgnore),
    overallResultLabel: processRow.overallResultLabel || (processRow.completed ? "완료" : "진행중"),
    summaryStatusLabel:
      processRow.summaryStatusLabel ||
      (processRow.isAbnormal && !processRow.isExpectedIgnore ? "확인 필요" : processRow.completed ? "성과 기록" : "진행중"),
    summaryText: processRow.summaryText || "-",
    statusLabel,
    statusSubLabel,
    overallStatusLabel: meta.overallStatusLabel || null,
    buyStatusLabel: meta.buyStatusLabel || null,
    sellStatusLabel: meta.sellStatusLabel || null,
    tradeAmount: toNumber(meta.tradeAmount, 0),
    entryAvgPrice: toNumber(meta.entryPrice || meta.avgEntryPrice, 0) || null,
    exitAvgPrice: toNumber(meta.exitPrice || meta.avgExitPrice, 0) || null,
    realizedPnl: cycleRealizedPnl,
    returnPct: toNumber(meta.tradeAmount, 0) > 0 ? (cycleRealizedPnl / toNumber(meta.tradeAmount, 0)) * 100 : null,
    result:
      !processRow.completed
        ? "OPEN"
        : processRow.isAbnormal && !processRow.isExpectedIgnore
          ? "REVIEW"
          : cycleRealizedPnl > 0
            ? "WIN"
            : cycleRealizedPnl < 0
              ? "LOSS"
              : "BREAKEVEN",
    source: "live-ledger",
    issueCategoryLabel: processRow.issueCategoryLabel || null,
    issueSourceLabel: processRow.issueSourceLabel || null,
    issueLabel: processRow.issueLabel || null,
    webhookOccurredAt: processRow.webhookOccurredAt || processRow.createdAt || null,
    completedAt: processRow.completedAt || null,
    abnormalAt: processRow.abnormalAt || null,
    currentStepLabel: processRow.currentStepLabel || null,
  };
};

const buildTrackRecordSummary = (processRows = []) => {
  const performanceRows = (processRows || []).filter(
    (row) => row?.completed && !(row?.isAbnormal && !row?.isExpectedIgnore)
  );
  const totalRealizedPnl = performanceRows.reduce(
    (sum, row) => sum + getTrackRecordCycleRealizedPnl(row),
    0
  );
  const winCount = performanceRows.filter(
    (row) => getTrackRecordCycleRealizedPnl(row) > 0
  ).length;
  const loseCount = performanceRows.filter(
    (row) => getTrackRecordCycleRealizedPnl(row) < 0
  ).length;
  const completedCount = performanceRows.length;
  const winningValues = performanceRows
    .map((row) => getTrackRecordCycleRealizedPnl(row))
    .filter((value) => value > 0);
  const losingValues = performanceRows
    .map((row) => getTrackRecordCycleRealizedPnl(row))
    .filter((value) => value < 0);

  return {
    totalRealizedPnl,
    completedCount,
    activeCount: (processRows || []).filter(
      (row) => !row?.completed && !(row?.isAbnormal && !row?.isExpectedIgnore)
    ).length,
    reviewCount: (processRows || []).filter((row) => row?.isAbnormal && !row?.isExpectedIgnore).length,
    abnormalCount: (processRows || []).filter((row) => row?.isAbnormal && !row?.isExpectedIgnore).length,
    winCount,
    loseCount,
    winRate: completedCount > 0 ? (winCount / completedCount) * 100 : 0,
    averageWin:
      winningValues.length > 0
        ? winningValues.reduce((sum, value) => sum + value, 0) / winningValues.length
        : null,
    averageLoss:
      losingValues.length > 0
        ? losingValues.reduce((sum, value) => sum + value, 0) / losingValues.length
        : null,
  };
};

const loadUserTrackRecordRows = async ({
  userId,
  mode = "live",
  status = "completed",
  sDate = "",
  eDate = "",
  limit = 300,
} = {}) => {
  const normalizedMode = normalizeTrackRecordMode(mode);
  const normalizedStatus = normalizeTrackRecordStatusFilter(status);
  const { createdFrom, createdTo } = buildTrackRecordDateRange({ sDate, eDate });
  const targetRows = await loadOrderProcessTargetRows({
    uid: userId,
    strategyMode: normalizedMode,
    createdFrom,
    createdTo,
    limit: Math.min(Math.max(Number(limit || 300), 1), 500),
  });
  const nowMs = Date.now();
  const currentItemMap = await loadDecoratedProcessItemsByTargets(targetRows);
  const processRows = await mapAsyncInBatches(
    targetRows,
    (targetRow) =>
      buildOrderProcessRow(targetRow, {
        nowMs,
        includeDetail: false,
        loadFullHistory: false,
        currentItem:
          currentItemMap.get(
            buildProcessItemCacheKey({
              uid: targetRow.uid,
              pid: targetRow.pid,
              strategyCategory: targetRow.strategyCategory,
              mode: normalizedMode,
            })
          ) || null,
      }),
    10
  );

  return {
    allRows: processRows,
    rows: processRows.filter((row) => matchesTrackRecordCompletion(row, normalizedStatus)),
    summary: buildTrackRecordSummary(processRows),
  };
};

const buildTrackRecordDetailItem = (processRow = {}) => ({
  ...buildTrackRecordListItem(processRow),
  processStatus: processRow.processStatus,
  normalityLabel: processRow.normalityLabel,
  detail: processRow.detail || null,
  algorithmProcess: processRow.algorithmProcess || null,
  gridProcess: processRow.gridProcess || null,
  algorithmMeta: processRow.algorithmMeta || null,
  gridMeta: processRow.gridMeta || null,
  issueDetail: processRow.issueDetail || null,
  issueCode: processRow.issueCode || null,
  issueSource: processRow.issueSource || null,
  issueSourceLabel: processRow.issueSourceLabel || null,
  issueCategory: processRow.issueCategory || null,
  issueCategoryLabel: processRow.issueCategoryLabel || null,
});

const buildOrderProcessStages = ({
  targetRow,
  webhookRow,
  binanceRows,
  ledgerRows,
  reservationRows,
  snapshotRows,
  msgRows,
  nowMs,
}) => {
  const resolveFirstAbnormalStageName = ({
    webhookStage,
    waitingStage,
    entryStage,
    exitPendingStage,
    exitStage,
  }) => {
    if (isAbnormalProcessStage(webhookStage)) {
      return "웹훅 수신";
    }
    if (isAbnormalProcessStage(waitingStage)) {
      return "대기";
    }
    if (isAbnormalProcessStage(entryStage)) {
      return "진입";
    }
    if (isAbnormalProcessStage(exitPendingStage)) {
      return "청산대기";
    }
    if (isAbnormalProcessStage(exitStage)) {
      return "청산";
    }
    return null;
  };

  const category = String(targetRow.strategyCategory || "").trim().toLowerCase();
  const createdAtMs = normalizeDateMs(targetRow.createdAt) || nowMs;
  const ageMs = Math.max(0, nowMs - createdAtMs);
  const snapshotSummary = buildSnapshotSummary(snapshotRows);
  const entryMsgIssue = resolveOrderProcessEntryMsgIssue({
    category,
    msgRows,
  });
  const exitMsgIssue = resolveOrderProcessExitMsgIssue({
    category,
    msgRows,
  });
  const latestRuntimeIssue = exitMsgIssue
    ? {
        stage: category === "grid" ? "Gridding" : "청산대기",
        detail: exitMsgIssue,
      }
    : entryMsgIssue
      ? {
          stage: "진입",
          detail: entryMsgIssue,
        }
      : null;

  const webhookResultCode = String(webhookRow?.resultCode || "").trim().toUpperCase();
  const webhookStatus = String(webhookRow?.status || "").trim().toUpperCase();
  const waitingResultCode = String(targetRow.resultCode || "").trim().toUpperCase();
  const entryRows = binanceRows.filter((row) => String(row.eventCode || "").trim().toUpperCase().includes("ENTRY"));
  const exitPendingRows = binanceRows.filter((row) => {
    const eventCode = String(row.eventCode || "").trim().toUpperCase();
    return (
      eventCode.includes("STOP_LOSS") ||
      eventCode.includes("TAKE_PROFIT") ||
      eventCode.includes("SPLIT_TAKE_PROFIT") ||
      eventCode.includes("MARKET_EXIT") ||
      eventCode.includes("MANUAL_CLOSE")
    );
  });
  const entryLedgerRows = (ledgerRows || []).filter((row) => isPidEntryLedgerEvent(row.eventType));
  const exitLedgerRows = (ledgerRows || []).filter((row) => isPidExitLedgerEvent(row.eventType));
  const activeReservations = (reservationRows || []).filter((row) =>
    ["ACTIVE", "PARTIAL"].includes(String(row.status || "").trim().toUpperCase())
  );
  const canceledReservations = (reservationRows || []).filter((row) =>
    ["CANCELED", "EXPIRED"].includes(String(row.status || "").trim().toUpperCase())
  );
  const filledReservations = (reservationRows || []).filter((row) =>
    String(row.status || "").trim().toUpperCase() === "FILLED"
  );
  const totalEntryQty = sumNumericField(entryLedgerRows, "fillQty");
  const totalExitQty = sumNumericField(exitLedgerRows, "fillQty");
  const latestEntryLedger = entryLedgerRows[entryLedgerRows.length - 1] || null;
  const latestExitLedger = exitLedgerRows[exitLedgerRows.length - 1] || null;
  const hasEntryLifecycleEvidence =
    entryLedgerRows.length > 0 ||
    snapshotSummary.hasOpenQty ||
    activeReservations.length > 0 ||
    exitLedgerRows.length > 0 ||
    filledReservations.length > 0;
  const hasExitLifecycleEvidence =
    activeReservations.length > 0 ||
    exitLedgerRows.length > 0 ||
    filledReservations.length > 0 ||
    canceledReservations.length > 0;

  let webhookStage = buildProcessStage("NORMAL", "webhook 수신");
  if (
    webhookRow?.httpStatus >= 400 ||
    ["INVALID_PAYLOAD", "KILL_SWITCH_BLOCKED", "NO_MATCHING_STRATEGY", "RUNTIME_ERROR"].includes(
      webhookResultCode
    ) ||
    !["RECEIVED", "PROCESSED", "IGNORED", "DUPLICATE"].includes(webhookStatus)
  ) {
    webhookStage = buildProcessStage(
      "ABNORMAL",
      webhookRow?.resultLabel || webhookRow?.resultCode || "webhook 처리 실패"
    );
  }

  let waitingStage = buildProcessStage("NA");
  if (category === "signal") {
    if (waitingResultCode === "ENTERED_PENDING") {
      waitingStage = buildProcessStage("NORMAL", "웹훅 처리 완료");
    } else if (!waitingResultCode && hasEntryLifecycleEvidence) {
      waitingStage = buildProcessStage("NORMAL", "웹훅 처리 완료");
    } else if (waitingResultCode === "RUNTIME_NOT_READY") {
      waitingStage = buildProcessStage(
        "NORMAL",
        "현재 PID가 이미 진행 중이라 이번 웹훅은 처리 없이 종료됨"
      );
    } else if (waitingResultCode === "SIGNAL_TYPE_MISMATCH") {
      waitingStage = buildProcessStage(
        "NORMAL",
        "이 PID 방향과 맞지 않아 이번 웹훅은 처리 없이 종료됨"
      );
    } else if (waitingResultCode === "LOCK_SKIPPED") {
      waitingStage = buildProcessStage("ABNORMAL", "동시 처리 잠금으로 진입이 스킵됨");
    } else if (waitingResultCode === "ENTRY_REJECTED") {
      waitingStage = buildProcessStage("ABNORMAL", "대기 단계에서 진입이 거절됨");
    } else if (waitingResultCode === "POSITION_TRACKING_ERROR") {
      waitingStage = buildProcessStage("ABNORMAL", "PID 포지션 추적 기록에 실패함");
    } else if (waitingResultCode && !hasEntryLifecycleEvidence) {
      waitingStage = buildProcessStage(
        "ABNORMAL",
        WEBHOOK_TARGET_RESULT_LABELS[waitingResultCode] || waitingResultCode
      );
    } else if (hasEntryLifecycleEvidence) {
      waitingStage = buildProcessStage("NORMAL", "웹훅 처리 완료");
    }
  } else {
    if (waitingResultCode === "GRID_ARMED") {
      waitingStage = buildProcessStage("NORMAL", "그리드 레짐 활성화");
    } else if (!waitingResultCode && hasEntryLifecycleEvidence) {
      waitingStage = buildProcessStage("NORMAL", "그리드 레짐 활성화");
    } else if (waitingResultCode === "GRID_ACTIVE_IGNORED") {
      waitingStage = buildProcessStage(
        "NORMAL",
        "기존 활성 레짐을 유지하고 이번 웹훅은 처리 없이 종료됨"
      );
    } else if (waitingResultCode === "GRID_SIGNAL_MISMATCH") {
      waitingStage = buildProcessStage("ABNORMAL", "그리드 신호명 불일치");
    } else if (waitingResultCode === "POSITION_TRACKING_ERROR") {
      waitingStage = buildProcessStage("ABNORMAL", "PID 포지션 추적 기록에 실패함");
    } else if (waitingResultCode && !hasEntryLifecycleEvidence) {
      waitingStage = buildProcessStage(
        "ABNORMAL",
        WEBHOOK_TARGET_RESULT_LABELS[waitingResultCode] || waitingResultCode
      );
    } else if (hasEntryLifecycleEvidence) {
      waitingStage = buildProcessStage("NORMAL", "그리드 레짐 활성화");
    }
  }

  let entryStage = buildProcessStage("NA");
  const abnormalEntryEvent =
    firstMatchingEvent(entryRows, (code) => code.includes("REJECT")) ||
    firstMatchingEvent(entryRows, (code) => code.includes("EXPIRED")) ||
    firstMatchingEvent(entryRows, (code) => code.includes("CANCELED"));
  const partialEntryEvent = firstMatchingEvent(entryRows, (code) => code.includes("PARTIALLY_FILLED"));
  const filledEntryEvent = firstMatchingEvent(entryRows, (code) => code.includes("FILLED"));
  const newEntryEvent = firstMatchingEvent(entryRows, (code) => code.includes("NEW"));

  if (latestEntryLedger || (hasEntryLifecycleEvidence && !abnormalEntryEvent)) {
    const entryQtyLabel = totalEntryQty > 0 || snapshotSummary.openQtyTotal > 0
      ? ` qty ${formatProcessQty(totalEntryQty || snapshotSummary.openQtyTotal)}`
      : "";
    entryStage = buildProcessStage("NORMAL", `진입 체결${entryQtyLabel}`);
  } else if (abnormalEntryEvent) {
    entryStage = buildProcessStage(
      "ABNORMAL",
      decorateBinanceRuntimeEventRow(abnormalEntryEvent).eventCodeLabel || abnormalEntryEvent.eventCode
    );
  } else if (partialEntryEvent) {
    entryStage = buildProcessStage(
      "ACTIVE",
      decorateBinanceRuntimeEventRow(partialEntryEvent).eventCodeLabel || "진입 주문 부분 체결"
    );
  } else if (newEntryEvent) {
    entryStage = buildProcessStage("ACTIVE", "진입 주문 접수");
  } else if (entryMsgIssue) {
    entryStage = buildProcessStage("ABNORMAL", entryMsgIssue);
  } else if (isAbnormalProcessStage(waitingStage)) {
    entryStage = buildProcessStage("NA");
  } else if (ageMs > 60 * 1000) {
    entryStage = buildProcessStage("ABNORMAL", "진입 주문 로그가 확인되지 않음");
  } else {
    entryStage = buildProcessStage("ACTIVE", "진입 처리 대기");
  }

  const isSkippedWaitingFlow =
    waitingResultCode === "RUNTIME_NOT_READY" ||
    waitingResultCode === "SIGNAL_TYPE_MISMATCH" ||
    waitingResultCode === "GRID_ACTIVE_IGNORED";

  const shouldStopAfterWaiting =
    ((isAbnormalProcessStage(waitingStage) &&
      !filledEntryEvent &&
      !newEntryEvent) ||
      isSkippedWaitingFlow);

  if (shouldStopAfterWaiting) {
    const stageList = [
      { key: "webhook", ...webhookStage, label: "웹훅 수신" },
      { key: "waiting", ...waitingStage, label: "대기" },
      { key: "entry", ...buildProcessStage("NA"), label: "진입" },
      { key: "exitPending", ...buildProcessStage("NA"), label: "청산대기" },
      { key: "exit", ...buildProcessStage("NA"), label: "청산" },
    ];
    const firstAbnormalStage = stageList.find((item) => item.state === "ABNORMAL") || null;
    const firstAbnormalStageName = resolveFirstAbnormalStageName({
      webhookStage,
      waitingStage,
      entryStage: buildProcessStage("NA"),
      exitPendingStage: buildProcessStage("NA"),
      exitStage: buildProcessStage("NA"),
    });

    return {
      stageList,
      webhookStage,
      waitingStage,
      entryStage: buildProcessStage("NA"),
      exitPendingStage: buildProcessStage("NA"),
      exitStage: buildProcessStage("NA"),
      processStatus: isSkippedWaitingFlow ? "NORMAL" : "ABNORMAL",
      processStatusLabel: isSkippedWaitingFlow
        ? ORDER_PROCESS_STATUS_LABELS.NORMAL
        : ORDER_PROCESS_STATUS_LABELS.ABNORMAL,
      abnormal: isSkippedWaitingFlow ? false : true,
      problemStage: isSkippedWaitingFlow ? null : firstAbnormalStageName || "대기",
      problemDetail: isSkippedWaitingFlow ? null : firstAbnormalStage?.detail || waitingStage.detail,
      latestRuntimeIssue,
      currentStepLabel: isSkippedWaitingFlow
        ? waitingStage.detail || "정상"
        : `${firstAbnormalStageName || "대기"} 비정상 종료`,
      completed: true,
      completionLabel: "완료",
    };
  }

  let exitPendingStage = buildProcessStage("NA");
  const triggerRejectEvent = firstMatchingEvent(exitPendingRows, (code) => code.includes("TRIGGER_REJECT"));
  const hasSameSideExitCompletion = (positionSide) => {
    const normalizedSide = String(positionSide || "").trim().toUpperCase();
    const matchedExitEvent = exitPendingRows.some((row) => {
      const rowCode = String(row.eventCode || "").trim().toUpperCase();
      const rowSide = getEventPositionSide(row);
      if (normalizedSide && rowSide && rowSide !== normalizedSide) {
        return false;
      }
      return rowCode.includes("FILLED") || rowCode.includes("FINISHED");
    });
    if (matchedExitEvent) {
      return true;
    }
    return exitLedgerRows.some((row) => {
      const rowSide = String(row.positionSide || "").trim().toUpperCase();
      if (normalizedSide && rowSide && rowSide !== normalizedSide) {
        return false;
      }
      return true;
    });
  };
  const isExpectedExitCleanupCancel = (row) => {
    const eventCode = String(row.eventCode || "").trim().toUpperCase();
    if (!eventCode.includes("CANCELED")) {
      return false;
    }
    if (
      !eventCode.includes("STOP_LOSS") &&
      !eventCode.includes("TAKE_PROFIT") &&
      !eventCode.includes("SPLIT_TAKE_PROFIT")
    ) {
      return false;
    }
    const rowSide = getEventPositionSide(row);
    const replacementRegistered = exitPendingRows.some((candidate) => {
      const candidateCode = String(candidate.eventCode || "").trim().toUpperCase();
      if (!candidateCode.includes("NEW")) {
        return false;
      }
      const candidateSide = getEventPositionSide(candidate);
      if (rowSide && candidateSide && rowSide !== candidateSide) {
        return false;
      }
      if (eventCode.includes("STOP_LOSS")) {
        return candidateCode.includes("STOP_LOSS");
      }
      if (eventCode.includes("SPLIT_TAKE_PROFIT")) {
        return candidateCode.includes("SPLIT_TAKE_PROFIT");
      }
      if (eventCode.includes("TAKE_PROFIT")) {
        return candidateCode.includes("TAKE_PROFIT");
      }
      return false;
    });
    if (replacementRegistered) {
      return true;
    }
    return hasSameSideExitCompletion(getEventPositionSide(row));
  };
  const abnormalExitPendingEvent =
    triggerRejectEvent ||
    firstMatchingEvent(exitPendingRows, (code) => code.includes("EXPIRED")) ||
    exitPendingRows.find((row) => {
      const eventCode = String(row.eventCode || "").trim().toUpperCase();
      return eventCode.includes("CANCELED") && !isExpectedExitCleanupCancel(row);
    }) ||
    null;
  const partialExitPendingEvent = firstMatchingEvent(exitPendingRows, (code) => code.includes("PARTIAL"));
  const readyExitPendingEvent =
    firstMatchingEvent(exitPendingRows, (code) => code.includes("STOP_LOSS_NEW")) ||
    firstMatchingEvent(exitPendingRows, (code) => code.includes("TAKE_PROFIT_NEW")) ||
    firstMatchingEvent(exitPendingRows, (code) => code.includes("SPLIT_TAKE_PROFIT_NEW")) ||
    firstMatchingEvent(exitPendingRows, (code) => code.includes("MARKET_EXIT_NEW")) ||
    firstMatchingEvent(exitPendingRows, (code) => code.includes("MANUAL_CLOSE_NEW"));

  if (abnormalExitPendingEvent && snapshotSummary.hasOpenQty) {
    exitPendingStage = buildProcessStage(
      "ABNORMAL",
      decorateBinanceRuntimeEventRow(abnormalExitPendingEvent).eventCodeLabel ||
        abnormalExitPendingEvent.eventCode
    );
  } else if (exitMsgIssue && (snapshotSummary.hasOpenQty || hasExitLifecycleEvidence)) {
    exitPendingStage = buildProcessStage("ABNORMAL", exitMsgIssue);
  } else if (activeReservations.length > 0) {
    exitPendingStage = buildProcessStage(
      "NORMAL",
      `청산 주문 ${activeReservations.length}건 대기`
    );
  } else if (partialExitPendingEvent) {
    exitPendingStage = buildProcessStage(
      "ACTIVE",
      decorateBinanceRuntimeEventRow(partialExitPendingEvent).eventCodeLabel || "청산 주문 부분 체결"
    );
  } else if (readyExitPendingEvent) {
    exitPendingStage = buildProcessStage(
      "NORMAL",
      decorateBinanceRuntimeEventRow(readyExitPendingEvent).eventCodeLabel || "청산 대기 주문 등록"
    );
  } else if (snapshotSummary.hasOpenQty && canceledReservations.length > 0) {
    exitPendingStage = buildProcessStage(
      "ABNORMAL",
      `청산 주문 취소/만료 ${canceledReservations.length}건`
    );
  } else if ((filledReservations.length > 0 || latestExitLedger) && !snapshotSummary.hasOpenQty) {
    exitPendingStage = buildProcessStage("NORMAL", "청산 주문 체결 완료");
  } else if (exitLedgerRows.length > 0) {
    exitPendingStage = buildProcessStage("NORMAL", "청산 단계 진입");
  } else if (snapshotSummary.hasOpenQty) {
    exitPendingStage =
      ageMs > 90 * 1000
        ? buildProcessStage("ABNORMAL", exitMsgIssue || "PID 기준 청산 주문이 확인되지 않음")
        : buildProcessStage("ACTIVE", "청산 대기 설정 중");
  } else if (isNormalProcessStage(entryStage) || isActiveProcessStage(entryStage)) {
    exitPendingStage = buildProcessStage("ACTIVE", "청산 대기 설정 중");
  }

  let exitStage = buildProcessStage("NA");
  const filledExitEvent = firstMatchingEvent(exitPendingRows, (code) => code.includes("FILLED")) || null;
  if ((filledExitEvent || latestExitLedger || filledReservations.length > 0) && !snapshotSummary.hasOpenQty) {
    exitStage = buildProcessStage(
      "NORMAL",
      latestExitLedger
        ? PID_EXIT_LEDGER_EVENT_LABELS[String(latestExitLedger.eventType || "").trim().toUpperCase()] ||
            "청산 완료"
        : "청산 완료"
    );
  } else if (isAbnormalProcessStage(exitPendingStage)) {
    exitStage = buildProcessStage("ABNORMAL", exitPendingStage.detail);
  } else if (snapshotSummary.hasOpenQty) {
    exitStage = buildProcessStage("ACTIVE", `보유 수량 ${formatProcessQty(snapshotSummary.openQtyTotal)}`);
  } else if (isNormalProcessStage(exitPendingStage) || isActiveProcessStage(exitPendingStage) || hasExitLifecycleEvidence) {
    exitStage = buildProcessStage("ACTIVE", "청산 대기/진행 중");
  }

  const stageList = [
    { key: "webhook", ...webhookStage, label: "웹훅 수신" },
    { key: "waiting", ...waitingStage, label: "대기" },
    { key: "entry", ...entryStage, label: "진입" },
    { key: "exitPending", ...exitPendingStage, label: "청산대기" },
    { key: "exit", ...exitStage, label: "청산" },
  ];
  const firstAbnormalStage = stageList.find((item) => item.state === "ABNORMAL") || null;
  const firstAbnormalStageName = resolveFirstAbnormalStageName({
    webhookStage,
    waitingStage,
    entryStage,
    exitPendingStage,
    exitStage,
  });
  const processStatus = firstAbnormalStage
    ? "ABNORMAL"
    : isNormalProcessStage(exitStage)
      ? "NORMAL"
      : "ACTIVE";

  return {
    stageList,
    webhookStage,
    waitingStage,
    entryStage,
    exitPendingStage,
    exitStage,
    processStatus,
    processStatusLabel: ORDER_PROCESS_STATUS_LABELS[processStatus] || processStatus,
    abnormal: Boolean(firstAbnormalStage),
    problemStage: firstAbnormalStageName || null,
    problemDetail: firstAbnormalStage?.detail || null,
    latestRuntimeIssue,
    currentStepLabel: firstAbnormalStage
      ? `${firstAbnormalStageName || "대기"} 비정상 종료`
      : buildProcessStateLabel({
          entryStage,
          exitPendingStage,
          exitStage,
          abnormal: false,
        }),
    completed: processStatus !== "ACTIVE",
    completionLabel: processStatus === "ACTIVE" ? "진행중" : "완료",
  };
};

const attachStrategyMetaToBinanceEventRows = async (rows = []) => {
  if (!Array.isArray(rows) || !rows.length) {
    return [];
  }

  const signalRows = rows.filter((row) => String(row.strategyCategory || "").trim().toLowerCase() === "signal");
  const gridRows = rows.filter((row) => String(row.strategyCategory || "").trim().toLowerCase() === "grid");

  const signalUids = Array.from(new Set(signalRows.map((row) => Number(row.uid || 0)).filter(Boolean)));
  const signalPids = Array.from(new Set(signalRows.map((row) => Number(row.pid || 0)).filter(Boolean)));
  const gridUids = Array.from(new Set(gridRows.map((row) => Number(row.uid || 0)).filter(Boolean)));
  const gridPids = Array.from(new Set(gridRows.map((row) => Number(row.pid || 0)).filter(Boolean)));

  const strategyMap = new Map();

  const mergeStrategyRows = (items = [], category, preferredMode) => {
    items.forEach((item) => {
      const key = `${item.uid}:${category}:${item.pid}`;
      const current = strategyMap.get(key);
      if (!current || current.strategyModeGuess !== "live") {
        strategyMap.set(key, {
          strategyName: item.strategyName || `#${item.pid}`,
          strategyModeGuess: preferredMode,
        });
      }
    });
  };

  if (signalUids.length && signalPids.length) {
    const uidPlaceholders = signalUids.map(() => "?").join(",");
    const pidPlaceholders = signalPids.map(() => "?").join(",");
    const [liveSignalRows] = await db.query(
      `SELECT uid, id AS pid, a_name AS strategyName
       FROM live_play_list
       WHERE uid IN (${uidPlaceholders}) AND id IN (${pidPlaceholders})`,
      [...signalUids, ...signalPids]
    );
    const [testSignalRows] = await db.query(
      `SELECT uid, id AS pid, a_name AS strategyName
       FROM test_play_list
       WHERE uid IN (${uidPlaceholders}) AND id IN (${pidPlaceholders})`,
      [...signalUids, ...signalPids]
    );
    mergeStrategyRows(liveSignalRows, "signal", "live");
    mergeStrategyRows(testSignalRows, "signal", "test");
  }

  if (gridUids.length && gridPids.length) {
    const uidPlaceholders = gridUids.map(() => "?").join(",");
    const pidPlaceholders = gridPids.map(() => "?").join(",");
    const [liveGridRows] = await db.query(
      `SELECT uid, id AS pid, a_name AS strategyName
       FROM live_grid_strategy_list
       WHERE uid IN (${uidPlaceholders}) AND id IN (${pidPlaceholders})`,
      [...gridUids, ...gridPids]
    );
    const [testGridRows] = await db.query(
      `SELECT uid, id AS pid, a_name AS strategyName
       FROM test_grid_strategy_list
       WHERE uid IN (${uidPlaceholders}) AND id IN (${pidPlaceholders})`,
      [...gridUids, ...gridPids]
    );
    mergeStrategyRows(liveGridRows, "grid", "live");
    mergeStrategyRows(testGridRows, "grid", "test");
  }

  return rows.map((row) => {
    const key = `${row.uid}:${String(row.strategyCategory || "").trim().toLowerCase()}:${row.pid}`;
    const meta = strategyMap.get(key);
    return {
      ...row,
      strategyName: meta?.strategyName || null,
      strategyModeGuess: meta?.strategyModeGuess || null,
    };
  });
};

const handlePlayAutoRoute = async (req, res, prefix) => {
  const userId = req.decoded.userId;
  notifyUserUpdated(req, userId);

  const item = await loadOwnedPlayItem(`SP_${prefix}_PLAY_DETAIL_ITEM`, req.body.id, userId);

  if (item === null) {
    return sendRouteError(res, 404, "전략을 찾을 수 없습니다.");
  }

  if (item === false) {
    return sendRouteError(res, 403, "본인 전략만 변경할 수 있습니다.");
  }

  if (!seon.marketST) {
    return sendRouteError(
      res,
      500,
      "06:00~07:00에는 트레이딩을 시작하거나 변경할 수 없습니다."
    );
  }

  const forceOffContext = await loadSignalForceOffContext(prefix, item.uid, item.id);
  const canonicalSignalItem = canonicalRuntimeState.decorateSignalItemSync(item, {
    snapshots: forceOffContext.snapshots,
    reservations: forceOffContext.reservations,
  });
  const runtimeStatus = canonicalSignalItem.runtimeState;
  const closeRequirement = signalForceOffControl.detectSignalForceOffCloseRequirement({
    item,
    runtimeStatus,
    snapshots: forceOffContext.snapshots,
    reservations: forceOffContext.reservations,
  });
  const shouldScheduleForceOffClose = signalForceOffControl.shouldScheduleSignalForceOffClose({
    runtimeStatus,
    closeRequired: closeRequirement.closeRequired,
  });
  const protectionPlan = signalForceOffControl.evaluateSignalForceOffProtectionAction({
    closeRequired: closeRequirement.closeRequired,
    closeAttempted: false,
  });
  const previousEnabled = canonicalSignalItem.enabled ? "Y" : "N";
  const allST = resolveRequestedEnabled(req.body);
  const nextEnabled = allST === "Y";
  const nextControlFields = buildLegacyControlFields(allST);
  const currentLegacySt = previousEnabled === "Y" ? "START" : "STOP";
  const nextLegacySt = nextControlFields.st;
  const controlAudit = {
    actorUserId: userId,
    targetUserId: item.uid,
    requestIp: getRequestIp(req),
    actionCode: nextEnabled ? "USER_ON" : "USER_OFF",
    previousEnabled,
    nextEnabled: allST,
    note: nextEnabled
      ? "algorithm-on"
      : `algorithm-off runtime:${runtimeStatus} close:${closeRequirement.reason}`,
    metadata: {
      runtimeStatus,
      legacyStatus: item.status || null,
      closeRequired: closeRequirement.closeRequired,
      closeRequiredReason: closeRequirement.reason,
      closeRequiredOpenQty: closeRequirement.openQty,
      closeRequiredPositionSide: closeRequirement.positionSide,
      activeReservationCount: closeRequirement.activeReservationCount,
      protectionAction: protectionPlan.action,
      controlIntent: nextEnabled ? "USER_ON" : "USER_OFF",
    },
  };

  if (!nextEnabled) {
    logSignalForceOffTrace("OFF_REQUEST_RECEIVED", {
      pid: item.id,
      uid: item.uid,
      symbol: item.symbol,
      runtimeStatus,
      legacyStatus: item.status,
      ...closeRequirement,
    });

    if (shouldScheduleForceOffClose) {
      logSignalForceOffTrace("OFF_CLOSE_REQUIRED_DETECTED", {
        pid: item.id,
        uid: item.uid,
        symbol: item.symbol,
        runtimeStatus,
        legacyStatus: item.status,
        ...closeRequirement,
      });
      logSignalForceOffTrace("OFF_PROTECTION_CANCEL_DEFERRED", {
        pid: item.id,
        uid: item.uid,
        symbol: item.symbol,
        runtimeStatus,
        legacyStatus: item.status,
        ...closeRequirement,
      });
      seon.setPendingPlayCloseReason(prefix === "LIVE" ? "Y" : "N", item.id, "manual-off");
      await strategyControlState.applyPlayControlState({
        mode: prefix,
        pid: item.id,
        enabled: allST,
        status: "EXACT",
        resetRuntime: false,
        audit: controlAudit,
      });
      await addPlayEventLog(
        prefix,
        item.uid,
        item.id,
        item.r_tid,
        "운용OFF_시장가청산대기_U",
        currentLegacySt,
        nextLegacySt,
        item.status,
        "EXACT",
        item.r_signalType,
        item.r_signalPrice || null,
        null
      );
    } else if (runtimeStatus === "EXACT_WAIT") {
      await strategyControlState.applyPlayControlState({
        mode: prefix,
        pid: item.id,
        enabled: allST,
        status: "READY",
        resetRuntime: true,
        audit: controlAudit,
      });
      await addPlayEventLog(
        prefix,
        item.uid,
        item.id,
        item.r_tid,
        "운용OFF_진입대기취소_U",
        currentLegacySt,
        nextLegacySt,
        item.status,
        "READY",
        item.r_signalType,
        item.r_signalPrice || null,
        null
      );
    } else {
      await strategyControlState.applyPlayControlState({
        mode: prefix,
        pid: item.id,
        enabled: allST,
        status: "READY",
        resetRuntime: true,
        audit: controlAudit,
      });
      await addPlayEventLog(
        prefix,
        item.uid,
        item.id,
        null,
        "운용OFF_대기복귀_U",
        currentLegacySt,
        nextLegacySt,
        item.status,
        "READY",
        null,
        null,
        null
      );
    }
  } else {
    await strategyControlState.applyPlayControlState({
      mode: prefix,
      pid: item.id,
      enabled: allST,
      status: "READY",
      resetRuntime: false,
      audit: controlAudit,
    });
    await addPlayEventLog(
      prefix,
      item.uid,
      item.id,
      null,
      "운용ON_대기시작_U",
      currentLegacySt,
      nextLegacySt,
      item.status,
      "READY",
      null,
      null,
      null
    );
  }
  return res.send({ allST, enabled: allST });
};

const ensureOwnedPlayItem = async (res, detailProcedure, id, userId) => {
  const item = await loadOwnedPlayItem(detailProcedure, id, userId);

  if (item === null) {
    sendRouteError(res, 404, "전략을 찾을 수 없습니다.");
    return null;
  }

  if (item === false) {
    sendRouteError(res, 403, "본인 전략만 조회하거나 변경할 수 있습니다.");
    return null;
  }

  return item;
};

const ensureOwnedPlayItems = async (res, detailProcedure, itemList, userId) => {
  for (let i = 0; i < itemList.length; i++) {
    const currentId =
      itemList[i] && typeof itemList[i] === "object" ? itemList[i].id : itemList[i];
    const ownedItem = await ensureOwnedPlayItem(
      res,
      detailProcedure,
      currentId,
      userId
    );

    if (!ownedItem) {
      return false;
    }
  }

  return true;
};

const normalizeCurrentTradeFlowPayload = (body = {}) => {
  const SIGNAL_TYPE_MAP = {
    BUY: "BUY",
    LONG: "BUY",
    GOLD: "BUY",
    SELL: "SELL",
    SHORT: "SELL",
    DEAD: "SELL",
  };
  const SIGNAL_FLOW_DEFAULTS = {
    scalping: { second2: 10, second3: 6, second4: 6 },
    trend: { second2: 2, second3: null, second4: null },
    greenlight: { second2: -2, second3: 2, second4: null },
    "atf+vixfix": { second2: null, second3: null, second4: null },
  };

  body.alarmSignalST = isEmpty3(body.alarmSignalST) || "Y";
  body.alarmResultST = isEmpty3(body.alarmResultST) || "Y";
  body.orderSize = Number(body.orderSize || 1);
  body.repeatConfig = isEmpty3(body.repeatConfig) || "N";
  body.AI_ST = "neutral";
  body.marginType = "cross";

  const normalizedSignalType =
    SIGNAL_TYPE_MAP[String(body.signalType || "").trim().toUpperCase()] || "BUY";
  body.signalType = normalizedSignalType;

  const normalizedType = String(body.type || "").trim().toLowerCase();
  const defaults = SIGNAL_FLOW_DEFAULTS[normalizedType] || SIGNAL_FLOW_DEFAULTS.scalping;
  body.second2 = body.second2 == null || body.second2 === "" ? defaults.second2 : body.second2;
  body.second3 = body.second3 == null || body.second3 === "" ? defaults.second3 : body.second3;
  body.second4 = body.second4 == null || body.second4 === "" ? defaults.second4 : body.second4;

  return body;
};

const toEnabledFlag = (value) => {
  if (value === true || value === "true" || value === "Y" || value === 1 || value === "1") {
    return "Y";
  }

  return "N";
};

const normalizePercentField = (value) => {
  const rawValue = String(value ?? "").trim();
  const numericValue = Number(rawValue);

  if (!rawValue || !Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return numericValue;
};

const normalizeExitOptionPayload = (body = {}) => {
  const splitTakeProfitOptions = splitTakeProfit.normalizeSplitTakeProfitPayload(body);
  const stopLossReverseEnabled = toEnabledFlag(body.stopLossReverseEnabled);
  const stopLossTimeEnabled = toEnabledFlag(body.stopLossTimeEnabled);
  const rawTimeValue = Number(body.stopLossTimeValue);
  const stopLossTimeValue =
    stopLossTimeEnabled === "Y" && Number.isFinite(rawTimeValue) && rawTimeValue > 0
      ? Math.trunc(rawTimeValue)
      : 0;

  body.profit =
    splitTakeProfitOptions.enabled && splitTakeProfitOptions.stages[0]
      ? splitTakeProfitOptions.stages[0].tpPercent
      : normalizePercentField(body.profit);
  body.stopLoss = normalizePercentField(body.stopLoss);
  body.profitTradeType = "per";
  body.profitFixValue = null;
  body.profitAbsValue = null;
  body.lossTradeType = "per";
  body.lossFixValue = null;
  body.lossAbsValue = null;

  body.stopLossReverseEnabled = stopLossReverseEnabled;
  body.stopLossTimeEnabled = stopLossTimeEnabled;
  body.stopLossTimeValue = stopLossTimeValue;

  return {
    stopLossReverseEnabled,
    stopLossTimeEnabled,
    stopLossTimeValue,
    splitTakeProfitOptions,
  };
};

const createStochUuid = async () => {
  let stochId = null;

  do {
    const uuid = seon.randomString(15);
    const uuidCK = await dbcon.DBOneCall(`CALL SP_API_STOCH_ID_GET(?)`, [uuid]);
    if (!uuidCK) {
      stochId = uuid;
    }
  } while (!stochId);

  return stochId;
};

const resolveMarketStochId = async (
  symbol,
  type,
  bunbong,
  second2,
  second3,
  second4
) => {
  const stochList = await dbcon.DBOneCall(`CALL SP_API_STOCH_GET(?,?,?,?,?,?)`, [
    symbol,
    type,
    bunbong,
    second2,
    second3,
    second4,
  ]);

  if (stochList) {
    return stochList.uuid;
  }

  const stochId = await createStochUuid();

  await dbcon.DBCall(`CALL SP_API_STOCH_ADD(?,?,?,?,?,?)`, [
    symbol,
    stochId,
    bunbong,
    second2,
    second3,
    second4,
  ]);
  return stochId;
};

const sendSaveFailure = (res, message) =>
  res.status(500).json({
    status: 500,
    message,
  });

const firstProcedureRow = (value) => {
  if (Array.isArray(value)) {
    return value[0] || null;
  }

  return value || null;
};

const savePlayExitOptions = async (prefix, playId, body) => {
  if (!playId) {
    return false;
  }

  const options = normalizeExitOptionPayload(body);
  const result = await dbcon.DBCall(`CALL SP_${prefix}_PLAY_EXIT_OPTION_EDIT(?,?,?,?)`, [
    playId,
    options.stopLossReverseEnabled,
    options.stopLossTimeEnabled,
    options.stopLossTimeValue,
  ]);

  if (result === false) {
    return false;
  }

  const tableName = prefix === "LIVE" ? "live_play_list" : "test_play_list";
  const splitOptions = options.splitTakeProfitOptions || splitTakeProfit.normalizeSplitTakeProfitPayload(body);
  const splitConfigResult = await dbcon.DBCall(
    `UPDATE ${tableName}
        SET splitTakeProfitEnabled = ?,
            splitTakeProfitCount = ?,
            splitTakeProfitGap = ?,
            splitTakeProfitConfigJson = ?
      WHERE id = ?`,
    [
      splitOptions.enabled ? "Y" : "N",
      splitOptions.splitTakeProfitCount || 0,
      Number(splitOptions.gapPercent || splitTakeProfit.DEFAULT_SPLIT_TAKE_PROFIT_GAP),
      splitOptions.configJson,
      playId,
    ]
  );

  return splitConfigResult !== false;
};

const SIGNAL_TABLE_MAP = {
  LIVE: "live_play_list",
  TEST: "test_play_list",
};

const getSignalTableName = (prefix) => SIGNAL_TABLE_MAP[prefix];

const loadOwnedSignalItem = async (prefix, id, userId) =>
  loadOwnedPlayItem(`SP_${prefix}_PLAY_DETAIL_ITEM`, id, userId);

const canDeleteSignalItem = (item) => {
  if (!item) {
    return false;
  }

  return (
    runtimeState.getRuntimeState(item) === "READY" &&
    !(Number(item.r_qty || 0) > 0)
  );
};

const GRID_TABLE_MAP = {
  LIVE: "live_grid_strategy_list",
  TEST: "test_grid_strategy_list",
};

const normalizeGridPayload = (body = {}) => ({
  a_name: isEmpty3(body.a_name).trim(),
  strategySignal: isEmpty3(body.strategySignal).trim() || null,
  symbol: gridRuntime.normalizeGridSymbol(body.symbol),
  bunbong: gridRuntime.normalizeGridBunbong(body.bunbong),
  marginType: "cross",
  margin: Number(body.margin || 0),
  leverage: Math.trunc(Number(body.leverage || 0)),
  profit: Number(body.profit || 0),
  tradeValue: Number(body.tradeValue || 0),
});

const getGridTableName = (prefix) => GRID_TABLE_MAP[prefix];

const firstRow = (rows) => (Array.isArray(rows) ? rows[0] || null : rows || null);

const normalizeStrategyMode = (value) =>
  String(value || "LIVE")
    .trim()
    .toUpperCase() === "TEST"
    ? "TEST"
    : "LIVE";

const loadCurrentSignalItemByPid = async ({ uid, pid, mode }) => {
  const tableName = getSignalTableName(normalizeStrategyMode(mode));
  const [rows] = await db.query(`SELECT * FROM ${tableName} WHERE id = ? AND uid = ? LIMIT 1`, [
    pid,
    uid,
  ]);
  return firstRow(rows);
};

const loadCurrentGridItemByPid = async ({ uid, pid, mode }) => {
  const tableName = getGridTableName(normalizeStrategyMode(mode));
  const [rows] = await db.query(`SELECT * FROM ${tableName} WHERE id = ? AND uid = ? LIMIT 1`, [
    pid,
    uid,
  ]);
  return firstRow(rows);
};

const loadDecoratedProcessItemByPid = async ({ uid, pid, strategyCategory, mode }) => {
  if (!uid || !pid) {
    return null;
  }

  const normalizedCategory = String(strategyCategory || "").trim().toLowerCase();
  if (normalizedCategory === "grid") {
    const row = await loadCurrentGridItemByPid({ uid, pid, mode });
    return row ? canonicalRuntimeState.decorateGridItem(row, { uid }) : null;
  }

  const row = await loadCurrentSignalItemByPid({ uid, pid, mode });
  return row ? canonicalRuntimeState.decorateSignalItem(row, { uid }) : null;
};

const buildProcessItemCacheKey = ({
  uid = 0,
  pid = 0,
  strategyCategory = "",
  mode = "live",
} = {}) =>
  [
    Number(uid || 0),
    Number(pid || 0),
    String(strategyCategory || "").trim().toLowerCase(),
    String(mode || "live").trim().toLowerCase(),
  ].join(":");

const loadCurrentProcessItemsByPids = async ({
  uid,
  pids = [],
  strategyCategory,
  mode,
} = {}) => {
  const normalizedUid = Number(uid || 0);
  const normalizedPids = [...new Set((pids || []).map((pid) => Number(pid || 0)).filter((pid) => pid > 0))];
  if (!(normalizedUid > 0) || normalizedPids.length === 0) {
    return [];
  }

  const normalizedMode = normalizeStrategyMode(mode);
  const normalizedCategory = String(strategyCategory || "").trim().toLowerCase();
  const tableName =
    normalizedCategory === "grid"
      ? getGridTableName(normalizedMode)
      : getSignalTableName(normalizedMode);
  const placeholders = normalizedPids.map(() => "?").join(", ");
  const [rows] = await db.query(
    `SELECT * FROM ${tableName} WHERE uid = ? AND id IN (${placeholders})`,
    [normalizedUid, ...normalizedPids]
  );

  return rows || [];
};

const decorateCurrentProcessItems = async ({
  uid,
  items = [],
  strategyCategory,
} = {}) => {
  const normalizedCategory = String(strategyCategory || "").trim().toLowerCase();
  if (normalizedCategory === "grid") {
    return canonicalRuntimeState.decorateGridCollection(items, { uid });
  }
  return canonicalRuntimeState.decorateSignalCollection(items, { uid });
};

const loadDecoratedProcessItemsByTargets = async (targetRows = []) => {
  const rows = Array.isArray(targetRows) ? targetRows : [];
  const groups = new Map();

  rows.forEach((targetRow) => {
    const uid = Number(targetRow?.uid || 0);
    const pid = Number(targetRow?.pid || 0);
    const strategyCategory = String(targetRow?.strategyCategory || "").trim().toLowerCase();
    const mode = String(targetRow?.strategyMode || "live").trim().toLowerCase();
    if (!(uid > 0) || !(pid > 0) || !strategyCategory) {
      return;
    }
    const groupKey = `${uid}:${strategyCategory}:${mode}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        uid,
        strategyCategory,
        mode,
        pids: new Set(),
      });
    }
    groups.get(groupKey).pids.add(pid);
  });

  const decoratedMap = new Map();
  const groupEntries = [...groups.values()];
  for (const group of groupEntries) {
    const rawItems = await loadCurrentProcessItemsByPids({
      uid: group.uid,
      pids: [...group.pids],
      strategyCategory: group.strategyCategory,
      mode: group.mode,
    });
    const decoratedItems = await decorateCurrentProcessItems({
      uid: group.uid,
      items: rawItems,
      strategyCategory: group.strategyCategory,
    });
    (decoratedItems || []).forEach((item) => {
      const key = buildProcessItemCacheKey({
        uid: group.uid,
        pid: item?.id,
        strategyCategory: group.strategyCategory,
        mode: group.mode,
      });
      decoratedMap.set(key, item);
    });
  }

  return decoratedMap;
};

const loadOwnedGridItem = async (prefix, id, userId) => {
  const tableName = getGridTableName(prefix);
  const [rows] = await db.query(`SELECT * FROM ${tableName} WHERE id = ? LIMIT 1`, [id]);
  const item = firstRow(rows);

  if (!item) {
    return null;
  }

  if (String(item.uid) !== String(userId)) {
    return false;
  }

  return item;
};

const canDeleteGridItem = (item) => {
  if (!item) {
    return false;
  }

  const noOpenQty =
    !(Number(item.longQty || 0) > 0) &&
    !(Number(item.shortQty || 0) > 0);
  const noPendingOrders =
    !item.longEntryOrderId &&
    !item.shortEntryOrderId &&
    !item.longExitOrderId &&
    !item.shortExitOrderId &&
    !item.longStopOrderId &&
    !item.shortStopOrderId;
  const runtimeState = canonicalRuntimeState.decorateGridItemSync(item).runtimeState;

  return noOpenQty && noPendingOrders && runtimeState === "READY";
};

const decorateGridCollection = (items) =>
  Array.isArray(items)
    ? items.map((item) => gridRuntime.decorateGridRuntimeFields(item))
    : items;

const handleGridAutoRoute = async (req, res, prefix) => {
  const userId = req.decoded.userId;
  const item = await loadOwnedGridItem(prefix, req.body.id, userId);

  if (item === null) {
    return sendRouteError(res, 404, "그리드 전략을 찾을 수 없습니다.");
  }

  if (item === false) {
    return sendRouteError(res, 403, "본인 전략만 변경할 수 있습니다.");
  }

  const previousEnabled = normalizeEnabledValue(item.enabled);
  const nextEnabled = resolveRequestedEnabled(req.body);
  const isOn = nextEnabled === "Y";

  try {
    await strategyControlState.applyGridControlState({
      mode: prefix,
      pid: req.body.id,
      enabled: nextEnabled,
      regimeEndReason: isOn ? null : "MANUAL_OFF",
      audit: {
        actorUserId: userId,
        targetUserId: item.uid,
        requestIp: getRequestIp(req),
        actionCode: isOn ? "USER_ON" : "USER_OFF",
        previousEnabled,
        nextEnabled,
        note: isOn ? "grid-on" : "grid-off",
        metadata: {
          legacyRegimeStatus: item.regimeStatus || null,
          longLegStatus: item.longLegStatus || null,
          shortLegStatus: item.shortLegStatus || null,
          controlIntent: isOn ? "USER_ON" : "USER_OFF",
        },
      },
    });

    if (!isOn) {
      const refreshedItem = (await loadOwnedGridItem(prefix, req.body.id, userId)) || item;
      await gridEngine.deactivateGridStrategy(prefix, refreshedItem, "MANUAL_OFF");
    }

    return res.send({
      ok: true,
      controlState: isOn ? "ON" : "OFF",
      enabled: nextEnabled,
    });
  } catch (error) {
    return sendRouteError(res, 500, `그리드 전략 상태 변경 중 오류가 발생했습니다: ${error?.message || error}`);
  }
};

/* GET home page. */
router.get("/", async function (req, res, next) {
  res.render("index", { title: "Express" });
});

router.post("/logout", async (req, res) => {
  const userId = req.decoded.userId;

  const n = await redisClient.v4.exists(userId);

  if (n) await redisClient.v4.del(userId);

  return res.status(200).json({
    status: 200,
  });
});

router.get("/myinfo", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_A_PER_MY_GET(?)`, [userId]);

  return res.send(reData);
});

router.get("/member", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_A_MEMBER_GET(?)`, [userId]);

  return res.send(sanitizeMemberForClient(reData));
});

router.post("/member/keys", async (req, res) => {
  const userId = req.decoded.userId;
  const nextAppKey = isEmpty3(req.body.appKey).trim();
  const nextAppSecret = isEmpty3(req.body.appSecret).trim();

  if (!nextAppKey && !nextAppSecret) {
    return sendRouteError(res, 400, "저장할 API Key 또는 Secret Key를 입력해 주세요.");
  }

  const member = await dbcon.DBOneCall(`CALL SP_A_MEMBER_GET(?)`, [userId]);
  if (!member) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }

  const finalAppKey = nextAppKey || member.appKey || null;
  const finalAppSecret = nextAppSecret ? credentialSecrets.protectSecret(nextAppSecret) : member.appSecret || null;

  if (!finalAppKey || !finalAppSecret) {
    return sendRouteError(res, 400, "API Key와 Secret Key를 모두 준비한 뒤 저장해 주세요.");
  }

  await db.query(
    `UPDATE admin_member SET appKey = ?, appSecret = ? WHERE id = ? LIMIT 1`,
    [finalAppKey, finalAppSecret, userId]
  );

  notifyUserUpdated(req, userId);
  await coin.refreshMemberApi(userId, finalAppKey, finalAppSecret);

  return res.send({
    success: true,
    hasAppKey: Boolean(finalAppKey),
    hasAppSecret: Boolean(finalAppSecret),
    message: "API Key와 Secret Key가 저장되었습니다.",
  });
});

router.post("/member/keys/validate", async (req, res) => {
  const userId = req.decoded.userId;
  const inputAppKey = isEmpty3(req.body.appKey).trim();
  const inputAppSecret = isEmpty3(req.body.appSecret).trim();
  const member = await dbcon.DBOneCall(`CALL SP_A_MEMBER_GET(?)`, [userId]);

  if (!member) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }

  const finalAppKey = inputAppKey || member.appKey || null;
  const finalAppSecret = inputAppSecret || member.appSecret || null;
  const result = await coin.validateMemberApiKeys(finalAppKey, finalAppSecret);

  if (!result.ok) {
    return res.status(400).send(result);
  }

  return res.send(result);
});

router.get("/price", async (req, res) => {
  const userId = req.decoded.userId;

  // let reData = await dbcon.DBOneCall(`CALL SP_API_PRICE_GET()`);

  // return res.send({cur_price: seon.lsPrice});

  const defaultSymbols = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT', 'DOGEUSDT', 'PUMPUSDT'];
  const symbols = Array.from(new Set([...(Object.keys(dt.price || {})), ...defaultSymbols]));
  const normalized = {};

  await Promise.all(
    symbols.map(async (symbol) => {
      normalized[symbol] = await coin.ensurePublicMarketPrice(symbol);
    })
  );

  return res.send(normalized);

});

router.get("/strategy-control-audit/recent", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "운영 관제 권한이 없습니다.");
  }

  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 80)));
  const conditions = [];
  const params = [];

  if (req.query.uid) {
    conditions.push("targetUserId = ?");
    params.push(Number(req.query.uid));
  }

  if (req.query.pid) {
    conditions.push("pid = ?");
    params.push(Number(req.query.pid));
  }

  if (req.query.strategyCategory) {
    conditions.push("strategyCategory = ?");
    params.push(String(req.query.strategyCategory).trim().toLowerCase());
  }

  if (req.query.strategyMode) {
    conditions.push("strategyMode = ?");
    params.push(String(req.query.strategyMode).trim().toLowerCase());
  }

  if (req.query.actionCode) {
    conditions.push("actionCode = ?");
    params.push(String(req.query.actionCode).trim().toUpperCase());
  }

  if (req.query.keyword) {
    conditions.push(
      "(LOWER(COALESCE(note, '')) LIKE ? OR LOWER(COALESCE(requestIp, '')) LIKE ? OR LOWER(COALESCE(metadataJson, '')) LIKE ?)"
    );
    const keyword = `%${String(req.query.keyword).trim().toLowerCase()}%`;
    params.push(keyword, keyword, keyword);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await db.query(
    `SELECT
        id,
        actorUserId,
        targetUserId,
        strategyCategory,
        strategyMode,
        pid,
        actionCode,
        previousEnabled,
        nextEnabled,
        requestIp,
        note,
        metadataJson,
        createdAt
      FROM strategy_control_audit
      ${whereSql}
      ORDER BY id DESC
      LIMIT ?`,
    params.concat(limit)
  );

  return res.send(
    (rows || []).map((row) => {
      let metadata = null;
      if (row.metadataJson) {
        try {
          metadata = JSON.parse(row.metadataJson);
        } catch (error) {
          metadata = null;
        }
      }
      return {
        ...row,
        metadata,
      };
    })
  );
});

router.post("/play/del", async (req, res) => {
  return sendRouteError(
    res,
    410,
    "Deprecated unaudited delete endpoint is disabled. Use /admin/live/del or /admin/test/del with USER_DELETE_STRATEGY confirmation."
  );
});

router.post("/live/del", async (req, res) => {
  const userId = req.decoded.userId;
  const idList = Array.isArray(req.body.idList) ? req.body.idList : [];
  if (!ensureExplicitStrategyDeleteIntent(res, req.body)) {
    return;
  }

  for (const target of idList) {
    const id = target && typeof target === "object" ? target.id : target;
    const item = await loadOwnedSignalItem("LIVE", id, userId);

    if (item === null) {
      return sendRouteError(res, 404, "실거래 전략을 찾을 수 없습니다.");
    }

    if (item === false) {
      return sendRouteError(res, 403, "본인 전략만 삭제할 수 있습니다.");
    }

    if (!canDeleteSignalItem(item)) {
      return sendRouteError(
        res,
        409,
        "포지션 또는 주문이 남아 있는 실거래 전략은 삭제할 수 없습니다. OFF 후 대기 상태에서 다시 시도해 주세요."
      );
    }
  }

  for (const target of idList) {
    const id = target && typeof target === "object" ? target.id : target;
    const item = await loadOwnedSignalItem("LIVE", id, userId);
    if (item && item !== false) {
      await writeControlAudit(req, {
        targetUserId: item.uid,
        strategyCategory: "signal",
        strategyMode: "live",
        pid: id,
        actionCode: "USER_DELETE_STRATEGY",
        previousEnabled: normalizeEnabledValue(item.enabled),
        nextEnabled: "N",
        note: "algorithm-deleted",
        metadata: {
          status: item.status || null,
          signalType: item.signalType || null,
        },
      });
    }
    await db.query(
      `DELETE FROM ${getSignalTableName("LIVE")} WHERE id = ? AND uid = ? LIMIT 1`,
      [id, userId]
    );
  }

  return res.send({ ok: true, deletedCount: idList.length });
});

router.post("/test/del", async (req, res) => {
  const userId = req.decoded.userId;
  const idList = Array.isArray(req.body.idList) ? req.body.idList : [];
  if (!ensureExplicitStrategyDeleteIntent(res, req.body)) {
    return;
  }

  for (const target of idList) {
    const id = target && typeof target === "object" ? target.id : target;
    const item = await loadOwnedSignalItem("TEST", id, userId);

    if (item === null) {
      return sendRouteError(res, 404, "모의 전략을 찾을 수 없습니다.");
    }

    if (item === false) {
      return sendRouteError(res, 403, "본인 전략만 삭제할 수 있습니다.");
    }

    if (!canDeleteSignalItem(item)) {
      return sendRouteError(
        res,
        409,
        "포지션 또는 주문이 남아 있는 모의 전략은 삭제할 수 없습니다. OFF 후 대기 상태에서 다시 시도해 주세요."
      );
    }
  }

  for (const target of idList) {
    const id = target && typeof target === "object" ? target.id : target;
    const item = await loadOwnedSignalItem("TEST", id, userId);
    if (item && item !== false) {
      await writeControlAudit(req, {
        targetUserId: item.uid,
        strategyCategory: "signal",
        strategyMode: "test",
        pid: id,
        actionCode: "USER_DELETE_STRATEGY",
        previousEnabled: normalizeEnabledValue(item.enabled),
        nextEnabled: "N",
        note: "algorithm-deleted",
        metadata: {
          status: item.status || null,
          signalType: item.signalType || null,
        },
      });
    }
    await db.query(
      `DELETE FROM ${getSignalTableName("TEST")} WHERE id = ? AND uid = ? LIMIT 1`,
      [id, userId]
    );
  }

  return res.send({ ok: true, deletedCount: idList.length });
});

router.get("/loglist", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBPageCall(`CALL SP_LOG_GET(?,?,?)`,[
    isEmpty(req.query.pid),
    req.query.page,
    req.query.size]
  );

  return res.send(reData);
});

router.get("/result", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBPageCall(`CALL SP_A_RESULT_PAGE(?,?,?,?,?)`, [
    userId,
    req.query.page,
    req.query.size,
    req.query.sDate,
    req.query.eDate,
  ]);

  return res.send(reData);
});
router.get("/result/export", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_A_RESULT_EXPORT(?,?,?)`, [
    userId,
    req.query.sDate,
    req.query.eDate,
  ]);

  return res.send(reData);
});
router.get("/result/detail", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBPageCall(`CALL SP_A_RESULT_DETAIL_PAGE(?,?,?,?)`, [
    userId,
    req.query.date,
    req.query.page,
    req.query.size
  ]);

  return res.send(reData);
});








router.get("/live/list", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_LIVE_PLAY_LOG_LIST(?)`, [
    userId
  ]);

  return res.send(await decorateOwnedSignalCollection(reData, userId));
});
router.get("/live/detail", async (req, res) => {
  const userId = req.decoded.userId;

  const play = await ensureOwnedPlayItem(
    res,
    "SP_LIVE_PLAY_DETAIL_ITEM",
    req.query.id,
    userId
  );

  if (!play) {
    return;
  }

  // let logList = await dbcon.DBCall(`CALL SP_A_PLAY_DETAIL_LOG(?)`, [
  //   play?.id
  // ]);

  // let logGroup = await dbcon.DBOneCall(`CALL SP_A_PLAY_DETAIL_LOG_GROUP(?,?)`, [
  //   play?.id,
  //   play?.idx
  // ]);

  // return res.send({
  //   play:play,
  //   logList:{},
  //   logGroup:{},
  // });

  return res.send(await decorateOwnedSignalItem(play, userId));
});
router.get("/live/detail/log", async (req, res) => {
  const userId = req.decoded.userId;

  const play = await ensureOwnedPlayItem(
    res,
    "SP_LIVE_PLAY_DETAIL_ITEM",
    req.query.id,
    userId
  );

  if (!play) {
    return;
  }

  const page = (req.query.page - 1) * req.query.size

  const reData = await dbcon.DBOriginCall(`CALL SP_LIVE_PLAY_DETAIL_LOG(?,?,?)`, [
    req.query.id,
    page,
    req.query.size
  ]);

  try{
    return res.send(decorateLogPayload({
      status: true,
      item:reData[0],
      pageInfo:reData[1][0],
      sumObj:reData[2][0]
    }));
  }catch(e){
    return res.send(decorateLogPayload({
      status: false,
      item: [],
      pageInfo:[],
      sumObj:[]
    }));
  }

  
});
router.post('/live/edit', validateItemAdd, async function(req, res){
  // validateItemAdd
 	const userId = req.decoded.userId;
  const ownedItem = await ensureOwnedPlayItem(
    res,
    "SP_LIVE_PLAY_DETAIL_ITEM",
    req.body.id,
    userId
  );

  if (!ownedItem) {
    return;
  }
  normalizeSignalRuntimeTypePayload(req.body);
  normalizeCurrentTradeFlowPayload(req.body);
  normalizeExitOptionPayload(req.body);
  
  let stoch_id = await resolveMarketStochId(
    req.body.symbol,
    req.body.type,
    req.body.bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4
  );

  // console.log(`${req.body.symbol} :::  ${req.body.second2}/${req.body.second3}/${req.body.second4}   ${stoch_id}`);

  await dbcon.DBCall(`CALL SP_LIVE_PLAY_STOCH_EDIT(?,?)`,[req.body.id, stoch_id]);
  
  const reData = await dbcon.DBCall(`CALL SP_LIVE_PLAY_EDIT(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    req.body.id,
    req.body.a_name,
    req.body.symbol,
    req.body.bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4,
    
    req.body.marginType,
    req.body.AI_ST,
    req.body.profit,
    req.body.stopLoss,

    req.body.leverage,
    req.body.margin,
    req.body.signalType,
    req.body.alarmSignalST,
    req.body.alarmResultST,
    req.body.orderSize,
    req.body.type,
    req.body.repeatConfig,
  ]);

  if(reData === false){
    return sendSaveFailure(res, "일시적인 문제로 실체결 전략 수정에 실패했습니다. 다시 시도해 주세요.");
  }

  if (!(await savePlayExitOptions("LIVE", req.body.id, req.body))) {
    return sendSaveFailure(res, "실체결 전략의 청산 옵션 저장에 실패했습니다. 다시 시도해 주세요.");
  }

  await strategyControlState.applyPlayControlState({
    mode: "LIVE",
    pid: req.body.id,
    enabled: canonicalRuntimeState.decorateSignalItemSync(ownedItem).enabled ? "Y" : "N",
    status: String(ownedItem.status || "READY").trim().toUpperCase() || "READY",
    resetRuntime: false,
  });

  return res.send(true);
});
router.post('/live/add', validateItemAdd, async function(req, res){
  const userId = req.decoded.userId;
  normalizeSignalRuntimeTypePayload(req.body);
  normalizeCurrentTradeFlowPayload(req.body);
  normalizeExitOptionPayload(req.body);
  let stoch_id = await resolveMarketStochId(
    req.body.symbol,
    req.body.type,
    req.body.bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4
  );

  const reData = await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    userId,
    stoch_id,
    req.body.a_name,
    req.body.symbol,
    req.body.bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4,

    req.body.marginType,
    req.body.AI_ST,
    req.body.profit,
    req.body.stopLoss,

    req.body.leverage,
    req.body.margin,
    req.body.signalType,
    req.body.alarmSignalST,
    req.body.alarmResultST,
    req.body.orderSize,
    req.body.type,
    req.body.repeatConfig,
  ]);

  if(reData === false){
    return sendSaveFailure(res, "일시적인 문제로 실체결 전략 저장에 실패했습니다. 다시 시도해 주세요.");
  }

  const createdId = Number(firstProcedureRow(reData)?.id || 0);
  if (!(await savePlayExitOptions("LIVE", createdId, req.body))) {
    return sendSaveFailure(res, "실체결 전략의 청산 옵션 저장에 실패했습니다. 다시 시도해 주세요.");
  }

  await strategyControlState.applyPlayControlState({
    mode: "LIVE",
    pid: createdId,
    enabled: "N",
    status: "READY",
    resetRuntime: false,
    audit: {
      actorUserId: userId,
      targetUserId: userId,
      requestIp: getRequestIp(req),
      actionCode: "CREATE",
      previousEnabled: "N",
      nextEnabled: "N",
      note: "algorithm-created-disabled",
    },
  });

  return res.send(true);
});


router.post("/live/auto", async (req, res) => {
  return handlePlayAutoRoute(req, res, "LIVE");
});
router.post("/live/select", async (req, res) => {
  const userId = req.decoded.userId;

  const itemList = req.body.itemList;

  const isOwned = await ensureOwnedPlayItems(
    res,
    "SP_LIVE_PLAY_DETAIL_ITEM",
    itemList,
    userId
  );

  if (!isOwned) {
    return;
  }

  for(let i=0;i<itemList.length;i++){
    await dbcon.DBCall(`CALL SP_LIVE_PLAY_SELECT(?,?)`, [
      itemList[i].id,
      itemList[i].st,
    ]);
  }

  return res.send(true);
});
router.post("/live/select/detail", async (req, res) => {
  const userId = req.decoded.userId;

  const ownedItem = await ensureOwnedPlayItem(
    res,
    "SP_LIVE_PLAY_DETAIL_ITEM",
    req.body.id,
    userId
  );

  if (!ownedItem) {
    return;
  }

  await dbcon.DBCall(`CALL SP_LIVE_PLAY_DETAIL_TAP(?,?)`, [
    req.body.id,
    req.body.st,
  ]);

  return res.send(true);
});
router.get("/live/result", async (req, res) => {
  const userId = req.decoded.userId;

  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_LIVE_RESULT_PAGE(?,?,?,?,?)`, [
    userId,
    page,
    req.query.size,
    req.query.sDate,
    req.query.eDate,
  ]);

  return res.send(decoratePagedResult(reData));
});
router.get("/live/result/export", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_LIVE_RESULT_EXPORT(?,?,?)`, [
    userId,
    req.query.sDate,
    req.query.eDate,
  ]);

  return res.send(decorateRuntimeCollection(reData));
});
router.get("/live/result/detail", async (req, res) => {
  const userId = req.decoded.userId;

  const page = (req.query.page - 1) * req.query.size

  const reData = await dbcon.DBOriginCall(`CALL SP_LIVE_RESULT_DETAIL_PAGE(?,?,?,?)`, [
    userId,
    req.query.date,
    page,
    req.query.size
  ]);

  return res.send(decorateLogPayload({
    item:reData[0],
    pageInfo:reData[1][0],
    sumObj:reData[2][0]
  }));
});


router.get("/test/list", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_TEST_PLAY_LOG_LIST(?)`, [
    userId
  ]);

  return res.send(await decorateOwnedSignalCollection(reData, userId));
});
router.get("/test/detail", async (req, res) => {
  const userId = req.decoded.userId;

  const play = await ensureOwnedPlayItem(
    res,
    "SP_TEST_PLAY_DETAIL_ITEM",
    req.query.id,
    userId
  );

  if (!play) {
    return;
  }

  // let logList = await dbcon.DBCall(`CALL SP_A_PLAY_DETAIL_LOG(?)`, [
  //   play?.id
  // ]);

  // let logGroup = await dbcon.DBOneCall(`CALL SP_A_PLAY_DETAIL_LOG_GROUP(?,?)`, [
  //   play?.id,
  //   play?.idx
  // ]);

  // return res.send({
  //   play:play,
  //   logList:{},
  //   logGroup:{},
  // });

  return res.send(await decorateOwnedSignalItem(play, userId));
});
router.get("/test/detail/log", async (req, res) => {
  const userId = req.decoded.userId;

  const play = await ensureOwnedPlayItem(
    res,
    "SP_TEST_PLAY_DETAIL_ITEM",
    req.query.id,
    userId
  );

  if (!play) {
    return;
  }

  const page = (req.query.page - 1) * req.query.size

  const reData = await dbcon.DBOriginCall(`CALL SP_TEST_PLAY_DETAIL_LOG(?,?,?)`, [
    req.query.id,
    page,
    req.query.size
  ]);

  try{
    return res.send(decorateLogPayload({
      status: true,
      item:reData[0],
      pageInfo:reData[1][0],
      sumObj:reData[2][0]
    }));
  }catch(e){
    return res.send(decorateLogPayload({
      status: false,
      item: [],
      pageInfo:[],
      sumObj:[]
    }));
  }

  
});
router.post('/test/edit', validateItemAdd, async function(req, res){
  // validateItemAdd
  // console.log(req.body);
  // return res.send(true);

 	const userId = req.decoded.userId;
  const ownedItem = await ensureOwnedPlayItem(
    res,
    "SP_TEST_PLAY_DETAIL_ITEM",
    req.body.id,
    userId
  );

  if (!ownedItem) {
    return;
  }
  normalizeSignalRuntimeTypePayload(req.body);
  normalizeCurrentTradeFlowPayload(req.body);
  normalizeExitOptionPayload(req.body);
  
  let stoch_id = await resolveMarketStochId(
    req.body.symbol,
    req.body.type,
    req.body.bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4
  );

  // console.log(`${req.body.symbol} :::  ${req.body.second2}/${req.body.second3}/${req.body.second4}   ${stoch_id}`);

  await dbcon.DBCall(`CALL SP_TEST_PLAY_STOCH_EDIT(?,?)`,[req.body.id, stoch_id]);

  const reData = await dbcon.DBCall(`CALL SP_TEST_PLAY_EDIT(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    req.body.id,
    req.body.a_name,
    req.body.symbol,
    req.body.bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4,

    req.body.marginType,
    req.body.AI_ST,
    req.body.profit,
    req.body.stopLoss,

    req.body.leverage,
    req.body.margin,
    req.body.signalType,
    req.body.alarmSignalST,
    req.body.alarmResultST,
    req.body.orderSize,
    req.body.type,
    req.body.repeatConfig,
  ]);

  if(reData === false){
    return sendSaveFailure(res, "일시적인 문제로 데모 전략 수정에 실패했습니다. 다시 시도해 주세요.");
  }

  if (!(await savePlayExitOptions("TEST", req.body.id, req.body))) {
    return sendSaveFailure(res, "데모 전략의 청산 옵션 저장에 실패했습니다. 다시 시도해 주세요.");
  }

  await strategyControlState.applyPlayControlState({
    mode: "TEST",
    pid: req.body.id,
    enabled: canonicalRuntimeState.decorateSignalItemSync(ownedItem).enabled ? "Y" : "N",
    status: String(ownedItem.status || "READY").trim().toUpperCase() || "READY",
    resetRuntime: false,
  });

  return res.send(true);
});

router.post('/test/add', validateItemAdd, async function(req, res){
  const userId = req.decoded.userId;
  normalizeSignalRuntimeTypePayload(req.body);
  normalizeCurrentTradeFlowPayload(req.body);
  normalizeExitOptionPayload(req.body);
  let stoch_id = await resolveMarketStochId(
    req.body.symbol,
    req.body.type,
    req.body.bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4
  );

  const reData = await dbcon.DBCall(`CALL SP_TEST_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    userId,
    stoch_id,
    req.body.a_name,
    req.body.symbol,
    req.body.bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4,

    req.body.marginType,
    req.body.AI_ST,
    req.body.profit,
    req.body.stopLoss,

    req.body.leverage,
    req.body.margin,
    req.body.signalType,
    req.body.alarmSignalST,
    req.body.alarmResultST,
    req.body.orderSize,
    req.body.type,
    req.body.repeatConfig,
  ]);

  if(reData === false){
    return sendSaveFailure(res, "일시적인 문제로 데모 전략 저장에 실패했습니다. 다시 시도해 주세요.");
  }

  const createdId = Number(firstProcedureRow(reData)?.id || 0);
  if (!(await savePlayExitOptions("TEST", createdId, req.body))) {
    return sendSaveFailure(res, "데모 전략의 청산 옵션 저장에 실패했습니다. 다시 시도해 주세요.");
  }

  await strategyControlState.applyPlayControlState({
    mode: "TEST",
    pid: createdId,
    enabled: "N",
    status: "READY",
    resetRuntime: false,
    audit: {
      actorUserId: userId,
      targetUserId: userId,
      requestIp: getRequestIp(req),
      actionCode: "CREATE",
      previousEnabled: "N",
      nextEnabled: "N",
      note: "algorithm-created-disabled",
    },
  });

  return res.send(true);
});

router.post("/test/auto", async (req, res) => {
  return handlePlayAutoRoute(req, res, "TEST");
});
router.post("/test/select", async (req, res) => {
  const userId = req.decoded.userId;

  const itemList = req.body.itemList;

  const isOwned = await ensureOwnedPlayItems(
    res,
    "SP_TEST_PLAY_DETAIL_ITEM",
    itemList,
    userId
  );

  if (!isOwned) {
    return;
  }

  for(let i=0;i<itemList.length;i++){
    await dbcon.DBCall(`CALL SP_TEST_PLAY_SELECT(?,?)`, [
      itemList[i].id,
      itemList[i].st,
    ]);
  }

  return res.send(true);
});
router.post("/test/select/detail", async (req, res) => {
  const userId = req.decoded.userId;

  const ownedItem = await ensureOwnedPlayItem(
    res,
    "SP_TEST_PLAY_DETAIL_ITEM",
    req.body.id,
    userId
  );

  if (!ownedItem) {
    return;
  }

  await dbcon.DBCall(`CALL SP_TEST_PLAY_DETAIL_TAP(?,?)`, [
    req.body.id,
    req.body.st,
  ]);

  return res.send(true);
});
router.get("/test/result", async (req, res) => {
  const userId = req.decoded.userId;

  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_TEST_RESULT_PAGE(?,?,?,?,?)`, [
    userId,
    page,
    req.query.size,
    req.query.sDate,
    req.query.eDate,
  ]);

  return res.send(decoratePagedResult(reData));
});
router.get("/test/result/export", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_TEST_RESULT_EXPORT(?,?,?)`, [
    userId,
    req.query.sDate,
    req.query.eDate,
  ]);

  return res.send(decorateRuntimeCollection(reData));
});
router.get("/test/result/detail", async (req, res) => {
  const userId = req.decoded.userId;

  const page = (req.query.page - 1) * req.query.size

  const reData = await dbcon.DBOriginCall(`CALL SP_TEST_RESULT_DETAIL_PAGE(?,?,?,?)`, [
    userId,
    req.query.date,
    page,
    req.query.size
  ]);

  return res.send(decorateLogPayload({
    item:reData[0],
    pageInfo:reData[1][0],
    sumObj:reData[2][0]
  }));
});

router.get("/test/result/item", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_TEST_RESULT_ITEM(?,?,?,?,?,?)`, [
    userId,
    req.query.id,
    req.query.sDate,
    req.query.eDate,

    page,
    req.query.size,
  ]);

  return res.send(decoratePagedResult(reData));
});
router.get("/live/result/item", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_LIVE_RESULT_ITEM(?,?,?,?,?,?)`, [
    userId,
    req.query.id,
    req.query.sDate,
    req.query.eDate,

    page,
    req.query.size,
  ]);

  return res.send(decoratePagedResult(reData));
});
router.get("/test/result/all", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_TEST_RESULT_ALL(?,?,?,?,?,?)`, [
    userId,
    req.query.sDate,
    req.query.eDate,

    req.query.pid,

    page,
    req.query.size,
  ]);

  return res.send(decoratePagedResult(reData));
});
router.get("/live/result/all", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_LIVE_RESULT_ALL(?,?,?,?,?,?)`, [
    userId,
    req.query.sDate,
    req.query.eDate,

    req.query.pid,

    page,
    req.query.size,
  ]);

  return res.send(decoratePagedResult(reData));
});
router.get("/live/result/exact/all", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_LIVE_RESULT_EXACT_ALL(?)`, [
    userId
  ]);

  return res.send(decorateRuntimeCollection(reData));
});
router.get("/test/result/exact/all", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_TEST_RESULT_EXACT_ALL(?)`, [
    userId
  ]);

  return res.send(decorateRuntimeCollection(reData));
});

router.get("/live/detail/item/rate", async (req, res) => {
  const userId = req.decoded.userId;

  const play = await ensureOwnedPlayItem(
    res,
    "SP_LIVE_PLAY_DETAIL_ITEM",
    req.query.id,
    userId
  );

  if (!play) {
    return;
  }

  let reData = await dbcon.DBOneCall(`CALL SP_LIVE_DETAIL_ITEM_RATE(?)`, [
    req.query.id
  ]);

  return res.send(reData);
});
router.get("/test/detail/item/rate", async (req, res) => {
  const userId = req.decoded.userId;

  const play = await ensureOwnedPlayItem(
    res,
    "SP_TEST_PLAY_DETAIL_ITEM",
    req.query.id,
    userId
  );

  if (!play) {
    return;
  }

  let reData = await dbcon.DBOneCall(`CALL SP_TEST_DETAIL_ITEM_RATE(?)`, [
    req.query.id
  ]);

  return res.send(reData);
});

router.get("/live/detail/rate", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_LIVE_DETAIL_RATE(?)`, [
    userId
  ]);

  return res.send(reData);
});
router.get("/test/detail/rate", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_TEST_DETAIL_RATE(?)`, [
    userId
  ]);

  return res.send(reData);
});

router.get("/live/result/name", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBCall(`CALL SP_LIVE_RESULT_NAME(?)`, [
    userId
  ]);

  return res.send(reData);
});

router.get("/test/result/name", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBCall(`CALL SP_TEST_RESULT_NAME(?)`, [
    userId
  ]);

  return res.send(reData);
});


router.get("/msg/item", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_MSG_PLAY_GET(?,?)`, [
    userId,
    req.query.pid,
  ]);

  return res.send(reData);
});

router.get("/msg", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_MSG_GET(?,?,?)`, [
    userId,
    page,
    req.query.size,
  ]);

  return res.send(reData);
});

const MSG_ACTION_META = {
  manual: { label: "수동 확인", severity: "high", needsAction: true },
  reject: { label: "즉시 거부", severity: "high", needsAction: true },
  requery: { label: "주문 재조회", severity: "medium", needsAction: true },
  retry: { label: "자동 재시도", severity: "medium", needsAction: false },
  info: { label: "참고", severity: "low", needsAction: false },
};

const decorateMsgAction = (action) => {
  return MSG_ACTION_META[action] || MSG_ACTION_META.info;
};

const decorateMsgRows = (rows = []) =>
  rows.map((row) => {
    const meta = decorateMsgAction(row.action);
    return {
      ...row,
      actionLabel: meta.label,
      severity: meta.severity,
      needsAction: meta.needsAction,
    };
  });

const summarizeMsgRows = (rows = []) => {
  return rows.reduce(
    (acc, row) => {
      const meta = decorateMsgAction(row.action);
      acc.totalCount += Number(row.totalCount || 0);
      if (meta.needsAction) {
        acc.needsActionCount += Number(row.totalCount || 0);
      }
      if (meta.severity === "high") {
        acc.highSeverityCount += Number(row.totalCount || 0);
      }
      acc.unreadCount += Number(row.unreadCount || 0);
      return acc;
    },
    {
      totalCount: 0,
      needsActionCount: 0,
      highSeverityCount: 0,
      unreadCount: 0,
    }
  );
};

const normalizeBacktestStatStrategyKey = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  const aliasMap = {
    stoch: "scalping",
    signal: "scalping",
    signals: "scalping",
    green_light: "greenlight",
    greenlight: "greenlight",
    "atf+vixfix": "atf+vixfix",
    atf_vixfix: "atf+vixfix",
    atfvixfix: "atf+vixfix",
  };

  return aliasMap[normalized] || normalized;
};

const normalizeBacktestStatSymbol = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\.P$/i, "");

const normalizeBacktestStatSignalType = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return "";
  }

  if (normalized === "LONG") {
    return "BUY";
  }

  if (normalized === "SHORT") {
    return "SELL";
  }

  return normalized;
};

const normalizeBacktestStatBunbong = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return "";
  }

  const minuteMatch = normalized.match(/^(\d+)\s*(M|MIN|MINUTE|MINUTES)$/);
  if (minuteMatch) {
    return `${minuteMatch[1]}MIN`;
  }

  if (/^\d+$/.test(normalized)) {
    return `${normalized}MIN`;
  }

  return normalized.replace(/\s+/g, "");
};

router.get("/backtest/stats", async (req, res) => {
  const strategyKey = normalizeBacktestStatStrategyKey(req.query.strategyKey || req.query.strategy);
  const symbol = normalizeBacktestStatSymbol(req.query.symbol);
  const bunbong = normalizeBacktestStatBunbong(req.query.bunbong || req.query.timeframe);
  const signalType = normalizeBacktestStatSignalType(
    req.query.signalType || req.query.direction || req.query.side
  );

  if (!strategyKey || !symbol || !bunbong || !signalType) {
    return res.send({
      strategyKey,
      symbol,
      bunbong,
      signalType,
      latestGeneratedAt: null,
      items: [],
    });
  }

  const [rows] = await db.query(
    `SELECT
        strategy_key AS strategyKey,
        symbol,
        bunbong,
        signal_type AS signalType,
        tp_value AS tpValue,
        pnl_value AS pnlValue,
        hit_rate AS hitRate,
        trade_count AS tradeCount,
        sample_count AS sampleCount,
        generated_at AS generatedAt,
        source
      FROM backtest_stat_current
      WHERE strategy_key = ? AND symbol = ? AND bunbong = ? AND signal_type = ?
      ORDER BY tp_value ASC`,
    [strategyKey, symbol, bunbong, signalType]
  );

  const latestGeneratedAt = rows.reduce((latest, row) => {
    if (!row.generatedAt) {
      return latest;
    }

    const current = new Date(row.generatedAt).getTime();
    const previous = latest ? new Date(latest).getTime() : 0;
    return current > previous ? row.generatedAt : latest;
  }, null);

  return res.send({
    strategyKey,
    symbol,
    bunbong,
    signalType,
    latestGeneratedAt,
    items: rows,
  });
});

router.get("/backtest/archive/latest", async (req, res) => {
  const strategyKey = normalizeBacktestStatStrategyKey(req.query.strategyKey || req.query.strategy);
  const symbol = normalizeBacktestStatSymbol(req.query.symbol);
  const bunbong = normalizeBacktestStatBunbong(req.query.bunbong || req.query.timeframe);
  const signalType = normalizeBacktestStatSignalType(
    req.query.signalType || req.query.direction || req.query.side
  );

  if (!strategyKey || !symbol || !bunbong || !signalType) {
    return res.send({
      strategyKey,
      symbol,
      bunbong,
      signalType,
      snapshotMonth: null,
      items: [],
    });
  }

  const [monthRows] = await db.query(
    `SELECT MAX(snapshot_month) AS snapshotMonth
     FROM backtest_stat_archive
     WHERE strategy_key = ? AND symbol = ? AND bunbong = ? AND signal_type = ?`,
    [strategyKey, symbol, bunbong, signalType]
  );

  const snapshotMonth = monthRows?.[0]?.snapshotMonth || null;
  if (!snapshotMonth) {
    return res.send({
      strategyKey,
      symbol,
      bunbong,
      signalType,
      snapshotMonth: null,
      items: [],
    });
  }

  const [rows] = await db.query(
    `SELECT
        snapshot_month AS snapshotMonth,
        strategy_key AS strategyKey,
        symbol,
        bunbong,
        signal_type AS signalType,
        tp_value AS tpValue,
        pnl_value AS pnlValue,
        hit_rate AS hitRate,
        trade_count AS tradeCount,
        sample_count AS sampleCount,
        generated_at AS generatedAt,
        source
      FROM backtest_stat_archive
      WHERE snapshot_month = ? AND strategy_key = ? AND symbol = ? AND bunbong = ? AND signal_type = ?
      ORDER BY tp_value ASC`,
    [snapshotMonth, strategyKey, symbol, bunbong, signalType]
  );

  return res.send({
    strategyKey,
    symbol,
    bunbong,
    signalType,
    snapshotMonth: dayjs(snapshotMonth).format("YYYY-MM-DD"),
    items: rows,
  });
});

router.get("/backtest/archive/months", async (req, res) => {
  const strategyKey = normalizeBacktestStatStrategyKey(req.query.strategyKey || req.query.strategy);
  const symbol = normalizeBacktestStatSymbol(req.query.symbol);
  const bunbong = normalizeBacktestStatBunbong(req.query.bunbong || req.query.timeframe);
  const signalType = normalizeBacktestStatSignalType(
    req.query.signalType || req.query.direction || req.query.side
  );

  if (!strategyKey || !symbol || !bunbong || !signalType) {
    return res.send({
      strategyKey,
      symbol,
      bunbong,
      signalType,
      months: [],
    });
  }

  const [rows] = await db.query(
    `SELECT
        snapshot_month AS snapshotMonth,
        COUNT(*) AS itemCount,
        MAX(generated_at) AS latestGeneratedAt
      FROM backtest_stat_archive
      WHERE strategy_key = ? AND symbol = ? AND bunbong = ? AND signal_type = ?
      GROUP BY snapshot_month
      ORDER BY snapshot_month DESC`,
    [strategyKey, symbol, bunbong, signalType]
  );

  return res.send({
    strategyKey,
    symbol,
    bunbong,
    signalType,
    months: rows.map((row) => ({
      snapshotMonth: row.snapshotMonth ? dayjs(row.snapshotMonth).format("YYYY-MM-DD") : null,
      itemCount: row.itemCount,
      latestGeneratedAt: row.latestGeneratedAt,
    })),
  });
});

router.get("/backtest/archive", async (req, res) => {
  const strategyKey = normalizeBacktestStatStrategyKey(req.query.strategyKey || req.query.strategy);
  const symbol = normalizeBacktestStatSymbol(req.query.symbol);
  const bunbong = normalizeBacktestStatBunbong(req.query.bunbong || req.query.timeframe);
  const signalType = normalizeBacktestStatSignalType(
    req.query.signalType || req.query.direction || req.query.side
  );
  const requestedMonth = String(req.query.month || req.query.snapshotMonth || "").trim();

  if (!strategyKey || !symbol || !bunbong || !signalType) {
    return res.send({
      strategyKey,
      symbol,
      bunbong,
      signalType,
      snapshotMonth: null,
      items: [],
    });
  }

  if (!requestedMonth) {
    return sendRouteError(res, 400, "조회할 snapshot month가 필요합니다.");
  }

  const normalizedMonth = dayjs(requestedMonth).isValid()
    ? dayjs(requestedMonth).format("YYYY-MM-DD")
    : null;

  if (!normalizedMonth) {
    return sendRouteError(res, 400, "유효한 snapshot month 형식이 아닙니다.");
  }

  const [rows] = await db.query(
    `SELECT
        snapshot_month AS snapshotMonth,
        strategy_key AS strategyKey,
        symbol,
        bunbong,
        signal_type AS signalType,
        tp_value AS tpValue,
        pnl_value AS pnlValue,
        hit_rate AS hitRate,
        trade_count AS tradeCount,
        sample_count AS sampleCount,
        generated_at AS generatedAt,
        source
      FROM backtest_stat_archive
      WHERE snapshot_month = ? AND strategy_key = ? AND symbol = ? AND bunbong = ? AND signal_type = ?
      ORDER BY tp_value ASC`,
    [normalizedMonth, strategyKey, symbol, bunbong, signalType]
  );

  return res.send({
    strategyKey,
    symbol,
    bunbong,
    signalType,
    snapshotMonth: normalizedMonth,
    items: rows,
  });
});

router.get("/backtest/hook/recent", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "30", 10) || 30, 1), 200);
  const [rows] = await db.query(
    `SELECT
        id,
        hook_type AS hookType,
        signal_tag AS signalTag,
        status,
        strategy_key AS strategyKey,
        symbol,
        bunbong,
        signal_type AS signalType,
        candle_min AS candleMin,
        best_metric AS bestMetric,
        first_signal_date AS firstSignalDate,
        payload_hash AS payloadHash,
        row_count AS rowCount,
        note,
        rows_json AS rowsJson,
        best_windows_json AS bestWindowsJson,
        created_at AS createdAt
      FROM backtest_webhook_log
      ORDER BY id DESC
      LIMIT ?`,
    [limit]
  );

  return res.send(rows);
});

router.get("/backtest/hook/item", async (req, res) => {
  const id = parseInt(req.query.id || "0", 10);
  if (!id) {
    return sendRouteError(res, 400, "조회할 backtest webhook 로그 id가 필요합니다.");
  }

  const [rows] = await db.query(
    `SELECT
        id,
        hook_type AS hookType,
        signal_tag AS signalTag,
        status,
        strategy_key AS strategyKey,
        symbol,
        bunbong,
        signal_type AS signalType,
        candle_min AS candleMin,
        best_metric AS bestMetric,
        first_signal_date AS firstSignalDate,
        payload_hash AS payloadHash,
        row_count AS rowCount,
        note,
        raw_body AS rawBody,
        rows_json AS rowsJson,
        best_windows_json AS bestWindowsJson,
        created_at AS createdAt
      FROM backtest_webhook_log
      WHERE id = ?
      LIMIT 1`,
    [id]
  );

  if (!rows.length) {
    return sendRouteError(res, 404, "backtest webhook 로그를 찾을 수 없습니다.");
  }

  const row = rows[0];
  let parsedRows = null;
  let parsedBestWindows = null;
  let parsedRawBody = null;

  try {
    parsedRows = row.rowsJson ? JSON.parse(row.rowsJson) : null;
  } catch (error) {}

  try {
    parsedBestWindows = row.bestWindowsJson ? JSON.parse(row.bestWindowsJson) : null;
  } catch (error) {}

  try {
    parsedRawBody = row.rawBody ? JSON.parse(row.rawBody) : null;
  } catch (error) {}

  return res.send({
    ...row,
    parsedRows,
    parsedBestWindows,
    parsedRawBody,
  });
});

router.get("/webhook/recent", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10) || 50, 1), 200);
  const hookCategory = String(req.query.category || "").trim().toLowerCase();
  const statuses = [];
  const params = [];

  if (hookCategory) {
    statuses.push(`hook_category = ?`);
    params.push(hookCategory);
  }

  params.push(limit);

  const [rows] = await db.query(
    `SELECT
        id,
        hook_category AS hookCategory,
        route_path AS routePath,
        status,
        result_code AS resultCode,
        request_ip AS requestIp,
        payload_hash AS payloadHash,
        strategy_key AS strategyKey,
        signal_tag AS signalTag,
        strategy_uuid AS strategyUuid,
        symbol,
        bunbong,
        signal_type AS signalType,
        matched_count AS matchedCount,
        processed_count AS processedCount,
        ignored_count AS ignoredCount,
        duplicate_flag AS duplicateFlag,
        http_status AS httpStatus,
        note,
        created_at AS createdAt
      FROM webhook_event_log
      ${statuses.length ? `WHERE ${statuses.join(" AND ")}` : ""}
      ORDER BY id DESC
      LIMIT ?`,
    params
  );

  return res.send(decorateWebhookEventRows(rows));
});

router.get("/webhook/item", async (req, res) => {
  const id = parseInt(req.query.id || "0", 10);
  if (!id) {
    return sendRouteError(res, 400, "조회할 webhook 로그 id가 필요합니다.");
  }

  const [rows] = await db.query(
    `SELECT
        id,
        hook_category AS hookCategory,
        route_path AS routePath,
        status,
        result_code AS resultCode,
        request_ip AS requestIp,
        payload_hash AS payloadHash,
        strategy_key AS strategyKey,
        signal_tag AS signalTag,
        strategy_uuid AS strategyUuid,
        symbol,
        bunbong,
        signal_type AS signalType,
        matched_count AS matchedCount,
        processed_count AS processedCount,
        ignored_count AS ignoredCount,
        duplicate_flag AS duplicateFlag,
        http_status AS httpStatus,
        note,
        raw_body AS rawBody,
        normalized_body AS normalizedBody,
        response_body AS responseBody,
        created_at AS createdAt
      FROM webhook_event_log
      WHERE id = ?
      LIMIT 1`,
    [id]
  );

  if (!rows.length) {
    return sendRouteError(res, 404, "webhook 로그를 찾을 수 없습니다.");
  }

  const row = decorateWebhookEventRow(rows[0]);
  let parsedRawBody = null;
  let parsedNormalizedBody = null;
  let parsedResponseBody = null;

  try {
    parsedRawBody = row.rawBody ? JSON.parse(row.rawBody) : null;
  } catch (error) {}

  try {
    parsedNormalizedBody = row.normalizedBody ? JSON.parse(row.normalizedBody) : null;
  } catch (error) {}

  try {
    parsedResponseBody = row.responseBody ? JSON.parse(row.responseBody) : null;
  } catch (error) {}

  const [targetRows] = await db.query(
    `SELECT
        id,
        event_id AS eventId,
        uid,
        pid,
        strategy_category AS strategyCategory,
        strategy_mode AS strategyMode,
        strategy_name AS strategyName,
        strategy_key AS strategyKey,
        strategy_uuid AS strategyUuid,
        symbol,
        bunbong,
        legacy_status AS legacyStatus,
        regime_status AS regimeStatus,
        control_state AS controlState,
        auto_st AS autoST,
        incoming_signal_type AS incomingSignalType,
        runtime_signal_type AS runtimeSignalType,
        result_code AS resultCode,
        severity,
        ops_status AS opsStatus,
        ops_note AS opsNote,
        ops_updated_by AS opsUpdatedBy,
        ops_updated_at AS opsUpdatedAt,
        note,
        payload_json AS payloadJson,
        created_at AS createdAt
      FROM webhook_event_target_log
      WHERE event_id = ?
      ORDER BY id ASC`,
    [id]
  );

  return res.send({
    ...row,
    parsedRawBody,
    parsedNormalizedBody,
    parsedResponseBody,
    targetItems: decorateWebhookTargetRows(
      targetRows.map((item) => {
        try {
          item.payloadJson = item.payloadJson ? JSON.parse(item.payloadJson) : null;
        } catch (error) {}
        return item;
      })
    ),
  });
});

router.get("/webhook/targets/recent", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "100", 10) || 100, 1), 300);
  const eventId = parseInt(req.query.eventId || "0", 10);
  const uid = parseInt(req.query.uid || "0", 10);
  const strategyCategory = String(req.query.category || "").trim().toLowerCase();
  const severity = String(req.query.severity || "").trim().toLowerCase();
  const opsStatus = String(req.query.opsStatus || "").trim().toUpperCase();
  const strategy = String(req.query.strategy || "").trim();
  const where = [];
  const params = [];

  if (eventId) {
    where.push("event_id = ?");
    params.push(eventId);
  }
  if (uid) {
    where.push("uid = ?");
    params.push(uid);
  }
  if (strategyCategory) {
    where.push("strategy_category = ?");
    params.push(strategyCategory);
  }
  if (severity) {
    where.push("severity = ?");
    params.push(severity);
  }
  if (opsStatus) {
    where.push("ops_status = ?");
    params.push(opsStatus);
  }
  if (strategy) {
    where.push("(strategy_name LIKE ? OR strategy_key LIKE ? OR strategy_uuid LIKE ?)");
    params.push(`%${strategy}%`, `%${strategy}%`, `%${strategy}%`);
  }

  params.push(limit);

  const [rows] = await db.query(
    `SELECT
        id,
        event_id AS eventId,
        uid,
        pid,
        strategy_category AS strategyCategory,
        strategy_mode AS strategyMode,
        strategy_name AS strategyName,
        strategy_key AS strategyKey,
        strategy_uuid AS strategyUuid,
        symbol,
        bunbong,
        legacy_status AS legacyStatus,
        regime_status AS regimeStatus,
        control_state AS controlState,
        auto_st AS autoST,
        incoming_signal_type AS incomingSignalType,
        runtime_signal_type AS runtimeSignalType,
        result_code AS resultCode,
        severity,
        ops_status AS opsStatus,
        ops_note AS opsNote,
        ops_updated_by AS opsUpdatedBy,
        ops_updated_at AS opsUpdatedAt,
        note,
        created_at AS createdAt
      FROM webhook_event_target_log
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC
      LIMIT ?`,
    params
  );

  return res.send(decorateWebhookTargetRows(rows));
});

router.get("/webhook/targets/summary", async (req, res) => {
  const hours = Math.min(Math.max(parseInt(req.query.hours || "24", 10) || 24, 1), 168);
  const uid = parseInt(req.query.uid || "0", 10);
  const strategyCategory = String(req.query.category || "").trim().toLowerCase();
  const where = ["created_at >= ?"];
  const params = [dayjs().subtract(hours, "hour").format("YYYY-MM-DD HH:mm:ss")];

  if (uid) {
    where.push("uid = ?");
    params.push(uid);
  }
  if (strategyCategory) {
    where.push("strategy_category = ?");
    params.push(strategyCategory);
  }

  const [rows] = await db.query(
    `SELECT
        strategy_category AS strategyCategory,
        severity,
        ops_status AS opsStatus,
        COUNT(*) AS targetCount,
        MAX(created_at) AS lastCreatedAt
      FROM webhook_event_target_log
      WHERE ${where.join(" AND ")}
      GROUP BY strategy_category, severity, ops_status
      ORDER BY targetCount DESC, strategy_category ASC, severity ASC, ops_status ASC`,
    params
  );

  return res.send(decorateWebhookTargetRows(rows));
});

router.post("/webhook/targets/status", async (req, res) => {
  const userId = req.decoded.userId;
  const id = parseInt(req.body.id || "0", 10);
  const opsStatus = String(req.body.opsStatus || "").trim().toUpperCase();
  const opsNoteRaw = req.body.opsNote;
  const opsNote = opsNoteRaw === undefined || opsNoteRaw === null ? null : String(opsNoteRaw).trim();

  if (!id) {
    return sendRouteError(res, 400, "target id가 필요합니다.");
  }

  if (!["OPEN", "ACK", "RESOLVED"].includes(opsStatus)) {
    return sendRouteError(res, 400, "opsStatus는 OPEN, ACK, RESOLVED 중 하나여야 합니다.");
  }

  await db.query(
    `UPDATE webhook_event_target_log
        SET ops_status = ?,
            ops_note = ?,
            ops_updated_by = ?,
            ops_updated_at = NOW()
      WHERE id = ?`,
    [opsStatus, opsNote || null, userId, id]
  );

  const [[row]] = await db.query(
    `SELECT
        id,
        event_id AS eventId,
        uid,
        pid,
        strategy_category AS strategyCategory,
        strategy_mode AS strategyMode,
        strategy_name AS strategyName,
        strategy_key AS strategyKey,
        strategy_uuid AS strategyUuid,
        symbol,
        bunbong,
        legacy_status AS legacyStatus,
        regime_status AS regimeStatus,
        control_state AS controlState,
        auto_st AS autoST,
        incoming_signal_type AS incomingSignalType,
        runtime_signal_type AS runtimeSignalType,
        result_code AS resultCode,
        severity,
        ops_status AS opsStatus,
        ops_note AS opsNote,
        ops_updated_by AS opsUpdatedBy,
        ops_updated_at AS opsUpdatedAt,
        note,
        payload_json AS payloadJson,
        created_at AS createdAt
      FROM webhook_event_target_log
      WHERE id = ?
      LIMIT 1`,
    [id]
  );

  if (row?.payloadJson) {
    try {
      row.payloadJson = JSON.parse(row.payloadJson);
    } catch (error) {}
  }

  return res.send(decorateWebhookTargetRow(row || {}));
});

router.get("/webhook/summary", async (req, res) => {
  const hours = Math.min(Math.max(parseInt(req.query.hours || "24", 10) || 24, 1), 168);
  const hookCategory = String(req.query.category || "").trim().toLowerCase();
  const where = ["created_at >= ?"];
  const params = [dayjs().subtract(hours, "hour").format("YYYY-MM-DD HH:mm:ss")];

  if (hookCategory) {
    where.push("hook_category = ?");
    params.push(hookCategory);
  }

  const [rows] = await db.query(
    `SELECT
        hook_category AS hookCategory,
        status,
        result_code AS resultCode,
        COUNT(*) AS eventCount,
        SUM(matched_count) AS matchedCount,
        SUM(processed_count) AS processedCount,
        SUM(ignored_count) AS ignoredCount,
        SUM(CASE WHEN duplicate_flag = 'Y' THEN 1 ELSE 0 END) AS duplicateCount,
        MAX(created_at) AS lastCreatedAt
      FROM webhook_event_log
      WHERE ${where.join(" AND ")}
      GROUP BY hook_category, status, result_code
      ORDER BY eventCount DESC, hook_category ASC, status ASC, result_code ASC`,
    params
  );

  return res.send(decorateWebhookEventRows(rows));
});

router.get("/runtime/binance/health", async (req, res) => {
  const userId = req.decoded.userId;
  const health = await coin.getBinanceRuntimeHealth(userId);
  return res.send(decorateBinanceRuntimeHealth(health));
});

router.get("/runtime/binance/reconcile", async (req, res) => {
  const userId = req.decoded.userId;
  const payload = await coin.getBinanceRuntimeReconciliation(userId);
  return res.send(decorateBinanceRuntimeReconciliation(payload));
});

router.get("/live/performance-summary", async (req, res) => {
  const userId = req.decoded.userId;
  const payload = await userPerformanceSummary.getUserPerformanceSummary(userId);
  return res.send(payload);
});

router.get("/account/readiness", async (req, res) => {
  const userId = req.decoded.userId;
  const runtimeHealth = await coin.getBinanceRuntimeHealth(userId).catch((error) => ({
    status: "UNKNOWN",
    lastErrorCode: error?.code || null,
    lastErrorMessage: error?.message || null,
  }));
  const member = await dbcon.DBOneCall(`CALL SP_A_MEMBER_GET(?)`, [userId]);
  const hasCredentials = Boolean(member?.appKey && member?.appSecret);
  if (hasCredentials) {
    runtimeHealth.apiValidation = await coin.validateMemberApiKeys(member.appKey, member.appSecret).catch((error) => ({
      ok: false,
      code: error?.code || "VALIDATION_ERROR",
      message: error?.message || "Binance API validation failed.",
    }));
  }
  const payload = await accountReadiness.getAccountReadiness(userId, { runtimeHealth });
  return res.send(payload);
});

router.post("/account/ensure-hedge-mode", async (req, res) => {
  const userId = req.decoded.userId;
  const decision = binanceWriteGuard.evaluateBinanceWriteAllowed({
    uid: userId,
    action: "WRITE_POSITION_MODE_CHANGE",
    caller: "routes/admin.account.ensure-hedge-mode",
    allowLiveOrders: false,
  });

  if (!decision.allowed) {
    return res.send({
      ok: false,
      blockedByWriteGuard: true,
      guardReason: decision.reason,
      runtimeMode: process.env.QA_DISABLE_BINANCE_WRITES ? "READ_ONLY_WRITE_DISABLED" : "WRITE_APPROVAL_REQUIRED",
      message: "헤지 모드 자동 설정은 live-write 승인 상태에서만 실행할 수 있습니다.",
    });
  }

  return res.status(501).send({
    ok: false,
    blockedByWriteGuard: false,
    message: "헤지 모드 자동 설정 실행은 별도 승인된 live-write preflight에서만 제공됩니다.",
  });
});

router.get("/runtime/account-risk/current", async (req, res) => {
  const userId = req.decoded.userId;
  const payload = await coin.getBinanceAccountRiskCurrent(userId, {
    persist: true,
    force: String(req.query.force || "").trim().toUpperCase() === "Y",
  });
  return res.send(decorateAccountRiskRow(payload));
});

router.get("/runtime/account-risk/history", async (req, res) => {
  const userId = req.decoded.userId;
  const limit = Math.min(Math.max(parseInt(req.query.limit || "48", 10) || 48, 1), 500);
  const hours = Math.min(Math.max(parseInt(req.query.hours || "24", 10) || 24, 1), 720);
  const [rows] = await db.query(
    `SELECT
        id,
        uid,
        account_mode AS accountMode,
        risk_level AS riskLevel,
        position_count AS positionCount,
        total_wallet_balance AS totalWalletBalance,
        total_unrealized_profit AS totalUnrealizedProfit,
        total_margin_balance AS totalMarginBalance,
        total_maint_margin AS totalMaintMargin,
        total_initial_margin AS totalInitialMargin,
        total_position_initial_margin AS totalPositionInitialMargin,
        total_open_order_initial_margin AS totalOpenOrderInitialMargin,
        total_cross_wallet_balance AS totalCrossWalletBalance,
        total_cross_un_pnl AS totalCrossUnPnl,
        available_balance AS availableBalance,
        max_withdraw_amount AS maxWithdrawAmount,
        account_equity AS accountEquity,
        account_maint_margin AS accountMaintMargin,
        account_margin_ratio AS accountMarginRatio,
        account_initial_margin_ratio AS accountInitialMarginRatio,
        account_open_order_margin_ratio AS accountOpenOrderMarginRatio,
        account_margin_buffer AS accountMarginBuffer,
        created_at AS createdAt
      FROM account_risk_snapshot
      WHERE uid = ? AND created_at >= ?
      ORDER BY id DESC
      LIMIT ?`,
    [userId, dayjs().subtract(hours, "hour").format("YYYY-MM-DD HH:mm:ss"), limit]
  );
  return res.send(decorateAccountRiskRows(rows));
});

router.get("/runtime/account-risk/summary", async (req, res) => {
  const userId = req.decoded.userId;
  const hours = Math.min(Math.max(parseInt(req.query.hours || "24", 10) || 24, 1), 720);
  const since = dayjs().subtract(hours, "hour").format("YYYY-MM-DD HH:mm:ss");
  const [overviewRows] = await db.query(
    `SELECT
        COUNT(*) AS snapshotCount,
        MAX(account_margin_ratio) AS maxAccountMarginRatio,
        AVG(account_margin_ratio) AS avgAccountMarginRatio,
        MIN(account_equity) AS minAccountEquity,
        MAX(account_maint_margin) AS maxAccountMaintMargin,
        MIN(account_margin_buffer) AS minAccountMarginBuffer,
        MAX(position_count) AS maxPositionCount,
        MAX(created_at) AS lastCreatedAt
      FROM account_risk_snapshot
      WHERE uid = ? AND created_at >= ?`,
    [userId, since]
  );
  const [levelRows] = await db.query(
    `SELECT
        risk_level AS riskLevel,
        COUNT(*) AS snapshotCount,
        MAX(created_at) AS lastCreatedAt
      FROM account_risk_snapshot
      WHERE uid = ? AND created_at >= ?
      GROUP BY risk_level
      ORDER BY snapshotCount DESC, risk_level ASC`,
    [userId, since]
  );

  const latest = await coin.getBinanceAccountRiskCurrent(userId, {
    persist: true,
    maxAgeMs: 10000,
  });

  return res.send({
    hours,
    latest: decorateAccountRiskRow(latest),
    overview: overviewRows?.[0] || {
      snapshotCount: 0,
      maxAccountMarginRatio: 0,
      avgAccountMarginRatio: 0,
      minAccountEquity: 0,
      maxAccountMaintMargin: 0,
      minAccountMarginBuffer: 0,
      maxPositionCount: 0,
      lastCreatedAt: null,
    },
    riskLevels: decorateAccountRiskRows(levelRows),
  });
});

router.get("/policy/rules", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "정책 관리 권한이 없습니다.");
  }

  const scopeType = String(req.query.scopeType || "").trim().toUpperCase() || undefined;
  const rows = await policyEngine.loadPolicyRules({
    scopeType,
    enabledOnly: false,
    scopeTarget: req.query.scopeTarget || "*",
  });

  return res.send(decoratePolicyRuleRows(rows));
});

router.get("/policy/evals/recent", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "정책 관제 권한이 없습니다.");
  }

  const rows = await policyEngine.listPolicyEvalLogs({
    uid: req.query.uid ? parseInt(req.query.uid, 10) : null,
    pid: req.query.pid ? parseInt(req.query.pid, 10) : null,
    ruleCode: req.query.ruleCode || null,
    scopeType: req.query.scopeType ? String(req.query.scopeType).trim().toUpperCase() : null,
    severity: req.query.severity || null,
    matched:
      req.query.matched === undefined
        ? null
        : ["Y", "TRUE", "1"].includes(String(req.query.matched).trim().toUpperCase()),
    limit: req.query.limit || 50,
  });

  return res.send(decoratePolicyEvalRows(rows));
});

router.get("/policy/evals/summary", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "정책 관제 권한이 없습니다.");
  }

  const rows = await policyEngine.summarizePolicyEvalLogs({
    hours: Math.min(Math.max(parseInt(req.query.hours || "24", 10) || 24, 1), 720),
    uid: req.query.uid ? parseInt(req.query.uid, 10) : null,
  });

  return res.send(
    decoratePolicyEvalRows(
      rows.map((row) => ({
        ...row,
        id: `${row.ruleCode}:${row.scopeType}:${row.severity}:${row.matched}`,
        reasonCode: null,
        reasonText: null,
        recommendedAction: null,
        actualAction: null,
        snapshot: null,
      }))
    )
  );
});

router.get("/policy/actions/recent", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "정책 관제 권한이 없습니다.");
  }

  const rows = await policyEngine.listPolicyActionLogs({
    hours: Math.min(Math.max(parseInt(req.query.hours || "24", 10) || 24, 1), 720),
    uid: req.query.uid ? parseInt(req.query.uid, 10) : null,
    pid: req.query.pid ? parseInt(req.query.pid, 10) : null,
    ruleCode: req.query.ruleCode || null,
    status: req.query.status || null,
    limit: req.query.limit || 50,
  });

  return res.send(decoratePolicyActionRows(rows));
});

router.get("/policy/actions/summary", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "정책 관제 권한이 없습니다.");
  }

  const rows = await policyEngine.summarizePolicyActionLogs({
    hours: Math.min(Math.max(parseInt(req.query.hours || "24", 10) || 24, 1), 720),
    uid: req.query.uid ? parseInt(req.query.uid, 10) : null,
  });

  return res.send(
    decoratePolicyActionRows(
      rows.map((row) => ({
        ...row,
        id: `${row.ruleCode}:${row.actionType}:${row.actionMode}:${row.status}`,
        note: null,
        result: null,
      }))
    )
  );
});

router.post("/policy/rules/update", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "정책 관리 권한이 없습니다.");
  }

  const ruleId = Number(req.body.id || 0);
  if (!ruleId) {
    return sendRouteError(res, 400, "수정할 정책 id가 필요합니다.");
  }

  const currentRows = await policyEngine.loadPolicyRules({ enabledOnly: false });
  const currentRule = currentRows.find((item) => Number(item.id) === ruleId);
  if (!currentRule) {
    return sendRouteError(res, 404, "수정할 정책을 찾을 수 없습니다.");
  }

  const nextEnabled =
    req.body.enabled === undefined ? currentRule.enabled : (["Y", "TRUE", "1"].includes(String(req.body.enabled).trim().toUpperCase()) ? "Y" : "N");
  const nextMode =
    req.body.mode === undefined
      ? String(currentRule.mode || "DRY_RUN").trim().toUpperCase()
      : String(req.body.mode || "DRY_RUN").trim().toUpperCase();
  const nextPriority =
    req.body.priority === undefined ? Number(currentRule.priority || 100) : Number(req.body.priority || currentRule.priority || 100);
  const nextSeverity =
    req.body.severity === undefined
      ? String(currentRule.severity || "low").trim().toLowerCase()
      : String(req.body.severity || currentRule.severity || "low").trim().toLowerCase();
  const nextDryRun =
    req.body.dryRun === undefined ? (nextMode === "DRY_RUN" ? "Y" : String(currentRule.dryRun || "Y").trim().toUpperCase()) : (["Y", "TRUE", "1"].includes(String(req.body.dryRun).trim().toUpperCase()) ? "Y" : "N");
  const nextConfig =
    req.body.config === undefined
      ? (currentRule.config || {})
      : (typeof req.body.config === "object" && req.body.config !== null ? req.body.config : currentRule.config || {});

  await db.query(
    `UPDATE policy_rule
     SET enabled = ?, mode = ?, dry_run = ?, priority = ?, severity = ?, config_json = ?, updated_by = ?
     WHERE id = ?
     LIMIT 1`,
    [
      nextEnabled,
      nextMode,
      nextDryRun,
      Number.isFinite(nextPriority) ? nextPriority : Number(currentRule.priority || 100),
      nextSeverity,
      JSON.stringify(nextConfig || {}),
      userId,
      ruleId,
    ]
  );

  const refreshedRows = await policyEngine.loadPolicyRules({ enabledOnly: false });
  const updatedRule = refreshedRows.find((item) => Number(item.id) === ruleId);
  let executionResult = null;
  if (
    updatedRule &&
    String(updatedRule.ruleCode || "").toUpperCase() === "GLOBAL_KILL_SWITCH" &&
    String(updatedRule.enabled || "").toUpperCase() === "Y" &&
    !updatedRule.isDryRun
  ) {
    executionResult = await policyEngine.executeGlobalKillSwitch({
      rule: updatedRule,
      actorId: userId,
      note: updatedRule.config?.note || "관리자에 의해 글로벌 kill-switch가 활성화되었습니다.",
    });
  }

  return res.send({
    ...decoratePolicyRuleRow(updatedRule || currentRule),
    executionResult,
  });
});

router.get("/policy/preview/user", async (req, res) => {
  const userId = req.decoded.userId;
  const requestedUid = req.query.uid ? parseInt(req.query.uid, 10) : userId;
  const isSelf = Number(requestedUid) === Number(userId);

  if (!isSelf) {
    const accessMember = await loadOpsAccessMember(userId);
    if (accessMember === null) {
      return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
    }
    if (accessMember === false) {
      return sendRouteError(res, 403, "정책 관제 권한이 없습니다.");
    }
  }

  const snapshot = await coin.getBinanceAccountRiskCurrent(requestedUid, {
    persist: true,
    maxAgeMs: 10000,
  });
  const preview = await policyEngine.buildUserPolicyPreview({
    uid: requestedUid,
    snapshot,
    persist: true,
  });
  const [recent, recentActions] = await Promise.all([
    policyEngine.listPolicyEvalLogs({
      uid: requestedUid,
      limit: 20,
    }),
    policyEngine.listPolicyActionLogs({
      uid: requestedUid,
      limit: 20,
    }),
  ]);

  return res.send({
    ...preview,
    latestRisk: decorateAccountRiskRow(snapshot),
    accountEvaluations: decoratePolicyEvalRows(preview.accountEvaluations),
    strategyEvaluations: decoratePolicyEvalRows(preview.strategyEvaluations),
    recentEvaluations: decoratePolicyEvalRows(recent),
    recentActions: decoratePolicyActionRows(recentActions),
  });
});

router.get("/runtime/ops/overview", async (req, res) => {
  const userId = req.decoded.userId;
  const hours = Math.min(Math.max(parseInt(req.query.hours || "24", 10) || 24, 1), 720);
  const since = dayjs().subtract(hours, "hour").format("YYYY-MM-DD HH:mm:ss");

  const [health, reconcile, accountRisk, summaryRows, recentHighRows, policyWarningRows, policyWarningSummaryRows, killSwitchState] = await Promise.all([
    coin.getBinanceRuntimeHealth(userId),
    coin.getBinanceRuntimeReconciliation(userId),
    coin.getBinanceAccountRiskCurrent(userId, {
      persist: true,
      maxAgeMs: 10000,
    }),
    db.query(
      `SELECT severity, COUNT(*) AS eventCount, MAX(created_at) AS lastCreatedAt
       FROM binance_runtime_event_log
       WHERE uid = ? AND created_at >= ?
       GROUP BY severity`,
      [userId, since]
    ),
    db.query(
      `SELECT
          id,
          uid,
          pid,
          strategy_category AS strategyCategory,
          event_type AS eventType,
          event_code AS eventCode,
          severity,
          symbol,
          side,
          position_side AS positionSide,
          client_order_id AS clientOrderId,
          client_algo_id AS clientAlgoId,
          order_id AS orderId,
          algo_id AS algoId,
          actual_order_id AS actualOrderId,
          execution_type AS executionType,
          order_status AS orderStatus,
          algo_status AS algoStatus,
          reject_reason AS rejectReason,
          expire_reason AS expireReason,
          order_type AS orderType,
          orig_type AS origType,
          quantity,
          executed_qty AS executedQty,
          avg_price AS avgPrice,
          last_price AS lastPrice,
          event_time AS eventTime,
          trade_time AS tradeTime,
          note,
          created_at AS createdAt
        FROM binance_runtime_event_log
        WHERE uid = ? AND created_at >= ? AND severity = 'high'
        ORDER BY id DESC
        LIMIT 10`,
      [userId, since]
    ),
    policyEngine.listMatchedPolicyWarnings({
      hours,
      uid: userId,
      limit: 10,
    }),
    policyEngine.summarizeMatchedPolicyWarnings({
      hours,
      uid: userId,
    }),
    policyEngine.getGlobalKillSwitchState(),
  ]);

  const severityRows = summaryRows?.[0] || [];
  const eventCounts = {
    highSeverityCount24h: Number(severityRows.find((item) => item.severity === "high")?.eventCount || 0),
    mediumSeverityCount24h: Number(severityRows.find((item) => item.severity === "medium")?.eventCount || 0),
    lowSeverityCount24h: Number(severityRows.find((item) => item.severity === "low")?.eventCount || 0),
    lastHighSeverityAt: severityRows.find((item) => item.severity === "high")?.lastCreatedAt || null,
    lastMediumSeverityAt: severityRows.find((item) => item.severity === "medium")?.lastCreatedAt || null,
  };

  const decoratedHealth = decorateBinanceRuntimeHealth(health);
  const decoratedReconcile = decorateBinanceRuntimeReconciliation(reconcile);
  const decoratedAccountRisk = decorateAccountRiskRow(accountRisk);
  const decoratedRecentHighEvents = decorateBinanceRuntimeEventRows(recentHighRows?.[0] || []);
  const decoratedPolicyWarnings = decoratePolicyEvalRows(policyWarningRows);
  const policyWarningCounts = buildPolicyWarningCounts(policyWarningSummaryRows);

  return res.send({
    hours,
    health: decoratedHealth,
    reconcile: decoratedReconcile,
    accountRisk: decoratedAccountRisk,
    eventCounts,
    policyWarnings: decoratedPolicyWarnings,
    policyWarningCounts,
    recentHighEvents: decoratedRecentHighEvents,
    killSwitchState,
    actionItems: buildRuntimeOpsActionItems({
      health: decoratedHealth,
      reconcile: decoratedReconcile,
      accountRisk: decoratedAccountRisk,
      eventCounts,
      policyWarnings: decoratedPolicyWarnings,
      policyWarningCounts,
      recentHighEvents: decoratedRecentHighEvents,
      killSwitchState,
    }),
  });
});

router.get("/runtime/ops/users/overview", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "운영 관제 권한이 없습니다.");
  }

  const hours = Math.min(Math.max(parseInt(req.query.hours || "24", 10) || 24, 1), 720);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "30", 10) || 30, 1), 200);
  const since = dayjs().subtract(hours, "hour").format("YYYY-MM-DD HH:mm:ss");

  const [memberRows] = await db.query(
    `SELECT id, mem_id AS memId, mem_name AS memName, grade, email, appKey, appSecret
     FROM admin_member
     ORDER BY id DESC
     LIMIT ?`,
    [limit]
  );

  const [riskRows] = await db.query(
    `SELECT
        t.uid,
        t.account_mode AS accountMode,
        t.risk_level AS riskLevel,
        t.position_count AS positionCount,
        t.account_equity AS accountEquity,
        t.account_maint_margin AS accountMaintMargin,
        t.account_margin_ratio AS accountMarginRatio,
        t.account_margin_buffer AS accountMarginBuffer,
        t.available_balance AS availableBalance,
        t.total_unrealized_profit AS totalUnrealizedProfit,
        t.created_at AS createdAt
      FROM account_risk_snapshot t
      INNER JOIN (
        SELECT uid, MAX(id) AS maxId
        FROM account_risk_snapshot
        GROUP BY uid
      ) latest ON latest.maxId = t.id`
  );

  const [eventRows] = await db.query(
    `SELECT
        uid,
        SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS highSeverityCount24h,
        SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) AS mediumSeverityCount24h,
        SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) AS lowSeverityCount24h,
        MAX(created_at) AS lastEventAt
      FROM binance_runtime_event_log
      WHERE created_at >= ?
      GROUP BY uid`,
    [since]
  );

  const [policyWarningSummaryRows, killSwitchState] = await Promise.all([
    policyEngine.summarizeMatchedPolicyWarnings({
      hours,
    }),
    policyEngine.getGlobalKillSwitchState(),
  ]);

  const riskMap = new Map(riskRows.map((item) => [String(item.uid), decorateAccountRiskRow(item)]));
  const eventMap = new Map(eventRows.map((item) => [String(item.uid), item]));
  const policyCountMap = new Map();
  (Array.isArray(policyWarningSummaryRows) ? policyWarningSummaryRows : []).forEach((row) => {
    const uidKey = String(row.uid || "");
    if (!uidKey) {
      return;
    }
    const current = policyCountMap.get(uidKey) || { total: 0, high: 0, medium: 0, low: 0, lastCreatedAt: null };
    const severity = String(row.severity || "").trim().toLowerCase();
    const count = Number(row.warningCount || 0);
    current.total += count;
    if (severity === "high") {
      current.high += count;
    } else if (severity === "medium") {
      current.medium += count;
    } else {
      current.low += count;
    }
    if (row.lastCreatedAt && (!current.lastCreatedAt || new Date(row.lastCreatedAt) > new Date(current.lastCreatedAt))) {
      current.lastCreatedAt = row.lastCreatedAt;
    }
    policyCountMap.set(uidKey, current);
  });

  const items = await Promise.all(
    memberRows.map(async (member) => {
      const uid = Number(member.id);
      const health = decorateBinanceRuntimeHealth(await coin.getBinanceRuntimeHealth(uid));
      let reconcile = { summary: { totalIssueCount: 0 }, signalIssues: [], gridIssues: [] };
      try {
        const payload = await coin.getBinanceRuntimeReconciliation(uid);
        reconcile = decorateBinanceRuntimeReconciliation(payload);
      } catch (error) {
        reconcile = {
          summary: { totalIssueCount: 0 },
          signalIssues: [],
          gridIssues: [],
          reconcileError: error.message || "reconcile failed",
        };
      }

      const risk = mergeAccountRiskWithHealth(
        riskMap.get(String(uid)) || decorateAccountRiskRow({
          uid,
          riskLevel: "UNKNOWN",
          accountEquity: 0,
          accountMaintMargin: 0,
          accountMarginRatio: 0,
          accountMarginBuffer: 0,
          positionCount: 0,
          createdAt: null,
        }),
        health
      );
      const eventCounts = eventMap.get(String(uid)) || {
        highSeverityCount24h: 0,
        mediumSeverityCount24h: 0,
        lowSeverityCount24h: 0,
        lastEventAt: null,
      };
      const policyCounts = policyCountMap.get(String(uid)) || {
        total: 0,
        high: 0,
        medium: 0,
        low: 0,
        lastCreatedAt: null,
      };

      const totalIssueCount = Number(reconcile?.summary?.totalIssueCount || 0);
      const priorityScore = getOpsPriorityScore({
        health,
        risk,
        eventCounts,
        policyCounts,
        issueCount: totalIssueCount,
        killSwitchState,
      });

      return {
        uid,
        memId: member.memId,
        memName: member.memName,
        email: member.email,
        grade: member.grade,
        hasCredentials: Boolean(member.appKey && member.appSecret),
        health,
        risk,
        eventCounts,
        policyWarningCounts: policyCounts,
        issueSummary: {
          signalIssueCount: Number(reconcile?.summary?.signalIssueCount || 0),
          gridIssueCount: Number(reconcile?.summary?.gridIssueCount || 0),
          totalIssueCount,
        },
        priorityScore,
        priorityLabel: getOpsPriorityLabel(priorityScore),
        actionItems: buildOpsUserActionItems({
          health,
          reconcile: {
            totalIssueCount,
          },
          risk,
          eventCounts,
          policyCounts,
          killSwitchState,
        }),
      };
    })
  );

  items.sort((a, b) => b.priorityScore - a.priorityScore || a.uid - b.uid);

  return res.send({
    hours,
    itemCount: items.length,
    summary: {
      userCount: items.length,
      criticalRiskCount: items.filter((item) => item.risk.riskLevel === "CRITICAL").length,
      dangerRiskCount: items.filter((item) => item.risk.riskLevel === "DANGER").length,
      actionRequiredCount: items.filter((item) => item.priorityScore >= 20).length,
      disconnectedCount: items.filter((item) => String(item.health.status || "").toUpperCase() !== "CONNECTED").length,
      policyHighWarningUserCount: items.filter((item) => Number(item.policyWarningCounts?.high || 0) > 0).length,
      policyMatchedUserCount: items.filter((item) => Number(item.policyWarningCounts?.total || 0) > 0).length,
      killSwitchActive: Boolean(killSwitchState?.active),
    },
    killSwitchState,
    item: items,
  });
});

router.get("/runtime/ops/users/item", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "운영 관제 권한이 없습니다.");
  }

  const targetUid = parseInt(req.query.uid || "0", 10);
  if (!targetUid) {
    return sendRouteError(res, 400, "조회할 uid가 필요합니다.");
  }

  const hours = Math.min(Math.max(parseInt(req.query.hours || "24", 10) || 24, 1), 720);
  const since = dayjs().subtract(hours, "hour").format("YYYY-MM-DD HH:mm:ss");
  const member = await dbcon.DBOneCall(`CALL SP_A_MEMBER_GET(?)`, [targetUid]);
  if (!member) {
    return sendRouteError(res, 404, "조회할 회원을 찾을 수 없습니다.");
  }

  const [health, reconcile, latestRisk, recentHighRows, policyWarnings, policyWarningSummaryRows, recentPolicyActions, killSwitchState] = await Promise.all([
    coin.getBinanceRuntimeHealth(targetUid),
    coin.getBinanceRuntimeReconciliation(targetUid).catch((error) => ({
      checkedAt: new Date().toISOString(),
      uid: targetUid,
      health: {},
      signalIssues: [],
      gridIssues: [],
      summary: {
        signalIssueCount: 0,
        gridIssueCount: 0,
        totalIssueCount: 0,
      },
      reconcileError: error.message || "reconcile failed",
    })),
    coin.getBinanceAccountRiskCurrent(targetUid, {
      persist: true,
      maxAgeMs: 10000,
    }).catch(() => ({
      uid: targetUid,
      riskLevel: "UNKNOWN",
      accountEquity: 0,
      accountMaintMargin: 0,
      accountMarginRatio: 0,
      accountMarginBuffer: 0,
      positionCount: 0,
      capturedAt: null,
    })),
    db.query(
      `SELECT
          id,
          uid,
          pid,
          strategy_category AS strategyCategory,
          event_type AS eventType,
          event_code AS eventCode,
          severity,
          symbol,
          side,
          position_side AS positionSide,
          client_order_id AS clientOrderId,
          client_algo_id AS clientAlgoId,
          order_id AS orderId,
          algo_id AS algoId,
          actual_order_id AS actualOrderId,
          execution_type AS executionType,
          order_status AS orderStatus,
          algo_status AS algoStatus,
          reject_reason AS rejectReason,
          expire_reason AS expireReason,
          order_type AS orderType,
          orig_type AS origType,
          quantity,
          executed_qty AS executedQty,
          avg_price AS avgPrice,
          last_price AS lastPrice,
          event_time AS eventTime,
          trade_time AS tradeTime,
          note,
          created_at AS createdAt
        FROM binance_runtime_event_log
        WHERE uid = ? AND created_at >= ? AND severity = 'high'
        ORDER BY id DESC
        LIMIT 20`,
      [targetUid, since]
    ),
    policyEngine.listMatchedPolicyWarnings({
      hours,
      uid: targetUid,
      limit: 20,
    }),
    policyEngine.summarizeMatchedPolicyWarnings({
      hours,
      uid: targetUid,
    }),
    policyEngine.listPolicyActionLogs({
      hours,
      uid: targetUid,
      limit: 20,
    }),
    policyEngine.getGlobalKillSwitchState(),
  ]);

  const decoratedHealth = decorateBinanceRuntimeHealth(health);
  const decoratedReconcile = decorateBinanceRuntimeReconciliation(reconcile);
  const decoratedLatestRisk = decorateAccountRiskRow(latestRisk);
  const decoratedRecentHighEvents = decorateBinanceRuntimeEventRows(recentHighRows?.[0] || []);
  const decoratedPolicyWarnings = decoratePolicyEvalRows(policyWarnings);
  const policyWarningCounts = buildPolicyWarningCounts(policyWarningSummaryRows);
  const totalIssueCount = Number(decoratedReconcile?.summary?.totalIssueCount || 0);
  const priorityScore = getOpsPriorityScore({
    health: decoratedHealth,
    risk: decoratedLatestRisk,
    eventCounts: {
      highSeverityCount24h: decoratedRecentHighEvents.length,
      mediumSeverityCount24h: 0,
      lowSeverityCount24h: 0,
    },
    issueCount: totalIssueCount,
    policyCounts: policyWarningCounts,
    killSwitchState,
  });

  return res.send({
    hours,
    member: {
      id: member.id,
      memId: member.mem_id,
      memName: member.mem_name,
      grade: member.grade,
      email: member.email,
      hasCredentials: Boolean(member.appKey && member.appSecret),
    },
    health: decoratedHealth,
    reconcile: decoratedReconcile,
    latestRisk: decoratedLatestRisk,
    recentHighEvents: decoratedRecentHighEvents,
    policyWarnings: decoratedPolicyWarnings,
    policyWarningCounts,
    recentPolicyActions: decoratePolicyActionRows(recentPolicyActions),
    killSwitchState,
    priorityScore,
    priorityLabel: getOpsPriorityLabel(priorityScore),
    actionItems: buildOpsUserActionItems({
      health: decoratedHealth,
      reconcile: {
        totalIssueCount,
      },
      risk: decoratedLatestRisk,
      eventCounts: {
        highSeverityCount24h: decoratedRecentHighEvents.length,
        mediumSeverityCount24h: 0,
        lowSeverityCount24h: 0,
      },
      policyWarnings: decoratedPolicyWarnings,
      policyCounts: policyWarningCounts,
      killSwitchState,
    }),
    recentWebhookEvents: decorateWebhookTargetRows(
      await db.query(
        `SELECT
            id,
            event_id AS eventId,
            uid,
            pid,
            strategy_category AS strategyCategory,
            strategy_mode AS strategyMode,
            strategy_name AS strategyName,
            strategy_key AS strategyKey,
            strategy_uuid AS strategyUuid,
            symbol,
            bunbong,
            legacy_status AS legacyStatus,
            regime_status AS regimeStatus,
            control_state AS controlState,
            auto_st AS autoST,
            incoming_signal_type AS incomingSignalType,
            runtime_signal_type AS runtimeSignalType,
            result_code AS resultCode,
            severity,
            ops_status AS opsStatus,
            ops_note AS opsNote,
            ops_updated_by AS opsUpdatedBy,
            ops_updated_at AS opsUpdatedAt,
            note,
            payload_json AS payloadJson,
            created_at AS createdAt
          FROM webhook_event_target_log
          WHERE uid = ?
          ORDER BY id DESC
          LIMIT 20`,
        [targetUid]
      ).then(([rows]) => rows || [])
    ),
    recentWebhookEventsNote: "webhook_event_target_log 기준으로 최근 사용자/전략 매칭 결과를 표시합니다.",
  });
});

router.get("/runtime/binance/events/recent", async (req, res) => {
  const userId = req.decoded.userId;
  const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10) || 50, 1), 200);
  const eventType = String(req.query.eventType || "").trim().toUpperCase();
  const severity = String(req.query.severity || "").trim().toLowerCase();
  const strategyCategory = String(req.query.category || "").trim().toLowerCase();
  const where = ["uid = ?"];
  const params = [userId];

  if (eventType) {
    where.push("event_type = ?");
    params.push(eventType);
  }

  if (severity) {
    where.push("severity = ?");
    params.push(severity);
  }

  if (strategyCategory) {
    where.push("strategy_category = ?");
    params.push(strategyCategory);
  }

  params.push(limit);

  const [rows] = await db.query(
    `SELECT
        id,
        uid,
        pid,
        strategy_category AS strategyCategory,
        event_type AS eventType,
        event_code AS eventCode,
        severity,
        symbol,
        side,
        position_side AS positionSide,
        client_order_id AS clientOrderId,
        client_algo_id AS clientAlgoId,
        order_id AS orderId,
        algo_id AS algoId,
        actual_order_id AS actualOrderId,
        execution_type AS executionType,
        order_status AS orderStatus,
        algo_status AS algoStatus,
        reject_reason AS rejectReason,
        expire_reason AS expireReason,
        order_type AS orderType,
        orig_type AS origType,
        quantity,
        executed_qty AS executedQty,
        avg_price AS avgPrice,
        last_price AS lastPrice,
        event_time AS eventTime,
        trade_time AS tradeTime,
        note,
        created_at AS createdAt
      FROM binance_runtime_event_log
      WHERE ${where.join(" AND ")}
      ORDER BY id DESC
      LIMIT ?`,
    params
  );

  return res.send(decorateBinanceRuntimeEventRows(rows));
});

router.get("/runtime/binance/events/item", async (req, res) => {
  const userId = req.decoded.userId;
  const id = parseInt(req.query.id || "0", 10);
  if (!id) {
    return sendRouteError(res, 400, "조회할 Binance 이벤트 로그 id가 필요합니다.");
  }

  const [rows] = await db.query(
    `SELECT
        id,
        uid,
        pid,
        strategy_category AS strategyCategory,
        event_type AS eventType,
        event_code AS eventCode,
        severity,
        symbol,
        side,
        position_side AS positionSide,
        client_order_id AS clientOrderId,
        client_algo_id AS clientAlgoId,
        order_id AS orderId,
        algo_id AS algoId,
        actual_order_id AS actualOrderId,
        execution_type AS executionType,
        order_status AS orderStatus,
        algo_status AS algoStatus,
        reject_reason AS rejectReason,
        expire_reason AS expireReason,
        order_type AS orderType,
        orig_type AS origType,
        quantity,
        executed_qty AS executedQty,
        avg_price AS avgPrice,
        last_price AS lastPrice,
        event_time AS eventTime,
        trade_time AS tradeTime,
        note,
        payload_json AS payloadJson,
        created_at AS createdAt
      FROM binance_runtime_event_log
      WHERE id = ? AND uid = ?
      LIMIT 1`,
    [id, userId]
  );

  if (!rows.length) {
    return sendRouteError(res, 404, "Binance 이벤트 로그를 찾을 수 없습니다.");
  }

  const item = rows[0];
  try {
    item.payloadJson = item.payloadJson ? JSON.parse(item.payloadJson) : null;
  } catch (error) {
  }

  return res.send(decorateBinanceRuntimeEventRow(item));
});

router.get("/runtime/binance/events/summary", async (req, res) => {
  const userId = req.decoded.userId;
  const hours = Math.min(Math.max(parseInt(req.query.hours || "24", 10) || 24, 1), 168);
  const strategyCategory = String(req.query.category || "").trim().toLowerCase();
  const where = ["uid = ?", "created_at >= ?"];
  const params = [userId, dayjs().subtract(hours, "hour").format("YYYY-MM-DD HH:mm:ss")];

  if (strategyCategory) {
    where.push("strategy_category = ?");
    params.push(strategyCategory);
  }

  const [rows] = await db.query(
    `SELECT
        strategy_category AS strategyCategory,
        event_type AS eventType,
        event_code AS eventCode,
        severity,
        COUNT(*) AS eventCount,
        MAX(created_at) AS lastCreatedAt
      FROM binance_runtime_event_log
      WHERE ${where.join(" AND ")}
      GROUP BY strategy_category, event_type, event_code, severity
      ORDER BY eventCount DESC, severity DESC, event_type ASC, event_code ASC`,
    params
  );

  return res.send(decorateBinanceRuntimeEventRows(rows));
});

router.get("/runtime/binance/order-monitor/recent", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "운영 관제 권한이 없습니다.");
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit || "100", 10) || 100, 1), 300);
  const uid = parseInt(req.query.uid || "0", 10);
  const pid = parseInt(req.query.pid || "0", 10);
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  const strategyCategory = String(req.query.category || "").trim().toLowerCase();
  const eventType = String(req.query.eventType || "").trim().toUpperCase();
  const severity = String(req.query.severity || "").trim().toLowerCase();
  const abnormalOnly =
    req.query.abnormalOnly === undefined
      ? false
      : ["Y", "TRUE", "1"].includes(String(req.query.abnormalOnly).trim().toUpperCase());

  const where = [];
  const params = [];

  if (uid) {
    where.push("uid = ?");
    params.push(uid);
  }
  if (pid) {
    where.push("pid = ?");
    params.push(pid);
  }
  if (symbol) {
    where.push("symbol = ?");
    params.push(symbol);
  }
  if (strategyCategory) {
    where.push("strategy_category = ?");
    params.push(strategyCategory);
  }
  if (eventType) {
    where.push("event_type = ?");
    params.push(eventType);
  }
  if (severity) {
    where.push("severity = ?");
    params.push(severity);
  }
  const fetchLimit = abnormalOnly ? Math.min(limit * 5, 1000) : limit;
  params.push(fetchLimit);

  const [rows] = await db.query(
    `SELECT
        id,
        uid,
        pid,
        strategy_category AS strategyCategory,
        event_type AS eventType,
        event_code AS eventCode,
        severity,
        symbol,
        side,
        position_side AS positionSide,
        client_order_id AS clientOrderId,
        client_algo_id AS clientAlgoId,
        order_id AS orderId,
        algo_id AS algoId,
        actual_order_id AS actualOrderId,
        execution_type AS executionType,
        order_status AS orderStatus,
        algo_status AS algoStatus,
        reject_reason AS rejectReason,
        expire_reason AS expireReason,
        order_type AS orderType,
        orig_type AS origType,
        quantity,
        executed_qty AS executedQty,
        avg_price AS avgPrice,
        last_price AS lastPrice,
        event_time AS eventTime,
        trade_time AS tradeTime,
        note,
        created_at AS createdAt
      FROM binance_runtime_event_log
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC
      LIMIT ?`,
    params
  );

  const withStrategyMeta = await attachStrategyMetaToBinanceEventRows(rows);
  const decoratedRows = decorateBinanceOrderMonitorRows(withStrategyMeta);
  return res.send(abnormalOnly ? decoratedRows.filter((row) => row.attentionRequired).slice(0, limit) : decoratedRows);
});

router.get("/runtime/binance/order-monitor/overview", async (req, res) => {
  try {
    const userId = req.decoded.userId;
    const accessMember = await loadAdminConsoleAccessMember(userId);
    if (accessMember === null) {
      return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
    }
    if (accessMember === false) {
      return sendRouteError(res, 403, "관리자 권한이 없습니다.");
    }

    const targetUid = parseInt(req.query.uid || userId || "0", 10);
    const rawLimit = Math.min(Math.max(parseInt(req.query.rawLimit || "120", 10) || 120, 1), 300);
    const symbols = String(req.query.symbols || "")
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);
    const payload = await adminOrderMonitor.buildAdminOrderMonitor(targetUid, {
      rawLimit,
      symbols,
    });
    return res.send(payload);
  } catch (error) {
    console.error("[ADMIN_ORDER_MONITOR_OVERVIEW]", error);
    return sendRouteError(res, 500, error?.message || "관리자 주문 관제 데이터를 불러오지 못했습니다.");
  }
});

router.get("/runtime/order-process/recent", async (req, res) => {
  try {
    const userId = req.decoded.userId;
    const accessMember = await loadOpsAccessMember(userId);
    if (accessMember === null) {
      return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
    }
    if (accessMember === false) {
      return sendRouteError(res, 403, "운영 관제 권한이 없습니다.");
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit || "80", 10) || 80, 1), 200);
    const uid = parseInt(req.query.uid || "0", 10);
    const pid = parseInt(req.query.pid || "0", 10);
    const symbol = String(req.query.symbol || "").trim().toUpperCase();
    const strategyCategory = String(req.query.category || "").trim().toLowerCase();
    const keyword = String(req.query.keyword || "").trim().toLowerCase();
    const abnormalOnly =
      req.query.abnormalOnly === undefined
        ? false
        : ["Y", "TRUE", "1"].includes(String(req.query.abnormalOnly).trim().toUpperCase());

    const targetRows = await loadOrderProcessTargetRows({
      limit,
      uid,
      pid,
      symbol,
      strategyCategory,
      keyword,
    });
    const nowMs = Date.now();
    const currentItemMap = await loadDecoratedProcessItemsByTargets(targetRows);
    const processRows = await mapAsyncInBatches(
      targetRows,
      (targetRow) =>
        buildOrderProcessRow(targetRow, {
          nowMs,
          includeDetail: false,
          loadFullHistory: false,
          currentItem:
            currentItemMap.get(
              buildProcessItemCacheKey({
                uid: targetRow.uid,
                pid: targetRow.pid,
                strategyCategory: targetRow.strategyCategory,
                mode: targetRow.strategyMode || "live",
              })
            ) || null,
        }),
      10
    );

    const filteredRows = abnormalOnly
      ? processRows.filter((row) => {
          const lifecycleStatus = String(row.lifecycleStatus || row.lifecycleResult || "").trim().toUpperCase();
          const severity = String(row.severity || "").trim().toUpperCase();
          if (row.isExpectedIgnore || lifecycleStatus === "EXPECTED" || lifecycleStatus === "RESOLVED") {
            return false;
          }
          return row.currentRisk === true || lifecycleStatus === "CURRENT_RISK" || severity === "CRITICAL" || severity === "WARN";
        })
      : processRows;
    return res.send(filteredRows);
  } catch (error) {
    console.error("[ADMIN_ORDER_PROCESS_RECENT_ERROR]", error);
    return sendRouteError(res, 500, "사용자 주문 로그를 불러오는 중 오류가 발생했습니다.");
  }
});

router.get("/runtime/order-process/item", async (req, res) => {
  try {
    const userId = req.decoded.userId;
    const accessMember = await loadOpsAccessMember(userId);
    if (accessMember === null) {
      return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
    }
    if (accessMember === false) {
      return sendRouteError(res, 403, "운영 관제 권한이 없습니다.");
    }

    const targetId = parseInt(req.query.id || "0", 10);
    if (!(targetId > 0)) {
      return sendRouteError(res, 400, "주문 로그 ID가 필요합니다.");
    }

    const targetRows = await loadOrderProcessTargetRows({ targetId });
    const targetRow = targetRows[0] || null;
    if (!targetRow) {
      return sendRouteError(res, 404, "주문 로그를 찾을 수 없습니다.");
    }

    const detailRow = await buildOrderProcessRow(targetRow, {
      nowMs: Date.now(),
      includeDetail: true,
    });

    return res.send(detailRow);
  } catch (error) {
    console.error("[ADMIN_ORDER_PROCESS_ITEM_ERROR]", error);
    return sendRouteError(res, 500, "주문 로그 상세를 불러오는 중 오류가 발생했습니다.");
  }
});

router.get("/live/track-record/runtime/recent", async (req, res) => {
  try {
    const userId = req.decoded.userId;
    const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    const size = Math.min(Math.max(parseInt(req.query.size || "10", 10) || 10, 1), 50);
    const status = normalizeTrackRecordStatusFilter(req.query.status || "completed");
    const sDate = String(req.query.sDate || "").trim();
    const eDate = String(req.query.eDate || "").trim();
    const fetchLimit = Math.min(Math.max(page * size * 4, 60), 200);

    const { rows, summary } = await loadUserTrackRecordRows({
      userId,
      mode: "live",
      status,
      sDate,
      eDate,
      limit: fetchLimit,
    });

    const totalCount = rows.length;
    const totalPage = Math.max(1, Math.ceil(totalCount / size));
    const offset = (page - 1) * size;
    const items = rows.slice(offset, offset + size).map((row) => buildTrackRecordListItem(row));

    return res.send({
      items,
      summary,
      pageInfo: {
        page,
        size,
        totalCount,
        totalPage,
      },
    });
  } catch (error) {
    console.error("[LIVE_TRACK_RECORD_RUNTIME_RECENT_ERROR]", error);
    return sendRouteError(res, 500, "라이브 트랙레코드를 불러오는 중 오류가 발생했습니다.");
  }
});

router.get("/live/track-record/runtime/item", async (req, res) => {
  const userId = req.decoded.userId;
  const targetId = parseInt(req.query.id || "0", 10);
  if (!(targetId > 0)) {
    return sendRouteError(res, 400, "트랙레코드 ID가 필요합니다.");
  }

  const targetRows = await loadOrderProcessTargetRows({
    targetId,
    uid: userId,
    strategyMode: "live",
  });
  const targetRow = targetRows[0] || null;
  if (!targetRow) {
    return sendRouteError(res, 404, "트랙레코드를 찾을 수 없습니다.");
  }

  const detailRow = await buildOrderProcessRow(targetRow, {
    nowMs: Date.now(),
    includeDetail: true,
  });

  return res.send(buildTrackRecordDetailItem(detailRow));
});

router.get("/test/track-record/runtime/recent", async (req, res) => {
  try {
    const userId = req.decoded.userId;
    const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    const size = Math.min(Math.max(parseInt(req.query.size || "10", 10) || 10, 1), 50);
    const status = normalizeTrackRecordStatusFilter(req.query.status || "completed");
    const sDate = String(req.query.sDate || "").trim();
    const eDate = String(req.query.eDate || "").trim();
    const fetchLimit = Math.min(Math.max(page * size * 4, 60), 200);

    const { rows, summary } = await loadUserTrackRecordRows({
      userId,
      mode: "test",
      status,
      sDate,
      eDate,
      limit: fetchLimit,
    });

    const totalCount = rows.length;
    const totalPage = Math.max(1, Math.ceil(totalCount / size));
    const offset = (page - 1) * size;
    const items = rows.slice(offset, offset + size).map((row) => buildTrackRecordListItem(row));

    return res.send({
      items,
      summary,
      pageInfo: {
        page,
        size,
        totalCount,
        totalPage,
      },
    });
  } catch (error) {
    console.error("[TEST_TRACK_RECORD_RUNTIME_RECENT_ERROR]", error);
    return sendRouteError(res, 500, "데모 트랙레코드를 불러오는 중 오류가 발생했습니다.");
  }
});

router.get("/test/track-record/runtime/item", async (req, res) => {
  const userId = req.decoded.userId;
  const targetId = parseInt(req.query.id || "0", 10);
  if (!(targetId > 0)) {
    return sendRouteError(res, 400, "트랙레코드 ID가 필요합니다.");
  }

  const targetRows = await loadOrderProcessTargetRows({
    targetId,
    uid: userId,
    strategyMode: "test",
  });
  const targetRow = targetRows[0] || null;
  if (!targetRow) {
    return sendRouteError(res, 404, "트랙레코드를 찾을 수 없습니다.");
  }

  const detailRow = await buildOrderProcessRow(targetRow, {
    nowMs: Date.now(),
    includeDetail: true,
  });

  return res.send(buildTrackRecordDetailItem(detailRow));
});

router.get("/system/logs/recent", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "운영 관제 권한이 없습니다.");
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit || "120", 10) || 120, 1), 300);
  const category = String(req.query.category || "").trim().toUpperCase();
  const uid = parseInt(req.query.uid || "0", 10);
  const pid = parseInt(req.query.pid || "0", 10);
  const keyword = String(req.query.keyword || "").trim().toLowerCase();
  const abnormalOnly =
    req.query.abnormalOnly === undefined
      ? true
      : ["Y", "TRUE", "1"].includes(String(req.query.abnormalOnly).trim().toUpperCase());

  const whereWebhook = [`hook_category = 'backtest'`];
  const webhookParams = [];
  if (keyword) {
    whereWebhook.push(`(
      LOWER(COALESCE(result_code,'')) LIKE ?
      OR LOWER(COALESCE(symbol,'')) LIKE ?
      OR LOWER(COALESCE(note,'')) LIKE ?
    )`);
    webhookParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const whereMsg = [];
  const msgParams = [];
  if (uid) {
    whereMsg.push("uid = ?");
    msgParams.push(uid);
  }
  if (pid) {
    whereMsg.push("pid = ?");
    msgParams.push(pid);
  }
  if (keyword) {
    whereMsg.push(
      `(LOWER(COALESCE(fun,'')) LIKE ? OR LOWER(COALESCE(code,'')) LIKE ? OR LOWER(COALESCE(msg,'')) LIKE ? OR LOWER(COALESCE(symbol,'')) LIKE ?)`
    );
    msgParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const [webhookRows] = await db.query(
    `SELECT
        id,
        result_code AS resultCode,
        symbol,
        bunbong,
        note,
        created_at AS createdAt
      FROM webhook_event_log
      WHERE ${whereWebhook.join(" AND ")}
      ORDER BY id DESC
      LIMIT ?`,
    [...webhookParams, limit]
  );

  const [msgRows] = await db.query(
    `SELECT
        id,
        fun,
        code,
        msg,
        uid,
        pid,
        symbol,
        side,
        created_at AS createdAt
      FROM msg_list
      ${whereMsg.length ? `WHERE ${whereMsg.join(" AND ")}` : ""}
      ORDER BY id DESC
      LIMIT ?`,
    [...msgParams, limit]
  );

  const systemRows = [];

  if (!category || category === "TV_STATS_WEBHOOK") {
    webhookRows.forEach((row) => {
      const abnormal = isSystemWebhookAbnormal(row);
      if (abnormalOnly && !abnormal) {
        return;
      }
      systemRows.push({
        id: `webhook-${row.id}`,
        category: "TV_STATS_WEBHOOK",
        abnormal,
        title: WEBHOOK_RESULT_LABELS[String(row.resultCode || "").trim().toUpperCase()] || row.resultCode,
        detail: `${row.symbol || "-"} / ${row.bunbong || "-"} / ${row.note || "-"}`,
        uid: null,
        pid: null,
        symbol: row.symbol || null,
        createdAt: row.createdAt,
      });
    });
  }

  msgRows.forEach((row) => {
    const resolvedCategory = classifySystemMsgCategory(row.fun);
    if (!resolvedCategory) {
      return;
    }
    if (category && category !== resolvedCategory) {
      return;
    }

    systemRows.push({
      id: `msg-${row.id}`,
      category: resolvedCategory,
      abnormal: true,
      title: row.fun || "system",
      detail: row.msg || row.code || "-",
      uid: row.uid || null,
      pid: row.pid || null,
      symbol: row.symbol || null,
      createdAt: row.createdAt,
    });
  });

  systemRows.sort((a, b) => (normalizeDateMs(b.createdAt) || 0) - (normalizeDateMs(a.createdAt) || 0));
  return res.send(decorateSystemLogRows(systemRows.slice(0, limit)));
});

router.get("/grid/live/list", async (req, res) => {
  const userId = req.decoded.userId;
  const [rows] = await db.query(
    `SELECT * FROM live_grid_strategy_list WHERE uid = ? ORDER BY id DESC`,
    [userId]
  );

  return res.send(await decorateOwnedGridCollection(rows, userId));
});

router.get("/grid/test/list", async (req, res) => {
  const userId = req.decoded.userId;
  const [rows] = await db.query(
    `SELECT * FROM test_grid_strategy_list WHERE uid = ? ORDER BY id DESC`,
    [userId]
  );

  return res.send(await decorateOwnedGridCollection(rows, userId));
});

router.get("/grid/live/detail", async (req, res) => {
  const userId = req.decoded.userId;
  const item = await loadOwnedGridItem("LIVE", req.query.id, userId);

  if (item === null) {
    return sendRouteError(res, 404, "그리드 전략을 찾을 수 없습니다.");
  }

  if (item === false) {
    return sendRouteError(res, 403, "본인 전략만 조회할 수 있습니다.");
  }

  return res.send(await decorateOwnedGridItem(item, userId));
});

router.get("/grid/test/detail", async (req, res) => {
  const userId = req.decoded.userId;
  const item = await loadOwnedGridItem("TEST", req.query.id, userId);

  if (item === null) {
    return sendRouteError(res, 404, "그리드 전략을 찾을 수 없습니다.");
  }

  if (item === false) {
    return sendRouteError(res, 403, "본인 전략만 조회할 수 있습니다.");
  }

  return res.send(await decorateOwnedGridItem(item, userId));
});

router.post("/grid/live/add", validateGridItemAdd, async (req, res) => {
  const userId = req.decoded.userId;
  const payload = normalizeGridPayload(req.body);
  const [result] = await db.query(
    `INSERT INTO live_grid_strategy_list
      (uid, a_name, strategySignal, symbol, bunbong, marginType, margin, leverage, profit, tradeValue, st, autoST, enabled)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      userId,
      payload.a_name,
      payload.strategySignal,
      payload.symbol,
      payload.bunbong,
      payload.marginType,
      payload.margin,
      payload.leverage,
      payload.profit,
      payload.tradeValue,
      null,
      null,
      "N",
    ]
  );

  await writeControlAudit(req, {
    targetUserId: userId,
    strategyCategory: "grid",
    strategyMode: "live",
    pid: result.insertId,
    actionCode: "CREATE",
    previousEnabled: "N",
    nextEnabled: "N",
    note: "grid-created-disabled",
  });

  return res.send({ ok: true, id: result.insertId });
});

router.post("/grid/test/add", validateGridItemAdd, async (req, res) => {
  const userId = req.decoded.userId;
  const payload = normalizeGridPayload(req.body);
  const [result] = await db.query(
    `INSERT INTO test_grid_strategy_list
      (uid, a_name, strategySignal, symbol, bunbong, marginType, margin, leverage, profit, tradeValue, st, autoST, enabled)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      userId,
      payload.a_name,
      payload.strategySignal,
      payload.symbol,
      payload.bunbong,
      payload.marginType,
      payload.margin,
      payload.leverage,
      payload.profit,
      payload.tradeValue,
      null,
      null,
      "N",
    ]
  );

  await writeControlAudit(req, {
    targetUserId: userId,
    strategyCategory: "grid",
    strategyMode: "test",
    pid: result.insertId,
    actionCode: "CREATE",
    previousEnabled: "N",
    nextEnabled: "N",
    note: "grid-created-disabled",
  });

  return res.send({ ok: true, id: result.insertId });
});

router.post("/grid/live/edit", validateGridItemAdd, async (req, res) => {
  const userId = req.decoded.userId;
  const item = await loadOwnedGridItem("LIVE", req.body.id, userId);

  if (item === null) {
    return sendRouteError(res, 404, "그리드 전략을 찾을 수 없습니다.");
  }

  if (item === false) {
    return sendRouteError(res, 403, "본인 전략만 수정할 수 있습니다.");
  }

  const payload = normalizeGridPayload(req.body);
  await db.query(
    `UPDATE live_grid_strategy_list
        SET a_name = ?,
            strategySignal = ?,
            symbol = ?,
            bunbong = ?,
            marginType = ?,
            margin = ?,
            leverage = ?,
            profit = ?,
            tradeValue = ?,
            updatedAt = NOW()
      WHERE id = ? LIMIT 1`,
    [
      payload.a_name,
      payload.strategySignal,
      payload.symbol,
      payload.bunbong,
      payload.marginType,
      payload.margin,
      payload.leverage,
      payload.profit,
      payload.tradeValue,
      req.body.id,
    ]
  );
  await strategyControlState.applyGridControlState({
    mode: "LIVE",
    pid: req.body.id,
    enabled: normalizeEnabledValue(item.enabled),
    regimeEndReason: item.regimeEndReason || null,
  });

  return res.send({ ok: true });
});

router.post("/grid/test/edit", validateGridItemAdd, async (req, res) => {
  const userId = req.decoded.userId;
  const item = await loadOwnedGridItem("TEST", req.body.id, userId);

  if (item === null) {
    return sendRouteError(res, 404, "그리드 전략을 찾을 수 없습니다.");
  }

  if (item === false) {
    return sendRouteError(res, 403, "본인 전략만 수정할 수 있습니다.");
  }

  const payload = normalizeGridPayload(req.body);
  await db.query(
    `UPDATE test_grid_strategy_list
        SET a_name = ?,
            strategySignal = ?,
            symbol = ?,
            bunbong = ?,
            marginType = ?,
            margin = ?,
            leverage = ?,
            profit = ?,
            tradeValue = ?,
            updatedAt = NOW()
      WHERE id = ? LIMIT 1`,
    [
      payload.a_name,
      payload.strategySignal,
      payload.symbol,
      payload.bunbong,
      payload.marginType,
      payload.margin,
      payload.leverage,
      payload.profit,
      payload.tradeValue,
      req.body.id,
    ]
  );
  await strategyControlState.applyGridControlState({
    mode: "TEST",
    pid: req.body.id,
    enabled: normalizeEnabledValue(item.enabled),
    regimeEndReason: item.regimeEndReason || null,
  });

  return res.send({ ok: true });
});

router.post("/grid/live/auto", async (req, res) => {
  return handleGridAutoRoute(req, res, "LIVE");
});

router.post("/grid/test/auto", async (req, res) => {
  return handleGridAutoRoute(req, res, "TEST");
});

router.post("/grid/live/del", async (req, res) => {
  const userId = req.decoded.userId;
  const idList = Array.isArray(req.body.idList) ? req.body.idList : [];
  if (!ensureExplicitStrategyDeleteIntent(res, req.body)) {
    return;
  }

  for (const target of idList) {
    const id = target && typeof target === "object" ? target.id : target;
    const item = await loadOwnedGridItem("LIVE", id, userId);

    if (item === null) {
      return sendRouteError(res, 404, "그리드 전략을 찾을 수 없습니다.");
    }

    if (item === false) {
      return sendRouteError(res, 403, "본인 전략만 삭제할 수 있습니다.");
    }

    if (!canDeleteGridItem(item)) {
      return sendRouteError(
        res,
        409,
        "주문 또는 포지션이 남아 있는 그리드 전략은 삭제할 수 없습니다. OFF 후 대기 상태에서 다시 시도해 주세요."
      );
    }
  }

  for (const target of idList) {
    const id = target && typeof target === "object" ? target.id : target;
    const item = await loadOwnedGridItem("LIVE", id, userId);
    if (item && item !== false) {
      await writeControlAudit(req, {
        targetUserId: item.uid,
        strategyCategory: "grid",
        strategyMode: "live",
        pid: id,
        actionCode: "USER_DELETE_STRATEGY",
        previousEnabled: normalizeEnabledValue(item.enabled),
        nextEnabled: "N",
        note: "grid-deleted",
        metadata: {
          regimeStatus: item.regimeStatus || null,
        },
      });
    }
    await db.query(`DELETE FROM ${getGridTableName("LIVE")} WHERE id = ? AND uid = ? LIMIT 1`, [
      id,
      userId,
    ]);
  }

  return res.send({ ok: true, deletedCount: idList.length });
});

router.post("/grid/test/del", async (req, res) => {
  const userId = req.decoded.userId;
  const idList = Array.isArray(req.body.idList) ? req.body.idList : [];
  if (!ensureExplicitStrategyDeleteIntent(res, req.body)) {
    return;
  }

  for (const target of idList) {
    const id = target && typeof target === "object" ? target.id : target;
    const item = await loadOwnedGridItem("TEST", id, userId);

    if (item === null) {
      return sendRouteError(res, 404, "그리드 전략을 찾을 수 없습니다.");
    }

    if (item === false) {
      return sendRouteError(res, 403, "본인 전략만 삭제할 수 있습니다.");
    }

    if (!canDeleteGridItem(item)) {
      return sendRouteError(
        res,
        409,
        "주문 또는 포지션이 남아 있는 그리드 전략은 삭제할 수 없습니다. OFF 후 대기 상태에서 다시 시도해 주세요."
      );
    }
  }

  for (const target of idList) {
    const id = target && typeof target === "object" ? target.id : target;
    const item = await loadOwnedGridItem("TEST", id, userId);
    if (item && item !== false) {
      await writeControlAudit(req, {
        targetUserId: item.uid,
        strategyCategory: "grid",
        strategyMode: "test",
        pid: id,
        actionCode: "USER_DELETE_STRATEGY",
        previousEnabled: normalizeEnabledValue(item.enabled),
        nextEnabled: "N",
        note: "grid-deleted",
        metadata: {
          regimeStatus: item.regimeStatus || null,
        },
      });
    }
    await db.query(`DELETE FROM ${getGridTableName("TEST")} WHERE id = ? AND uid = ? LIMIT 1`, [
      id,
      userId,
    ]);
  }

  return res.send({ ok: true, deletedCount: idList.length });
});

router.get("/msg/recent", async (req, res) => {
  const userId = req.decoded.userId;
  const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10) || 50, 1), 200);

  const reData = await dbcon.DBCall(`CALL SP_MSG_RECENT_GET(?,?)`, [
    userId,
    limit,
  ]);

  return res.send(decorateMsgRows(reData));
});

router.get("/msg/user-facing", async (req, res) => {
  const userId = req.decoded.userId;
  const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10) || 50, 1), 200);
  const [msgRows] = await db.query(
    `SELECT id, fun, code, msg, uid, pid, symbol, side, st, created_at AS createdAt
       FROM msg_list
      WHERE uid = ?
      ORDER BY id DESC
      LIMIT ?`,
    [userId, limit]
  );
  const [runtimeRows] = await db.query(
    `SELECT id, uid, pid, strategy_category AS strategyCategory, event_type AS eventType,
            event_code AS eventCode, severity, symbol, side, position_side AS positionSide,
            client_order_id AS clientOrderId, order_id AS orderId, order_status AS orderStatus,
            quantity AS origQty, executed_qty AS executedQty, note, created_at AS createdAt
       FROM binance_runtime_event_log
      WHERE uid = ?
      ORDER BY id DESC
      LIMIT ?`,
    [userId, limit]
  );
  const runtimeMessages = (runtimeRows || []).map((row) => ({
    ...row,
    fun: row.eventType,
    code: row.eventCode,
    msg: row.note || row.eventCode,
  }));
  const rows = messageFilter
    .filterUserFacingMessages([...(msgRows || []), ...runtimeMessages])
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, limit);
  return res.send(rows);
});

router.get("/msg/summary", async (req, res) => {
  const userId = req.decoded.userId;
  const days = Math.min(Math.max(parseInt(req.query.days || "7", 10) || 7, 1), 90);

  const reData = await dbcon.DBCall(`CALL SP_MSG_ERROR_SUMMARY_GET(?,?)`, [
    userId,
    days,
  ]);

  return res.send(decorateMsgRows(reData));
});

router.get("/msg/code-summary", async (req, res) => {
  const userId = req.decoded.userId;
  const days = Math.min(Math.max(parseInt(req.query.days || "7", 10) || 7, 1), 90);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10) || 20, 1), 100);

  const reData = await dbcon.DBCall(`CALL SP_MSG_ERROR_CODE_SUMMARY_GET(?,?,?)`, [
    userId,
    days,
    limit,
  ]);

  return res.send(decorateMsgRows(reData));
});

router.get("/msg/dashboard", async (req, res) => {
  const userId = req.decoded.userId;
  const days = Math.min(Math.max(parseInt(req.query.days || "7", 10) || 7, 1), 90);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10) || 20, 1), 100);
  const recentLimit = Math.min(Math.max(parseInt(req.query.recentLimit || "10", 10) || 10, 1), 50);

  const [recent, summary, codeSummary] = await Promise.all([
    dbcon.DBCall(`CALL SP_MSG_RECENT_GET(?,?)`, [userId, recentLimit]),
    dbcon.DBCall(`CALL SP_MSG_ERROR_SUMMARY_GET(?,?)`, [userId, days]),
    dbcon.DBCall(`CALL SP_MSG_ERROR_CODE_SUMMARY_GET(?,?,?)`, [userId, days, limit]),
  ]);

  const summaryRows = decorateMsgRows(summary);
  const codeRows = decorateMsgRows(codeSummary);

  return res.send({
    windowDays: days,
    overview: summarizeMsgRows(summaryRows),
    summary: summaryRows,
    codeSummary: codeRows,
    recent: decorateMsgRows(recent),
  });
});

router.get("/msg/alert", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_MSG_ONE_GET(?)`, [
    userId,
  ]);

  return res.send(reData);
});


router.get("/candle/data", async (req, res) => {
  let reData = await dbcon.DBCall(`CALL SP_C_CANDLE_GET(?,?)`, [
    req.query.bunbong,
    req.query.symbol,
  ]);



  // if(dt.price){
  //   // console.log(dt.price.ETHUSDT);
  //   for(let i=0;i<reData.length;i++){
  //     try{
  //       const price =  parseFloat(dt.price.BTCUSDT.bestBid);
  //       const symbol = reData[i].symbol;
  //       const close = parseFloat(reData[i].CLOSE_NOW);
  //       const bunbong = reData[i].bunbong;
  
  //       if(symbol != 'BTCUSDT'){
  //         continue;
  //       }
  
  //       // 利앷컧瑜?%) = (?꾩옱媛?- 怨쇨굅媛? / 怨쇨굅媛?횞 100
  //       console.log(`[${bunbong}]${symbol} :: ${(price-close)/close*100}`);

  //     }catch(e){

  //     }
      

  //   }
  // }


  return res.send(reData);
});

router.get("/manage/strategies/overview", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "관리자만 접근할 수 있습니다.");
  }

  try {
    const items = await adminManagement.listStrategyCatalogOverview();
    const exchangeSymbolCatalog = items.exchangeSymbolCatalog || { items: [], symbols: adminManagement.KNOWN_SYMBOLS, refreshedAt: null };
    return res.send({
      items,
      summary: {
        total: items.length,
        active: items.filter((item) => item.isActive).length,
        abnormalWebhook: items.filter((item) => item.signalWebhookStatus?.abnormal).length,
        abnormalBacktest: items.filter((item) => item.statsWebhookStatus?.abnormal).length,
        abnormalPrice: items.filter((item) => item.priceFeedStatus?.abnormal).length,
      },
      meta: {
        knownSymbols: exchangeSymbolCatalog.symbols || adminManagement.KNOWN_SYMBOLS,
        exchangeSymbolCatalog,
        timeframeExamples: adminManagement.KNOWN_TIMEFRAMES,
      },
    });
  } catch (error) {
    console.error("[ADMIN STRATEGY OVERVIEW]", error);
    return sendRouteError(res, 500, "전략 관리 데이터를 불러오지 못했습니다.");
  }
});

router.get("/trading/catalog-options", async (req, res) => {
  const userId = req.decoded.userId;

  try {
    const items = await adminManagement.listUserSelectableStrategyCatalog({
      uid: userId,
      category: req.query.category,
    });
    const exchangeSymbolCatalog = await adminManagement.loadExchangeSymbolCatalog();

    return res.send({
      ok: true,
      items,
      meta: {
        knownSymbols: exchangeSymbolCatalog?.symbols || adminManagement.KNOWN_SYMBOLS,
        exchangeSymbolCatalog,
        timeframeExamples: adminManagement.KNOWN_TIMEFRAMES,
        signalRuntimeTypeMaxLength: adminManagement.SIGNAL_RUNTIME_TYPE_MAX_LENGTH,
      },
    });
  } catch (error) {
    console.error("[TRADING CATALOG OPTIONS]", error);
    return sendRouteError(res, 500, "사용자 전략 옵션을 불러오지 못했습니다.");
  }
});

router.get("/manage/strategies/item", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "관리자만 접근할 수 있습니다.");
  }

  try {
    const item = await adminManagement.getStrategyCatalogItem(req.query.id);
    if (!item) {
      return sendRouteError(res, 404, "전략 카탈로그를 찾을 수 없습니다.");
    }
    return res.send(item);
  } catch (error) {
    console.error("[ADMIN STRATEGY ITEM]", error);
    return sendRouteError(res, 500, "전략 상세를 불러오지 못했습니다.");
  }
});

router.post("/manage/strategies/save", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "관리자만 접근할 수 있습니다.");
  }

  try {
    const savedId = await adminManagement.saveStrategyCatalog(req.body);
    const item = await adminManagement.getStrategyCatalogItem(savedId);
    return res.send({ ok: true, id: savedId, item });
  } catch (error) {
    return sendRouteError(res, 400, error?.message || "전략 저장에 실패했습니다.");
  }
});

router.post("/manage/strategies/delete", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "관리자만 접근할 수 있습니다.");
  }

  try {
    await adminManagement.deleteStrategyCatalog(req.body.id);
    return res.send({ ok: true });
  } catch (error) {
    return sendRouteError(res, 400, error?.message || "전략 삭제에 실패했습니다.");
  }
});

router.get("/manage/users/overview", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "관리자만 접근할 수 있습니다.");
  }

  try {
    const items = await adminManagement.listUserManagementOverview(req.query || {});
    return res.send({
      items,
      summary: {
        total: items.length,
        liveDemo: items.filter((item) => item.tradeAccessMode === adminManagement.TRADE_ACCESS_MODES.LIVE_DEMO).length,
        demoOnly: items.filter((item) => item.tradeAccessMode === adminManagement.TRADE_ACCESS_MODES.DEMO_ONLY).length,
        withCredentials: items.filter((item) => item.hasCredentials).length,
      },
    });
  } catch (error) {
    console.error("[ADMIN USER OVERVIEW]", error);
    return sendRouteError(res, 500, "사용자 관리 데이터를 불러오지 못했습니다.");
  }
});

router.get("/manage/users/item", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "관리자만 접근할 수 있습니다.");
  }

  try {
    const item = await adminManagement.getUserManagementItem(req.query.uid);
    if (!item) {
      return sendRouteError(res, 404, "사용자를 찾을 수 없습니다.");
    }
    return res.send(item);
  } catch (error) {
    console.error("[ADMIN USER ITEM]", error);
    return sendRouteError(res, 500, "사용자 상세를 불러오지 못했습니다.");
  }
});

router.post("/manage/users/access", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "관리자만 접근할 수 있습니다.");
  }

  try {
    const mode = await adminManagement.updateUserTradeAccess(req.body.uid, req.body.tradeAccessMode);
    const item = await adminManagement.getUserManagementItem(req.body.uid);
    return res.send({ ok: true, tradeAccessMode: mode, item });
  } catch (error) {
    return sendRouteError(res, 400, error?.message || "사용자 권한 변경에 실패했습니다.");
  }
});

router.post("/manage/users/delete", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadOpsAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "관리자만 접근할 수 있습니다.");
  }

  try {
    await adminManagement.deleteUser(req.body.uid);
    return res.send({ ok: true });
  } catch (error) {
    return sendRouteError(res, 400, error?.message || "사용자 삭제에 실패했습니다.");
  }
});

router.get("/manage/revenue/summary", async (req, res) => {
  const userId = req.decoded.userId;
  const accessMember = await loadAdminConsoleAccessMember(userId);
  if (accessMember === null) {
    return sendRouteError(res, 404, "회원 정보를 찾을 수 없습니다.");
  }
  if (accessMember === false) {
    return sendRouteError(res, 403, "관리자만 접근할 수 있습니다.");
  }

  try {
    const summary = await adminManagement.getRevenueSummary(req.query || {});
    return res.send(summary);
  } catch (error) {
    console.error("[ADMIN REVENUE SUMMARY]", error);
    return sendRouteError(res, 500, "매출 데이터를 불러오지 못했습니다.");
  }
});

router.get("/exchange/symbol-rules", async (req, res) => {
  try {
    const rules = await adminManagement.getExchangeSymbolRuleSummary(req.query?.symbol);
    return res.send({
      ok: true,
      minMarginUsdt: 5,
      rules: rules || null,
    });
  } catch (error) {
    console.error("[ADMIN EXCHANGE SYMBOL RULES]", error);
    return sendRouteError(res, 500, "종목 주문 규칙을 불러오지 못했습니다.");
  }
});



module.exports = router;



