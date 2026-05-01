const fs = require("fs");
const path = require("path");

const db = require("../../database/connect/config");
const pidPositionLedger = require("../../pid-position-ledger");
const qaBinance = require("./qa-binance");

const APPROVAL_PHRASE = "APPROVE_LOCAL_STALE_CONVERGENCE_UID147_AFTER_USER_BINANCE_CLEANUP_20260501";
const UID = 147;
const SYMBOLS = ["PUMPUSDT", "XRPUSDT"];

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toSqlDateTime = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
};

const hasArg = (name) => process.argv.includes(name);

const assertApproval = () => {
  const provided = process.env.LOCAL_STALE_CONVERGENCE_APPROVAL || "";
  if (!hasArg("--apply") || provided !== APPROVAL_PHRASE) {
    throw new Error("LOCAL_STALE_CONVERGENCE_APPROVAL_REQUIRED");
  }
};

const loadExchange = async () => {
  const out = {};
  for (const symbol of SYMBOLS) {
    const [positions, openOrders, openAlgoOrders, allOrders, userTrades] = await Promise.all([
      qaBinance.getPositionRisk(UID, symbol),
      qaBinance.getOpenOrders(UID, symbol),
      qaBinance.getOpenAlgoOrders(UID, symbol),
      qaBinance.getAllOrders(UID, symbol, 100),
      qaBinance.getUserTrades(UID, symbol, 100),
    ]);
    out[symbol] = { positions, openOrders, openAlgoOrders, allOrders, userTrades };
  }
  return out;
};

const getPositionQty = (exchange, symbol, side) => {
  const row = (exchange?.[symbol]?.positions || []).find(
    (item) => item.symbol === symbol && String(item.positionSide || "").toUpperCase() === side
  );
  return toNumber(row?.positionAmt);
};

const assertExchangeFlat = (exchange) => {
  const failures = [];
  for (const symbol of SYMBOLS) {
    const openOrders = exchange?.[symbol]?.openOrders || [];
    const openAlgoOrders = exchange?.[symbol]?.openAlgoOrders || [];
    if (openOrders.length > 0) {
      failures.push(`${symbol}:openOrders:${openOrders.length}`);
    }
    if (openAlgoOrders.length > 0) {
      failures.push(`${symbol}:openAlgoOrders:${openAlgoOrders.length}`);
    }
    for (const side of ["LONG", "SHORT"]) {
      const qty = Math.abs(getPositionQty(exchange, symbol, side));
      if (qty > 0) {
        failures.push(`${symbol}:${side}:qty:${qty}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`LIVE_STATE_NOT_FLAT:${failures.join(",")}`);
  }
};

const loadLocalState = async () => {
  const [snapshots] = await db.query(
    `SELECT *
       FROM live_pid_position_snapshot
      WHERE uid = ?
        AND symbol IN ('PUMPUSDT','XRPUSDT')
        AND ABS(openQty) > 0.000000001
      ORDER BY symbol, positionSide, pid`,
    [UID]
  );
  const [reservations] = await db.query(
    `SELECT *
       FROM live_pid_exit_reservation
      WHERE uid = ?
        AND symbol IN ('PUMPUSDT','XRPUSDT')
        AND status IN ('ACTIVE','PARTIAL','CANCEL_REQUESTED','CANCEL_PENDING','UNKNOWN_CANCEL_STATE')
      ORDER BY symbol, positionSide, pid, id`,
    [UID]
  );
  return { snapshots, reservations };
};

const ledgerCount = async (whereSql, params) => {
  const [rows] = await db.query(`SELECT COUNT(*) AS cnt FROM live_pid_position_ledger WHERE ${whereSql}`, params);
  return Number(rows?.[0]?.cnt || 0);
};

const findOrder = (exchange, symbol, orderId) =>
  (exchange?.[symbol]?.allOrders || []).find((item) => String(item.orderId) === String(orderId));

const findTrade = (exchange, symbol, tradeId) =>
  (exchange?.[symbol]?.userTrades || []).find((item) => String(item.id) === String(tradeId));

const recordRuntimeEvent = async ({
  uid = UID,
  pid,
  strategyCategory,
  eventCode,
  symbol,
  side,
  positionSide,
  clientOrderId = null,
  orderId = null,
  quantity = null,
  executedQty = null,
  avgPrice = null,
  tradeTime = null,
  note,
  payload = {},
}) => {
  await db.query(
    `INSERT INTO binance_runtime_event_log
      (
        uid, pid, strategy_category, event_type, event_code, severity, symbol, side, position_side,
        client_order_id, order_id, quantity, executed_qty, avg_price, trade_time, note, payload_json, created_at
      )
     VALUES
      (?, ?, ?, 'LOCAL_STALE_CONVERGENCE', ?, 'WARN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      uid,
      pid,
      strategyCategory,
      eventCode,
      symbol,
      side,
      positionSide,
      clientOrderId,
      orderId,
      quantity,
      executedQty,
      avgPrice,
      tradeTime ? new Date(tradeTime).getTime() : null,
      String(note || "").slice(0, 255),
      JSON.stringify(payload || {}),
    ]
  );
};

const addMsg = async ({ fun, code, msg, uid = UID, pid, tid = null, symbol, side }) => {
  await db.query(
    `INSERT INTO msg_list (fun, code, msg, uid, pid, tid, symbol, side, st, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Y', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      String(fun || "").slice(0, 20),
      String(code || "").slice(0, 20),
      String(msg || ""),
      uid,
      pid,
      tid ? String(tid).slice(0, 12) : null,
      symbol,
      side,
    ]
  );
};

const syncSignalReady = async ({ pid, positionSide }) => {
  await pidPositionLedger.syncSignalPlaySnapshot(pid, positionSide);
  await db.query(
    `UPDATE live_play_list
        SET status = 'READY',
            r_qty = 0,
            r_signalType = NULL,
            r_exactPrice = NULL
      WHERE id = ?
        AND uid = ?
      LIMIT 1`,
    [pid, UID]
  );
};

const syncGridClosed = async ({ pid, leg }) => {
  const normalizedLeg = String(leg || "").toUpperCase();
  await pidPositionLedger.syncGridLegSnapshot(pid, normalizedLeg);
  const statusColumn = normalizedLeg === "LONG" ? "longLegStatus" : "shortLegStatus";
  await db.query(
    `UPDATE live_grid_strategy_list
        SET ${statusColumn} = 'IDLE',
            regimeStatus = CASE
              WHEN longLegStatus IN ('IDLE','CLOSED') AND shortLegStatus IN ('IDLE','CLOSED') THEN 'WAITING_WEBHOOK'
              ELSE regimeStatus
            END,
            regimeEndReason = 'CONTROLLED_LOCAL_STALE_CONVERGENCE',
            updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
        AND uid = ?
      LIMIT 1`,
    [pid, UID]
  );
};

const applyOwnerClearFill = async ({
  pid,
  strategyCategory,
  symbol,
  positionSide,
  order,
  trade,
  eventType,
  note,
}) => {
  const duplicateByTrade = await ledgerCount(
    `uid = ? AND sourceTradeId = ?`,
    [UID, String(trade.id)]
  );
  const duplicateByOrder = await ledgerCount(
    `uid = ? AND pid = ? AND strategyCategory = ? AND sourceOrderId = ? AND sourceTradeId = ?`,
    [UID, pid, strategyCategory, String(order.orderId), String(trade.id)]
  );
  if (duplicateByTrade > 0 || duplicateByOrder > 0) {
    return { skipped: true, reason: "DUPLICATE_LEDGER_EXISTS", duplicateByTrade, duplicateByOrder };
  }

  const result = await pidPositionLedger.applyExitFill({
    uid: UID,
    pid,
    strategyCategory,
    symbol,
    positionSide,
    sourceClientOrderId: order.clientOrderId,
    sourceOrderId: String(order.orderId),
    sourceTradeId: String(trade.id),
    fillQty: toNumber(trade.qty),
    fillPrice: toNumber(trade.price || order.avgPrice),
    fee: toNumber(trade.commission),
    realizedPnl: toNumber(trade.realizedPnl),
    tradeTime: new Date(Number(trade.time || order.updateTime || order.time || Date.now())),
    eventType,
    note,
  });

  await recordRuntimeEvent({
    pid,
    strategyCategory,
    eventCode: eventType,
    symbol,
    side: order.side,
    positionSide,
    clientOrderId: order.clientOrderId,
    orderId: order.orderId,
    quantity: toNumber(order.origQty),
    executedQty: toNumber(order.executedQty),
    avgPrice: toNumber(order.avgPrice || trade.price),
    tradeTime: new Date(Number(trade.time || order.updateTime || order.time || Date.now())),
    note,
    payload: { tradeId: trade.id, result },
  });

  await addMsg({
    fun: "localStaleConv",
    code: "FILL_RECOVERED",
    msg: `${note}, orderId:${order.orderId}, tradeId:${trade.id}, qty:${trade.qty}, pnl:${trade.realizedPnl}`,
    pid,
    tid: order.orderId,
    symbol,
    side: positionSide === "LONG" ? "BUY" : "SELL",
  });

  return { skipped: false, result };
};

const cancelReservations = async ({ pid, strategyCategory, symbol, positionSide, clientOrderIds, note }) => {
  const affectedRows = await pidPositionLedger.markReservationsCanceled(clientOrderIds, {
    uid: UID,
    pid,
    strategyCategory,
    positionSide,
  });
  await recordRuntimeEvent({
    pid,
    strategyCategory,
    eventCode: "STALE_RESERVATION_TERMINALIZED",
    symbol,
    side: positionSide === "LONG" ? "BUY" : "SELL",
    positionSide,
    quantity: affectedRows,
    note,
    payload: { clientOrderIds, affectedRows },
  });
  await addMsg({
    fun: "localStaleConv",
    code: "RESV_CANCELED",
    msg: `${note}, affectedRows:${affectedRows}, clientOrderIds:${clientOrderIds.join(",")}`,
    pid,
    symbol,
    side: positionSide === "LONG" ? "BUY" : "SELL",
  });
  return affectedRows;
};

const closeAmbiguousRemainder = async ({ pid, strategyCategory, symbol, positionSide, eventType, note }) => {
  const before = await pidPositionLedger.loadSnapshot({ uid: UID, pid, strategyCategory, positionSide });
  const result = await pidPositionLedger.closeSnapshotAsOrphan({
    uid: UID,
    pid,
    strategyCategory,
    symbol,
    positionSide,
    eventType,
    note,
    tradeTime: new Date(),
  });
  const after = await pidPositionLedger.loadSnapshot({ uid: UID, pid, strategyCategory, positionSide });
  await recordRuntimeEvent({
    pid,
    strategyCategory,
    eventCode: eventType,
    symbol,
    side: positionSide === "LONG" ? "BUY" : "SELL",
    positionSide,
    quantity: toNumber(before?.openQty),
    executedQty: 0,
    avgPrice: 0,
    note,
    payload: { before, after, result, realizedPnl: 0 },
  });
  await addMsg({
    fun: "localStaleConv",
    code: "STALE_FLATTEN",
    msg: `${note}, openQtyBefore:${toNumber(before?.openQty)}, openQtyAfter:${toNumber(after?.openQty)}, realizedPnl:0`,
    pid,
    symbol,
    side: positionSide === "LONG" ? "BUY" : "SELL",
  });
  return { before, after, result };
};

const summarizeCleanGate = async (exchange, localState = null) => {
  const local = localState || await loadLocalState();
  const rows = [];
  for (const symbol of SYMBOLS) {
    for (const side of ["LONG", "SHORT"]) {
      const binanceQty = Math.abs(getPositionQty(exchange, symbol, side));
      const openOrders = (exchange?.[symbol]?.openOrders || []).length;
      const openAlgoOrders = (exchange?.[symbol]?.openAlgoOrders || [])
        .filter((row) => String(row.positionSide || "").toUpperCase() === side)
        .length;
      const localOpenQty = (local.snapshots || [])
        .filter((row) => row.symbol === symbol && String(row.positionSide || "").toUpperCase() === side)
        .reduce((sum, row) => sum + Math.abs(toNumber(row.openQty)), 0);
      const activeReservations = (local.reservations || [])
        .filter((row) => row.symbol === symbol && String(row.positionSide || "").toUpperCase() === side)
        .reduce((sum, row) => sum + Math.max(0, toNumber(row.reservedQty) - toNumber(row.filledQty)), 0);
      rows.push({
        symbol,
        side,
        binanceQty,
        openOrders,
        openAlgoOrders,
        localOpenQty,
        activeReservations,
        verdict: binanceQty === 0 && openOrders === 0 && openAlgoOrders === 0 && localOpenQty === 0 && activeReservations === 0
          ? "CLEAN"
          : "STALE_OR_RISK",
      });
    }
  }
  return rows;
};

const execute = async () => {
  assertApproval();
  const beforeExchange = await loadExchange();
  assertExchangeFlat(beforeExchange);
  const beforeLocal = await loadLocalState();

  const xrpLongOrder = findOrder(beforeExchange, "XRPUSDT", 147883985483);
  const xrpLongTrade = findTrade(beforeExchange, "XRPUSDT", 3098434937);
  const xrpShortOrder = findOrder(beforeExchange, "XRPUSDT", 147883985484);
  const xrpShortTrade = findTrade(beforeExchange, "XRPUSDT", 3098434938);
  if (!xrpLongOrder || !xrpLongTrade || !xrpShortOrder || !xrpShortTrade) {
    throw new Error("REQUIRED_CLEANUP_FILL_EVIDENCE_MISSING");
  }
  if (String(xrpLongOrder.status).toUpperCase() !== "FILLED" || String(xrpShortOrder.status).toUpperCase() !== "FILLED") {
    throw new Error("CLEANUP_ORDER_NOT_FILLED");
  }

  const actions = [];

  actions.push({
    action: "PID 991749 owner-clear actual fill recovery",
    pid: 991749,
    before: await pidPositionLedger.loadSnapshot({ uid: UID, pid: 991749, strategyCategory: "signal", positionSide: "SHORT" }),
    ledger: await applyOwnerClearFill({
      pid: 991749,
      strategyCategory: "signal",
      symbol: "XRPUSDT",
      positionSide: "SHORT",
      order: xrpShortOrder,
      trade: xrpShortTrade,
      eventType: "SIGNAL_EXTERNAL_MANUAL_CLOSE_FILL",
      note: "approved-local-stale-convergence: owner-clear user Binance cleanup 20260501",
    }),
  });
  const signalReservationEffect = await cancelReservations({
    pid: 991749,
    strategyCategory: "signal",
    symbol: "XRPUSDT",
    positionSide: "SHORT",
    clientOrderIds: [
      "PROFIT_147_991749_147846553633",
      "STOP_147_991749_147846553633",
    ],
    note: "approved-local-stale-convergence: terminalize sibling TP/STOP after owner-clear cleanup",
  });
  await syncSignalReady({ pid: 991749, positionSide: "SHORT" });
  actions[actions.length - 1].reservationEffect = signalReservationEffect;
  actions[actions.length - 1].after = await pidPositionLedger.loadSnapshot({ uid: UID, pid: 991749, strategyCategory: "signal", positionSide: "SHORT" });

  actions.push({
    action: "PID 991501 clear final 3.4 fill recovery",
    pid: 991501,
    before: await pidPositionLedger.loadSnapshot({ uid: UID, pid: 991501, strategyCategory: "grid", positionSide: "LONG" }),
    ledger: await applyOwnerClearFill({
      pid: 991501,
      strategyCategory: "grid",
      symbol: "XRPUSDT",
      positionSide: "LONG",
      order: xrpLongOrder,
      trade: xrpLongTrade,
      eventType: "GRID_EXTERNAL_MANUAL_CLOSE_FILL",
      note: "approved-local-stale-convergence: clear final 3.4 user Binance cleanup 20260501",
    }),
  });
  const after991501Fill = await pidPositionLedger.loadSnapshot({ uid: UID, pid: 991501, strategyCategory: "grid", positionSide: "LONG" });
  let correction = null;
  if (toNumber(after991501Fill?.openQty) > 0) {
    correction = await closeAmbiguousRemainder({
      pid: 991501,
      strategyCategory: "grid",
      symbol: "XRPUSDT",
      positionSide: "LONG",
      eventType: "GRID_EXCHANGE_FLAT_LOCAL_STALE_FLATTEN",
      note: "controlled-local-stale-convergence: exchange flat, prior aggregate reduction not owner-clear, no Binance open protection, realizedPnl=0",
    });
  }
  await syncGridClosed({ pid: 991501, leg: "LONG" });
  actions[actions.length - 1].correction = correction;
  actions[actions.length - 1].after = await pidPositionLedger.loadSnapshot({ uid: UID, pid: 991501, strategyCategory: "grid", positionSide: "LONG" });

  const pumpReservationEffect = await cancelReservations({
    pid: 991502,
    strategyCategory: "grid",
    symbol: "PUMPUSDT",
    positionSide: "LONG",
    clientOrderIds: ["GSTOP_L_147_991502_48618296"],
    note: "approved-local-stale-convergence: terminalize stale GRID_STOP missing on Binance",
  });
  actions.push({
    action: "PID 991502 stale GRID_STOP reservation terminalization",
    pid: 991502,
    before: "ACTIVE GSTOP_L_147_991502_48618296",
    after: "CANCELED local terminal state",
    ledger: null,
    reservationEffect: pumpReservationEffect,
  });

  const afterExchange = await loadExchange();
  const afterLocal = await loadLocalState();
  const beforeGate = await summarizeCleanGate(beforeExchange, beforeLocal);
  const afterGate = await summarizeCleanGate(afterExchange, afterLocal);
  const duplicateIntegrity = {
    sourceTradeId3098434937: await ledgerCount(`uid = ? AND sourceTradeId = ?`, [UID, "3098434937"]),
    sourceTradeId3098434938: await ledgerCount(`uid = ? AND sourceTradeId = ?`, [UID, "3098434938"]),
    sourceOrderId147883985483: await ledgerCount(`uid = ? AND sourceOrderId = ?`, [UID, "147883985483"]),
    sourceOrderId147883985484: await ledgerCount(`uid = ? AND sourceOrderId = ?`, [UID, "147883985484"]),
    correctionRealizedPnl: await db
      .query(
        `SELECT COALESCE(SUM(realizedPnl), 0) AS pnl
           FROM live_pid_position_ledger
          WHERE uid = ?
            AND pid = 991501
            AND eventType = 'GRID_EXCHANGE_FLAT_LOCAL_STALE_FLATTEN'`,
        [UID]
      )
      .then(([rows]) => toNumber(rows?.[0]?.pnl)),
  };

  const report = {
    approvalPhrase: APPROVAL_PHRASE,
    generatedAt: new Date().toISOString(),
    beforeGate,
    actions,
    afterGate,
    duplicateIntegrity,
    afterLocal,
  };
  const out = path.resolve(
    "legacy/backend/tools/qa/reports/tmp-approved-local-stale-convergence-20260501-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      ".json"
  );
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, beforeGate, actions, afterGate, duplicateIntegrity }, null, 2));
};

execute()
  .catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch (error) {}
    process.exit(process.exitCode || 0);
  });
