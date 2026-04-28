const db = require("./database/connect/config");
const dbcon = require("./dbcon");
const runtimeState = require("./runtime-state");
const canonicalRuntimeState = require("./canonical-runtime-state");
const strategyControlState = require("./strategy-control-state");

let seon = null;
let gridEngine = null;

const getSeon = () => {
  if (!seon) {
    seon = require("./seon");
  }

  return seon;
};

const getGridEngine = () => {
  if (!gridEngine) {
    gridEngine = require("./grid-engine");
  }

  return gridEngine;
};

const POLICY_SCOPE_TYPE_LABELS = {
  USER: "사용자",
  STRATEGY: "전략",
  PLATFORM: "플랫폼",
};

const POLICY_ACTION_TYPE_LABELS = {
  WARN: "경고",
  AUTO_OFF_STRATEGY: "전략 자동 OFF",
  AUTO_OFF_USER: "사용자 자동 OFF",
  KILL_SWITCH: "킬 스위치",
  NONE: "동작 없음",
};

const POLICY_MODE_LABELS = {
  DRY_RUN: "드라이런",
  SOFT: "소프트",
  HARD: "하드",
};

const POLICY_REASON_LABELS = {
  ACCOUNT_MARGIN_RATIO_WATCH: "마진 비율 관심 구간",
  ACCOUNT_MARGIN_RATIO_WARNING: "마진 비율 경고 구간",
  ACCOUNT_MARGIN_RATIO_DANGER: "마진 비율 위험 구간",
  ACCOUNT_MARGIN_RATIO_CRITICAL: "마진 비율 치명 구간",
  ACCOUNT_MARGIN_RATIO_CLEAR: "마진 비율 정상 복귀",
  ACCOUNT_MDD_THRESHOLD: "계정 MDD 임계치 도달",
  ACCOUNT_MDD_CLEAR: "계정 MDD 정상 복귀",
  STRATEGY_CONSEC_STOPLOSS_STREAK: "전략 연속 손절 누적",
  STRATEGY_CONSEC_STOPLOSS_THRESHOLD: "전략 연속 손절 임계치 도달",
  STRATEGY_CONSEC_STOPLOSS_CLEAR: "전략 연속 손절 정상 복귀",
};

const DEFAULT_MARGIN_RATIO_CONFIG = {
  watchThreshold: 5,
  warningThreshold: 10,
  dangerThreshold: 20,
  criticalThreshold: 35,
  cooldownMinutes: 15,
};

const DEFAULT_ACCOUNT_MDD_CONFIG = {
  mddPercent: 15,
  cooldownMinutes: 60,
};

const DEFAULT_GLOBAL_KILL_SWITCH_CONFIG = {
  blockedCategories: ["signal", "grid"],
  note: null,
};

const DEFAULT_CONSEC_STOPLOSS_CONFIG = {
  strategyCategory: "signal",
  maxConsecutiveLosses: 3,
  cooldownMinutes: 30,
  maxLogs: 20,
  countableExitReasons: ["STOP_LOSS_PRICE"],
  profitExitReasons: ["TAKE_PROFIT"],
  resetOnProfit: true,
};

const safeJsonParse = (value, fallback = {}) => {
  if (!value) {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeUpper = (value, fallback = "") =>
  String(value ?? fallback)
    .trim()
    .toUpperCase();

const normalizeLower = (value, fallback = "") =>
  String(value ?? fallback)
    .trim()
    .toLowerCase();

const normalizeEnabledValue = strategyControlState.normalizeEnabledValue;
const buildLegacyControlFields = strategyControlState.buildLegacyControlFields;

const asIsoString = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const getStrategyEnabledFlag = (strategy = {}) =>
  normalizeEnabledValue(canonicalRuntimeState.getItemEnabled(strategy) ? "Y" : "N");

const applySignalControlState = async ({
  uid = null,
  pid,
  enabled,
  status = "READY",
  resetRuntime = false,
  previousEnabled = "N",
  actionCode = null,
  note = null,
  metadata = null,
} = {}) => {
  if (!pid) {
    return false;
  }

  return strategyControlState.applyPlayControlState({
    mode: "LIVE",
    pid,
    enabled,
    status,
    resetRuntime,
    audit: actionCode
      ? {
          actorUserId: null,
          targetUserId: uid,
          actionCode,
          previousEnabled,
          nextEnabled: enabled,
          requestIp: "system:policy-engine",
          note,
          metadata,
        }
      : null,
  });
};

const applyGridControlState = async ({
  uid = null,
  pid,
  enabled,
  regimeEndReason = null,
  previousEnabled = "N",
  actionCode = null,
  note = null,
  metadata = null,
} = {}) => {
  if (!pid) {
    return false;
  }

  return strategyControlState.applyGridControlState({
    mode: "LIVE",
    pid,
    enabled,
    regimeEndReason,
    audit: actionCode
      ? {
          actorUserId: null,
          targetUserId: uid,
          actionCode,
          previousEnabled,
          nextEnabled: enabled,
          requestIp: "system:policy-engine",
          note,
          metadata,
        }
      : null,
  });
};

const diffMinutesFromNow = (value) => {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) {
    return Number.POSITIVE_INFINITY;
  }
  return (Date.now() - ts) / 60000;
};

const loadPolicyRules = async ({ scopeType, scopeTarget = "*", enabledOnly = true } = {}) => {
  const conditions = [];
  const params = [];

  if (scopeType) {
    conditions.push("scope_type = ?");
    params.push(scopeType);
  }

  if (enabledOnly) {
    conditions.push("enabled = 'Y'");
  }

  if (scopeTarget) {
    conditions.push("(scope_target = '*' OR scope_target = ?)");
    params.push(scopeTarget);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await db.query(
    `SELECT
        id,
        rule_code AS ruleCode,
        scope_type AS scopeType,
        scope_target AS scopeTarget,
        action_type AS actionType,
        mode,
        enabled,
        dry_run AS dryRun,
        priority,
        severity,
        config_json AS configJson,
        created_by AS createdBy,
        updated_by AS updatedBy,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM policy_rule
      ${whereSql}
      ORDER BY priority ASC, id ASC`,
    params
  );

  return rows.map((row) => ({
    ...row,
    config: safeJsonParse(row.configJson, {}),
    isEnabled: normalizeUpper(row.enabled) === "Y",
    isDryRun: normalizeUpper(row.dryRun) === "Y" || normalizeUpper(row.mode) === "DRY_RUN",
  }));
};

const loadPolicyRuntimeState = async ({
  ruleCode,
  scopeType,
  scopeTarget,
  stateKey = "current",
} = {}) => {
  const [rows] = await db.query(
    `SELECT
        id,
        rule_code AS ruleCode,
        scope_type AS scopeType,
        scope_target AS scopeTarget,
        uid,
        pid,
        strategy_category AS strategyCategory,
        state_key AS stateKey,
        state_value_json AS stateValueJson,
        updated_at AS updatedAt
      FROM policy_runtime_state
      WHERE rule_code = ?
        AND scope_type = ?
        AND scope_target = ?
        AND state_key = ?
      LIMIT 1`,
    [ruleCode, scopeType, scopeTarget, stateKey]
  );

  const row = rows?.[0];
  if (!row) {
    return null;
  }

  return {
    ...row,
    stateValue: safeJsonParse(row.stateValueJson, {}),
  };
};

const upsertPolicyRuntimeState = async ({
  ruleCode,
  scopeType,
  scopeTarget,
  uid = null,
  pid = null,
  strategyCategory = null,
  stateKey = "current",
  stateValue = {},
} = {}) => {
  await db.query(
    `INSERT INTO policy_runtime_state (
        rule_code, scope_type, scope_target, uid, pid, strategy_category, state_key, state_value_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        uid = VALUES(uid),
        pid = VALUES(pid),
        strategy_category = VALUES(strategy_category),
        state_value_json = VALUES(state_value_json),
        updated_at = CURRENT_TIMESTAMP()`,
    [
      ruleCode,
      scopeType,
      scopeTarget,
      uid,
      pid,
      strategyCategory,
      stateKey,
      JSON.stringify(stateValue || {}),
    ]
  );
};

const insertPolicyEvalLog = async ({
  ruleCode,
  scopeType,
  scopeTarget,
  uid = null,
  pid = null,
  strategyCategory = null,
  severity = "low",
  matched = false,
  reasonCode = null,
  reasonText = null,
  snapshot = {},
  recommendedAction = "NONE",
  actualAction = "NONE",
} = {}) => {
  const [result] = await db.query(
    `INSERT INTO policy_eval_log (
        rule_code, scope_type, scope_target, uid, pid, strategy_category,
        severity, matched, reason_code, reason_text, snapshot_json,
        recommended_action, actual_action
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ruleCode,
      scopeType,
      scopeTarget,
      uid,
      pid,
      strategyCategory,
      normalizeLower(severity, "low"),
      matched ? "Y" : "N",
      reasonCode,
      reasonText,
      JSON.stringify(snapshot || {}),
      recommendedAction || "NONE",
      actualAction || "NONE",
    ]
  );

  return Number(result?.insertId || 0);
};

const updatePolicyEvalActualAction = async (id, actualAction = "NONE") => {
  if (!id) {
    return false;
  }

  await db.query(
    `UPDATE policy_eval_log
     SET actual_action = ?
     WHERE id = ?
     LIMIT 1`,
    [actualAction || "NONE", id]
  );

  return true;
};

const insertPolicyActionLog = async ({
  ruleCode,
  scopeType,
  scopeTarget,
  uid = null,
  pid = null,
  strategyCategory = null,
  actionType,
  actionMode = "DRY_RUN",
  status = "QUEUED",
  actorType = "SYSTEM",
  actorId = null,
  note = null,
  result = {},
} = {}) => {
  const [insertResult] = await db.query(
    `INSERT INTO policy_action_log (
        rule_code, scope_type, scope_target, uid, pid, strategy_category,
        action_type, action_mode, status, actor_type, actor_id, note, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ruleCode,
      scopeType,
      scopeTarget,
      uid,
      pid,
      strategyCategory,
      actionType,
      actionMode,
      status,
      actorType,
      actorId,
      note,
      JSON.stringify(result || {}),
    ]
  );

  return Number(insertResult?.insertId || 0);
};

const buildEvalFingerprint = ({
  matched = false,
  severity = "low",
  reasonCode = null,
  recommendedAction = "NONE",
  extra = null,
} = {}) =>
  JSON.stringify({
    matched: Boolean(matched),
    severity: normalizeLower(severity, "low"),
    reasonCode: reasonCode || null,
    recommendedAction: recommendedAction || "NONE",
    extra: extra || null,
  });

const shouldPersistEvalLog = ({
  currentState = {},
  nextFingerprint,
  matched = false,
  cooldownMinutes = 0,
} = {}) => {
  const previousFingerprint = currentState?.lastFingerprint || null;
  const lastLoggedAt = currentState?.lastLoggedAt || null;
  const previousMatched = Boolean(currentState?.lastMatched);

  if (nextFingerprint !== previousFingerprint) {
    return true;
  }

  if (previousMatched && !matched) {
    return true;
  }

  if (matched && diffMinutesFromNow(lastLoggedAt) >= Number(cooldownMinutes || 0)) {
    return true;
  }

  return false;
};

const buildRuleLabel = (ruleCode) =>
  ({
    ACCOUNT_MARGIN_RATIO_WARNING: "마진 비율 경고",
    ACCOUNT_MDD_AUTO_OFF: "계정 MDD 자동 OFF",
    STRATEGY_CONSEC_STOPLOSS_AUTO_OFF: "전략 연속 손절 자동 OFF",
    GLOBAL_KILL_SWITCH: "글로벌 킬 스위치",
  }[ruleCode] || ruleCode);

const normalizeRuleMode = (rule = {}) =>
  normalizeUpper(rule.mode || (rule.isDryRun ? "DRY_RUN" : ""), "DRY_RUN");

const isRuleDryRunMode = (rule = {}) =>
  rule.isDryRun || normalizeRuleMode(rule) === "DRY_RUN";

const decoratePolicyRule = (row = {}) => ({
  ...row,
  scopeTypeLabel: POLICY_SCOPE_TYPE_LABELS[normalizeUpper(row.scopeType)] || row.scopeType,
  actionTypeLabel: POLICY_ACTION_TYPE_LABELS[normalizeUpper(row.actionType)] || row.actionType,
  modeLabel: POLICY_MODE_LABELS[normalizeUpper(row.mode)] || row.mode,
  ruleLabel: buildRuleLabel(row.ruleCode),
});

const getGlobalKillSwitchState = async ({ category = null } = {}) => {
  const rows = await loadPolicyRules({
    scopeType: "PLATFORM",
    scopeTarget: "*",
    enabledOnly: true,
  });

  const rule = rows.find((item) => item.ruleCode === "GLOBAL_KILL_SWITCH");
  if (!rule) {
    return {
      active: false,
      blocked: false,
      category: category ? normalizeLower(category) : null,
      mode: "DRY_RUN",
      note: null,
      rule: null,
      blockedCategories: [],
    };
  }

  const config = {
    ...DEFAULT_GLOBAL_KILL_SWITCH_CONFIG,
    ...safeJsonParse(rule.configJson || rule.config, {}),
  };
  const blockedCategories = (Array.isArray(config.blockedCategories) ? config.blockedCategories : [])
    .map((item) => normalizeLower(item))
    .filter(Boolean);
  const normalizedCategory = category ? normalizeLower(category) : null;
  const blocked =
    !normalizedCategory || blockedCategories.length === 0
      ? true
      : blockedCategories.includes(normalizedCategory);
  const active = blocked && !isRuleDryRunMode(rule);

  return {
    active,
    blocked,
    category: normalizedCategory,
    mode: normalizeRuleMode(rule),
    note: config.note || null,
    rule: decoratePolicyRule(rule),
    blockedCategories,
  };
};

const getMarginRatioTier = (ratio, config = DEFAULT_MARGIN_RATIO_CONFIG) => {
  if (ratio >= toNumber(config.criticalThreshold, DEFAULT_MARGIN_RATIO_CONFIG.criticalThreshold)) {
    return { level: "CRITICAL", severity: "high", reasonCode: "ACCOUNT_MARGIN_RATIO_CRITICAL" };
  }
  if (ratio >= toNumber(config.dangerThreshold, DEFAULT_MARGIN_RATIO_CONFIG.dangerThreshold)) {
    return { level: "DANGER", severity: "high", reasonCode: "ACCOUNT_MARGIN_RATIO_DANGER" };
  }
  if (ratio >= toNumber(config.warningThreshold, DEFAULT_MARGIN_RATIO_CONFIG.warningThreshold)) {
    return { level: "WARNING", severity: "medium", reasonCode: "ACCOUNT_MARGIN_RATIO_WARNING" };
  }
  if (ratio >= toNumber(config.watchThreshold, DEFAULT_MARGIN_RATIO_CONFIG.watchThreshold)) {
    return { level: "WATCH", severity: "low", reasonCode: "ACCOUNT_MARGIN_RATIO_WATCH" };
  }
  return null;
};

const evaluateMarginRatioRule = async ({ uid, rule, snapshot, persist = true } = {}) => {
  const scopeTarget = String(uid);
  const config = {
    ...DEFAULT_MARGIN_RATIO_CONFIG,
    ...safeJsonParse(rule.configJson || rule.config, {}),
  };
  const currentStateRow = await loadPolicyRuntimeState({
    ruleCode: rule.ruleCode,
    scopeType: rule.scopeType,
    scopeTarget,
  });
  const currentState = currentStateRow?.stateValue || {};
  const ratio = toNumber(snapshot?.accountMarginRatio, 0);
  const tier = getMarginRatioTier(ratio, config);
  const matched = Boolean(tier);
  const severity = tier?.severity || "low";
  const reasonCode = tier?.reasonCode || "ACCOUNT_MARGIN_RATIO_CLEAR";
  const reasonText = matched
    ? `Account Margin Ratio ${ratio.toFixed(2)}%가 ${tier.level} 임계치에 도달했습니다.`
    : `Account Margin Ratio ${ratio.toFixed(2)}%로 정상 범위입니다.`;
  const recommendedAction = matched ? rule.actionType : "NONE";
  const snapshotJson = {
    uid,
    accountEquity: toNumber(snapshot?.accountEquity, 0),
    accountMaintMargin: toNumber(snapshot?.accountMaintMargin, 0),
    accountMarginRatio: ratio,
    riskLevel: snapshot?.riskLevel || "UNKNOWN",
    thresholds: config,
  };
  const nextFingerprint = buildEvalFingerprint({
    matched,
    severity,
    reasonCode,
    recommendedAction,
    extra: tier?.level || "NORMAL",
  });
  const shouldLog = shouldPersistEvalLog({
    currentState,
    nextFingerprint,
    matched,
    cooldownMinutes: config.cooldownMinutes,
  });
  const nextState = {
    ...currentState,
    lastMatched: matched,
    lastLevel: tier?.level || "NORMAL",
    lastRatio: ratio,
    lastFingerprint: nextFingerprint,
    lastReasonCode: reasonCode,
    updatedAt: asIsoString(),
  };

  if (shouldLog && persist) {
    await insertPolicyEvalLog({
      ruleCode: rule.ruleCode,
      scopeType: rule.scopeType,
      scopeTarget,
      uid,
      severity,
      matched,
      reasonCode,
      reasonText,
      snapshot: snapshotJson,
      recommendedAction,
      actualAction: "NONE",
    });
    nextState.lastLoggedAt = asIsoString();
  }

  if (persist) {
    await upsertPolicyRuntimeState({
      ruleCode: rule.ruleCode,
      scopeType: rule.scopeType,
      scopeTarget,
      uid,
      stateValue: nextState,
    });
  }

  return {
    ruleCode: rule.ruleCode,
    ruleLabel: buildRuleLabel(rule.ruleCode),
    scopeType: rule.scopeType,
    scopeTarget,
    uid,
    matched,
    severity,
    reasonCode,
    reasonLabel: POLICY_REASON_LABELS[reasonCode] || reasonCode,
    reasonText,
    recommendedAction,
    actualAction: "NONE",
    snapshot: snapshotJson,
    logged: shouldLog,
  };
};

const evaluateAccountMddRule = async ({ uid, rule, snapshot, persist = true, executeActions = false } = {}) => {
  const scopeTarget = String(uid);
  const config = {
    ...DEFAULT_ACCOUNT_MDD_CONFIG,
    ...safeJsonParse(rule.configJson || rule.config, {}),
  };
  const currentStateRow = await loadPolicyRuntimeState({
    ruleCode: rule.ruleCode,
    scopeType: rule.scopeType,
    scopeTarget,
  });
  const currentState = currentStateRow?.stateValue || {};
  const accountEquity = toNumber(snapshot?.accountEquity, 0);
  const previousPeak = toNumber(currentState.peakEquity, 0);
  const peakEquity = Math.max(previousPeak, accountEquity);
  const peakAt =
    peakEquity > previousPeak ? asIsoString(snapshot?.capturedAt || new Date()) : currentState.peakAt || null;
  const drawdownPercent =
    peakEquity > 0 ? Number((((peakEquity - accountEquity) / peakEquity) * 100).toFixed(6)) : 0;
  const threshold = toNumber(config.mddPercent, DEFAULT_ACCOUNT_MDD_CONFIG.mddPercent);
  const matched = peakEquity > 0 && drawdownPercent >= threshold;
  const severity = matched ? "high" : "low";
  const reasonCode = matched ? "ACCOUNT_MDD_THRESHOLD" : "ACCOUNT_MDD_CLEAR";
  const reasonText = matched
    ? `Account Equity drawdown ${drawdownPercent.toFixed(2)}%가 MDD 임계치 ${threshold.toFixed(2)}%를 넘었습니다.`
    : `Account Equity drawdown ${drawdownPercent.toFixed(2)}%로 정상 범위입니다.`;
  const recommendedAction = matched ? rule.actionType : "NONE";
  const snapshotJson = {
    uid,
    accountEquity,
    peakEquity,
    peakAt,
    drawdownPercent,
    threshold,
    riskLevel: snapshot?.riskLevel || "UNKNOWN",
  };
  const nextFingerprint = buildEvalFingerprint({
    matched,
    severity,
    reasonCode,
    recommendedAction,
    extra: Number(drawdownPercent.toFixed(2)),
  });
  const shouldLog = shouldPersistEvalLog({
    currentState,
    nextFingerprint,
    matched,
    cooldownMinutes: config.cooldownMinutes,
  });
  const shouldExecuteAction =
    Boolean(matched) &&
    Boolean(persist) &&
    Boolean(executeActions) &&
    normalizeUpper(rule.actionType) === "AUTO_OFF_USER" &&
    !isRuleDryRunMode(rule) &&
    currentState?.lastActionFingerprint !== nextFingerprint;
  let actualAction = "NONE";
  let actionStatus = "NONE";
  let actionLogId = null;

  if (shouldExecuteAction) {
    const actionResult = await executeUserAutoOffAction({
      uid,
      rule,
      scopeTarget,
      snapshot: snapshotJson,
      reasonCode,
      reasonText,
    });
    actualAction = actionResult.actualAction || "NONE";
    actionStatus = actionResult.actionStatus || "NONE";
    actionLogId = actionResult.actionLogId || null;
  }
  const nextState = {
    ...currentState,
    peakEquity,
    peakAt,
    drawdownPercent,
    lastMatched: matched,
    lastReasonCode: reasonCode,
    lastFingerprint: nextFingerprint,
    lastActionFingerprint: shouldExecuteAction ? nextFingerprint : matched ? currentState?.lastActionFingerprint || null : null,
    lastActionStatus: actionStatus !== "NONE" ? actionStatus : currentState?.lastActionStatus || null,
    lastActionAt: actionStatus !== "NONE" ? asIsoString() : currentState?.lastActionAt || null,
    lastActionLogId: actionLogId || currentState?.lastActionLogId || null,
    updatedAt: asIsoString(),
  };

  let evalLogId = null;
  if (shouldLog && persist) {
    evalLogId = await insertPolicyEvalLog({
      ruleCode: rule.ruleCode,
      scopeType: rule.scopeType,
      scopeTarget,
      uid,
      severity,
      matched,
      reasonCode,
      reasonText,
      snapshot: snapshotJson,
      recommendedAction,
      actualAction,
    });
    nextState.lastLoggedAt = asIsoString();
  } else if (actionStatus !== "NONE" && persist && actualAction !== "NONE") {
    evalLogId = await insertPolicyEvalLog({
      ruleCode: rule.ruleCode,
      scopeType: rule.scopeType,
      scopeTarget,
      uid,
      severity,
      matched,
      reasonCode,
      reasonText,
      snapshot: snapshotJson,
      recommendedAction,
      actualAction,
    });
    nextState.lastLoggedAt = asIsoString();
  }

  if (evalLogId && actualAction !== "NONE") {
    await updatePolicyEvalActualAction(evalLogId, actualAction);
  }

  if (persist) {
    await upsertPolicyRuntimeState({
      ruleCode: rule.ruleCode,
      scopeType: rule.scopeType,
      scopeTarget,
      uid,
      stateValue: nextState,
    });
  }

  return {
    ruleCode: rule.ruleCode,
    ruleLabel: buildRuleLabel(rule.ruleCode),
    scopeType: rule.scopeType,
    scopeTarget,
    uid,
    matched,
    severity,
    reasonCode,
    reasonLabel: POLICY_REASON_LABELS[reasonCode] || reasonCode,
    reasonText,
    recommendedAction,
    actualAction,
    actionStatus,
    actionLogId,
    snapshot: snapshotJson,
    logged: shouldLog,
  };
};

const loadSignalStrategies = async (uid, { strategyPid = null } = {}) => {
  const where = ["uid = ?"];
  const params = [uid];

  if (strategyPid) {
    where.push("id = ?");
    params.push(strategyPid);
  }

  const [rows] = await db.query(
    `SELECT
        id AS pid,
        uid,
        a_name AS strategyName,
        symbol,
        bunbong,
        enabled,
        status,
        r_tid AS runtimeTid,
        r_signalType AS runtimeSignalType
      FROM live_play_list
      WHERE ${where.join(" AND ")}
      ORDER BY id ASC`,
    params
  );

  return rows || [];
};

const loadAllLiveSignalStrategies = async () => {
  const [rows] = await db.query(
    `SELECT
        id AS pid,
        uid,
        a_name AS strategyName,
        symbol,
        bunbong,
        enabled,
        status,
        r_tid AS runtimeTid,
        r_signalType AS runtimeSignalType
      FROM live_play_list
      ORDER BY uid ASC, id ASC`
  );

  return rows || [];
};

const loadLiveStrategySnapshot = async (uid, pid) => {
  const [rows] = await db.query(
    `SELECT
        id AS pid,
        uid,
        a_name AS strategyName,
        symbol,
        bunbong,
        enabled,
        status,
        r_tid AS runtimeTid,
        r_signalType AS runtimeSignalType
      FROM live_play_list
      WHERE uid = ? AND id = ?
      LIMIT 1`,
    [uid, pid]
  );

  return rows?.[0] || null;
};

const loadLiveGridStrategies = async (uid) => {
  const [rows] = await db.query(
    `SELECT
        id AS pid,
        uid,
        a_name AS strategyName,
        strategySignal,
        symbol,
        bunbong,
        enabled,
        regimeStatus,
        regimeEndReason,
        longLegStatus,
        shortLegStatus,
        longEntryOrderId,
        shortEntryOrderId,
        longExitOrderId,
        shortExitOrderId,
        longStopOrderId,
        shortStopOrderId,
        longQty,
        shortQty
      FROM live_grid_strategy_list
      WHERE uid = ?
      ORDER BY id ASC`,
    [uid]
  );

  return rows || [];
};

const loadAllLiveGridStrategies = async () => {
  const [rows] = await db.query(
    `SELECT
        id AS pid,
        uid,
        a_name AS strategyName,
        strategySignal,
        symbol,
        bunbong,
        enabled,
        regimeStatus,
        regimeEndReason,
        longLegStatus,
        shortLegStatus,
        longEntryOrderId,
        shortEntryOrderId,
        longExitOrderId,
        shortExitOrderId,
        longStopOrderId,
        shortStopOrderId,
        longQty,
        shortQty
      FROM live_grid_strategy_list
      ORDER BY uid ASC, id ASC`
  );

  return rows || [];
};

const loadLiveGridStrategySnapshot = async (uid, pid) => {
  const [rows] = await db.query(
    `SELECT
        id AS pid,
        uid,
        a_name AS strategyName,
        strategySignal,
        symbol,
        bunbong,
        enabled,
        regimeStatus,
        regimeEndReason,
        longLegStatus,
        shortLegStatus,
        longEntryOrderId,
        shortEntryOrderId,
        longExitOrderId,
        shortExitOrderId,
        longStopOrderId,
        shortStopOrderId,
        longQty,
        shortQty
      FROM live_grid_strategy_list
      WHERE uid = ? AND id = ?
      LIMIT 1`,
    [uid, pid]
  );

  return rows?.[0] || null;
};

const hasGridOpenExposure = (row = {}) =>
  toNumber(row.longQty, 0) > 0 ||
  toNumber(row.shortQty, 0) > 0 ||
  normalizeUpper(row.longLegStatus) === "OPEN" ||
  normalizeUpper(row.shortLegStatus) === "OPEN";

const loadStrategyRecentCloseLogs = async (uid, pid, limit = 20) => {
  try {
    const [rows] = await db.query(
      `SELECT
          id,
          exitReason,
          exitMode,
          win_loss AS winLoss,
          closeTime
        FROM live_play_log
        WHERE uid = ? AND pid = ?
        ORDER BY id DESC
        LIMIT ?`,
      [uid, pid, limit]
    );
    return rows || [];
  } catch (error) {
    return [];
  }
};

const buildConsecutiveStopLossSnapshot = (logs = [], config = DEFAULT_CONSEC_STOPLOSS_CONFIG) => {
  const countableSet = new Set(
    (Array.isArray(config.countableExitReasons) ? config.countableExitReasons : []).map((item) =>
      normalizeUpper(item)
    )
  );
  const profitSet = new Set(
    (Array.isArray(config.profitExitReasons) ? config.profitExitReasons : []).map((item) =>
      normalizeUpper(item)
    )
  );

  let consecutiveLosses = 0;
  let latestLogId = null;
  const recent = [];

  for (const log of logs) {
    const exitReason = normalizeUpper(log.exitReason);
    const winLoss = normalizeUpper(log.winLoss);
    if (latestLogId === null) {
      latestLogId = Number(log.id || 0);
    }

    recent.push({
      id: Number(log.id || 0),
      exitReason: exitReason || null,
      winLoss: winLoss || null,
      closeTime: log.closeTime || null,
    });

    if (countableSet.has(exitReason)) {
      consecutiveLosses += 1;
      continue;
    }

    if (profitSet.has(exitReason) || winLoss === "W" || winLoss === "WIN") {
      if (config.resetOnProfit !== false) {
        break;
      }
      continue;
    }

    break;
  }

  return {
    consecutiveLosses,
    latestLogId,
    recent,
  };
};

const executeSignalStrategyAutoOffAction = async ({
  uid,
  strategy,
  rule,
  scopeTarget,
  snapshot = {},
  reasonCode = null,
  reasonText = null,
} = {}) => {
  const actionMode = normalizeRuleMode(rule);
  const strategyCategory = normalizeLower(snapshot.strategyCategory || "signal", "signal");
  const current = await loadLiveStrategySnapshot(uid, strategy.pid);

  if (!current) {
    const actionLogId = await insertPolicyActionLog({
      ruleCode: rule.ruleCode,
      scopeType: rule.scopeType,
      scopeTarget,
      uid,
      pid: strategy.pid,
      strategyCategory,
      actionType: rule.actionType,
      actionMode,
      status: "FAILED",
      note: "전략 스냅샷을 찾을 수 없어 자동 OFF를 수행하지 못했습니다.",
      result: {
        reasonCode,
        reasonText,
        snapshot,
      },
    });

    return {
      actualAction: "NONE",
      actionStatus: "FAILED",
      actionLogId,
      note: "strategy-not-found",
    };
  }

  if (getStrategyEnabledFlag(current) === "N" && normalizeUpper(current.status) === "READY") {
    const actionLogId = await insertPolicyActionLog({
      ruleCode: rule.ruleCode,
      scopeType: rule.scopeType,
      scopeTarget,
      uid,
      pid: strategy.pid,
      strategyCategory,
      actionType: rule.actionType,
      actionMode,
      status: "SKIPPED",
      note: "이미 OFF 상태인 전략이라 추가 자동 OFF를 생략했습니다.",
      result: {
        reasonCode,
        reasonText,
        before: current,
        snapshot,
      },
    });

    return {
      actualAction: "NONE",
      actionStatus: "SKIPPED",
      actionLogId,
      note: "already-off",
    };
  }

  const previousEnabled = getStrategyEnabledFlag(current);
  await applySignalControlState({
    uid,
    pid: strategy.pid,
    enabled: "N",
    status: "READY",
    resetRuntime: true,
    previousEnabled,
    actionCode: "POLICY_AUTO_OFF_STRATEGY",
    note: `${rule.ruleCode}:${reasonCode || "POLICY_TRIGGER"}`,
    metadata: {
      reasonCode,
      reasonText,
      actionMode,
    },
  });
  await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
    uid,
    strategy.pid,
    null,
    null,
    "정책AUTO_OFF_연속손절_U",
    previousEnabled === "Y" ? "START" : "STOP",
    "STOP",
    current.status,
    "READY",
    null,
    runtimeState.formatRuntimeSnapshot(
      {
        ...current,
        enabled: false,
        status: "READY",
      },
      { exitReason: "bound-stop" }
    ),
    `${rule.ruleCode}:${reasonCode || "POLICY_TRIGGER"}`,
  ]);

  const after = await loadLiveStrategySnapshot(uid, strategy.pid);
  const actionLogId = await insertPolicyActionLog({
    ruleCode: rule.ruleCode,
    scopeType: rule.scopeType,
    scopeTarget,
    uid,
    pid: strategy.pid,
    strategyCategory,
    actionType: rule.actionType,
    actionMode,
    status: "EXECUTED",
    note: reasonText || "전략 연속 손절 정책에 따라 자동 OFF를 수행했습니다.",
    result: {
      reasonCode,
      reasonText,
      before: current,
      after,
      snapshot,
    },
  });

  return {
    actualAction: rule.actionType,
    actionStatus: "EXECUTED",
    actionLogId,
    note: "auto-off-executed",
  };
};

const appendSignalPolicyAutoOffEventLog = async ({
  uid,
  current,
  nextEnabled,
  nextStatus,
  label,
  reasonCode,
  reasonText,
  exitReason = null,
} = {}) => {
  if (!uid || !current?.pid) {
    return false;
  }

  const currentControlState = getStrategyEnabledFlag(current) === "Y" ? "START" : "STOP";
  const nextControlState = normalizeEnabledValue(nextEnabled) === "Y" ? "START" : "STOP";

  await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
    uid,
    current.pid,
    current.runtimeTid || null,
    null,
    label,
    currentControlState,
    nextControlState,
    current.status,
    nextStatus,
    current.runtimeSignalType || null,
    runtimeState.formatRuntimeSnapshot(
      {
        ...current,
        enabled: normalizeEnabledValue(nextEnabled) === "Y",
        status: nextStatus,
      },
      exitReason ? { exitReason } : {}
    ),
    `${reasonCode || "POLICY_TRIGGER"}:${reasonText || ""}`.slice(0, 255),
  ]);

  return true;
};

const applySignalStrategyUserSoftOff = async ({
  uid,
  strategy,
  reasonCode,
  reasonText,
} = {}) => {
  const current = await loadLiveStrategySnapshot(uid, strategy.pid);
  if (!current) {
    return {
      pid: strategy.pid,
      strategyName: strategy.strategyName || null,
      status: "FAILED",
      note: "signal-strategy-not-found",
      before: null,
      after: null,
    };
  }

  const status = normalizeUpper(current.status);
  const previousEnabled = getStrategyEnabledFlag(current);

  if (status === "EXACT") {
    await applySignalControlState({
      uid,
      pid: current.pid,
      enabled: "N",
      status: current.status,
      resetRuntime: false,
      previousEnabled,
      actionCode: "POLICY_AUTO_OFF_USER_SOFT",
      note: `${reasonCode || "POLICY_TRIGGER"}:signal-open-kept-future-entries-disabled`,
      metadata: { reasonCode, reasonText, status },
    });
    await appendSignalPolicyAutoOffEventLog({
      uid,
      current,
      nextEnabled: "N",
      nextStatus: current.status,
      label: "정책AUTO_OFF_계정SOFT_U",
      reasonCode,
      reasonText,
    });

    return {
      pid: current.pid,
      strategyName: current.strategyName || null,
      status: "EXECUTED",
      note: "signal-open-kept-future-entries-disabled",
      before: current,
      after: await loadLiveStrategySnapshot(uid, current.pid),
    };
  }

  await applySignalControlState({
    uid,
    pid: current.pid,
    enabled: "N",
    status: "READY",
    resetRuntime: true,
    previousEnabled,
    actionCode: "POLICY_AUTO_OFF_USER_SOFT",
    note: `${reasonCode || "POLICY_TRIGGER"}:${status === "EXACT_WAIT" ? "signal-entry-pending-canceled" : "signal-idle-stopped"}`,
    metadata: { reasonCode, reasonText, status },
  });
  await appendSignalPolicyAutoOffEventLog({
    uid,
    current,
    nextEnabled: "N",
    nextStatus: "READY",
    label: "정책AUTO_OFF_계정SOFT_U",
    reasonCode,
    reasonText,
  });

  return {
    pid: current.pid,
    strategyName: current.strategyName || null,
    status: "EXECUTED",
    note: status === "EXACT_WAIT" ? "signal-entry-pending-canceled" : "signal-idle-stopped",
    before: current,
    after: await loadLiveStrategySnapshot(uid, current.pid),
  };
};

const applySignalStrategyUserHardOff = async ({
  uid,
  strategy,
  reasonCode,
  reasonText,
} = {}) => {
  const current = await loadLiveStrategySnapshot(uid, strategy.pid);
  if (!current) {
    return {
      pid: strategy.pid,
      strategyName: strategy.strategyName || null,
      status: "FAILED",
      note: "signal-strategy-not-found",
      before: null,
      after: null,
    };
  }

  const status = normalizeUpper(current.status);
  const previousEnabled = getStrategyEnabledFlag(current);

  if (status === "EXACT") {
    getSeon().setPendingPlayCloseReason("Y", current.pid, "manual-off");
    await applySignalControlState({
      uid,
      pid: current.pid,
      enabled: "N",
      status: current.status,
      resetRuntime: false,
      previousEnabled,
      actionCode: "POLICY_AUTO_OFF_USER_HARD",
      note: `${reasonCode || "POLICY_TRIGGER"}:signal-manual-close-dispatched`,
      metadata: { reasonCode, reasonText, status, exitReason: "manual-off" },
    });
    await appendSignalPolicyAutoOffEventLog({
      uid,
      current,
      nextEnabled: "N",
      nextStatus: current.status,
      label: "정책AUTO_OFF_계정HARD_U",
      reasonCode,
      reasonText,
      exitReason: "manual-off",
    });

    return {
      pid: current.pid,
      strategyName: current.strategyName || null,
      status: "EXECUTED",
      note: "signal-manual-close-dispatched",
      before: current,
      after: await loadLiveStrategySnapshot(uid, current.pid),
    };
  }

  if (false && runtimeState.isLegacyExitPendingStatus(status)) {
    await applySignalControlState({
      uid,
      pid: current.pid,
      enabled: "N",
      status: current.status,
      resetRuntime: false,
      previousEnabled,
      actionCode: "POLICY_AUTO_OFF_USER_HARD",
      note: `${reasonCode || "POLICY_TRIGGER"}:signal-exit-pending-kept-off`,
      metadata: { reasonCode, reasonText, status, exitReason: "manual-off" },
    });
    await appendSignalPolicyAutoOffEventLog({
      uid,
      current,
      nextEnabled: "N",
      nextStatus: current.status,
      label: "정책AUTO_OFF_계정HARD_U",
      reasonCode,
      reasonText,
      exitReason: "manual-off",
    });

    return {
      pid: current.pid,
      strategyName: current.strategyName || null,
      status: "EXECUTED",
      note: "signal-exit-pending-kept-off",
      before: current,
      after: await loadLiveStrategySnapshot(uid, current.pid),
    };
  }

  await applySignalControlState({
    uid,
    pid: current.pid,
    enabled: "N",
    status: "READY",
    resetRuntime: true,
    previousEnabled,
    actionCode: "POLICY_AUTO_OFF_USER_HARD",
    note: `${reasonCode || "POLICY_TRIGGER"}:${status === "EXACT_WAIT" ? "signal-entry-pending-canceled" : "signal-idle-stopped"}`,
    metadata: { reasonCode, reasonText, status },
  });
  await appendSignalPolicyAutoOffEventLog({
    uid,
    current,
    nextEnabled: "N",
    nextStatus: "READY",
    label: "정책AUTO_OFF_계정HARD_U",
    reasonCode,
    reasonText,
  });

  return {
    pid: current.pid,
    strategyName: current.strategyName || null,
    status: "EXECUTED",
    note: status === "EXACT_WAIT" ? "signal-entry-pending-canceled" : "signal-idle-stopped",
    before: current,
    after: await loadLiveStrategySnapshot(uid, current.pid),
  };
};

const executeUserAutoOffAction = async ({
  uid,
  rule,
  scopeTarget,
  snapshot = {},
  reasonCode = null,
  reasonText = null,
} = {}) => {
  const actionMode = normalizeRuleMode(rule);
  const signalStrategies = await loadSignalStrategies(uid);
  const gridStrategies = await loadLiveGridStrategies(uid);

  if (!signalStrategies.length && !gridStrategies.length) {
    const actionLogId = await insertPolicyActionLog({
      ruleCode: rule.ruleCode,
      scopeType: rule.scopeType,
      scopeTarget,
      uid,
      actionType: rule.actionType,
      actionMode,
      status: "SKIPPED",
      note: "운영 중인 사용자 전략이 없어 사용자 단위 AUTO OFF를 건너뛰었습니다.",
      result: {
        reasonCode,
        reasonText,
        snapshot,
      },
    });

    return {
      actualAction: "NONE",
      actionStatus: "SKIPPED",
      actionLogId,
      note: "no-user-strategies",
    };
  }

  const signalResults = [];
  for (const strategy of signalStrategies) {
    const result =
      actionMode === "HARD"
        ? await applySignalStrategyUserHardOff({ uid, strategy, reasonCode, reasonText })
        : await applySignalStrategyUserSoftOff({ uid, strategy, reasonCode, reasonText });
    signalResults.push(result);
  }

  const gridResults = [];
  for (const row of gridStrategies) {
    const before = await loadLiveGridStrategySnapshot(uid, row.pid);
    if (!before) {
      gridResults.push({
        pid: row.pid,
        strategyName: row.strategyName || null,
        status: "FAILED",
        note: "grid-strategy-not-found",
        before: null,
        after: null,
      });
      continue;
    }

    try {
      const previousEnabled = normalizeEnabledValue(before.enabled);
      await applyGridControlState({
        uid,
        pid: before.pid,
        enabled: "N",
        regimeEndReason: actionMode === "HARD" ? "POLICY_AUTO_OFF_USER" : before.regimeEndReason || "POLICY_AUTO_OFF_USER",
        previousEnabled,
        actionCode: actionMode === "HARD" ? "POLICY_AUTO_OFF_USER_HARD" : "POLICY_AUTO_OFF_USER_SOFT",
        note: `${reasonCode || "POLICY_TRIGGER"}:${actionMode === "HARD" ? "grid-hard-deactivate" : "grid-soft-suspend"}`,
        metadata: {
          reasonCode,
          reasonText,
          actionMode,
        },
      });

      if (actionMode === "HARD") {
        await getGridEngine().deactivateGridStrategy("LIVE", before, "POLICY_AUTO_OFF_USER");
      } else {
        await getGridEngine().suspendGridStrategy("LIVE", before, "POLICY_AUTO_OFF_USER");
      }

      gridResults.push({
        pid: before.pid,
        strategyName: before.strategyName || null,
        status: "EXECUTED",
        note: actionMode === "HARD" ? "grid-hard-deactivated" : "grid-soft-suspended",
        before,
        after: await loadLiveGridStrategySnapshot(uid, before.pid),
      });
    } catch (error) {
      gridResults.push({
        pid: before.pid,
        strategyName: before.strategyName || null,
        status: "FAILED",
        note: error?.message || String(error),
        before,
        after: await loadLiveGridStrategySnapshot(uid, before.pid),
      });
    }
  }

  const executedCount = [...signalResults, ...gridResults].filter((item) => item.status === "EXECUTED").length;
  const failedCount = [...signalResults, ...gridResults].filter((item) => item.status === "FAILED").length;
  const skippedCount = [...signalResults, ...gridResults].filter((item) => item.status === "SKIPPED").length;
  const actionStatus = executedCount > 0 ? "EXECUTED" : failedCount > 0 ? "FAILED" : "SKIPPED";
  const actualAction = executedCount > 0 ? rule.actionType : "NONE";
  const actionLogId = await insertPolicyActionLog({
    ruleCode: rule.ruleCode,
    scopeType: rule.scopeType,
    scopeTarget,
    uid,
    actionType: rule.actionType,
    actionMode,
    status: actionStatus,
    note:
      reasonText ||
      `사용자 단위 AUTO OFF를 수행했습니다. executed:${executedCount}, failed:${failedCount}, skipped:${skippedCount}`,
    result: {
      reasonCode,
      reasonText,
      snapshot,
      counts: {
        signalCount: signalResults.length,
        gridCount: gridResults.length,
        executedCount,
        failedCount,
        skippedCount,
      },
      signalResults,
      gridResults,
    },
  });

  return {
    actualAction,
    actionStatus,
    actionLogId,
    note:
      actionStatus === "EXECUTED"
        ? "user-auto-off-executed"
        : actionStatus === "FAILED"
          ? "user-auto-off-failed"
          : "user-auto-off-skipped",
  };
};

const executeGlobalKillSwitch = async ({
  rule = null,
  actorId = null,
  note = null,
} = {}) => {
  if (!rule || normalizeUpper(rule.ruleCode) !== "GLOBAL_KILL_SWITCH") {
    return {
      actualAction: "NONE",
      actionStatus: "SKIPPED",
      actionLogId: null,
      note: "invalid-rule",
    };
  }

  const actionMode = normalizeRuleMode(rule);
  const config = {
    ...DEFAULT_GLOBAL_KILL_SWITCH_CONFIG,
    ...safeJsonParse(rule.configJson || rule.config, {}),
  };
  const blockedCategories = Array.isArray(config.blockedCategories)
    ? config.blockedCategories.map((item) => normalizeLower(item)).filter(Boolean)
    : [];
  const blockAll =
    !blockedCategories.length || blockedCategories.includes("all");
  const shouldHandleSignal = blockAll || blockedCategories.includes("signal");
  const shouldHandleGrid = blockAll || blockedCategories.includes("grid");

  const signalStrategies = shouldHandleSignal ? await loadAllLiveSignalStrategies() : [];
  const gridStrategies = shouldHandleGrid ? await loadAllLiveGridStrategies() : [];

  const signalResults = [];
  for (const strategy of signalStrategies) {
    const result =
      actionMode === "HARD"
        ? await applySignalStrategyUserHardOff({
            uid: strategy.uid,
            strategy,
            reasonCode: "GLOBAL_KILL_SWITCH",
            reasonText: note || "글로벌 kill-switch가 활성화되었습니다.",
          })
        : await applySignalStrategyUserSoftOff({
            uid: strategy.uid,
            strategy,
            reasonCode: "GLOBAL_KILL_SWITCH",
            reasonText: note || "글로벌 kill-switch가 활성화되었습니다.",
          });
    signalResults.push({
      uid: strategy.uid,
      ...result,
    });
  }

  const gridResults = [];
  for (const strategy of gridStrategies) {
    const before = await loadLiveGridStrategySnapshot(strategy.uid, strategy.pid);
    if (!before) {
      gridResults.push({
        uid: strategy.uid,
        pid: strategy.pid,
        strategyName: strategy.strategyName || null,
        status: "FAILED",
        note: "grid-strategy-not-found",
        before: null,
        after: null,
      });
      continue;
    }

    try {
      const previousEnabled = normalizeEnabledValue(before.enabled);
      await applyGridControlState({
        uid: strategy.uid,
        pid: before.pid,
        enabled: "N",
        regimeEndReason: actionMode === "HARD" ? "GLOBAL_KILL_SWITCH" : before.regimeEndReason || "GLOBAL_KILL_SWITCH",
        previousEnabled,
        actionCode: actionMode === "HARD" ? "POLICY_GLOBAL_KILL_SWITCH_HARD" : "POLICY_GLOBAL_KILL_SWITCH_SOFT",
        note: `GLOBAL_KILL_SWITCH:${actionMode === "HARD" ? "grid-hard-deactivate" : "grid-soft-suspend"}`,
        metadata: {
          note: note || null,
          actionMode,
        },
      });

      if (actionMode === "HARD") {
        await getGridEngine().deactivateGridStrategy("LIVE", before, "GLOBAL_KILL_SWITCH");
      } else {
        await getGridEngine().suspendGridStrategy("LIVE", before, "GLOBAL_KILL_SWITCH");
      }

      gridResults.push({
        uid: strategy.uid,
        pid: before.pid,
        strategyName: before.strategyName || null,
        status: "EXECUTED",
        note: actionMode === "HARD" ? "grid-hard-kill-switch" : "grid-soft-kill-switch",
        before,
        after: await loadLiveGridStrategySnapshot(strategy.uid, before.pid),
      });
    } catch (error) {
      gridResults.push({
        uid: strategy.uid,
        pid: strategy.pid,
        strategyName: strategy.strategyName || null,
        status: "FAILED",
        note: error?.message || String(error),
        before,
        after: await loadLiveGridStrategySnapshot(strategy.uid, strategy.pid),
      });
    }
  }

  const allResults = [...signalResults, ...gridResults];
  const executedCount = allResults.filter((item) => item.status === "EXECUTED").length;
  const failedCount = allResults.filter((item) => item.status === "FAILED").length;
  const skippedCount = allResults.filter((item) => item.status === "SKIPPED").length;
  const actionStatus = executedCount > 0 ? "EXECUTED" : failedCount > 0 ? "FAILED" : "SKIPPED";
  const actualAction = executedCount > 0 ? rule.actionType : "NONE";
  const actionLogId = await insertPolicyActionLog({
    ruleCode: rule.ruleCode,
    scopeType: rule.scopeType,
    scopeTarget: rule.scopeTarget,
    actionType: rule.actionType,
    actionMode,
    status: actionStatus,
    actorType: actorId ? "ADMIN" : "SYSTEM",
    actorId,
    note:
      note ||
      `글로벌 kill-switch를 적용했습니다. executed:${executedCount}, failed:${failedCount}, skipped:${skippedCount}`,
    result: {
      blockedCategories: blockAll ? ["all"] : blockedCategories,
      counts: {
        signalCount: signalResults.length,
        gridCount: gridResults.length,
        executedCount,
        failedCount,
        skippedCount,
      },
      signalResults,
      gridResults,
    },
  });

  return {
    actualAction,
    actionStatus,
    actionLogId,
    note:
      actionStatus === "EXECUTED"
        ? "global-kill-switch-executed"
        : actionStatus === "FAILED"
          ? "global-kill-switch-failed"
          : "global-kill-switch-skipped",
  };
};

const evaluateConsecutiveStopLossRuleForStrategy = async ({
  uid,
  strategy,
  rule,
  persist = true,
  executeActions = false,
} = {}) => {
  const config = {
    ...DEFAULT_CONSEC_STOPLOSS_CONFIG,
    ...safeJsonParse(rule.configJson || rule.config, {}),
  };
  const maxLogs = Math.max(toNumber(config.maxLogs, DEFAULT_CONSEC_STOPLOSS_CONFIG.maxLogs), 1);
  const logs = await loadStrategyRecentCloseLogs(uid, strategy.pid, maxLogs);
  const streakSnapshot = buildConsecutiveStopLossSnapshot(logs, config);
  const scopeTarget = `${normalizeLower(config.strategyCategory, "signal")}:${strategy.pid}`;
  const currentStateRow = await loadPolicyRuntimeState({
    ruleCode: rule.ruleCode,
    scopeType: rule.scopeType,
    scopeTarget,
  });
  const currentState = currentStateRow?.stateValue || {};
  const consecutiveLosses = streakSnapshot.consecutiveLosses;
  const threshold = Math.max(
    toNumber(config.maxConsecutiveLosses, DEFAULT_CONSEC_STOPLOSS_CONFIG.maxConsecutiveLosses),
    1
  );
  const matched = consecutiveLosses >= threshold;
  const severity = matched ? "high" : consecutiveLosses > 0 ? "medium" : "low";
  const reasonCode = matched
    ? "STRATEGY_CONSEC_STOPLOSS_THRESHOLD"
    : consecutiveLosses > 0
      ? "STRATEGY_CONSEC_STOPLOSS_STREAK"
      : "STRATEGY_CONSEC_STOPLOSS_CLEAR";
  const reasonText = matched
    ? `${strategy.strategyName || `전략 ${strategy.pid}`}의 최근 연속 손절이 ${consecutiveLosses}회로 임계치 ${threshold}회에 도달했습니다.`
    : consecutiveLosses > 0
      ? `${strategy.strategyName || `전략 ${strategy.pid}`}의 최근 연속 손절이 ${consecutiveLosses}회입니다.`
      : `${strategy.strategyName || `전략 ${strategy.pid}`}의 연속 손절 상태가 정상 범위입니다.`;
  const recommendedAction = matched ? rule.actionType : "NONE";
  const snapshot = {
    uid,
    pid: strategy.pid,
    strategyName: strategy.strategyName || null,
    strategyCategory: normalizeLower(config.strategyCategory, "signal"),
    consecutiveLosses,
    threshold,
    latestLogId: streakSnapshot.latestLogId,
    recentExits: streakSnapshot.recent,
  };
  const nextFingerprint = buildEvalFingerprint({
    matched,
    severity,
    reasonCode,
    recommendedAction,
    extra: consecutiveLosses,
  });
  const shouldLog =
    (consecutiveLosses > 0 || Boolean(currentState?.lastMatched)) &&
    shouldPersistEvalLog({
      currentState,
      nextFingerprint,
      matched,
      cooldownMinutes: config.cooldownMinutes,
    });
  const shouldExecuteAction =
    Boolean(matched) &&
    Boolean(persist) &&
    Boolean(executeActions) &&
    normalizeUpper(rule.actionType) === "AUTO_OFF_STRATEGY" &&
    !isRuleDryRunMode(rule) &&
    currentState?.lastActionFingerprint !== nextFingerprint;
  let actualAction = "NONE";
  let actionStatus = "NONE";
  let actionLogId = null;

  if (shouldExecuteAction) {
    const actionResult = await executeSignalStrategyAutoOffAction({
      uid,
      strategy,
      rule,
      scopeTarget,
      snapshot,
      reasonCode,
      reasonText,
    });
    actualAction = actionResult.actualAction || "NONE";
    actionStatus = actionResult.actionStatus || "NONE";
    actionLogId = actionResult.actionLogId || null;
  }

  const nextState = {
    ...currentState,
    consecutiveLosses,
    latestLogId: streakSnapshot.latestLogId,
    lastMatched: matched,
    lastReasonCode: reasonCode,
    lastFingerprint: nextFingerprint,
    lastActionFingerprint: shouldExecuteAction ? nextFingerprint : matched ? currentState?.lastActionFingerprint || null : null,
    lastActionStatus: actionStatus !== "NONE" ? actionStatus : currentState?.lastActionStatus || null,
    lastActionAt: actionStatus !== "NONE" ? asIsoString() : currentState?.lastActionAt || null,
    lastActionLogId: actionLogId || currentState?.lastActionLogId || null,
    updatedAt: asIsoString(),
  };

  let evalLogId = null;
  if (shouldLog && persist) {
    evalLogId = await insertPolicyEvalLog({
      ruleCode: rule.ruleCode,
      scopeType: rule.scopeType,
      scopeTarget,
      uid,
      pid: strategy.pid,
      strategyCategory: normalizeLower(config.strategyCategory, "signal"),
      severity,
      matched,
      reasonCode,
      reasonText,
      snapshot,
      recommendedAction,
      actualAction,
    });
    nextState.lastLoggedAt = asIsoString();
  } else if (actionStatus !== "NONE" && persist && actualAction !== "NONE") {
    evalLogId = await insertPolicyEvalLog({
      ruleCode: rule.ruleCode,
      scopeType: rule.scopeType,
      scopeTarget,
      uid,
      pid: strategy.pid,
      strategyCategory: normalizeLower(config.strategyCategory, "signal"),
      severity,
      matched,
      reasonCode,
      reasonText,
      snapshot,
      recommendedAction,
      actualAction,
    });
    nextState.lastLoggedAt = asIsoString();
  }

  if (evalLogId && actualAction !== "NONE") {
    await updatePolicyEvalActualAction(evalLogId, actualAction);
  }

  if (persist) {
    await upsertPolicyRuntimeState({
      ruleCode: rule.ruleCode,
      scopeType: rule.scopeType,
      scopeTarget,
      uid,
      pid: strategy.pid,
      strategyCategory: normalizeLower(config.strategyCategory, "signal"),
      stateValue: nextState,
    });
  }

  return {
    ruleCode: rule.ruleCode,
    ruleLabel: buildRuleLabel(rule.ruleCode),
    scopeType: rule.scopeType,
    scopeTarget,
    uid,
    pid: strategy.pid,
    strategyCategory: normalizeLower(config.strategyCategory, "signal"),
    strategyName: strategy.strategyName || null,
    matched,
    severity,
    reasonCode,
    reasonLabel: POLICY_REASON_LABELS[reasonCode] || reasonCode,
    reasonText,
    recommendedAction,
    actualAction,
    actionStatus,
    actionLogId,
    snapshot,
    logged: shouldLog,
  };
};

const evaluateUserAccountPolicies = async ({ uid, snapshot, persist = true, executeActions = false } = {}) => {
  const rules = await loadPolicyRules({
    scopeType: "USER",
    scopeTarget: String(uid),
    enabledOnly: true,
  });

  const results = [];
  for (const rule of rules) {
    if (rule.ruleCode === "ACCOUNT_MARGIN_RATIO_WARNING") {
      results.push(await evaluateMarginRatioRule({ uid, rule, snapshot, persist }));
      continue;
    }

    if (rule.ruleCode === "ACCOUNT_MDD_AUTO_OFF") {
      results.push(await evaluateAccountMddRule({ uid, rule, snapshot, persist, executeActions }));
    }
  }

  return results;
};

const evaluateUserStrategyPolicies = async ({ uid, persist = true, executeActions = false, strategyPid = null } = {}) => {
  const rules = await loadPolicyRules({
    scopeType: "STRATEGY",
    scopeTarget: "*",
    enabledOnly: true,
  });

  if (!rules.length) {
    return [];
  }

  const strategies = await loadSignalStrategies(uid, { strategyPid });
  const results = [];

  for (const strategy of strategies) {
    for (const rule of rules) {
      const config = {
        ...DEFAULT_CONSEC_STOPLOSS_CONFIG,
        ...safeJsonParse(rule.configJson || rule.config, {}),
      };

      if (normalizeLower(config.strategyCategory, "signal") !== "signal") {
        continue;
      }

      results.push(
        await evaluateConsecutiveStopLossRuleForStrategy({
          uid,
          strategy,
          rule,
          persist,
          executeActions,
        })
      );
    }
  }

  return results;
};

const buildUserPolicyPreview = async ({ uid, snapshot = null, persist = true } = {}) => {
  const accountSnapshot = snapshot || null;
  const accountEvaluations = accountSnapshot
    ? await evaluateUserAccountPolicies({
        uid,
        snapshot: accountSnapshot,
        persist,
      })
    : [];
  const strategyEvaluations = await evaluateUserStrategyPolicies({
    uid,
    persist,
  });

  return {
    evaluatedAt: asIsoString(),
    uid,
    accountEvaluations,
    strategyEvaluations,
    unsupported: [
      {
        strategyCategory: "grid",
        code: "GRID_POLICY_HISTORY_NOT_READY",
        label: "Grid 연속 손절 정책은 전용 종료 이력 테이블을 붙인 뒤 활성화합니다.",
      },
    ],
  };
};

const listPolicyEvalLogs = async ({
  uid = null,
  pid = null,
  ruleCode = null,
  scopeType = null,
  severity = null,
  matched = null,
  limit = 50,
} = {}) => {
  const conditions = [];
  const params = [];

  if (uid) {
    conditions.push("uid = ?");
    params.push(uid);
  }
  if (pid) {
    conditions.push("pid = ?");
    params.push(pid);
  }
  if (ruleCode) {
    conditions.push("rule_code = ?");
    params.push(ruleCode);
  }
  if (scopeType) {
    conditions.push("scope_type = ?");
    params.push(scopeType);
  }
  if (severity) {
    conditions.push("severity = ?");
    params.push(normalizeLower(severity));
  }
  if (matched === true || matched === false) {
    conditions.push("matched = ?");
    params.push(matched ? "Y" : "N");
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await db.query(
    `SELECT
        id,
        rule_code AS ruleCode,
        scope_type AS scopeType,
        scope_target AS scopeTarget,
        uid,
        pid,
        strategy_category AS strategyCategory,
        severity,
        matched,
        reason_code AS reasonCode,
        reason_text AS reasonText,
        snapshot_json AS snapshotJson,
        recommended_action AS recommendedAction,
        actual_action AS actualAction,
        created_at AS createdAt
      FROM policy_eval_log
      ${whereSql}
      ORDER BY id DESC
      LIMIT ?`,
    [...params, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)]
  );

  return rows.map((row) => ({
    ...row,
    snapshot: safeJsonParse(row.snapshotJson, {}),
  }));
};

const summarizePolicyEvalLogs = async ({ hours = 24, uid = null } = {}) => {
  const conditions = ["created_at >= ?"];
  const params = [new Date(Date.now() - Math.max(hours, 1) * 3600 * 1000)];

  if (uid) {
    conditions.push("uid = ?");
    params.push(uid);
  }

  const [rows] = await db.query(
    `SELECT
        rule_code AS ruleCode,
        scope_type AS scopeType,
        severity,
        matched,
        COUNT(*) AS evalCount,
        MAX(created_at) AS lastCreatedAt
      FROM policy_eval_log
      WHERE ${conditions.join(" AND ")}
      GROUP BY rule_code, scope_type, severity, matched
      ORDER BY rule_code ASC, severity DESC, matched DESC`,
    params
  );

  return rows || [];
};

const listMatchedPolicyWarnings = async ({ hours = 24, uid = null, limit = 20 } = {}) => {
  const conditions = ["created_at >= ?", "matched = 'Y'"];
  const params = [new Date(Date.now() - Math.max(hours, 1) * 3600 * 1000)];

  if (uid) {
    conditions.push("uid = ?");
    params.push(uid);
  }

  const [rows] = await db.query(
    `SELECT
        id,
        rule_code AS ruleCode,
        scope_type AS scopeType,
        scope_target AS scopeTarget,
        uid,
        pid,
        strategy_category AS strategyCategory,
        severity,
        matched,
        reason_code AS reasonCode,
        reason_text AS reasonText,
        snapshot_json AS snapshotJson,
        recommended_action AS recommendedAction,
        actual_action AS actualAction,
        created_at AS createdAt
      FROM policy_eval_log
      WHERE ${conditions.join(" AND ")}
      ORDER BY id DESC
      LIMIT ?`,
    [...params, Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200)]
  );

  return rows.map((row) => ({
    ...row,
    snapshot: safeJsonParse(row.snapshotJson, {}),
  }));
};

const summarizeMatchedPolicyWarnings = async ({ hours = 24, uid = null } = {}) => {
  const conditions = ["created_at >= ?", "matched = 'Y'"];
  const params = [new Date(Date.now() - Math.max(hours, 1) * 3600 * 1000)];

  if (uid) {
    conditions.push("uid = ?");
    params.push(uid);
  }

  const [rows] = await db.query(
    `SELECT
        uid,
        scope_type AS scopeType,
        severity,
        COUNT(*) AS warningCount,
        MAX(created_at) AS lastCreatedAt
      FROM policy_eval_log
      WHERE ${conditions.join(" AND ")}
      GROUP BY uid, scope_type, severity
      ORDER BY severity DESC, scope_type ASC`,
    params
  );

  return rows || [];
};

const listPolicyActionLogs = async ({
  hours = 24,
  uid = null,
  pid = null,
  ruleCode = null,
  status = null,
  limit = 50,
} = {}) => {
  const conditions = ["created_at >= ?"];
  const params = [new Date(Date.now() - Math.max(hours, 1) * 3600 * 1000)];

  if (uid) {
    conditions.push("uid = ?");
    params.push(uid);
  }

  if (pid) {
    conditions.push("pid = ?");
    params.push(pid);
  }

  if (ruleCode) {
    conditions.push("rule_code = ?");
    params.push(ruleCode);
  }

  if (status) {
    conditions.push("status = ?");
    params.push(normalizeUpper(status));
  }

  const [rows] = await db.query(
    `SELECT
        id,
        rule_code AS ruleCode,
        scope_type AS scopeType,
        scope_target AS scopeTarget,
        uid,
        pid,
        strategy_category AS strategyCategory,
        action_type AS actionType,
        action_mode AS actionMode,
        status,
        actor_type AS actorType,
        actor_id AS actorId,
        note,
        result_json AS resultJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM policy_action_log
      WHERE ${conditions.join(" AND ")}
      ORDER BY id DESC
      LIMIT ?`,
    [...params, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)]
  );

  return rows.map((row) => ({
    ...row,
    result: safeJsonParse(row.resultJson, {}),
  }));
};

const summarizePolicyActionLogs = async ({ hours = 24, uid = null } = {}) => {
  const conditions = ["created_at >= ?"];
  const params = [new Date(Date.now() - Math.max(hours, 1) * 3600 * 1000)];

  if (uid) {
    conditions.push("uid = ?");
    params.push(uid);
  }

  const [rows] = await db.query(
    `SELECT
        rule_code AS ruleCode,
        action_type AS actionType,
        action_mode AS actionMode,
        status,
        COUNT(*) AS actionCount,
        MAX(created_at) AS lastCreatedAt
      FROM policy_action_log
      WHERE ${conditions.join(" AND ")}
      GROUP BY rule_code, action_type, action_mode, status
      ORDER BY rule_code ASC, status ASC`,
    params
  );

  return rows || [];
};

module.exports = {
  POLICY_SCOPE_TYPE_LABELS,
  POLICY_ACTION_TYPE_LABELS,
  POLICY_MODE_LABELS,
  POLICY_REASON_LABELS,
  decoratePolicyRule,
  getGlobalKillSwitchState,
  loadPolicyRules,
  listPolicyEvalLogs,
  summarizePolicyEvalLogs,
  listMatchedPolicyWarnings,
  summarizeMatchedPolicyWarnings,
  listPolicyActionLogs,
  summarizePolicyActionLogs,
  executeGlobalKillSwitch,
  evaluateUserAccountPolicies,
  evaluateUserStrategyPolicies,
  buildUserPolicyPreview,
};
