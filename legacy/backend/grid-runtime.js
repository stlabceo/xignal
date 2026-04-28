const db = require("./database/connect/config");
const canonicalRuntimeState = require("./canonical-runtime-state");

const GRID_REGIME_END_REASON_LABELS = {
  BOX_BREAK: "박스 종료",
  BOX_BREAK_WAITING: "박스 대기 종료",
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

const armGridWebhookTargetsForMode = async (mode, payload) => {
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
      ORDER BY id ASC`,
    [payload.symbol, payload.bunbong]
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

const processGridWebhook = async (payload = {}) => {
  const normalized = normalizeGridWebhookPayload(payload);
  const [liveResult, testResult] = await Promise.all([
    armGridWebhookTargetsForMode("live", normalized),
    armGridWebhookTargetsForMode("test", normalized),
  ]);

  return {
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
  };
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

  return {
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
    rawPayload: payload,
  };
};

const validateGridWebhookPayload = (payload = {}) => {
  const normalized = normalizeGridWebhookPayload(payload);

  if (!normalized.strategySignal) {
    return { ok: false, reason: "missing-strategy-signal", payload: normalized };
  }

  if (!normalized.symbol) {
    return { ok: false, reason: "missing-symbol", payload: normalized };
  }

  if (!normalized.bunbong) {
    return { ok: false, reason: "missing-bunbong", payload: normalized };
  }

  if (!(normalized.supportPrice > 0)) {
    return { ok: false, reason: "missing-support-price", payload: normalized };
  }

  if (!(normalized.resistancePrice > 0)) {
    return { ok: false, reason: "missing-resistance-price", payload: normalized };
  }

  if (!(normalized.triggerPrice > 0)) {
    return { ok: false, reason: "missing-trigger-price", payload: normalized };
  }

  if (!(normalized.supportPrice < normalized.resistancePrice)) {
    return { ok: false, reason: "invalid-box-range", payload: normalized };
  }

  if (
    normalized.triggerPrice <= normalized.supportPrice ||
    normalized.triggerPrice >= normalized.resistancePrice
  ) {
    return { ok: false, reason: "trigger-outside-box", payload: normalized };
  }

  return { ok: true, payload: normalized };
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
  normalizeGridSignalKey,
  normalizeGridSymbol,
  normalizeGridBunbong,
  parseGridPrice,
  normalizeGridSignalTime,
  getGridControlState,
  getGridControlStateLabel,
  getGridRegimeStatusLabel,
  getGridRegimeEndReasonLabel,
  getGridLegStatusLabel,
  decorateGridRuntimeFields,
  normalizeGridWebhookPayload,
  validateGridWebhookPayload,
  processGridWebhook,
  isGridRegimeActive,
  buildGridWebhookUpdateParams,
};
