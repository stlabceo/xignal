const db = require("./database/connect/config");
const dayjs = require("dayjs");

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeDateMs = (value) => {
  if (!value) {
    return 0;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const parseJson = (value, fallback = null) => {
  if (!value) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
};

const buildStage = (status, label, detail = null) => ({
  status,
  label,
  detail,
});

const getTargetWindow = (targetRow, nowMs = Date.now()) => {
  const createdAtMs = normalizeDateMs(targetRow?.createdAt) || nowMs;
  return {
    createdAtMs,
    fromTime: dayjs(createdAtMs - 5000).format("YYYY-MM-DD HH:mm:ss"),
    toTime: dayjs(nowMs + 1000).format("YYYY-MM-DD HH:mm:ss"),
  };
};

const loadMsgRows = async ({ uid, pid, fromTime, toTime }) => {
  const [rows] = await db.query(
    `SELECT id, fun, code, msg, created_at AS createdAt
       FROM msg_list
      WHERE uid = ? AND pid = ? AND created_at BETWEEN ? AND ?
      ORDER BY id ASC`,
    [uid, pid, fromTime, toTime]
  );
  return rows || [];
};

const loadTestPlayLogRows = async ({ uid, pid, fromTime, toTime }) => {
  const [rows] = await db.query(
    `SELECT *
       FROM test_play_log
      WHERE uid = ? AND pid = ? AND closeTime BETWEEN ? AND ?
      ORDER BY id ASC`,
    [uid, pid, fromTime, toTime]
  );
  return rows || [];
};

const loadTestPlayItem = async ({ uid, pid }) => {
  const [[row]] = await db.query(
    `SELECT *
       FROM test_play_list
      WHERE uid = ? AND id = ?
      LIMIT 1`,
    [uid, pid]
  );
  return row || null;
};

const loadTestGridItem = async ({ uid, pid }) => {
  const [[row]] = await db.query(
    `SELECT *
       FROM test_grid_strategy_list
      WHERE uid = ? AND id = ?
      LIMIT 1`,
    [uid, pid]
  );
  return row || null;
};

const normalizeSignalDirection = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "LONG") {
    return "BUY";
  }
  if (normalized === "SHORT") {
    return "SELL";
  }
  return normalized || null;
};

const buildBaseDemoRow = ({ targetRow, completed, processStatus, currentStepLabel, createdAt, completedAt }) => ({
  id: targetRow.id,
  eventId: targetRow.eventId,
  uid: targetRow.uid,
  pid: targetRow.pid,
  category: targetRow.strategyCategory,
  strategyCategory: targetRow.strategyCategory,
  strategyCategoryLabel: String(targetRow.strategyCategory || "").toLowerCase() === "grid" ? "Grid" : "Algorithm",
  categoryLabel: String(targetRow.strategyCategory || "").toLowerCase() === "grid" ? "Grid" : "Algorithm",
  strategyMode: "test",
  tradeMode: "demo",
  trackRecordType: "demo",
  strategySuccessScope: "demo_only",
  statsEligible: false,
  recommendationEligible: false,
  strategyName: targetRow.strategyName,
  strategyKey: targetRow.strategyKey,
  strategyUuid: targetRow.strategyUuid,
  symbol: targetRow.symbol,
  bunbong: targetRow.bunbong,
  signalType: targetRow.incomingSignalType || targetRow.runtimeSignalType || null,
  createdAt,
  webhookOccurredAt: createdAt,
  routePath: targetRow.routePath,
  webhookResultCode: targetRow.webhookResultCode,
  targetResultCode: targetRow.resultCode,
  processStatus,
  normalityLabel: processStatus === "NORMAL" ? "정상" : "진행중",
  isAbnormal: false,
  currentRisk: false,
  lifecycleStatus: completed ? "CLOSED" : "ACTIVE",
  lifecycleResult: completed ? "CLOSED" : "ACTIVE",
  severity: "INFO",
  expectedOrAbnormal: "REVIEW",
  isExpectedIgnore: false,
  completed,
  completedAt,
  completionLabel: completed ? "완료" : "진행중",
  currentStepLabel,
  problemStage: null,
  problemDetail: null,
  protectionStatus: "DEMO_ONLY",
  activeProtectionCount: 0,
  expectedProtectionCount: 0,
  currentPositionQty: 0,
  localOpenQty: 0,
  openQtyTotal: 0,
  reconciliationOrigin: "DEMO_TRACK_RECORD",
  recoveryReason: null,
  issueReason: null,
  nextAction: "없음",
});

const buildDemoSignalRow = async (targetRow, options = {}) => {
  const nowMs = options.nowMs || Date.now();
  const { fromTime, toTime } = getTargetWindow(targetRow, nowMs);
  const [play, logs, msgRows] = await Promise.all([
    options.currentItem || loadTestPlayItem({ uid: targetRow.uid, pid: targetRow.pid }),
    loadTestPlayLogRows({ uid: targetRow.uid, pid: targetRow.pid, fromTime, toTime }),
    loadMsgRows({ uid: targetRow.uid, pid: targetRow.pid, fromTime, toTime }),
  ]);
  const latestLog = logs[logs.length - 1] || null;
  const isCompleted = Boolean(latestLog);
  const direction = normalizeSignalDirection(
    latestLog?.signalType || play?.r_signalType || targetRow.incomingSignalType || targetRow.runtimeSignalType
  );
  const openQty = isCompleted ? 0 : toNumber(play?.r_qty, 0);
  const tradeAmount = toNumber(latestLog?.positionSize, 0) || toNumber(play?.leverage, 0) * toNumber(play?.margin, 0);
  const realizedPnl = toNumber(latestLog?.pol_sum, 0);
  const exitReason = latestLog?.exitReasonCode || latestLog?.exitMode || latestLog?.st || null;
  const processStatus = isCompleted ? "NORMAL" : "ACTIVE";
  const currentStepLabel = isCompleted ? "데모 청산 완료" : "데모 진행중";
  const createdAt = targetRow.createdAt || latestLog?.openTime || play?.createdAt || null;
  const completedAt = latestLog?.closeTime || null;
  const baseRow = buildBaseDemoRow({
    targetRow,
    completed: isCompleted,
    processStatus,
    currentStepLabel,
    createdAt,
    completedAt,
  });
  const entryPrice = toNumber(latestLog?.openPrice, 0) || toNumber(play?.r_exactPrice, 0) || toNumber(play?.r_signalPrice, 0);
  const exitPrice = toNumber(latestLog?.closePrice, 0);
  const entryStage = buildStage(entryPrice > 0 ? "NORMAL" : "WAITING", "진입", entryPrice > 0 ? `entryPrice:${entryPrice}` : null);
  const exitStage = buildStage(isCompleted ? "NORMAL" : "WAITING", "청산", exitPrice > 0 ? `exitPrice:${exitPrice}, reason:${exitReason || "-"}` : null);

  const row = {
    ...baseRow,
    signalType: direction,
    lifecycleStatus: isCompleted ? "CLOSED" : openQty > 0 ? "OPEN_PROTECTED" : "ENTRY_PENDING",
    lifecycleResult: isCompleted ? "CLOSED" : openQty > 0 ? "OPEN_PROTECTED" : "ENTRY_PENDING",
    currentPositionQty: openQty,
    localOpenQty: openQty,
    openQtyTotal: openQty,
    realizedPnl,
    actualEntryNotional: tradeAmount,
    ledgerFillCount: isCompleted ? 2 : entryPrice > 0 ? 1 : 0,
    entryLedgerCount: entryPrice > 0 ? 1 : 0,
    exitLedgerCount: isCompleted ? 1 : 0,
    entryFillCount: entryPrice > 0 ? 1 : 0,
    exitFillCount: isCompleted ? 1 : 0,
    entryOrderEventCount: 0,
    exitOrderEventCount: isCompleted ? 1 : 0,
    runtimeMessageCount: msgRows.length,
    summaryText: isCompleted ? "데모 트랙레코드 정상 종료" : "데모 런타임 진행중",
    webhookStage: buildStage("NORMAL", "웹훅 수신"),
    waitingStage: buildStage("NORMAL", "대기"),
    entryStage,
    exitPendingStage: buildStage(isCompleted ? "NORMAL" : "WAITING", "청산대기"),
    exitStage,
    stageList: [
      { key: "webhook", ...buildStage("NORMAL", "웹훅 수신") },
      { key: "waiting", ...buildStage("NORMAL", "대기") },
      { key: "entry", ...entryStage },
      { key: "exitPending", ...buildStage(isCompleted ? "NORMAL" : "WAITING", "청산대기") },
      { key: "exit", ...exitStage },
    ],
    algorithmMeta: {
      trackRecordType: "demo",
      strategySuccessScope: "demo_only",
      statsEligible: false,
      recommendationEligible: false,
      strategyName: targetRow.strategyName || play?.a_name || "-",
      symbol: targetRow.symbol || play?.symbol || "-",
      direction,
      tradeAmount,
      actualEntryNotional: tradeAmount,
      entryPrice,
      avgEntryPrice: entryPrice,
      exitPrice,
      avgExitPrice: exitPrice,
      realizedPnl,
      exitReason,
      tpPct: toNumber(play?.profit, 0),
      slPct: toNumber(play?.stopLoss, 0),
      timeStop: play?.stopLossTimeValue || null,
      splitTpStage: play?.r_splitStageIndex ?? null,
      resetStopPrice: toNumber(play?.r_stopPrice, 0) || null,
      finalQty: isCompleted ? 0 : openQty,
      statusLabel: isCompleted ? "데모 청산 완료" : "데모 진행중",
    },
  };

  if (!options.includeDetail) {
    return row;
  }

  return {
    ...row,
    detail: {
      window: { fromTime, toTime },
      webhook: {
        eventId: targetRow.eventId,
        routePath: targetRow.routePath,
        resultCode: targetRow.webhookResultCode,
        occurredAt: targetRow.createdAt,
      },
      currentItem: play,
      counts: {
        binanceEvents: 0,
        cycleLedgerEvents: row.ledgerFillCount,
        allLedgerEvents: row.ledgerFillCount,
        reservations: 0,
        snapshots: openQty > 0 || isCompleted ? 1 : 0,
        runtimeMessages: msgRows.length,
      },
      binanceEvents: [],
      cycleLedgerEvents: latestLog
        ? [
            {
              id: `demo-entry-${latestLog.id}`,
              eventType: "DEMO_ENTRY",
              positionSide: direction === "SELL" ? "SHORT" : "LONG",
              fillQty: latestLog.positionSize && entryPrice ? toNumber(latestLog.positionSize) / entryPrice : null,
              fillPrice: entryPrice,
              realizedPnl: 0,
              openQtyAfter: latestLog.positionSize && entryPrice ? toNumber(latestLog.positionSize) / entryPrice : null,
              tradeTime: latestLog.openTime,
              note: "demo-only entry",
              createdAt: latestLog.openTime,
            },
            {
              id: `demo-exit-${latestLog.id}`,
              eventType: "DEMO_EXIT",
              positionSide: direction === "SELL" ? "SHORT" : "LONG",
              fillQty: latestLog.positionSize && entryPrice ? toNumber(latestLog.positionSize) / entryPrice : null,
              fillPrice: exitPrice,
              realizedPnl,
              openQtyAfter: 0,
              tradeTime: latestLog.closeTime,
              note: `demo-only exit:${exitReason || "-"}`,
              createdAt: latestLog.closeTime,
            },
          ]
        : [],
      allLedgerEvents: [],
      reservations: [],
      snapshots: [
        {
          id: `demo-snapshot-${targetRow.pid}`,
          symbol: targetRow.symbol,
          positionSide: direction === "SELL" ? "SHORT" : "LONG",
          status: isCompleted ? "CLOSED" : openQty > 0 ? "OPEN" : "ENTRY_PENDING",
          openQty,
          avgEntryPrice: entryPrice,
          cycleRealizedPnl: realizedPnl,
          createdAt,
          updatedAt: completedAt || createdAt,
        },
      ],
      runtimeMessages: msgRows,
    },
  };
};

const parseGridMsgEvents = (msgRows = []) => {
  const events = [];
  for (const row of msgRows) {
    const text = String(row.msg || "");
    const legMatch = text.match(/leg:([A-Z]+)/i);
    const leg = legMatch ? legMatch[1].toUpperCase() : null;
    const entryMatch = text.match(/entryPrice:([0-9.]+)/i);
    const exitMatch = text.match(/exitPrice:([0-9.]+)/i);
    const qtyMatch = text.match(/qty:([0-9.]+)/i);
    const tpMatch = text.match(/tp:([0-9.]+)/i);
    const stopMatch = text.match(/stop:([0-9.]+)/i);
    events.push({
      ...row,
      leg,
      entryPrice: entryMatch ? toNumber(entryMatch[1], 0) : null,
      exitPrice: exitMatch ? toNumber(exitMatch[1], 0) : null,
      qty: qtyMatch ? toNumber(qtyMatch[1], 0) : null,
      tp: tpMatch ? toNumber(tpMatch[1], 0) : null,
      stop: stopMatch ? toNumber(stopMatch[1], 0) : null,
    });
  }
  return events;
};

const computeGridDemoPnl = (events = []) => {
  const entries = new Map();
  let pnl = 0;
  for (const event of events) {
    const code = String(event.code || "").toUpperCase();
    if (code === "ENTRY_FILLED" && event.leg && event.entryPrice > 0 && event.qty > 0) {
      entries.set(event.leg, { price: event.entryPrice, qty: event.qty });
      continue;
    }
    if ((code === "TAKE_PROFIT" || code === "BOX_BREAK") && event.leg && event.exitPrice > 0) {
      const entry = entries.get(event.leg);
      if (!entry) {
        continue;
      }
      pnl += event.leg === "SHORT"
        ? (entry.price - event.exitPrice) * entry.qty
        : (event.exitPrice - entry.price) * entry.qty;
    }
  }
  return pnl;
};

const buildDemoGridRow = async (targetRow, options = {}) => {
  const nowMs = options.nowMs || Date.now();
  const { fromTime, toTime } = getTargetWindow(targetRow, nowMs);
  const [grid, msgRows] = await Promise.all([
    options.currentItem || loadTestGridItem({ uid: targetRow.uid, pid: targetRow.pid }),
    loadMsgRows({ uid: targetRow.uid, pid: targetRow.pid, fromTime, toTime }),
  ]);
  const events = parseGridMsgEvents(msgRows);
  const entryEvents = events.filter((event) => String(event.code || "").toUpperCase() === "ENTRY_FILLED");
  const exitEvents = events.filter((event) => ["TAKE_PROFIT", "BOX_BREAK", "ENDED_STALE_POSITION_CLOSED"].includes(String(event.code || "").toUpperCase()));
  const longQty = toNumber(grid?.longQty, 0);
  const shortQty = toNumber(grid?.shortQty, 0);
  const openQty = (String(grid?.longLegStatus || "").toUpperCase() === "OPEN" ? longQty : 0)
    + (String(grid?.shortLegStatus || "").toUpperCase() === "OPEN" ? shortQty : 0);
  const completed = String(grid?.regimeStatus || "").toUpperCase() === "ENDED" || (exitEvents.length > 0 && openQty <= 0);
  const realizedPnl = computeGridDemoPnl(events);
  const actualEntryNotional = entryEvents.reduce(
    (sum, event) => sum + toNumber(event.entryPrice, 0) * toNumber(event.qty, 0),
    0
  ) || (toNumber(grid?.tradeValue, 0) * 2);
  const createdAt = targetRow.createdAt || grid?.createdAt || null;
  const completedAt = completed ? (exitEvents[exitEvents.length - 1]?.createdAt || grid?.updatedAt || null) : null;
  const baseRow = buildBaseDemoRow({
    targetRow,
    completed,
    processStatus: completed ? "NORMAL" : "ACTIVE",
    currentStepLabel: completed ? "데모 Grid 종료" : "데모 Grid 진행중",
    createdAt,
    completedAt,
  });
  const entryStage = buildStage(entryEvents.length > 0 ? "NORMAL" : "WAITING", "진입", entryEvents.length ? `entries:${entryEvents.length}` : null);
  const exitStage = buildStage(completed ? "NORMAL" : "WAITING", "청산", exitEvents.length ? `exits:${exitEvents.length}` : null);
  const row = {
    ...baseRow,
    lifecycleStatus: completed ? "CLOSED" : openQty > 0 ? "OPEN_PROTECTED" : "ENTRY_PENDING",
    lifecycleResult: completed ? "CLOSED" : openQty > 0 ? "OPEN_PROTECTED" : "ENTRY_PENDING",
    currentPositionQty: openQty,
    localOpenQty: openQty,
    openQtyTotal: openQty,
    realizedPnl,
    actualEntryNotional,
    ledgerFillCount: entryEvents.length + exitEvents.length,
    entryLedgerCount: entryEvents.length,
    exitLedgerCount: exitEvents.length,
    entryFillCount: entryEvents.length,
    exitFillCount: exitEvents.length,
    entryOrderEventCount: 0,
    exitOrderEventCount: exitEvents.length,
    activeProtectionCount: openQty > 0 ? 2 : 0,
    expectedProtectionCount: openQty > 0 ? 2 : 0,
    protectionStatus: openQty > 0 ? "DEMO_TP_READY" : "NONE",
    runtimeMessageCount: msgRows.length,
    summaryText: completed ? "데모 Grid 트랙레코드 정상 종료" : "데모 Grid 런타임 진행중",
    webhookStage: buildStage("NORMAL", "웹훅 수신"),
    waitingStage: buildStage("NORMAL", "대기"),
    entryStage,
    exitPendingStage: buildStage(completed ? "NORMAL" : "WAITING", "청산대기"),
    exitStage,
    stageList: [
      { key: "webhook", ...buildStage("NORMAL", "웹훅 수신") },
      { key: "waiting", ...buildStage("NORMAL", "대기") },
      { key: "entry", ...entryStage },
      { key: "exitPending", ...buildStage(completed ? "NORMAL" : "WAITING", "청산대기") },
      { key: "exit", ...exitStage },
    ],
    gridMeta: {
      trackRecordType: "demo",
      strategySuccessScope: "demo_only",
      statsEligible: false,
      recommendationEligible: false,
      strategyName: targetRow.strategyName || grid?.a_name || "-",
      symbol: targetRow.symbol || grid?.symbol || "-",
      boxSizePct: 3,
      tpPct: toNumber(grid?.profit, 0),
      triggerPrice: toNumber(grid?.triggerPrice, 0) || null,
      supportPrice: toNumber(grid?.supportPrice, 0) || null,
      resistancePrice: toNumber(grid?.resistancePrice, 0) || null,
      tradeAmount: actualEntryNotional,
      actualEntryNotional,
      currentRegimeRealizedPnl: realizedPnl,
      entryPrice: entryEvents[0]?.entryPrice || null,
      exitPrice: exitEvents[exitEvents.length - 1]?.exitPrice || null,
      finalQty: completed ? 0 : openQty,
      overallStatusLabel: completed ? "데모 Grid 종료" : grid?.regimeStatus || "ACTIVE",
      buyStatusLabel: grid?.longLegStatus || null,
      sellStatusLabel: grid?.shortLegStatus || null,
      statusLabel: completed ? "데모 Grid 종료" : "데모 Grid 진행중",
    },
  };

  if (!options.includeDetail) {
    return row;
  }

  return {
    ...row,
    detail: {
      window: { fromTime, toTime },
      webhook: {
        eventId: targetRow.eventId,
        routePath: targetRow.routePath,
        resultCode: targetRow.webhookResultCode,
        occurredAt: targetRow.createdAt,
      },
      currentItem: grid,
      counts: {
        binanceEvents: 0,
        cycleLedgerEvents: row.ledgerFillCount,
        allLedgerEvents: row.ledgerFillCount,
        reservations: 0,
        snapshots: 1,
        runtimeMessages: msgRows.length,
      },
      binanceEvents: [],
      cycleLedgerEvents: events.map((event) => ({
        id: `demo-grid-${event.id}`,
        eventType: String(event.code || "").toUpperCase(),
        positionSide: event.leg,
        fillQty: event.qty,
        fillPrice: event.entryPrice || event.exitPrice,
        realizedPnl: 0,
        openQtyAfter: openQty,
        tradeTime: event.createdAt,
        note: event.msg,
        createdAt: event.createdAt,
      })),
      allLedgerEvents: [],
      reservations: [],
      snapshots: [
        {
          id: `demo-grid-snapshot-${targetRow.pid}`,
          symbol: targetRow.symbol,
          positionSide: "BOTH",
          status: completed ? "CLOSED" : openQty > 0 ? "OPEN" : "ENTRY_ARMED",
          openQty,
          cycleRealizedPnl: realizedPnl,
          createdAt,
          updatedAt: completedAt || grid?.updatedAt || createdAt,
        },
      ],
      runtimeMessages: msgRows,
    },
  };
};

const buildDemoOrderProcessRow = async (targetRow, options = {}) => {
  const category = String(targetRow?.strategyCategory || "").trim().toLowerCase();
  if (category === "signal") {
    return buildDemoSignalRow(targetRow, options);
  }
  if (category === "grid") {
    return buildDemoGridRow(targetRow, options);
  }
  return null;
};

module.exports = {
  buildDemoOrderProcessRow,
};
