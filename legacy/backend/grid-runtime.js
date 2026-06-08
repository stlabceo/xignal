const db = require("./database/connect/config");
const canonicalRuntimeState = require("./canonical-runtime-state");

const GRID_REGIME_END_REASON_LABELS = {
  BOX_BREAK: "박스 종료",
  BOX_BREAK_WAITING: "박스 대기 종료",
  GRID_BREAKOUT_OBSERVED: "GRID_BREAKOUT_OBSERVED",
  GRID_EXIT_CONFIRM_PENDING: "GRID_EXIT_CONFIRM_PENDING",
  GRID_EXIT_ALERT: "GRID_EXIT_ALERT",
  CANDLE_CLOSE_BREAKOUT: "CANDLE_CLOSE_BREAKOUT",
  MANUAL_OFF: "수동 종료",
  NEW_WEBHOOK: "새 레짐 수신",
};

const GRID_LEG_STATUS_LABELS = {
  IDLE: "대기",
  ENTRY_ARMED: "진입대기",
  OPEN: "포지션보유",
  EXIT_ARMED: "청산대기",
};

const normalizeGridSignalKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

const normalizeGridSymbol = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_]+:/, "")
    .replace(/\.P$/i, "");

const GRID_BUNBONG_ALIAS_MAP = new Map([
  ["1", "1MIN"],
  ["1M", "1MIN"],
  ["1MIN", "1MIN"],
  ["2", "2MIN"],
  ["2M", "2MIN"],
  ["2MIN", "2MIN"],
  ["5", "5MIN"],
  ["5M", "5MIN"],
  ["5MIN", "5MIN"],
  ["10", "10MIN"],
  ["10M", "10MIN"],
  ["10MIN", "10MIN"],
  ["15", "15MIN"],
  ["15M", "15MIN"],
  ["15MIN", "15MIN"],
  ["30", "30MIN"],
  ["30M", "30MIN"],
  ["30MIN", "30MIN"],
  ["60", "1H"],
  ["60M", "1H"],
  ["60MIN", "1H"],
  ["1H", "1H"],
  ["120", "2H"],
  ["120M", "2H"],
  ["120MIN", "2H"],
  ["2H", "2H"],
]);

const normalizeGridBunbong = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!normalized) {
    return "";
  }

  const hourMatch = normalized.match(/^(\d+)\s*(H|HR|HOUR|HOURS)$/);
  if (hourMatch) {
    const canonicalHour = GRID_BUNBONG_ALIAS_MAP.get(`${hourMatch[1]}H`);
    return canonicalHour || `${hourMatch[1]}H`;
  }

  const minuteMatch = normalized.match(/^(\d+)\s*(M|MIN|MINUTE|MINUTES)?$/);
  if (minuteMatch) {
    const canonicalMinute = GRID_BUNBONG_ALIAS_MAP.get(minuteMatch[1]) || GRID_BUNBONG_ALIAS_MAP.get(`${minuteMatch[1]}MIN`);
    return canonicalMinute || `${minuteMatch[1]}MIN`;
  }

  return GRID_BUNBONG_ALIAS_MAP.get(normalized) || normalized;
};

const parseGridPrice = (value) => {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const numeric = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
};

const normalizeGridContractEnum = (value, allowed, fallback) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
};

const getGridExitFeatureFlags = (env = process.env) => ({
  GRID_EXIT_CONTRACT_MODE: normalizeGridContractEnum(
    env.GRID_EXIT_CONTRACT_MODE,
    ["OFF", "SHADOW", "ENFORCE"],
    "SHADOW"
  ),
  GRID_CANDLE_CLOSE_LEGACY_MODE: normalizeGridContractEnum(
    env.GRID_CANDLE_CLOSE_LEGACY_MODE,
    ["AUDIT_ONLY", "REJECT"],
    "AUDIT_ONLY"
  ),
  GRID_EXIT_ORCHESTRATOR_ENABLED:
    String(env.GRID_EXIT_ORCHESTRATOR_ENABLED || "0").trim() === "1" ? "1" : "0",
  GRID_EMERGENCY_STOP_BACKSTOP_MODE: normalizeGridContractEnum(
    env.GRID_EMERGENCY_STOP_BACKSTOP_MODE,
    ["LEGACY", "NEW_KEYED_ONLY", "ENFORCE"],
    "NEW_KEYED_ONLY"
  ),
});

const normalizeGridRegimeStrategySignal = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

const normalizeGridRegimeTime = (value) => {
  const normalized = normalizeGridSignalTime(value);
  return normalized ? String(normalized).replace(/\s+/g, "T") : "";
};

const normalizeGridRegimePrice = (value) => {
  const numeric = parseGridPrice(value);
  if (!(numeric > 0)) {
    return "";
  }
  return numeric
    .toFixed(12)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
};

const buildGridRegimeKey = (input = {}) => {
  const strategySignal = normalizeGridRegimeStrategySignal(input.strategySignal);
  const symbol = normalizeGridSymbol(input.symbol || input.ticker || input.market);
  const timeframe = normalizeGridBunbong(
    input.bunbong || input.timeframe || input.timeFrame || input.interval || input.candle_min
  );
  const supportPrice = normalizeGridRegimePrice(
    input.supportPrice ?? input.support ?? input.supportLine ?? input.lowerLine
  );
  const resistancePrice = normalizeGridRegimePrice(
    input.resistancePrice ?? input.resistance ?? input.resistanceLine ?? input.upperLine
  );
  const triggerPrice = normalizeGridRegimePrice(
    input.triggerPrice ?? input.trigger ?? input.triggerLine ?? input.centerLine
  );
  const signalTime = normalizeGridRegimeTime(
    input.signalTime ?? input.time ?? input.eventTime ?? input.triggeredAt
  );

  return [
    "GRIDREGIME",
    "v1",
    strategySignal,
    symbol,
    timeframe,
    supportPrice,
    resistancePrice,
    triggerPrice,
    signalTime,
  ].join("|");
};

const getGridRegimeKeyMissingFields = (payload = {}) => {
  const missing = [];
  if (!normalizeGridRegimeStrategySignal(payload.strategySignal)) missing.push("strategySignal");
  if (!normalizeGridSymbol(payload.symbol || payload.ticker || payload.market)) missing.push("symbol");
  if (!normalizeGridBunbong(payload.bunbong || payload.timeframe || payload.timeFrame || payload.interval || payload.candle_min)) missing.push("timeframe");
  if (!normalizeGridRegimePrice(payload.supportPrice ?? payload.support ?? payload.supportLine ?? payload.lowerLine)) missing.push("supportPrice");
  if (!normalizeGridRegimePrice(payload.resistancePrice ?? payload.resistance ?? payload.resistanceLine ?? payload.upperLine)) missing.push("resistancePrice");
  if (!normalizeGridRegimePrice(payload.triggerPrice ?? payload.trigger ?? payload.triggerLine ?? payload.centerLine)) missing.push("triggerPrice");
  if (!normalizeGridRegimeTime(payload.signalTime ?? payload.time ?? payload.eventTime ?? payload.triggeredAt)) missing.push("signalTime");
  return missing;
};

const hasForbiddenGridSignalPriceField = (payload = {}) =>
  payload &&
  typeof payload === "object" &&
  (Object.prototype.hasOwnProperty.call(payload, "signalPrice") ||
    Object.prototype.hasOwnProperty.call(payload, "signal_price"));

const validateGridRegimeKeyContract = ({ eventType, payload = {}, flags = getGridExitFeatureFlags() } = {}) => {
  const contractMode = flags.GRID_EXIT_CONTRACT_MODE;
  const suppliedKey = String(payload.gridRegimeKey || payload.grid_regime_key || "").trim();
  const canonicalKey = buildGridRegimeKey(payload);
  const missingFields = getGridRegimeKeyMissingFields(payload);
  const prefix = String(eventType || "GRID").toLowerCase().replace(/_/g, "-");
  const warnings = [];

  if (!suppliedKey) {
    warnings.push(`${prefix}-missing-grid-regime-key`);
  }

  if (eventType === "GRID_ARM" && missingFields.length > 0) {
    warnings.push(`${prefix}-missing-canonical-key-fields:${missingFields.join(",")}`);
  }

  if (eventType === "GRID_ARM" && suppliedKey && missingFields.length === 0 && suppliedKey !== canonicalKey) {
    warnings.push(`${prefix}-grid-regime-key-mismatch`);
  }

  if (contractMode === "ENFORCE" && warnings.length > 0) {
    return {
      ok: false,
      reason: warnings[0],
      suppliedKey,
      canonicalKey,
      warnings,
    };
  }

  return {
    ok: true,
    reason: null,
    suppliedKey,
    canonicalKey,
    warnings: contractMode === "SHADOW" ? warnings : [],
  };
};

const parseGridStoredWebhookPayload = (row = {}) => {
  if (!row || typeof row !== "object") {
    return {};
  }
  if (row.lastWebhookPayloadJson && typeof row.lastWebhookPayloadJson === "object") {
    return row.lastWebhookPayloadJson;
  }
  const raw = String(row.lastWebhookPayloadJson || "").trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return {};
  }
};

const getStoredGridRegimeKeyForRow = (row = {}) => {
  const direct = String(row.gridRegimeKey || row.grid_regime_key || "").trim();
  if (direct) {
    return direct;
  }
  const storedPayload = parseGridStoredWebhookPayload(row);
  return String(storedPayload.gridRegimeKey || storedPayload.grid_regime_key || "").trim();
};

const GRID_WEBHOOK_FORBIDDEN_TARGET_IDENTITY_FIELDS = [
  "pid",
  "uid",
  "targetId",
  "target_id",
  "userId",
  "user_id",
  "webhookTargetId",
  "webhook_target_id",
];

const findForbiddenGridWebhookTargetIdentityField = (payload = {}) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return GRID_WEBHOOK_FORBIDDEN_TARGET_IDENTITY_FIELDS.find((field) =>
    Object.prototype.hasOwnProperty.call(payload, field)
  ) || null;
};

const normalizeGridExitAction = (payload = {}) =>
  String(
    payload?.gridAction ||
      payload?.exitAction ||
      payload?.action ||
      payload?.eventType ||
      payload?.alertType ||
      payload?.signalType ||
      payload?.grid_event ||
      ""
  )
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const isGridExitWebhookPayload = (payload = {}) =>
  normalizeGridExitAction(payload) === "GRID_EXIT" ||
  String(payload?.signal || "").trim().toUpperCase() === "GRID_EXIT";

const normalizeGridBoolean = (value) => {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "y", "yes", "closed", "confirmed"].includes(normalized);
};

const isGridCandleCloseExitWebhookPayload = (payload = {}) => {
  const action = normalizeGridExitAction(payload);
  return ["GRID_CANDLE_CLOSE", "CANDLE_CLOSE", "CANDLE_CLOSE_BREAKOUT", "GRID_CANDLE_CLOSE_BREAKOUT"].includes(action);
};

const isGridExitPolicyWebhookPayload = (payload = {}) =>
  isGridExitWebhookPayload(payload) || isGridCandleCloseExitWebhookPayload(payload);

const gridPricesEqual = (left, right) => {
  const a = parseGridPrice(left);
  const b = parseGridPrice(right);
  if (!(a > 0) || !(b > 0)) {
    return false;
  }
  return Math.abs(a - b) <= Math.max(1e-8, Math.abs(b) * 1e-10);
};

const validateGridBoxScope = (payload = {}) => {
  if (!(payload.supportPrice > 0)) {
    return { ok: false, reason: "missing-support-price" };
  }
  if (!(payload.resistancePrice > 0)) {
    return { ok: false, reason: "missing-resistance-price" };
  }
  if (!(payload.triggerPrice > 0)) {
    return { ok: false, reason: "missing-trigger-price" };
  }
  if (!(payload.supportPrice < payload.resistancePrice)) {
    return { ok: false, reason: "invalid-box-range" };
  }
  if (payload.triggerPrice <= payload.supportPrice || payload.triggerPrice >= payload.resistancePrice) {
    return { ok: false, reason: "trigger-outside-box" };
  }
  return { ok: true, reason: null };
};

const isGridExitBoxScopeMatchForRow = (row = {}, payload = {}) =>
  gridPricesEqual(row.supportPrice, payload.supportPrice) &&
  gridPricesEqual(row.resistancePrice, payload.resistancePrice) &&
  gridPricesEqual(row.triggerPrice, payload.triggerPrice);

const normalizeGridSignalTime = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw.replace("T", " ").replace(/Z$/i, "").replace(/\.\d+$/, "");
  }

  const pad = (input) => String(input).padStart(2, "0");
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-") +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
};

const GRID_WEBHOOK_TABLE_MAP = {
  live: "live_grid_strategy_list",
  test: "test_grid_strategy_list",
};

const getGridWebhookTableName = (mode = "live") =>
  GRID_WEBHOOK_TABLE_MAP[String(mode || "live").trim().toLowerCase()] || null;

const buildGridWebhookTargetItem = ({
  row = {},
  mode = "live",
  resultCode = null,
  note = null,
  nextRegimeStatus = null,
} = {}) => ({
  uid: row.uid,
  pid: row.id,
  strategyCategory: "grid",
  strategyMode: String(mode || "live").trim().toLowerCase(),
  strategyName: row.a_name || null,
  strategySignal: row.strategySignal || null,
  strategyUuid: null,
  symbol: row.symbol || null,
  bunbong: row.bunbong || null,
  legacyStatus: row.regimeStatus || null,
  regimeStatus: nextRegimeStatus || row.regimeStatus || null,
  controlState: String(row.enabled || "").trim().toUpperCase() === "Y" ? "ON" : "OFF",
  autoST: null,
  incomingSignalType: null,
  runtimeSignalType: null,
  resultCode,
  note,
});

const armGridWebhookTargetsForMode = async (mode, payload, options = {}) => {
  const tableName = getGridWebhookTableName(mode);
  if (!tableName) {
    return {
      matched: 0,
      armed: 0,
      ignoredActive: 0,
      ignoredConflict: 0,
      ignoredSignal: 0,
      targetItems: [],
    };
  }

  const scopedUid = Number(options.uid || options.userId || 0) || null;
  const uidPredicate = scopedUid ? " AND uid = ?" : "";
  const [rows] = await db.query(
      `SELECT
        id,
        uid,
        a_name,
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
      FROM ${tableName}
      WHERE enabled = 'Y'
        AND symbol = ?
        AND bunbong = ?
        ${uidPredicate}
      ORDER BY id ASC`,
    scopedUid ? [payload.symbol, payload.bunbong, scopedUid] : [payload.symbol, payload.bunbong]
  );

  const strategySignalKey = normalizeGridSignalKey(payload.strategySignal);
  const result = {
    matched: 0,
    armed: 0,
    ignoredActive: 0,
    ignoredConflict: 0,
    ignoredSignal: 0,
    targetItems: [],
  };

  for (const row of rows || []) {
    const rowSignalKey = normalizeGridSignalKey(row.strategySignal);
    if (rowSignalKey !== strategySignalKey) {
      result.ignoredSignal += 1;
      result.targetItems.push(
        buildGridWebhookTargetItem({
          row,
          mode,
          resultCode: "GRID_SIGNAL_MISMATCH",
          note: `strategySignal:${row.strategySignal || "-"}`,
        })
      );
      continue;
    }

    result.matched += 1;
    const rowRegimeStatus = String(row.regimeStatus || "").trim().toUpperCase();
    if (rowRegimeStatus && rowRegimeStatus !== "WAITING_WEBHOOK") {
      result.ignoredActive += 1;
      result.targetItems.push(
        buildGridWebhookTargetItem({
          row,
          mode,
          resultCode: "GRID_ACTIVE_IGNORED",
          note: `regimeStatus:${row.regimeStatus || "-"}`,
        })
      );
      continue;
    }

    const patchPayloadJson = JSON.stringify(payload.rawPayload || payload);
    const [updateResult] = await db.query(
      `UPDATE ${tableName}
          SET regimeStatus = 'ACTIVE',
              regimeEndReason = NULL,
              regimeReceivedAt = NOW(),
              signalTime = ?,
              supportPrice = ?,
              resistancePrice = ?,
              triggerPrice = ?,
              longLegStatus = 'ENTRY_ARMED',
              shortLegStatus = 'ENTRY_ARMED',
              longEntryOrderId = NULL,
              shortEntryOrderId = NULL,
              longExitOrderId = NULL,
              shortExitOrderId = NULL,
              longStopOrderId = NULL,
              shortStopOrderId = NULL,
              longQty = 0,
              shortQty = 0,
              longEntryPrice = NULL,
              shortEntryPrice = NULL,
              longTakeProfitPrice = NULL,
              shortTakeProfitPrice = NULL,
              longStopPrice = NULL,
              shortStopPrice = NULL,
              lastWebhookPayloadJson = ?,
              updatedAt = NOW()
        WHERE id = ?
          AND uid = ?
          AND enabled = 'Y'
          AND regimeStatus = 'WAITING_WEBHOOK'
        LIMIT 1`,
      [
        payload.signalTime || null,
        payload.supportPrice,
        payload.resistancePrice,
        payload.triggerPrice,
        patchPayloadJson,
        row.id,
        row.uid,
      ]
    );

    if (updateResult?.affectedRows > 0) {
      result.armed += 1;
      result.targetItems.push(
        buildGridWebhookTargetItem({
          row,
          mode,
          resultCode: "GRID_ARMED",
          note: "grid-regime-armed",
          nextRegimeStatus: "ACTIVE",
        })
      );
      continue;
    }

    result.ignoredConflict += 1;
    result.targetItems.push(
      buildGridWebhookTargetItem({
        row,
        mode,
        resultCode: "GRID_ACTIVE_IGNORED",
        note: "concurrent-regime-update",
      })
    );
  }

  return result;
};

const previewGridWebhookTargetsForMode = async (mode, payload, options = {}) => {
  const tableName = getGridWebhookTableName(mode);
  if (!tableName) {
    return {
      matched: 0,
      armed: 0,
      ignoredActive: 0,
      ignoredConflict: 0,
      ignoredSignal: 0,
      targetItems: [],
    };
  }

  const scopedUid = Number(options.uid || options.userId || 0) || null;
  const uidPredicate = scopedUid ? " AND uid = ?" : "";
  const [rows] = await db.query(
      `SELECT
        id,
        uid,
        a_name,
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
      FROM ${tableName}
      WHERE enabled = 'Y'
        AND symbol = ?
        AND bunbong = ?
        ${uidPredicate}
      ORDER BY id ASC`,
    scopedUid ? [payload.symbol, payload.bunbong, scopedUid] : [payload.symbol, payload.bunbong]
  );

  const strategySignalKey = normalizeGridSignalKey(payload.strategySignal);
  const result = {
    matched: 0,
    armed: 0,
    ignoredActive: 0,
    ignoredConflict: 0,
    ignoredSignal: 0,
    targetItems: [],
  };

  for (const row of rows || []) {
    const rowSignalKey = normalizeGridSignalKey(row.strategySignal);
    if (rowSignalKey !== strategySignalKey) {
      result.ignoredSignal += 1;
      result.targetItems.push(
        buildGridWebhookTargetItem({
          row,
          mode,
          resultCode: "GRID_SIGNAL_MISMATCH",
          note: `strategySignal:${row.strategySignal || "-"}`,
        })
      );
      continue;
    }

    result.matched += 1;
    const rowRegimeStatus = String(row.regimeStatus || "").trim().toUpperCase();
    if (rowRegimeStatus && rowRegimeStatus !== "WAITING_WEBHOOK") {
      result.ignoredActive += 1;
      result.targetItems.push(
        buildGridWebhookTargetItem({
          row,
          mode,
          resultCode: "GRID_ACTIVE_IGNORED",
          note: `regimeStatus:${row.regimeStatus || "-"}`,
        })
      );
      continue;
    }

    result.armed += 1;
    result.targetItems.push(
      buildGridWebhookTargetItem({
        row,
        mode,
        resultCode: "GRID_ARM_PREVIEW",
        note: "grid-regime-arm-preview",
        nextRegimeStatus: "ACTIVE",
      })
    );
  }

  return result;
};

const combineGridWebhookResults = (liveResult, testResult) => ({
  matched: Number(liveResult.matched || 0) + Number(testResult.matched || 0),
  armed: Number(liveResult.armed || 0) + Number(testResult.armed || 0),
  ignoredActive:
    Number(liveResult.ignoredActive || 0) + Number(testResult.ignoredActive || 0),
  ignoredConflict:
    Number(liveResult.ignoredConflict || 0) + Number(testResult.ignoredConflict || 0),
  ignoredSignal:
    Number(liveResult.ignoredSignal || 0) + Number(testResult.ignoredSignal || 0),
  live: {
    matched: Number(liveResult.matched || 0),
    armed: Number(liveResult.armed || 0),
    ignoredActive: Number(liveResult.ignoredActive || 0),
    ignoredConflict: Number(liveResult.ignoredConflict || 0),
    ignoredSignal: Number(liveResult.ignoredSignal || 0),
  },
  test: {
    matched: Number(testResult.matched || 0),
    armed: Number(testResult.armed || 0),
    ignoredActive: Number(testResult.ignoredActive || 0),
    ignoredConflict: Number(testResult.ignoredConflict || 0),
    ignoredSignal: Number(testResult.ignoredSignal || 0),
  },
  targetItems: [...(liveResult.targetItems || []), ...(testResult.targetItems || [])],
});

const previewGridWebhook = async (payload = {}, options = {}) => {
  const normalized = normalizeGridWebhookPayload(payload);
  const [liveResult, testResult] = await Promise.all([
    previewGridWebhookTargetsForMode("live", normalized, options),
    previewGridWebhookTargetsForMode("test", normalized, options),
  ]);

  return combineGridWebhookResults(liveResult, testResult);
};

const processGridWebhook = async (payload = {}, options = {}) => {
  const normalized = normalizeGridWebhookPayload(payload);
  const includeLive = options.includeLive !== false;
  const includeTest = options.includeTest !== false;
  const [liveResult, testResult] = await Promise.all([
    includeLive
      ? armGridWebhookTargetsForMode("live", normalized, options)
      : {
          matched: 0,
          armed: 0,
          ignoredActive: 0,
          ignoredConflict: 0,
          ignoredSignal: 0,
          targetItems: [],
        },
    includeTest
      ? armGridWebhookTargetsForMode("test", normalized, options)
      : {
          matched: 0,
          armed: 0,
          ignoredActive: 0,
          ignoredConflict: 0,
          ignoredSignal: 0,
          targetItems: [],
        },
  ]);

  return combineGridWebhookResults(liveResult, testResult);
};

const getGridControlState = (item = {}) =>
  canonicalRuntimeState.getItemEnabled(item) ? "ON" : "OFF";

const getGridControlStateLabel = (item = {}) =>
  canonicalRuntimeState.decorateGridItemSync(item).controlStateLabel;

const getGridRegimeStatusLabel = (statusOrItem) => {
  if (statusOrItem && typeof statusOrItem === "object") {
    return canonicalRuntimeState.decorateGridItemSync(statusOrItem).runtimeStateLabel;
  }

  return statusOrItem === "GRIDDING"
    ? canonicalRuntimeState.GRID_RUNTIME_LABELS.GRIDDING
    : canonicalRuntimeState.GRID_RUNTIME_LABELS.READY;
};

const getGridRegimeEndReasonLabel = (reason) =>
  GRID_REGIME_END_REASON_LABELS[reason] || reason || "-";

const getGridLegStatusLabel = (status) =>
  GRID_LEG_STATUS_LABELS[status] || status || "-";

const decorateGridRuntimeFields = (item = {}) => {
  if (!item || typeof item !== "object") {
    return item;
  }

  const decorated = canonicalRuntimeState.decorateGridItemSync(item);
  return {
    ...decorated,
    regimeStatusLabel: decorated.runtimeStateLabel,
    regimeEndReasonLabel: getGridRegimeEndReasonLabel(item.regimeEndReason),
    longLegStatusLabel: getGridLegStatusLabel(item.longLegStatus),
    shortLegStatusLabel: getGridLegStatusLabel(item.shortLegStatus),
  };
};

const normalizeGridWebhookPayload = (payload = {}) => {
  const strategySignal = String(
    payload?.signal ||
      payload?.strategySignal ||
      payload?.strategy ||
      payload?.strategy_name ||
      payload?.db_type ||
      ""
  ).trim();

  const signalTime = String(
    payload?.time || payload?.signalTime || payload?.eventTime || payload?.triggeredAt || ""
  ).trim();

  const normalized = {
    strategySignal,
    strategySignalKey: normalizeGridSignalKey(strategySignal),
    symbol: normalizeGridSymbol(payload?.symbol || payload?.ticker || payload?.market),
    bunbong: normalizeGridBunbong(
      payload?.bunbong ||
        payload?.timeframe ||
        payload?.timeFrame ||
        payload?.interval ||
        payload?.candle_min
    ),
    signalTime: normalizeGridSignalTime(signalTime),
    supportPrice: parseGridPrice(
      payload?.supportPrice ?? payload?.support ?? payload?.supportLine ?? payload?.lowerLine
    ),
    resistancePrice: parseGridPrice(
      payload?.resistancePrice ?? payload?.resistance ?? payload?.resistanceLine ?? payload?.upperLine
    ),
    triggerPrice: parseGridPrice(
      payload?.triggerPrice ?? payload?.trigger ?? payload?.triggerLine ?? payload?.centerLine
    ),
    gridRegimeKey: String(payload?.gridRegimeKey || payload?.grid_regime_key || "").trim(),
    rawPayload: payload,
  };

  return {
    ...normalized,
    canonicalGridRegimeKey: buildGridRegimeKey(normalized),
  };
};

const normalizeGridExitWebhookPayload = (payload = {}) => {
  const base = normalizeGridWebhookPayload(payload);
  const exitAction = normalizeGridExitAction(payload);
  const candle = payload?.candle && typeof payload.candle === "object" ? payload.candle : {};
  const candleClosePrice = parseGridPrice(
    payload?.candleClosePrice ??
      payload?.candle_close_price ??
      payload?.closePrice ??
      payload?.close ??
      candle.close
  );
  const candleClosed = normalizeGridBoolean(
    payload?.candleClosed ??
      payload?.candle_closed ??
      payload?.isConfirmed ??
      payload?.confirmed ??
      candle.closed ??
      candle.confirmed
  );

  return {
    ...base,
    exitAction,
    explicitGridExit: payload?.explicitGridExit === true || isGridExitWebhookPayload(payload),
    candleClosePrice,
    candleClosed,
    candleCloseTime:
      normalizeGridSignalTime(
        payload?.candleCloseTime ??
          payload?.candle_close_time ??
          payload?.closeTime ??
          candle.closeTime ??
          ""
      ) || null,
  };
};

const validateGridWebhookPayload = (payload = {}, options = {}) => {
  const forbiddenIdentityField = findForbiddenGridWebhookTargetIdentityField(payload);
  if (forbiddenIdentityField) {
    return { ok: false, reason: `forbidden-target-identity-field:${forbiddenIdentityField}`, payload: normalizeGridWebhookPayload(payload) };
  }

  if (hasForbiddenGridSignalPriceField(payload)) {
    return { ok: false, reason: "forbidden-grid-signal-price-field", payload: normalizeGridWebhookPayload(payload) };
  }

  const normalized = normalizeGridWebhookPayload(payload);
  const flags = options.featureFlags || getGridExitFeatureFlags(options.env || process.env);

  if (!normalized.strategySignal) {
    return { ok: false, reason: "missing-strategy-signal", payload: normalized };
  }

  if (!normalized.symbol) {
    return { ok: false, reason: "missing-symbol", payload: normalized };
  }

  if (!normalized.bunbong) {
    return { ok: false, reason: "missing-bunbong", payload: normalized };
  }

  const boxScope = validateGridBoxScope(normalized);
  if (!boxScope.ok) {
    return { ok: false, reason: boxScope.reason, payload: normalized };
  }

  const keyContract = validateGridRegimeKeyContract({
    eventType: "GRID_ARM",
    payload: normalized,
    flags,
  });
  if (!keyContract.ok) {
    return {
      ok: false,
      reason: keyContract.reason,
      payload: {
        ...normalized,
        gridRegimeKeyWarnings: keyContract.warnings,
      },
    };
  }

  return {
    ok: true,
    payload: {
      ...normalized,
      gridRegimeKeyWarnings: keyContract.warnings,
    },
  };
};

const validateGridExitWebhookPayload = (payload = {}, options = {}) => {
  const forbiddenIdentityField = findForbiddenGridWebhookTargetIdentityField(payload);
  if (forbiddenIdentityField) {
    return { ok: false, reason: `forbidden-target-identity-field:${forbiddenIdentityField}`, payload: normalizeGridExitWebhookPayload(payload) };
  }

  if (hasForbiddenGridSignalPriceField(payload)) {
    return { ok: false, reason: "forbidden-grid-signal-price-field", payload: normalizeGridExitWebhookPayload(payload) };
  }

  const normalized = normalizeGridExitWebhookPayload(payload);
  const flags = options.featureFlags || getGridExitFeatureFlags(options.env || process.env);

  if (!normalized.strategySignal) {
    return { ok: false, reason: "missing-strategy-signal", payload: normalized };
  }

  if (!normalized.symbol) {
    return { ok: false, reason: "missing-symbol", payload: normalized };
  }

  if (!normalized.bunbong) {
    return { ok: false, reason: "missing-bunbong", payload: normalized };
  }

  if (normalized.explicitGridExit) {
    const keyContract = validateGridRegimeKeyContract({
      eventType: "GRID_EXIT",
      payload: normalized,
      flags,
    });
    if (!keyContract.ok) {
      return {
        ok: false,
        reason: keyContract.reason,
        payload: {
          ...normalized,
          gridRegimeKeyWarnings: keyContract.warnings,
        },
      };
    }
    return {
      ok: true,
      payload: {
        ...normalized,
        gridRegimeKeyWarnings: keyContract.warnings,
      },
    };
  }

  if (flags.GRID_CANDLE_CLOSE_LEGACY_MODE === "REJECT") {
    return { ok: false, reason: "grid-candle-close-legacy-rejected", payload: normalized };
  }

  if (!normalized.candleClosed) {
    return {
      ok: true,
      payload: {
        ...normalized,
        legacyCandleCloseAuditOnly: true,
        gridRegimeKeyWarnings: ["grid-candle-close-legacy-audit-only"],
      },
    };
  }

  if (!(normalized.candleClosePrice > 0)) {
    return {
      ok: true,
      payload: {
        ...normalized,
        legacyCandleCloseAuditOnly: true,
        gridRegimeKeyWarnings: ["grid-candle-close-legacy-audit-only"],
      },
    };
  }

  return {
    ok: true,
    payload: {
      ...normalized,
      legacyCandleCloseAuditOnly: true,
      gridRegimeKeyWarnings: ["grid-candle-close-legacy-audit-only"],
    },
  };
};

const isGridExitCloseoutPendingStatus = (status) => {
  const normalized = String(status || "").trim().toUpperCase();
  return [
    "CANCEL_INTENT_PENDING",
    "CONTROLLED_CLOSE_QUEUED",
    "GMANUAL_QUEUED",
    "GMANUAL_VERIFY_PENDING",
    "GMANUAL_CLOSE_PENDING",
    "GMANUAL_CLOSE_INTENT_PENDING",
  ].includes(normalized);
};

const isConfirmedCandleCloseBreakoutForRow = (row = {}, payload = {}) => {
  if (!payload.candleClosed) {
    return false;
  }
  const closePrice = parseGridPrice(payload.candleClosePrice);
  if (!(closePrice > 0)) {
    return false;
  }
  const supportPrice = parseGridPrice(row.supportPrice || payload.supportPrice);
  const resistancePrice = parseGridPrice(row.resistancePrice || payload.resistancePrice);
  if (!(supportPrice > 0) || !(resistancePrice > 0) || supportPrice >= resistancePrice) {
    return false;
  }
  return closePrice <= supportPrice || closePrice >= resistancePrice;
};

const previewGridExitWebhookTargetsForMode = async (mode, payload, options = {}) => {
  const tableName = getGridWebhookTableName(mode);
  if (!tableName) {
    return {
      matched: 0,
      armed: 0,
      ignoredActive: 0,
      ignoredConflict: 0,
      ignoredSignal: 0,
      targetItems: [],
    };
  }

  const scopedUid = Number(options.uid || options.userId || 0) || null;
  const uidPredicate = scopedUid ? " AND uid = ?" : "";
  const [rows] = await db.query(
      `SELECT
        id,
        uid,
        a_name,
        strategySignal,
        symbol,
        bunbong,
        enabled,
        regimeStatus,
        regimeEndReason,
        supportPrice,
        resistancePrice,
        triggerPrice,
        lastWebhookPayloadJson,
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
      FROM ${tableName}
      WHERE enabled = 'Y'
        AND symbol = ?
        AND bunbong = ?
        ${uidPredicate}
      ORDER BY id ASC`,
    scopedUid ? [payload.symbol, payload.bunbong, scopedUid] : [payload.symbol, payload.bunbong]
  );

  const strategySignalKey = normalizeGridSignalKey(payload.strategySignal);
  const result = {
    matched: 0,
    armed: 0,
    ignoredActive: 0,
    ignoredConflict: 0,
    ignoredSignal: 0,
    targetItems: [],
  };

  for (const row of rows || []) {
    const rowSignalKey = normalizeGridSignalKey(row.strategySignal);
    if (rowSignalKey !== strategySignalKey) {
      result.ignoredSignal += 1;
      result.targetItems.push(
        buildGridWebhookTargetItem({
          row,
          mode,
          resultCode: "GRID_EXIT_SIGNAL_MISMATCH",
          note: `strategySignal:${row.strategySignal || "-"}`,
        })
      );
      continue;
    }

    result.matched += 1;
    const rowRegimeStatus = String(row.regimeStatus || "").trim().toUpperCase();

    if (!payload.explicitGridExit) {
      result.ignoredActive += 1;
      result.targetItems.push(
        buildGridWebhookTargetItem({
          row,
          mode,
          resultCode: "GRID_CANDLE_CLOSE_LEGACY_DISABLED_AUDIT",
          note: "legacy-candle-close-audit-only",
        })
      );
      continue;
    }

    if (!rowRegimeStatus || rowRegimeStatus === "WAITING_WEBHOOK" || rowRegimeStatus === "ENDED") {
      result.ignoredActive += 1;
      result.targetItems.push(
        buildGridWebhookTargetItem({
          row,
          mode,
          resultCode: "GRID_EXIT_NO_ACTIVE_REGIME",
          note: `regimeStatus:${row.regimeStatus || "-"}`,
        })
      );
      continue;
    }

    if (isGridExitCloseoutPendingStatus(rowRegimeStatus)) {
      result.ignoredConflict += 1;
      result.targetItems.push(
        buildGridWebhookTargetItem({
          row,
          mode,
          resultCode: "GRID_EXIT_ALREADY_PENDING",
          note: `regimeStatus:${row.regimeStatus || "-"}`,
        })
      );
      continue;
    }

    if (!payload.gridRegimeKey) {
      result.ignoredConflict += 1;
      result.targetItems.push(
        buildGridWebhookTargetItem({
          row,
          mode,
          resultCode: "GRID_EXIT_MISSING_GRID_REGIME_KEY",
          note: "missing-gridRegimeKey",
        })
      );
      continue;
    }

    const storedGridRegimeKey = getStoredGridRegimeKeyForRow(row);
    if (!storedGridRegimeKey || storedGridRegimeKey !== payload.gridRegimeKey) {
      result.targetItems.push(
        buildGridWebhookTargetItem({
          row,
          mode,
          resultCode: storedGridRegimeKey ? "GRID_EXIT_KEY_MISMATCH" : "GRID_EXIT_ROW_KEY_MISSING",
          note: `payloadKey:${payload.gridRegimeKey || "-"}, rowKey:${storedGridRegimeKey || "-"}`,
        })
      );
      result.ignoredConflict += 1;
      continue;
    }

    result.armed += 1;
    result.targetItems.push(
      buildGridWebhookTargetItem({
        row,
        mode,
        resultCode: "GRID_EXIT_ALERT_PREVIEW",
        note: "explicit-grid-exit-alert-key-match",
        nextRegimeStatus: "CANCEL_INTENT_PENDING",
      })
    );
  }

  return result;
};

const previewGridExitWebhook = async (payload = {}, options = {}) => {
  const normalized = normalizeGridExitWebhookPayload(payload);
  const [liveResult, testResult] = await Promise.all([
    previewGridExitWebhookTargetsForMode("live", normalized, options),
    previewGridExitWebhookTargetsForMode("test", normalized, options),
  ]);

  return combineGridWebhookResults(liveResult, testResult);
};

const isGridRegimeActive = (status) =>
  status === "ENTRIES_ARMED" || status === "ACTIVE" || status === "ENDED";

const buildGridWebhookUpdateParams = (payload) => [
  payload.signalTime || null,
  payload.supportPrice,
  payload.resistancePrice,
  payload.triggerPrice,
  JSON.stringify(payload.rawPayload || {}),
];

module.exports = {
  getGridExitFeatureFlags,
  normalizeGridRegimeStrategySignal,
  normalizeGridRegimeTime,
  normalizeGridRegimePrice,
  buildGridRegimeKey,
  validateGridRegimeKeyContract,
  getStoredGridRegimeKeyForRow,
  normalizeGridSignalKey,
  normalizeGridSymbol,
  normalizeGridBunbong,
  parseGridPrice,
  normalizeGridSignalTime,
  findForbiddenGridWebhookTargetIdentityField,
  validateGridBoxScope,
  isGridExitBoxScopeMatchForRow,
  normalizeGridExitAction,
  isGridExitWebhookPayload,
  isGridExitPolicyWebhookPayload,
  getGridControlState,
  getGridControlStateLabel,
  getGridRegimeStatusLabel,
  getGridRegimeEndReasonLabel,
  getGridLegStatusLabel,
  decorateGridRuntimeFields,
  normalizeGridWebhookPayload,
  validateGridWebhookPayload,
  normalizeGridExitWebhookPayload,
  validateGridExitWebhookPayload,
  isConfirmedCandleCloseBreakoutForRow,
  previewGridWebhook,
  previewGridExitWebhook,
  processGridWebhook,
  isGridRegimeActive,
  buildGridWebhookUpdateParams,
};
