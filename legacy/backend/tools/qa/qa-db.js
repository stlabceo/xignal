const db = require("../../database/connect/config");

const SIGNAL_TABLE = "live_play_list";
const GRID_TABLE = "live_grid_strategy_list";

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const delay = (ms = 0) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));

const normalizeSymbol = (value, fallback = "BTCUSDT") =>
  String(value || fallback)
    .trim()
    .toUpperCase();

const normalizePositionSide = (value, fallback = "LONG") =>
  String(value || fallback)
    .trim()
    .toUpperCase();

const toSqlDateTime = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
};

const query = async (sql, params = []) => {
  const [rows] = await db.query(sql, params);
  return rows;
};

const one = async (sql, params = []) => {
  const rows = await query(sql, params);
  return rows[0] || null;
};

const scalar = async (sql, params = []) => {
  const row = await one(sql, params);
  if (!row) {
    return null;
  }
  return row[Object.keys(row)[0]];
};

const resolveAnyExistingUid = async () => {
  const row = await one(`SELECT id FROM admin_member ORDER BY id ASC LIMIT 1`);
  return Number(row?.id || 0);
};

const resolveReadOnlyUid = async (preferredUid = 0) => {
  if (preferredUid > 0) {
    return preferredUid;
  }

  const row = await one(
    `SELECT id
       FROM admin_member
      WHERE appKey IS NOT NULL
        AND appSecret IS NOT NULL
        AND tradeAccessMode <> 'DEMO_ONLY'
      ORDER BY id ASC
      LIMIT 1`
  );
  return Number(row?.id || 0);
};

const getMember = async (uid) =>
  await one(
    `SELECT id, mem_id, tradeAccessMode, appKey, appSecret
       FROM admin_member
      WHERE id = ?
      LIMIT 1`,
    [uid]
  );

const ensureUidExists = async (uid) => {
  const member = await getMember(uid);
  if (!member) {
    throw new Error(`QA_UID_NOT_FOUND:${uid}`);
  }
  return member;
};

const buildLabel = (prefix = "QA") =>
  `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

const normalizePositiveIds = (values = []) =>
  Array.from(
    new Set([].concat(values || []).map((value) => Number(value || 0)).filter((value) => value > 0))
  );

const isQaTempStrategyName = (value) => String(value || "").trim().toUpperCase().startsWith("QA_");

const loadStrategyMarkerRows = async (tableName, uid, ids = []) => {
  const normalizedIds = normalizePositiveIds(ids);
  if (normalizedIds.length === 0) {
    return [];
  }
  const placeholders = normalizedIds.map(() => "?").join(",");
  return await query(
    `SELECT id, a_name
       FROM ${tableName}
      WHERE uid = ?
        AND id IN (${placeholders})`,
    [uid, ...normalizedIds]
  );
};

const resolveQaTempSignalIds = async (uid, ids = []) => {
  const rows = await loadStrategyMarkerRows(SIGNAL_TABLE, uid, ids);
  return rows.filter((row) => isQaTempStrategyName(row.a_name)).map((row) => Number(row.id));
};

const resolveQaTempGridIds = async (uid, ids = []) => {
  const rows = await loadStrategyMarkerRows(GRID_TABLE, uid, ids);
  return rows.filter((row) => isQaTempStrategyName(row.a_name)).map((row) => Number(row.id));
};

const createTempSignalPlay = async ({
  uid,
  symbol = "BTCUSDT",
  bunbong = "1MIN",
  type = "ATF+VIXFIX",
  aName = null,
  status = "READY",
  enabled = "Y",
  signalType = "BUY",
  rSignalType = "BUY",
  rSignalTime = null,
  rExactPrice = null,
  rExactTime = null,
  rQty = null,
  splitTakeProfitEnabled = "N",
  splitTakeProfitCount = 0,
  splitTakeProfitGap = 0.2,
  splitTakeProfitConfigJson = null,
} = {}) => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const label = aName || buildLabel("QA_SIGNAL");
  const [result] = await db.query(
    `INSERT INTO ${SIGNAL_TABLE}
      (
        uid,
        live_ST,
        a_name,
        type,
        symbol,
        bunbong,
        marginType,
        signalType,
        enabled,
        st,
        autoST,
        status,
        leverage,
        margin,
        r_signalType,
        r_signalTime,
        r_exactPrice,
        r_exactTime,
        r_qty,
        splitTakeProfitEnabled,
        splitTakeProfitCount,
        splitTakeProfitGap,
        splitTakeProfitConfigJson
      )
     VALUES
      (?, 'Y', ?, ?, ?, ?, 'isolated', ?, ?, NULL, 'N', ?, 1, 10, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uid,
      label,
      type,
      normalizedSymbol,
      bunbong,
      signalType,
      enabled,
      status,
      rSignalType,
      rSignalTime,
      rExactPrice,
      rExactTime,
      rQty,
      splitTakeProfitEnabled,
      splitTakeProfitCount,
      splitTakeProfitGap,
      splitTakeProfitConfigJson,
    ]
  );

  return loadSignalRow(result.insertId);
};

const createTempGridStrategy = async ({
  uid,
  symbol = "BTCUSDT",
  bunbong = "1MIN",
  aName = null,
  strategySignal = "QA_GRID",
  enabled = "Y",
  regimeStatus = "WAITING_WEBHOOK",
  longLegStatus = "IDLE",
  shortLegStatus = "IDLE",
  longQty = 0,
  shortQty = 0,
} = {}) => {
  const label = aName || buildLabel("QA_GRID");
  const [result] = await db.query(
    `INSERT INTO ${GRID_TABLE}
      (
        uid,
        a_name,
        strategySignal,
        symbol,
        bunbong,
        marginType,
        margin,
        leverage,
        profit,
        tradeValue,
        st,
        autoST,
        enabled,
        regimeStatus,
        longLegStatus,
        shortLegStatus,
        longQty,
        shortQty
      )
     VALUES
      (?, ?, ?, ?, ?, 'isolated', 10, 1, 0.3, 10, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
    [
      uid,
      label,
      strategySignal,
      normalizeSymbol(symbol),
      bunbong,
      enabled,
      regimeStatus,
      longLegStatus,
      shortLegStatus,
      toNumber(longQty),
      toNumber(shortQty),
    ]
  );
  return loadGridRow(result.insertId);
};

const insertReservation = async ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  clientOrderId,
  sourceOrderId = null,
  actualOrderId = null,
  reservationKind = "BOUND_PROFIT",
  reservedQty = 0,
  filledQty = 0,
  status = "ACTIVE",
  note = null,
} = {}) => {
  const [result] = await db.query(
    `INSERT INTO live_pid_exit_reservation
      (
        uid,
        pid,
        strategyCategory,
        symbol,
        positionSide,
        clientOrderId,
        sourceOrderId,
        actualOrderId,
        reservationKind,
        reservedQty,
        filledQty,
        status,
        note
      )
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uid,
      pid,
      String(strategyCategory || "").trim().toLowerCase(),
      normalizeSymbol(symbol),
      normalizePositionSide(positionSide),
      clientOrderId,
      sourceOrderId,
      actualOrderId,
      reservationKind,
      toNumber(reservedQty),
      toNumber(filledQty),
      status,
      note,
    ]
  );
  return result.insertId;
};

const loadSignalRow = async (pid) =>
  await one(`SELECT * FROM ${SIGNAL_TABLE} WHERE id = ? LIMIT 1`, [pid]);

const loadGridRow = async (pid) =>
  await one(`SELECT * FROM ${GRID_TABLE} WHERE id = ? LIMIT 1`, [pid]);

const loadLedgerRows = async ({ pid, strategyCategory }) =>
  await query(
    `SELECT *
       FROM live_pid_position_ledger
      WHERE pid = ?
        AND strategyCategory = ?
      ORDER BY id ASC`,
    [pid, String(strategyCategory || "").trim().toLowerCase()]
  );

const loadSnapshotRows = async ({ uid, pid, strategyCategory }) =>
  await query(
    `SELECT *
       FROM live_pid_position_snapshot
      WHERE uid = ?
        AND pid = ?
        AND strategyCategory = ?
      ORDER BY positionSide ASC`,
    [uid, pid, String(strategyCategory || "").trim().toLowerCase()]
  );

const loadSnapshot = async ({ uid, pid, strategyCategory, positionSide }) =>
  await one(
    `SELECT *
       FROM live_pid_position_snapshot
      WHERE uid = ?
        AND pid = ?
        AND strategyCategory = ?
        AND positionSide = ?
      LIMIT 1`,
    [uid, pid, String(strategyCategory || "").trim().toLowerCase(), normalizePositionSide(positionSide)]
  );

const loadReservations = async ({ uid, pid, strategyCategory }) =>
  await query(
    `SELECT *
       FROM live_pid_exit_reservation
      WHERE uid = ?
        AND pid = ?
        AND strategyCategory = ?
      ORDER BY id ASC`,
    [uid, pid, String(strategyCategory || "").trim().toLowerCase()]
  );

const loadMsgList = async ({ uid, pid, limit = 20 }) =>
  await query(
    `SELECT id, fun, code, msg, uid, pid, symbol, side, created_at
       FROM msg_list
      WHERE uid = ?
        AND pid = ?
      ORDER BY id DESC
      LIMIT ?`,
    [uid, pid, limit]
  );

const loadRuntimeEventLogs = async ({ uid, pid, limit = 20 }) => {
  const [tableRow] = await db.query(`SHOW TABLES LIKE 'binance_runtime_event_log'`);
  if (!tableRow || tableRow.length === 0) {
    return [];
  }

  return await query(
    `SELECT id, uid, pid, strategy_category, event_type, event_code, note
       FROM binance_runtime_event_log
      WHERE uid = ?
        AND pid = ?
      ORDER BY id DESC
      LIMIT ?`,
    [uid, pid, limit]
  );
};

const cleanupArtifacts = async ({
  uid,
  pids = [],
  signalIds = [],
  gridIds = [],
  registeredQaPids = [],
  settleMs = 250,
  passes = 2,
} = {}) => {
  const requestedPids = normalizePositiveIds(pids);
  const requestedSignalIds = normalizePositiveIds([].concat(signalIds || [], requestedPids));
  const requestedGridIds = normalizePositiveIds([].concat(gridIds || [], requestedPids));
  const registeredArtifactPids = normalizePositiveIds(registeredQaPids);
  const [signalMarkerRows, gridMarkerRows] = await Promise.all([
    loadStrategyMarkerRows(SIGNAL_TABLE, uid, requestedSignalIds),
    loadStrategyMarkerRows(GRID_TABLE, uid, requestedGridIds),
  ]);
  const uniqueSignalIds = signalMarkerRows
    .filter((row) => isQaTempStrategyName(row.a_name))
    .map((row) => Number(row.id));
  const uniqueGridIds = gridMarkerRows
    .filter((row) => isQaTempStrategyName(row.a_name))
    .map((row) => Number(row.id));
  const uniquePids = normalizePositiveIds([].concat(uniqueSignalIds, uniqueGridIds));
  const requestedAllIds = normalizePositiveIds([].concat(requestedPids, requestedSignalIds, requestedGridIds));
  const allowedAllIds = new Set([].concat(uniquePids, uniqueSignalIds, uniqueGridIds, registeredArtifactPids).map((value) => Number(value)));
  const nonQaIds = new Set(
    []
      .concat(signalMarkerRows, gridMarkerRows)
      .filter((row) => row?.id && !isQaTempStrategyName(row.a_name))
      .map((row) => Number(row.id))
  );
  const blockedPids = requestedAllIds.filter((value) => !allowedAllIds.has(Number(value)));
  const conflictPids = uniquePids.filter((value) => nonQaIds.has(Number(value)));
  const artifactCleanupPids = normalizePositiveIds(
    [].concat(uniquePids, registeredArtifactPids)
      .filter((value) => !nonQaIds.has(Number(value)))
  );
  const signalArtifactIds = normalizePositiveIds([].concat(uniqueSignalIds, registeredArtifactPids));
  const gridArtifactIds = normalizePositiveIds([].concat(uniqueGridIds, registeredArtifactPids));
  const msgCleanupPids = artifactCleanupPids;

  if (requestedAllIds.length === 0) {
    return {
      cleaned: false,
      pids: [],
      signalIds: [],
      gridIds: [],
      blockedPids: [],
      conflictPids: [],
      guard: "QA_MARKER_REQUIRED",
    };
  }

  if (uniquePids.length === 0 && uniqueSignalIds.length === 0 && uniqueGridIds.length === 0 && registeredArtifactPids.length === 0) {
    return {
      cleaned: false,
      pids: [],
      signalIds: [],
      gridIds: [],
      blockedPids,
      conflictPids,
      guard: "QA_MARKER_REQUIRED",
    };
  }

  const signalPlaceholders = uniqueSignalIds.map(() => "?").join(",");
  const gridPlaceholders = uniqueGridIds.map(() => "?").join(",");
  const signalArtifactPlaceholders = signalArtifactIds.map(() => "?").join(",");
  const gridArtifactPlaceholders = gridArtifactIds.map(() => "?").join(",");
  const msgPlaceholders = msgCleanupPids.map(() => "?").join(",");
  const normalizedPasses = Math.max(1, Number(passes || 0));

  const runDeletePass = async () => {
    if (signalArtifactIds.length > 0) {
      await db.query(
        `DELETE FROM live_pid_exit_reservation
          WHERE uid = ?
            AND strategyCategory = 'signal'
            AND pid IN (${signalArtifactPlaceholders})`,
        [uid, ...signalArtifactIds]
      );
      await db.query(
        `DELETE FROM live_pid_position_snapshot
          WHERE uid = ?
            AND strategyCategory = 'signal'
            AND pid IN (${signalArtifactPlaceholders})`,
        [uid, ...signalArtifactIds]
      );
      await db.query(
        `DELETE FROM live_pid_position_ledger
          WHERE uid = ?
            AND strategyCategory = 'signal'
            AND pid IN (${signalArtifactPlaceholders})`,
        [uid, ...signalArtifactIds]
      );
    }

    if (gridArtifactIds.length > 0) {
      await db.query(
        `DELETE FROM live_pid_exit_reservation
          WHERE uid = ?
            AND strategyCategory = 'grid'
            AND pid IN (${gridArtifactPlaceholders})`,
        [uid, ...gridArtifactIds]
      );
      await db.query(
        `DELETE FROM live_pid_position_snapshot
          WHERE uid = ?
            AND strategyCategory = 'grid'
            AND pid IN (${gridArtifactPlaceholders})`,
        [uid, ...gridArtifactIds]
      );
      await db.query(
        `DELETE FROM live_pid_position_ledger
          WHERE uid = ?
            AND strategyCategory = 'grid'
            AND pid IN (${gridArtifactPlaceholders})`,
        [uid, ...gridArtifactIds]
      );
    }

    if (msgCleanupPids.length > 0) {
      await db.query(
        `DELETE FROM msg_list
          WHERE uid = ?
            AND pid IN (${msgPlaceholders})`,
        [uid, ...msgCleanupPids]
      );
    }

    const [runtimeLogTable] = await db.query(`SHOW TABLES LIKE 'binance_runtime_event_log'`);
    if (runtimeLogTable && runtimeLogTable.length > 0 && signalArtifactIds.length > 0) {
      await db.query(
        `DELETE FROM binance_runtime_event_log
          WHERE uid = ?
            AND strategy_category = 'signal'
            AND pid IN (${signalArtifactPlaceholders})`,
        [uid, ...signalArtifactIds]
      );
    }
    if (runtimeLogTable && runtimeLogTable.length > 0 && gridArtifactIds.length > 0) {
      await db.query(
        `DELETE FROM binance_runtime_event_log
          WHERE uid = ?
            AND strategy_category = 'grid'
            AND pid IN (${gridArtifactPlaceholders})`,
        [uid, ...gridArtifactIds]
      );
    }

    if (uniqueSignalIds.length > 0) {
      await db.query(
        `DELETE FROM ${SIGNAL_TABLE}
          WHERE uid = ?
            AND id IN (${signalPlaceholders})`,
        [uid, ...uniqueSignalIds]
      );
    }

    if (uniqueGridIds.length > 0) {
      await db.query(
        `DELETE FROM ${GRID_TABLE}
          WHERE uid = ?
            AND id IN (${gridPlaceholders})`,
        [uid, ...uniqueGridIds]
      );
    }
  };

  await runDeletePass();
  for (let index = 1; index < normalizedPasses; index += 1) {
    await delay(settleMs);
    await runDeletePass();
  }
  await delay(settleMs);
  await runDeletePass();

  return {
    cleaned: true,
    pids: uniquePids,
    signalIds: uniqueSignalIds,
    gridIds: uniqueGridIds,
    blockedPids,
    conflictPids,
    guard: "QA_MARKER_REQUIRED",
  };
};

const findQaTempSignalIdsByUid = async (uid) => {
  const normalizedUid = Number(uid || 0);
  if (!(normalizedUid > 0)) {
    return [];
  }

  const rows = await query(
    `SELECT id
       FROM ${SIGNAL_TABLE}
      WHERE uid = ?
        AND a_name LIKE 'QA_%'`,
    [normalizedUid]
  );

  return Array.from(
    new Set(
      (rows || [])
        .map((row) => Number(row?.id || 0))
        .filter((value) => value > 0)
    )
  );
};

const findQaTempGridIdsByUid = async (uid) => {
  const normalizedUid = Number(uid || 0);
  if (!(normalizedUid > 0)) {
    return [];
  }

  const rows = await query(
    `SELECT id
       FROM ${GRID_TABLE}
      WHERE uid = ?
        AND a_name LIKE 'QA_%'`,
    [normalizedUid]
  );

  return Array.from(
    new Set(
      (rows || [])
        .map((row) => Number(row?.id || 0))
        .filter((value) => value > 0)
    )
  );
};

const findQaTempPidsByUid = async (uid) => {
  const [signalRows, gridRows] = await Promise.all([
    findQaTempSignalIdsByUid(uid),
    findQaTempGridIdsByUid(uid),
  ]);

  return Array.from(
    new Set([].concat(signalRows || [], gridRows || []).map((value) => Number(value || 0)).filter((value) => value > 0))
  );
};

const loadQaTempArtifactRows = async ({ uid, pids = [] } = {}) => {
  const normalizedUid = Number(uid || 0);
  const normalizedPids = Array.from(
    new Set([].concat(pids || []).map((value) => Number(value || 0)).filter((value) => value > 0))
  );

  const [signalIds, gridIds] = await Promise.all([
    findQaTempSignalIdsByUid(normalizedUid),
    findQaTempGridIdsByUid(normalizedUid),
  ]);

  const pidPlaceholders = normalizedPids.length > 0
    ? normalizedPids.map(() => "?").join(",")
    : "";
  const signalPlaceholders = signalIds.length > 0
    ? signalIds.map(() => "?").join(",")
    : "";
  const gridPlaceholders = gridIds.length > 0
    ? gridIds.map(() => "?").join(",")
    : "";

  const [signalRows, gridRows, msgRows] = await Promise.all([
    signalIds.length > 0
      ? query(
          `SELECT id, uid, a_name, symbol, enabled, status, created_at
             FROM ${SIGNAL_TABLE}
            WHERE uid = ?
              AND id IN (${signalPlaceholders})
            ORDER BY id ASC`,
          [normalizedUid, ...signalIds]
        )
      : [],
    gridIds.length > 0
      ? query(
          `SELECT id, uid, a_name, symbol, enabled, regimeStatus, createdAt
             FROM ${GRID_TABLE}
            WHERE uid = ?
              AND id IN (${gridPlaceholders})
            ORDER BY id ASC`,
          [normalizedUid, ...gridIds]
        )
      : [],
    normalizedPids.length > 0
      ? query(
          `SELECT id, uid, pid, fun, code, symbol, created_at
             FROM msg_list
            WHERE uid = ?
              AND pid IN (${pidPlaceholders})
            ORDER BY pid ASC, id ASC`,
          [normalizedUid, ...normalizedPids]
        )
      : [],
  ]);

  return {
    live_play_list: signalRows,
    live_grid_strategy_list: gridRows,
    msg_list: msgRows,
  };
};

const sumLocalOpenQtyBySymbolSide = async (uid) =>
  await query(
    `SELECT symbol,
            positionSide,
            ROUND(SUM(openQty), 12) AS localOpenQty,
            GROUP_CONCAT(pid ORDER BY pid ASC) AS pidList
       FROM live_pid_position_snapshot
      WHERE uid = ?
        AND (status = 'OPEN' OR COALESCE(openQty, 0) > 0)
      GROUP BY symbol, positionSide
      ORDER BY symbol ASC, positionSide ASC`,
    [uid]
  );

const loadActiveReservationsByUid = async (uid) =>
  await query(
    `SELECT *
       FROM live_pid_exit_reservation
      WHERE uid = ?
        AND status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')
      ORDER BY pid ASC, id ASC`,
    [uid]
  );

const loadStrategyRow = async ({ strategyCategory, strategyId, pid }) => {
  const targetId = Number(strategyId || pid || 0);
  if (!(targetId > 0)) {
    return null;
  }

  if (String(strategyCategory || "").trim().toUpperCase() === "GRID") {
    return loadGridRow(targetId);
  }

  return loadSignalRow(targetId);
};

const countArtifactRowsForPids = async ({ uid, pids = [] } = {}) => {
  const normalizedUid = Number(uid || 0);
  const normalizedPids = Array.from(
    new Set([].concat(pids || []).map((value) => Number(value || 0)).filter((value) => value > 0))
  );

  if (!(normalizedUid > 0) || normalizedPids.length === 0) {
    return {
      live_pid_position_ledger: 0,
      live_pid_position_snapshot: 0,
      live_grid_strategy_list: 0,
      live_play_list: 0,
      live_pid_exit_reservation: 0,
      msg_list: 0,
    };
  }

  const placeholders = normalizedPids.map(() => "?").join(",");
  const params = [normalizedUid, ...normalizedPids];
  const [
    ledgerCount,
    snapshotCount,
    gridCount,
    signalCount,
    reservationCount,
    msgCount,
  ] = await Promise.all([
    scalar(
      `SELECT COUNT(*) AS cnt
         FROM live_pid_position_ledger
        WHERE uid = ?
          AND pid IN (${placeholders})`,
      params
    ),
    scalar(
      `SELECT COUNT(*) AS cnt
         FROM live_pid_position_snapshot
        WHERE uid = ?
          AND pid IN (${placeholders})`,
      params
    ),
    scalar(
      `SELECT COUNT(*) AS cnt
         FROM ${GRID_TABLE}
        WHERE uid = ?
          AND id IN (${placeholders})`,
      params
    ),
    scalar(
      `SELECT COUNT(*) AS cnt
         FROM ${SIGNAL_TABLE}
        WHERE uid = ?
          AND id IN (${placeholders})`,
      params
    ),
    scalar(
      `SELECT COUNT(*) AS cnt
         FROM live_pid_exit_reservation
        WHERE uid = ?
          AND pid IN (${placeholders})`,
      params
    ),
    scalar(
      `SELECT COUNT(*) AS cnt
         FROM msg_list
        WHERE uid = ?
          AND pid IN (${placeholders})`,
      params
    ),
  ]);

  return {
    live_pid_position_ledger: Number(ledgerCount || 0),
    live_pid_position_snapshot: Number(snapshotCount || 0),
    live_grid_strategy_list: Number(gridCount || 0),
    live_play_list: Number(signalCount || 0),
    live_pid_exit_reservation: Number(reservationCount || 0),
    msg_list: Number(msgCount || 0),
  };
};

const countRows = async (tableName) =>
  Number(await scalar(`SELECT COUNT(*) AS cnt FROM ${tableName}`)) || 0;

const closePool = async () => {
  try {
    await db.end();
  } catch (error) {}
};

module.exports = {
  SIGNAL_TABLE,
  GRID_TABLE,
  db,
  closePool,
  toNumber,
  toSqlDateTime,
  normalizeSymbol,
  normalizePositionSide,
  query,
  one,
  scalar,
  countRows,
  getMember,
  ensureUidExists,
  resolveAnyExistingUid,
  resolveReadOnlyUid,
  buildLabel,
  createTempSignalPlay,
  createTempGridStrategy,
  insertReservation,
  loadSignalRow,
  loadGridRow,
  loadLedgerRows,
  loadSnapshotRows,
  loadSnapshot,
  loadReservations,
  loadMsgList,
  loadRuntimeEventLogs,
  cleanupArtifacts,
  isQaTempStrategyName,
  findQaTempSignalIdsByUid,
  findQaTempGridIdsByUid,
  loadQaTempArtifactRows,
  findQaTempPidsByUid,
  sumLocalOpenQtyBySymbolSide,
  loadActiveReservationsByUid,
  loadStrategyRow,
  countArtifactRowsForPids,
};
