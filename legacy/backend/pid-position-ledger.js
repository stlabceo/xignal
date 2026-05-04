const crypto = require("crypto");
const db = require("./database/connect/config");
const { parsePlatformClientOrderId } = require("./order-client-id");

const normalizeSymbol = (symbol) =>
  String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z]+:/, "")
    .replace(/\.P$/i, "");

const normalizePositionSide = (positionSide) => {
  const normalized = String(positionSide || "")
    .trim()
    .toUpperCase();

  if (normalized === "LONG" || normalized === "BUY") {
    return "LONG";
  }

  if (normalized === "SHORT" || normalized === "SELL") {
    return "SHORT";
  }

  return null;
};

const normalizeStrategyCategory = (strategyCategory) =>
  String(strategyCategory || "")
    .trim()
    .toLowerCase();

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toSqlDateTime = (value) => {
  if (!value) {
    return null;
  }

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

const normalizeSourceId = (value) => {
  if (value == null || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
};

const buildReservationClientOrderScope = ({
  clientOrderId,
  uid = null,
  pid = null,
  strategyCategory = null,
  positionSide = null,
  stage = "RESERVATION_CLIENT_ORDER_SCOPE",
} = {}) => {
  const normalizedClientOrderId = normalizeSourceId(clientOrderId);
  const parsed = parsePlatformClientOrderId(normalizedClientOrderId);
  const expectedUid = Number(uid || 0);
  const expectedPid = Number(pid || 0);

  if (!normalizedClientOrderId) {
    return { ok: false, clauses: [], params: [], parsed, normalizedClientOrderId };
  }

  if (parsed && expectedUid > 0 && parsed.uid !== expectedUid) {
    logLedgerStateChange("CLIENT_ORDER_UID_MISMATCH_BLOCKED", {
      stage,
      clientOrderId: normalizedClientOrderId,
      parsedUid: parsed.uid,
      expectedUid,
      parsedPid: parsed.pid,
      expectedPid: expectedPid || null,
    });
    return { ok: false, clauses: [], params: [], parsed, normalizedClientOrderId };
  }

  if (parsed && expectedPid > 0 && parsed.pid !== expectedPid) {
    logLedgerStateChange("CLIENT_ORDER_PID_MISMATCH_BLOCKED", {
      stage,
      clientOrderId: normalizedClientOrderId,
      parsedUid: parsed.uid,
      expectedUid: expectedUid || null,
      parsedPid: parsed.pid,
      expectedPid,
    });
    return { ok: false, clauses: [], params: [], parsed, normalizedClientOrderId };
  }

  const clauses = ["clientOrderId = ?"];
  const params = [normalizedClientOrderId];
  const scopedUid = expectedUid > 0 ? expectedUid : parsed?.uid;
  const scopedPid = expectedPid > 0 ? expectedPid : parsed?.pid;
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedPositionSide = normalizePositionSide(positionSide);

  if (scopedUid > 0) {
    clauses.push("uid = ?");
    params.push(scopedUid);
  }
  if (scopedPid > 0) {
    clauses.push("pid = ?");
    params.push(scopedPid);
  }
  if (normalizedCategory) {
    clauses.push("strategyCategory = ?");
    params.push(normalizedCategory);
  }
  if (normalizedPositionSide) {
    clauses.push("positionSide = ?");
    params.push(normalizedPositionSide);
  }

  if (!parsed && !(scopedUid > 0)) {
    logLedgerStateChange("RESERVATION_CLIENT_ORDER_SCOPE_UNKNOWN", {
      stage,
      clientOrderId: normalizedClientOrderId,
    });
    return { ok: false, clauses: [], params: [], parsed, normalizedClientOrderId };
  }

  if (parsed || scopedUid > 0 || scopedPid > 0) {
    logLedgerStateChange("RESERVATION_UID_SCOPE_ENFORCED", {
      stage,
      clientOrderId: normalizedClientOrderId,
      uid: scopedUid || null,
      pid: scopedPid || null,
      strategyCategory: normalizedCategory || null,
      positionSide: normalizedPositionSide || null,
      parsed: parsed
        ? { prefix: parsed.prefix, uid: parsed.uid, pid: parsed.pid, leg: parsed.leg || null }
        : null,
    });
  }

  return { ok: true, clauses, params, parsed, normalizedClientOrderId };
};

const normalizeTradeId = (value) => {
  if (value == null || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
};

const isFillEventType = (eventType) =>
  String(eventType || "")
    .trim()
    .toUpperCase()
    .includes("FILL");

const logLedgerRuntime = (stage, payload = {}) => {
  try {
    console.log(
      `[PID_LEDGER] ${stage} ${JSON.stringify(payload)}`
    );
  } catch (error) {
    console.log(`[PID_LEDGER] ${stage}`);
  }
};

const logLedgerStateChange = (stage, payload = {}) => {
  logLedgerRuntime(stage, payload);
};

const buildFillIdentity = ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  sourceClientOrderId = null,
  sourceOrderId = null,
  sourceTradeId = null,
  tradeTime = null,
  fillQty = 0,
  fillPrice = 0,
} = {}) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedPositionSide = normalizePositionSide(positionSide);
  const normalizedTradeTime = toSqlDateTime(tradeTime);
  const normalizedQty = toNumber(fillQty);
  const normalizedPrice = toNumber(fillPrice);
  const normalizedClientOrderId = normalizeSourceId(sourceClientOrderId);
  const normalizedOrderId = normalizeSourceId(sourceOrderId);
  const normalizedTradeId = normalizeTradeId(sourceTradeId);

  if (
    !uid ||
    !pid ||
    !normalizedCategory ||
    !normalizedSymbol ||
    !normalizedPositionSide ||
    !(normalizedQty > 0) ||
    !(normalizedPrice > 0) ||
    !normalizedTradeTime ||
    (!normalizedTradeId && !normalizedClientOrderId && !normalizedOrderId)
  ) {
    return null;
  }

  return {
    uid: Number(uid),
    pid: Number(pid),
    strategyCategory: normalizedCategory,
    symbol: normalizedSymbol,
    positionSide: normalizedPositionSide,
    sourceClientOrderId: normalizedClientOrderId,
    sourceOrderId: normalizedOrderId,
    sourceTradeId: normalizedTradeId,
    tradeTime: normalizedTradeTime,
    fillQty: normalizedQty,
    fillPrice: normalizedPrice,
  };
};

const buildFillIdentityKey = (payload = {}) => {
  const identity = buildFillIdentity(payload);
  if (!identity) {
    return null;
  }

  return [
    identity.uid,
    identity.pid,
    identity.strategyCategory,
    identity.symbol,
    identity.positionSide,
    identity.sourceTradeId ? `trade:${identity.sourceTradeId}` : "trade:-",
    identity.sourceClientOrderId
      ? `client:${identity.sourceClientOrderId}`
      : "client:-",
    identity.sourceOrderId ? `order:${identity.sourceOrderId}` : "order:-",
    `time:${identity.tradeTime}`,
    `qty:${identity.fillQty.toFixed(12)}`,
    `price:${identity.fillPrice.toFixed(12)}`,
  ].join(":");
};

const logDuplicateExchangeFillIgnored = ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  sourceClientOrderId,
  sourceOrderId,
  sourceTradeId,
  existingEventType,
  incomingEventType,
  fillQty,
  fillPrice,
  tradeTime,
  reason = "DUPLICATE_EXCHANGE_FILL_IGNORED",
} = {}) => {
  logLedgerRuntime(reason, {
    uid,
    pid,
    strategyCategory: normalizeStrategyCategory(strategyCategory),
    symbol: normalizeSymbol(symbol),
    positionSide: normalizePositionSide(positionSide),
    sourceClientOrderId: normalizeSourceId(sourceClientOrderId),
    sourceOrderId: normalizeSourceId(sourceOrderId),
    sourceTradeId: normalizeTradeId(sourceTradeId),
    existingEventType: String(existingEventType || "").trim() || null,
    incomingEventType: String(incomingEventType || "").trim() || null,
    fillQty: toNumber(fillQty),
    fillPrice: toNumber(fillPrice),
    tradeTime: toSqlDateTime(tradeTime),
  });
};

const buildSnapshotLockKey = ({
  uid,
  pid,
  strategyCategory,
  positionSide,
}) =>
  `pid-position:${Number(uid || 0)}:${Number(pid || 0)}:${normalizeStrategyCategory(
    strategyCategory
  )}:${normalizePositionSide(positionSide)}`;

const acquireDbNamedLock = async (connection, lockKey, timeoutSeconds = 1) => {
  if (!connection || !lockKey) {
    return false;
  }

  const [rows] = await connection.query("SELECT GET_LOCK(?, ?) AS locked", [
    lockKey,
    timeoutSeconds,
  ]);
  return Number(rows?.[0]?.locked || 0) === 1;
};

const releaseDbNamedLock = async (connection, lockKey) => {
  if (!connection || !lockKey) {
    return;
  }

  try {
    await connection.query("DO RELEASE_LOCK(?)", [lockKey]);
  } catch (error) {}
};

const withSnapshotTransaction = async (context, worker) => {
  const lockKey = buildSnapshotLockKey(context);
  let connection = null;

  try {
    connection = await db.getConnection();
    const locked = await acquireDbNamedLock(connection, lockKey, 1);
    if (!locked) {
      return {
        ok: false,
        reason: "LOCK_BUSY",
      };
    }

    await connection.beginTransaction();
    const result = await worker(connection);
    await connection.commit();
    return result;
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {}
    }
    throw error;
  } finally {
    if (connection) {
      await releaseDbNamedLock(connection, lockKey);
      connection.release();
    }
  }
};

const loadSnapshotForUpdate = async (
  connection,
  { uid, pid, strategyCategory, positionSide }
) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedPositionSide = normalizePositionSide(positionSide);
  if (!uid || !pid || !normalizedCategory || !normalizedPositionSide) {
    return null;
  }

  const [rows] = await connection.query(
    `SELECT *
       FROM live_pid_position_snapshot
      WHERE uid = ?
        AND pid = ?
        AND strategyCategory = ?
        AND positionSide = ?
      LIMIT 1
      FOR UPDATE`,
    [uid, pid, normalizedCategory, normalizedPositionSide]
  );

  return rows?.[0] || null;
};

const loadSnapshot = async ({ uid, pid, strategyCategory, positionSide }) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedPositionSide = normalizePositionSide(positionSide);
  if (!uid || !pid || !normalizedCategory || !normalizedPositionSide) {
    return null;
  }

  const [rows] = await db.query(
    `SELECT *
       FROM live_pid_position_snapshot
      WHERE uid = ?
        AND pid = ?
        AND strategyCategory = ?
        AND positionSide = ?
      LIMIT 1`,
    [uid, pid, normalizedCategory, normalizedPositionSide]
  );

  return rows?.[0] || null;
};

const findRecordedFill = async ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  sourceClientOrderId = null,
  sourceOrderId = null,
  sourceTradeId = null,
  fillQty = 0,
  fillPrice = 0,
  tradeTime = null,
  connection = null,
} = {}) => {
  const identity = buildFillIdentity({
    uid,
    pid,
    strategyCategory,
    symbol,
    positionSide,
    sourceClientOrderId,
    sourceOrderId,
    sourceTradeId,
    fillQty,
    fillPrice,
    tradeTime,
  });

  if (!identity) {
    return null;
  }

  if (identity.sourceTradeId) {
    const executor = connection || db;
    const [rows] = await executor.query(
      `SELECT *
         FROM live_pid_position_ledger
        WHERE uid = ?
          AND pid = ?
          AND strategyCategory = ?
          AND symbol = ?
          AND positionSide = ?
          AND sourceTradeId = ?
        ORDER BY id DESC
        LIMIT 1`,
      [
        identity.uid,
        identity.pid,
        identity.strategyCategory,
        identity.symbol,
        identity.positionSide,
        identity.sourceTradeId,
      ]
    );
    return rows?.[0] || null;
  }

  const clauses = [];
  const params = [
    identity.uid,
    identity.pid,
    identity.strategyCategory,
    identity.symbol,
    identity.positionSide,
    identity.tradeTime,
    identity.fillQty,
    identity.fillPrice,
  ];
  if (identity.sourceClientOrderId) {
    clauses.push(`sourceClientOrderId = ?`);
    params.push(identity.sourceClientOrderId);
  }
  if (identity.sourceOrderId) {
    clauses.push(`sourceOrderId = ?`);
    params.push(identity.sourceOrderId);
  }

  const executor = connection || db;
  const [rows] = await executor.query(
    `SELECT *
       FROM live_pid_position_ledger
      WHERE uid = ?
        AND pid = ?
        AND strategyCategory = ?
        AND symbol = ?
        AND positionSide = ?
        AND tradeTime = ?
        AND ABS(fillQty - ?) < 0.000000001
        AND ABS(fillPrice - ?) < 0.000000001
        AND ${clauses.join(" AND ")}
      ORDER BY id DESC
      LIMIT 1`,
    params
  );

  return rows?.[0] || null;
};

const loadAnySnapshotByPid = async ({ uid, pid, strategyCategory }) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  if (!uid || !pid || !normalizedCategory) {
    return null;
  }

  const [rows] = await db.query(
    `SELECT *
       FROM live_pid_position_snapshot
      WHERE uid = ?
        AND pid = ?
        AND strategyCategory = ?
      ORDER BY
        CASE WHEN status = 'OPEN' THEN 0 ELSE 1 END,
        updatedAt DESC
      LIMIT 1`,
    [uid, pid, normalizedCategory]
  );

  return rows?.[0] || null;
};

const loadSnapshotsByPids = async ({ uid, strategyCategory, pids = [] } = {}) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedPids = []
    .concat(pids || [])
    .map((item) => Number(item || 0))
    .filter((item) => item > 0);

  if (!uid || !normalizedCategory || normalizedPids.length === 0) {
    return [];
  }

  const [rows] = await db.query(
    `SELECT *
       FROM live_pid_position_snapshot
      WHERE uid = ?
        AND strategyCategory = ?
        AND pid IN (${normalizedPids.map(() => "?").join(",")})`,
    [uid, normalizedCategory, ...normalizedPids]
  );

  return rows || [];
};

const upsertSnapshot = async (
  connection,
  { uid, pid, strategyCategory, symbol, positionSide },
  patch = {}
) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedPositionSide = normalizePositionSide(positionSide);
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!uid || !pid || !normalizedCategory || !normalizedPositionSide || !normalizedSymbol) {
    return null;
  }

  const entries = Object.entries({
    ...patch,
  });
  const columns = ["uid", "pid", "strategyCategory", "symbol", "positionSide", ...entries.map(([key]) => key)];
  const placeholders = columns.map(() => "?").join(", ");
  const updates = entries
    .map(([key]) => `${key} = VALUES(${key})`)
    .concat(["updatedAt = CURRENT_TIMESTAMP"])
    .join(", ");

  await connection.query(
    `INSERT INTO live_pid_position_snapshot (${columns.join(", ")})
     VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updates}`,
    [
      uid,
      pid,
      normalizedCategory,
      normalizedSymbol,
      normalizedPositionSide,
      ...entries.map(([, value]) => value),
    ]
  );

  return await loadSnapshotForUpdate(connection, {
    uid,
    pid,
    strategyCategory: normalizedCategory,
    positionSide: normalizedPositionSide,
  });
};

const buildLedgerDedupeKey = ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  eventType,
  sourceClientOrderId,
  sourceOrderId,
  sourceTradeId,
  tradeTime,
  fillQty,
  fillPrice,
}) => {
  if (isFillEventType(eventType)) {
    const fillIdentityKey = buildFillIdentityKey({
      uid,
      pid,
      strategyCategory,
      symbol,
      positionSide,
      sourceClientOrderId,
      sourceOrderId,
      sourceTradeId,
      tradeTime,
      fillQty,
      fillPrice,
    });
    if (fillIdentityKey) {
      return fillIdentityKey;
    }
  }

  return [
    uid,
    pid,
    normalizeStrategyCategory(strategyCategory),
    normalizeSymbol(symbol),
    normalizePositionSide(positionSide),
    String(eventType || "").trim().toUpperCase(),
    String(sourceTradeId || "-").trim(),
    String(sourceClientOrderId || "-").trim(),
    String(sourceOrderId || "-").trim(),
    String(toSqlDateTime(tradeTime) || "-"),
    toNumber(fillQty).toFixed(12),
    toNumber(fillPrice).toFixed(12),
  ].join(":");
};

const loadLedgerRowByDedupeKey = async (connection, dedupeKey) => {
  if (!connection || !dedupeKey) {
    return null;
  }

  const [rows] = await connection.query(
    `SELECT *
       FROM live_pid_position_ledger
      WHERE dedupeKey = ?
      LIMIT 1`,
    [dedupeKey]
  );
  return rows?.[0] || null;
};

const insertLedgerRow = async (connection, payload = {}) => {
  const dedupeKey = buildLedgerDedupeKey(payload);
  try {
    const [result] = await connection.query(
      `INSERT INTO live_pid_position_ledger
      (
        uid,
        pid,
        strategyCategory,
        symbol,
        positionSide,
        eventType,
        sourceClientOrderId,
        sourceOrderId,
        sourceTradeId,
        fillQty,
        fillPrice,
        fillValue,
        fee,
        realizedPnl,
        openQtyAfter,
        openCostAfter,
        avgEntryPriceAfter,
        tradeTime,
        dedupeKey,
        note
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        payload.uid,
        payload.pid,
        normalizeStrategyCategory(payload.strategyCategory),
        normalizeSymbol(payload.symbol),
        normalizePositionSide(payload.positionSide),
        payload.eventType,
        payload.sourceClientOrderId || null,
        payload.sourceOrderId == null ? null : String(payload.sourceOrderId),
        payload.sourceTradeId == null ? null : String(payload.sourceTradeId),
        toNumber(payload.fillQty),
        toNumber(payload.fillPrice),
        toNumber(payload.fillValue),
        toNumber(payload.fee),
        toNumber(payload.realizedPnl),
        toNumber(payload.openQtyAfter),
        toNumber(payload.openCostAfter),
        toNumber(payload.avgEntryPriceAfter),
        toSqlDateTime(payload.tradeTime),
        dedupeKey,
        payload.note || null,
      ]
    );

    return {
      ok: true,
      duplicate: false,
      dedupeKey,
      insertId: Number(result?.insertId || 0) || null,
    };
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return {
        ok: true,
        duplicate: true,
        dedupeKey,
        existingRow: await loadLedgerRowByDedupeKey(connection, dedupeKey),
      };
    }

    throw error;
  }
};

const applyEntryFill = async ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  sourceClientOrderId = null,
  sourceOrderId = null,
  sourceTradeId = null,
  fillQty = 0,
  fillPrice = 0,
  fee = 0,
  tradeTime = null,
  eventType = "ENTRY_FILL",
  note = null,
}) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedPositionSide = normalizePositionSide(positionSide);
  const normalizedSymbol = normalizeSymbol(symbol);
  const resolvedQty = toNumber(fillQty);
  const resolvedPrice = toNumber(fillPrice);
  const resolvedFee = toNumber(fee);

  if (
    !uid ||
    !pid ||
    !normalizedCategory ||
    !normalizedPositionSide ||
    !normalizedSymbol ||
    !(resolvedQty > 0) ||
    !(resolvedPrice > 0)
  ) {
    return {
      ok: false,
      reason: "INVALID_ENTRY_FILL",
      snapshot: null,
    };
  }

  return await withSnapshotTransaction(
    {
      uid,
      pid,
      strategyCategory: normalizedCategory,
      positionSide: normalizedPositionSide,
    },
    async (connection) => {
      const current =
        (await loadSnapshotForUpdate(connection, {
          uid,
          pid,
          strategyCategory: normalizedCategory,
          positionSide: normalizedPositionSide,
        })) || null;

      const existingFill = await findRecordedFill({
        uid,
        pid,
        strategyCategory: normalizedCategory,
        symbol: normalizedSymbol,
        positionSide: normalizedPositionSide,
        sourceClientOrderId,
        sourceOrderId,
        sourceTradeId,
        fillQty: resolvedQty,
        fillPrice: resolvedPrice,
        tradeTime,
        connection,
      });
      if (existingFill) {
        logDuplicateExchangeFillIgnored({
          uid,
          pid,
          strategyCategory: normalizedCategory,
          symbol: normalizedSymbol,
          positionSide: normalizedPositionSide,
          sourceClientOrderId,
          sourceOrderId,
          sourceTradeId,
          existingEventType: existingFill.eventType,
          incomingEventType: eventType,
          fillQty: resolvedQty,
          fillPrice: resolvedPrice,
          tradeTime,
        });
        return {
          ok: true,
          duplicate: true,
          snapshot: current,
          existingFill,
        };
      }

      const shouldResetCycle = !(toNumber(current?.openQty) > 0);
      const baseOpenQty = shouldResetCycle ? 0 : toNumber(current?.openQty);
      const baseOpenCost = shouldResetCycle ? 0 : toNumber(current?.openCost);
      const baseRealizedPnl = shouldResetCycle ? 0 : toNumber(current?.cycleRealizedPnl);
      const baseFees = shouldResetCycle ? 0 : toNumber(current?.cycleFees);
      const nextOpenQty = baseOpenQty + resolvedQty;
      const nextOpenCost = baseOpenCost + resolvedQty * resolvedPrice;
      const nextAvgEntryPrice = nextOpenQty > 0 ? nextOpenCost / nextOpenQty : 0;
      const nextSnapshotPatch = {
        status: nextOpenQty > 0 ? "OPEN" : "CLOSED",
        openQty: nextOpenQty,
        openCost: nextOpenCost,
        avgEntryPrice: nextAvgEntryPrice,
        cycleRealizedPnl: baseRealizedPnl,
        cycleFees: baseFees + resolvedFee,
        entryFillCount: shouldResetCycle ? 1 : toNumber(current?.entryFillCount) + 1,
        exitFillCount: shouldResetCycle ? 0 : toNumber(current?.exitFillCount),
        openedAt: shouldResetCycle ? toSqlDateTime(tradeTime) : current?.openedAt || toSqlDateTime(tradeTime),
        lastEntryAt: toSqlDateTime(tradeTime),
      };

      const ledgerResult = await insertLedgerRow(connection, {
        uid,
        pid,
        strategyCategory: normalizedCategory,
        symbol: normalizedSymbol,
        positionSide: normalizedPositionSide,
        eventType,
        sourceClientOrderId,
        sourceOrderId,
        sourceTradeId,
        fillQty: resolvedQty,
        fillPrice: resolvedPrice,
        fillValue: resolvedQty * resolvedPrice,
        fee: resolvedFee,
        realizedPnl: 0,
        openQtyAfter: nextOpenQty,
        openCostAfter: nextOpenCost,
        avgEntryPriceAfter: nextAvgEntryPrice,
        tradeTime,
        note,
      });

      if (ledgerResult.duplicate) {
        logDuplicateExchangeFillIgnored({
          uid,
          pid,
          strategyCategory: normalizedCategory,
          symbol: normalizedSymbol,
          positionSide: normalizedPositionSide,
          sourceClientOrderId,
          sourceOrderId,
          sourceTradeId,
          existingEventType: ledgerResult?.existingRow?.eventType || null,
          incomingEventType: eventType,
          fillQty: resolvedQty,
          fillPrice: resolvedPrice,
          tradeTime,
        });
        const latest = await loadSnapshotForUpdate(connection, {
          uid,
          pid,
          strategyCategory: normalizedCategory,
          positionSide: normalizedPositionSide,
        });
        return {
          ok: true,
          duplicate: true,
          snapshot: latest,
        };
      }

      const snapshot = await upsertSnapshot(
        connection,
        {
          uid,
          pid,
          strategyCategory: normalizedCategory,
          symbol: normalizedSymbol,
          positionSide: normalizedPositionSide,
        },
        nextSnapshotPatch
      );

      logLedgerStateChange("ENTRY_FILL_APPLIED", {
        uid,
        pid,
        strategyCategory: normalizedCategory,
        symbol: normalizedSymbol,
        positionSide: normalizedPositionSide,
        sourceClientOrderId: normalizeSourceId(sourceClientOrderId),
        sourceOrderId: normalizeSourceId(sourceOrderId),
        sourceTradeId: normalizeTradeId(sourceTradeId),
        eventType,
        fillQty: resolvedQty,
        fillPrice: resolvedPrice,
        tradeTime: toSqlDateTime(tradeTime),
        snapshotStatus: snapshot?.status || null,
        openQtyAfter: toNumber(snapshot?.openQty),
        avgEntryPriceAfter: toNumber(snapshot?.avgEntryPrice),
      });

      return {
        ok: true,
        duplicate: false,
        snapshot,
      };
    }
  );
};

const applyExitFill = async ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  sourceClientOrderId = null,
  sourceOrderId = null,
  sourceTradeId = null,
  fillQty = 0,
  fillPrice = 0,
  fee = 0,
  realizedPnl = 0,
  tradeTime = null,
  eventType = "EXIT_FILL",
  note = null,
}) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedPositionSide = normalizePositionSide(positionSide);
  const normalizedSymbol = normalizeSymbol(symbol);
  const requestedQty = toNumber(fillQty);
  const resolvedPrice = toNumber(fillPrice);
  const resolvedFee = toNumber(fee);
  const resolvedPnl = toNumber(realizedPnl);

  if (
    !uid ||
    !pid ||
    !normalizedCategory ||
    !normalizedPositionSide ||
    !normalizedSymbol ||
    !(requestedQty > 0)
  ) {
    return {
      ok: false,
      reason: "INVALID_EXIT_FILL",
      snapshot: null,
      appliedQty: 0,
    };
  }

  return await withSnapshotTransaction(
    {
      uid,
      pid,
      strategyCategory: normalizedCategory,
      positionSide: normalizedPositionSide,
    },
    async (connection) => {
      const current =
        (await loadSnapshotForUpdate(connection, {
          uid,
          pid,
          strategyCategory: normalizedCategory,
          positionSide: normalizedPositionSide,
        })) || null;

      const existingFill = await findRecordedFill({
        uid,
        pid,
        strategyCategory: normalizedCategory,
        symbol: normalizedSymbol,
        positionSide: normalizedPositionSide,
        sourceClientOrderId,
        sourceOrderId,
        sourceTradeId,
        fillQty: requestedQty,
        fillPrice: resolvedPrice,
        tradeTime,
        connection,
      });
      if (existingFill) {
        logDuplicateExchangeFillIgnored({
          uid,
          pid,
          strategyCategory: normalizedCategory,
          symbol: normalizedSymbol,
          positionSide: normalizedPositionSide,
          sourceClientOrderId,
          sourceOrderId,
          sourceTradeId,
          existingEventType: existingFill.eventType,
          incomingEventType: eventType,
          fillQty: requestedQty,
          fillPrice: resolvedPrice,
          tradeTime,
        });
        return {
          ok: true,
          duplicate: true,
          snapshot: current,
          appliedQty: 0,
          existingFill,
        };
      }

      const baseOpenQty = toNumber(current?.openQty);
      const baseOpenCost = toNumber(current?.openCost);
      let sourceReservation = null;
      if (sourceClientOrderId) {
        const reservationScope = buildReservationClientOrderScope({
          clientOrderId: sourceClientOrderId,
          uid,
          pid,
          strategyCategory: normalizedCategory,
          positionSide: normalizedPositionSide,
          stage: "APPLY_EXIT_FILL_SOURCE_RESERVATION_LOOKUP",
        });
        if (!reservationScope.ok) {
          logLedgerStateChange("RESERVATION_CLIENT_ORDER_PARSE_FAILED", {
            stage: "APPLY_EXIT_FILL_SOURCE_RESERVATION_LOOKUP",
            uid,
            pid,
            strategyCategory: normalizedCategory,
            positionSide: normalizedPositionSide,
            sourceClientOrderId: normalizeSourceId(sourceClientOrderId),
          });
        } else {
          const [reservationRows] = await connection.query(
            `SELECT *
               FROM live_pid_exit_reservation
              WHERE ${reservationScope.clauses.join(" AND ")}
              LIMIT 1
              FOR UPDATE`,
            reservationScope.params
          );
          sourceReservation = reservationRows?.[0] || null;
        }
      }
      const overfillTolerance = 1e-9;
      if (!(baseOpenQty > overfillTolerance)) {
        logLedgerStateChange("EXIT_FILL_WITHOUT_PID_OWNED_QTY_BLOCKED", {
          uid,
          pid,
          strategyCategory: normalizedCategory,
          symbol: normalizedSymbol,
          positionSide: normalizedPositionSide,
          sourceClientOrderId: normalizeSourceId(sourceClientOrderId),
          sourceOrderId: normalizeSourceId(sourceOrderId),
          sourceTradeId: normalizeTradeId(sourceTradeId),
          requestedQty,
          pidOwnedOpenQty: baseOpenQty,
          eventType,
          reason: "PID_OWNED_QTY_ZERO_OR_ALREADY_CLOSED",
        });
        return {
          ok: false,
          blocked: true,
          reason: "PID_OWNED_QTY_ZERO",
          snapshot: current,
          appliedQty: 0,
        };
      }
      if (requestedQty > baseOpenQty + overfillTolerance) {
        logLedgerStateChange("FILL_QTY_EXCEEDS_PID_OWNED_QTY", {
          uid,
          pid,
          strategyCategory: normalizedCategory,
          symbol: normalizedSymbol,
          positionSide: normalizedPositionSide,
          sourceClientOrderId: normalizeSourceId(sourceClientOrderId),
          sourceOrderId: normalizeSourceId(sourceOrderId),
          sourceTradeId: normalizeTradeId(sourceTradeId),
          requestedQty,
          pidOwnedOpenQty: baseOpenQty,
          eventType,
          reason: "USER_ACTION_REQUIRED_OVERFILLED_OR_CROSS_PID",
        });
      }
      if (sourceReservation) {
        const remainingReservedQty = Math.max(
          0,
          toNumber(sourceReservation.reservedQty) - toNumber(sourceReservation.filledQty)
        );
        if (remainingReservedQty > 0 && requestedQty > remainingReservedQty + overfillTolerance) {
          logLedgerStateChange("FILL_QTY_EXCEEDS_RESERVATION_QTY", {
            uid,
            pid,
            strategyCategory: normalizedCategory,
            symbol: normalizedSymbol,
            positionSide: normalizedPositionSide,
            sourceClientOrderId: normalizeSourceId(sourceClientOrderId),
            sourceOrderId: normalizeSourceId(sourceOrderId),
            sourceTradeId: normalizeTradeId(sourceTradeId),
            requestedQty,
            remainingReservedQty,
            reservationId: sourceReservation.id || null,
            reservationKind: sourceReservation.reservationKind || null,
            eventType,
            reason: "USER_ACTION_REQUIRED_OVERFILLED_OR_CROSS_PID",
          });
        }
      }
      const appliedQty = Math.min(requestedQty, baseOpenQty);
      const appliedRatio = requestedQty > 0 ? Math.min(1, Math.max(0, appliedQty / requestedQty)) : 0;
      const appliedFee = resolvedFee * appliedRatio;
      const appliedPnl = resolvedPnl * appliedRatio;
      const averageEntryPrice =
        baseOpenQty > 0 && baseOpenCost > 0 ? baseOpenCost / baseOpenQty : toNumber(current?.avgEntryPrice, resolvedPrice);
      const costReduction = appliedQty > 0 ? averageEntryPrice * appliedQty : 0;
      const nextOpenQty = Math.max(0, baseOpenQty - appliedQty);
      const nextOpenCost = Math.max(0, baseOpenCost - costReduction);
      const nextAvgEntryPrice = nextOpenQty > 0 ? nextOpenCost / nextOpenQty : 0;
      const nextSnapshotPatch = {
        status: nextOpenQty > 0 ? "OPEN" : "CLOSED",
        openQty: nextOpenQty,
        openCost: nextOpenCost,
        avgEntryPrice: nextAvgEntryPrice,
        cycleRealizedPnl: toNumber(current?.cycleRealizedPnl) + appliedPnl,
        cycleFees: toNumber(current?.cycleFees) + appliedFee,
        entryFillCount: toNumber(current?.entryFillCount),
        exitFillCount: toNumber(current?.exitFillCount) + 1,
        lastExitAt: toSqlDateTime(tradeTime),
      };

      const ledgerResult = await insertLedgerRow(connection, {
        uid,
        pid,
        strategyCategory: normalizedCategory,
        symbol: normalizedSymbol,
        positionSide: normalizedPositionSide,
        eventType,
        sourceClientOrderId,
        sourceOrderId,
        sourceTradeId,
        fillQty: appliedQty,
        fillPrice: resolvedPrice,
        fillValue: appliedQty * resolvedPrice,
        fee: appliedFee,
        realizedPnl: appliedPnl,
        openQtyAfter: nextOpenQty,
        openCostAfter: nextOpenCost,
        avgEntryPriceAfter: nextAvgEntryPrice,
        tradeTime,
        note,
      });

      if (ledgerResult.duplicate) {
        logDuplicateExchangeFillIgnored({
          uid,
          pid,
          strategyCategory: normalizedCategory,
          symbol: normalizedSymbol,
          positionSide: normalizedPositionSide,
          sourceClientOrderId,
          sourceOrderId,
          sourceTradeId,
          existingEventType: ledgerResult?.existingRow?.eventType || null,
          incomingEventType: eventType,
          fillQty: appliedQty,
          fillPrice: resolvedPrice,
          tradeTime,
        });
        const latest = await loadSnapshotForUpdate(connection, {
          uid,
          pid,
          strategyCategory: normalizedCategory,
          positionSide: normalizedPositionSide,
        });
        return {
          ok: true,
          duplicate: true,
          snapshot: latest,
          appliedQty: 0,
        };
      }

      const snapshot = await upsertSnapshot(
        connection,
        {
          uid,
          pid,
          strategyCategory: normalizedCategory,
          symbol: normalizedSymbol,
          positionSide: normalizedPositionSide,
        },
        nextSnapshotPatch
      );

      if (sourceClientOrderId) {
        await applyReservationFill(
          connection,
          sourceClientOrderId,
          appliedQty,
          sourceOrderId,
          {
            uid,
            pid,
            strategyCategory: normalizedCategory,
            positionSide: normalizedPositionSide,
          }
        );
      }

      logLedgerStateChange("EXIT_FILL_APPLIED", {
        uid,
        pid,
        strategyCategory: normalizedCategory,
        symbol: normalizedSymbol,
        positionSide: normalizedPositionSide,
        sourceClientOrderId: normalizeSourceId(sourceClientOrderId),
        sourceOrderId: normalizeSourceId(sourceOrderId),
        sourceTradeId: normalizeTradeId(sourceTradeId),
        eventType,
        fillQty: appliedQty,
        fillPrice: resolvedPrice,
        realizedPnl: appliedPnl,
        tradeTime: toSqlDateTime(tradeTime),
        snapshotStatus: snapshot?.status || null,
        openQtyAfter: toNumber(snapshot?.openQty),
        avgEntryPriceAfter: toNumber(snapshot?.avgEntryPrice),
      });

      return {
        ok: true,
        duplicate: false,
        snapshot,
        appliedQty,
      };
    }
  );
};

const applyReservationFill = async (
  connection,
  clientOrderId,
  fillQty,
  actualOrderId = null,
  scope = {}
) => {
  if (!connection || !clientOrderId || !(toNumber(fillQty) > 0)) {
    return false;
  }

  const reservationScope = buildReservationClientOrderScope({
    clientOrderId,
    uid: scope.uid,
    pid: scope.pid,
    strategyCategory: scope.strategyCategory,
    positionSide: scope.positionSide,
    stage: "APPLY_RESERVATION_FILL_LOOKUP",
  });
  if (!reservationScope.ok) {
    logLedgerStateChange("RESERVATION_CLIENT_ORDER_PARSE_FAILED", {
      stage: "APPLY_RESERVATION_FILL_LOOKUP",
      clientOrderId: normalizeSourceId(clientOrderId),
      uid: scope.uid || null,
      pid: scope.pid || null,
    });
    return false;
  }

  const [rows] = await connection.query(
    `SELECT *
       FROM live_pid_exit_reservation
      WHERE ${reservationScope.clauses.join(" AND ")}
      LIMIT 1
      FOR UPDATE`,
    reservationScope.params
  );

  const current = rows?.[0];
  if (!current) {
    return false;
  }

  const nextFilledQty = toNumber(current.filledQty) + toNumber(fillQty);
  const reservedQty = toNumber(current.reservedQty);
  const nextStatus =
    reservedQty > 0 && nextFilledQty + 1e-12 >= reservedQty ? "FILLED" : "PARTIAL";

  await connection.query(
    `UPDATE live_pid_exit_reservation
        SET filledQty = ?,
            status = ?,
            actualOrderId = COALESCE(?, actualOrderId),
            updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [
      nextFilledQty,
      nextStatus,
      actualOrderId == null ? null : String(actualOrderId),
      current.id,
    ]
  );

  logLedgerStateChange("RESERVATION_FILL_APPLIED", {
    clientOrderId,
    reservationId: current.id,
    strategyCategory: current.strategyCategory || null,
    pid: Number(current.pid || 0),
    uid: Number(current.uid || 0),
    positionSide: current.positionSide || null,
    reservationKind: current.reservationKind || null,
    sourceOrderId: current.sourceOrderId || null,
    actualOrderId: actualOrderId == null ? current.actualOrderId || null : String(actualOrderId),
    filledQtyDelta: toNumber(fillQty),
    filledQtyAfter: nextFilledQty,
    reservedQty,
    statusAfter: nextStatus,
  });

  return true;
};

const replaceExitReservations = async ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  reservations = [],
}) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedPositionSide = normalizePositionSide(positionSide);
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!uid || !pid || !normalizedCategory || !normalizedPositionSide || !normalizedSymbol) {
    return false;
  }

  return await withSnapshotTransaction(
    {
      uid,
      pid,
      strategyCategory: normalizedCategory,
      positionSide: normalizedPositionSide,
    },
    async (connection) => {
      const keepClientIds = reservations
        .map((item) => String(item.clientOrderId || "").trim())
        .filter(Boolean);
      let pendingCancelAffectedRows = 0;

      if (keepClientIds.length > 0) {
        const [retireResult] = await connection.query(
          `UPDATE live_pid_exit_reservation
              SET status = 'CANCEL_PENDING', updatedAt = CURRENT_TIMESTAMP
            WHERE uid = ?
              AND pid = ?
              AND strategyCategory = ?
              AND positionSide = ?
              AND status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')
              AND clientOrderId NOT IN (${keepClientIds.map(() => "?").join(",")})`,
          [uid, pid, normalizedCategory, normalizedPositionSide, ...keepClientIds]
        );
        pendingCancelAffectedRows = Number(retireResult?.affectedRows || 0);
      } else {
        const [retireResult] = await connection.query(
          `UPDATE live_pid_exit_reservation
              SET status = 'CANCEL_PENDING', updatedAt = CURRENT_TIMESTAMP
            WHERE uid = ?
              AND pid = ?
              AND strategyCategory = ?
              AND positionSide = ?
              AND status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')`,
          [uid, pid, normalizedCategory, normalizedPositionSide]
        );
        pendingCancelAffectedRows = Number(retireResult?.affectedRows || 0);
      }

      if (pendingCancelAffectedRows > 0) {
        logLedgerStateChange("RESERVATION_CANCEL_UNKNOWN", {
          uid,
          pid,
          strategyCategory: normalizedCategory,
          symbol: normalizedSymbol,
          positionSide: normalizedPositionSide,
          affectedRows: pendingCancelAffectedRows,
          reason: "REPLACED_WITHOUT_BINANCE_CANCEL_CONFIRMATION",
        });
      }

      for (const reservation of reservations) {
        const clientOrderId = String(reservation.clientOrderId || "").trim();
        if (!clientOrderId) {
          continue;
        }

        await connection.query(
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
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE
            uid = VALUES(uid),
            pid = VALUES(pid),
            strategyCategory = VALUES(strategyCategory),
            symbol = VALUES(symbol),
            positionSide = VALUES(positionSide),
            sourceOrderId = VALUES(sourceOrderId),
            actualOrderId = COALESCE(VALUES(actualOrderId), actualOrderId),
            reservationKind = VALUES(reservationKind),
            reservedQty = VALUES(reservedQty),
            filledQty = 0,
            status = 'ACTIVE',
            note = VALUES(note),
            updatedAt = CURRENT_TIMESTAMP`,
          [
            uid,
            pid,
            normalizedCategory,
            normalizedSymbol,
            normalizedPositionSide,
            clientOrderId,
            reservation.sourceOrderId == null ? null : String(reservation.sourceOrderId),
            reservation.actualOrderId == null ? null : String(reservation.actualOrderId),
            reservation.reservationKind || "EXIT",
            toNumber(reservation.reservedQty),
            0,
            "ACTIVE",
            reservation.note || null,
          ]
        );
      }

      logLedgerStateChange("EXIT_RESERVATIONS_REPLACED", {
        uid,
        pid,
        strategyCategory: normalizedCategory,
        symbol: normalizedSymbol,
        positionSide: normalizedPositionSide,
        reservationCount: reservations.length,
        reservationClientOrderIds: reservations.map((item) => String(item.clientOrderId || "").trim()).filter(Boolean),
      });

      return true;
    }
  );
};

const markReservationsCanceled = async (clientOrderIds = [], scope = {}) => {
  const normalizedIds = []
    .concat(clientOrderIds || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  if (normalizedIds.length === 0) {
    return 0;
  }

  let affectedRows = 0;
  for (const clientOrderId of normalizedIds) {
    const reservationScope = buildReservationClientOrderScope({
      clientOrderId,
      uid: scope.uid,
      pid: scope.pid,
      strategyCategory: scope.strategyCategory,
      positionSide: scope.positionSide,
      stage: "MARK_RESERVATIONS_CANCELED",
    });
    if (!reservationScope.ok) {
      logLedgerStateChange("RESERVATION_CLIENT_ORDER_PARSE_FAILED", {
        stage: "MARK_RESERVATIONS_CANCELED",
        clientOrderId,
        uid: scope.uid || null,
        pid: scope.pid || null,
      });
      continue;
    }

    const [result] = await db.query(
      `UPDATE live_pid_exit_reservation
          SET status = 'CANCELED', updatedAt = CURRENT_TIMESTAMP
        WHERE ${reservationScope.clauses.join(" AND ")}
          AND status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')`,
      reservationScope.params
    );
    affectedRows += Number(result?.affectedRows || 0);
  }

  if (affectedRows > 0) {
    logLedgerStateChange("RESERVATION_CANCEL_CONFIRMED", {
      clientOrderIds: normalizedIds,
      affectedRows,
    });
    logLedgerStateChange("RESERVATIONS_CANCELED", {
      clientOrderIds: normalizedIds,
      affectedRows,
    });
  }

  return affectedRows;
};

const markReservationFilledFromExchangeEvidence = async (clientOrderId, evidence = {}, scope = {}) => {
  const normalizedClientOrderId = String(clientOrderId || "").trim();
  if (!normalizedClientOrderId) {
    return { ok: false, affectedRows: 0, reason: "MISSING_CLIENT_ORDER_ID" };
  }

  const reservationScope = buildReservationClientOrderScope({
    clientOrderId: normalizedClientOrderId,
    uid: scope.uid,
    pid: scope.pid,
    strategyCategory: scope.strategyCategory,
    positionSide: scope.positionSide,
    stage: "MARK_RESERVATION_FILLED_FROM_EXCHANGE",
  });
  if (!reservationScope.ok) {
    logLedgerStateChange("RESERVATION_CLIENT_ORDER_PARSE_FAILED", {
      stage: "MARK_RESERVATION_FILLED_FROM_EXCHANGE",
      clientOrderId: normalizedClientOrderId,
      uid: scope.uid || null,
      pid: scope.pid || null,
    });
    return { ok: false, affectedRows: 0, reason: "CLIENT_ORDER_SCOPE_FAILED" };
  }

  const actualOrderId = evidence.actualOrderId == null ? null : String(evidence.actualOrderId);
  const where = reservationScope.clauses.slice();
  const params = reservationScope.params.slice();
  if (actualOrderId) {
    where.push(`(actualOrderId IS NULL OR actualOrderId = ?)`);
    params.push(actualOrderId);
  }

  const [rows] = await db.query(
    `SELECT *
       FROM live_pid_exit_reservation
      WHERE ${where.join(" AND ")}
      ORDER BY id DESC
      LIMIT 1`,
    params
  );

  const current = rows?.[0];
  if (!current) {
    return { ok: false, affectedRows: 0, reason: "RESERVATION_NOT_FOUND" };
  }

  const reservedQty = toNumber(current.reservedQty);
  const filledQtyFromEvidence = toNumber(evidence.filledQty, reservedQty);
  const filledQtyAfter =
    reservedQty > 0
      ? Math.min(Math.max(filledQtyFromEvidence, toNumber(current.filledQty)), reservedQty)
      : Math.max(filledQtyFromEvidence, toNumber(current.filledQty));
  const noteSuffix = evidence.note ? ` | ${String(evidence.note).slice(0, 512)}` : "";

  const [result] = await db.query(
    `UPDATE live_pid_exit_reservation
        SET filledQty = ?,
            status = 'FILLED',
            actualOrderId = COALESCE(?, actualOrderId),
            note = CONCAT(COALESCE(note, ''), ?),
            updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')`,
    [filledQtyAfter, actualOrderId, noteSuffix, current.id]
  );

  const affectedRows = Number(result?.affectedRows || 0);
  if (affectedRows > 0) {
    logLedgerStateChange("RESERVATION_FILL_CONFIRMED_FROM_EXCHANGE", {
      clientOrderId: normalizedClientOrderId,
      reservationId: current.id,
      strategyCategory: current.strategyCategory || null,
      pid: Number(current.pid || 0),
      uid: Number(current.uid || 0),
      positionSide: current.positionSide || null,
      reservationKind: current.reservationKind || null,
      actualOrderId,
      filledQtyBefore: toNumber(current.filledQty),
      filledQtyAfter,
      reservedQty,
      evidenceStatus: evidence.status || null,
    });
  }

  return {
    ok: affectedRows > 0 || current.status === "FILLED",
    affectedRows,
    reservationId: current.id,
    statusBefore: current.status,
    filledQtyBefore: toNumber(current.filledQty),
    filledQtyAfter: affectedRows > 0 ? filledQtyAfter : toNumber(current.filledQty),
  };
};

const terminalizeStaleReservationsAfterOwnerClose = async (clientOrderIds = [], evidence = {}, scope = {}) => {
  const normalizedIds = []
    .concat(clientOrderIds || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  if (normalizedIds.length === 0) {
    return { ok: false, affectedRows: 0, reason: "MISSING_CLIENT_ORDER_IDS" };
  }

  let affectedRows = 0;
  const results = [];
  const noteSuffix = evidence.note ? ` | ${String(evidence.note).slice(0, 512)}` : "";
  const status = evidence.status === "EXPIRED" ? "EXPIRED" : "CANCELED";

  for (const clientOrderId of normalizedIds) {
    const reservationScope = buildReservationClientOrderScope({
      clientOrderId,
      uid: scope.uid,
      pid: scope.pid,
      strategyCategory: scope.strategyCategory,
      positionSide: scope.positionSide,
      stage: "TERMINALIZE_STALE_RESERVATION_AFTER_OWNER_CLOSE",
    });
    if (!reservationScope.ok) {
      logLedgerStateChange("RESERVATION_CLIENT_ORDER_PARSE_FAILED", {
        stage: "TERMINALIZE_STALE_RESERVATION_AFTER_OWNER_CLOSE",
        clientOrderId,
        uid: scope.uid || null,
        pid: scope.pid || null,
      });
      results.push({ clientOrderId, ok: false, reason: "CLIENT_ORDER_SCOPE_FAILED" });
      continue;
    }

    const [result] = await db.query(
      `UPDATE live_pid_exit_reservation
          SET status = ?,
              note = CONCAT(COALESCE(note, ''), ?),
              updatedAt = CURRENT_TIMESTAMP
        WHERE ${reservationScope.clauses.join(" AND ")}
          AND status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')`,
      [status, noteSuffix, ...reservationScope.params]
    );
    const rowCount = Number(result?.affectedRows || 0);
    affectedRows += rowCount;
    results.push({ clientOrderId, ok: rowCount > 0, affectedRows: rowCount });
  }

  if (affectedRows > 0) {
    logLedgerStateChange("STALE_RESERVATION_TERMINALIZED_AFTER_OWNER_CLOSE", {
      clientOrderIds: normalizedIds,
      status,
      affectedRows,
      uid: scope.uid || null,
      pid: scope.pid || null,
      strategyCategory: scope.strategyCategory || null,
      positionSide: scope.positionSide || null,
      evidence: evidence.summary || null,
    });
  }

  return { ok: affectedRows > 0, affectedRows, results };
};

const bindReservationActualOrderId = async (clientOrderId, actualOrderId, scope = {}) => {
  const normalizedClientOrderId = String(clientOrderId || "").trim();
  if (!normalizedClientOrderId || actualOrderId == null || actualOrderId === "") {
    return 0;
  }

  const reservationScope = buildReservationClientOrderScope({
    clientOrderId: normalizedClientOrderId,
    uid: scope.uid,
    pid: scope.pid,
    strategyCategory: scope.strategyCategory,
    positionSide: scope.positionSide,
    stage: "BIND_RESERVATION_ACTUAL_ORDER_ID",
  });
  if (!reservationScope.ok) {
    logLedgerStateChange("RESERVATION_CLIENT_ORDER_PARSE_FAILED", {
      stage: "BIND_RESERVATION_ACTUAL_ORDER_ID",
      clientOrderId: normalizedClientOrderId,
      uid: scope.uid || null,
      pid: scope.pid || null,
    });
    return 0;
  }

  const normalizedActualOrderId = String(actualOrderId);
  const [result] = await db.query(
    `UPDATE live_pid_exit_reservation
        SET actualOrderId = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE ${reservationScope.clauses.join(" AND ")}
        AND (actualOrderId IS NULL OR actualOrderId <> ?)`,
    [normalizedActualOrderId, ...reservationScope.params, normalizedActualOrderId]
  );

  if (Number(result?.affectedRows || 0) > 0) {
    logLedgerStateChange("RESERVATION_ACTUAL_ORDER_BOUND", {
      clientOrderId: normalizedClientOrderId,
      actualOrderId: normalizedActualOrderId,
      affectedRows: Number(result?.affectedRows || 0),
    });
  }

  return Number(result?.affectedRows || 0);
};

const loadActiveReservations = async ({
  uid,
  pid,
  strategyCategory,
  positionSide = null,
} = {}) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedPositionSide = positionSide
    ? normalizePositionSide(positionSide)
    : null;

  if (!uid || !pid || !normalizedCategory) {
    return [];
  }

  const where = [
    `uid = ?`,
    `pid = ?`,
    `strategyCategory = ?`,
    `status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')`,
  ];
  const params = [uid, pid, normalizedCategory];

  if (normalizedPositionSide) {
    where.push(`positionSide = ?`);
    params.push(normalizedPositionSide);
  }

  const [rows] = await db.query(
    `SELECT *
       FROM live_pid_exit_reservation
      WHERE ${where.join(" AND ")}
      ORDER BY id ASC`,
    params
  );

  return rows || [];
};

const loadRecentReservations = async ({
  uid,
  pid,
  strategyCategory,
  positionSide = null,
  limit = 20,
} = {}) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedPositionSide = positionSide
    ? normalizePositionSide(positionSide)
    : null;
  const resolvedLimit = Math.max(1, Number(limit || 20));

  if (!uid || !pid || !normalizedCategory) {
    return [];
  }

  const where = [
    `uid = ?`,
    `pid = ?`,
    `strategyCategory = ?`,
  ];
  const params = [uid, pid, normalizedCategory];

  if (normalizedPositionSide) {
    where.push(`positionSide = ?`);
    params.push(normalizedPositionSide);
  }

  const [rows] = await db.query(
    `SELECT *
       FROM live_pid_exit_reservation
      WHERE ${where.join(" AND ")}
      ORDER BY updatedAt DESC, id DESC
      LIMIT ?`,
    [...params, resolvedLimit]
  );

  return rows || [];
};

const loadActiveReservationsByPids = async ({
  uid,
  strategyCategory,
  pids = [],
} = {}) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedPids = []
    .concat(pids || [])
    .map((item) => Number(item || 0))
    .filter((item) => item > 0);

  if (!uid || !normalizedCategory || normalizedPids.length === 0) {
    return [];
  }

  const [rows] = await db.query(
    `SELECT *
       FROM live_pid_exit_reservation
      WHERE uid = ?
        AND strategyCategory = ?
        AND status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')
        AND pid IN (${normalizedPids.map(() => "?").join(",")})
      ORDER BY id ASC`,
    [uid, normalizedCategory, ...normalizedPids]
  );

  return rows || [];
};

const getOpenQty = async ({ uid, pid, strategyCategory, positionSide }) => {
  const snapshot = await loadSnapshot({ uid, pid, strategyCategory, positionSide });
  return toNumber(snapshot?.openQty);
};

const closeSnapshotAsOrphan = async ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  eventType = "SYSTEM_ORPHAN_CLOSE",
  note = null,
  tradeTime = null,
} = {}) => {
  const normalizedCategory = normalizeStrategyCategory(strategyCategory);
  const normalizedPositionSide = normalizePositionSide(positionSide);
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!uid || !pid || !normalizedCategory || !normalizedPositionSide || !normalizedSymbol) {
    return {
      ok: false,
      reason: "INVALID_ORPHAN_CLOSE",
      snapshot: null,
    };
  }

  return await withSnapshotTransaction(
    {
      uid,
      pid,
      strategyCategory: normalizedCategory,
      positionSide: normalizedPositionSide,
    },
    async (connection) => {
      const current =
        (await loadSnapshotForUpdate(connection, {
          uid,
          pid,
          strategyCategory: normalizedCategory,
          positionSide: normalizedPositionSide,
        })) || null;

      if (!current || !(toNumber(current.openQty) > 0)) {
        return {
          ok: true,
          duplicate: false,
          snapshot: current,
        };
      }

      const ledgerResult = await insertLedgerRow(connection, {
        uid,
        pid,
        strategyCategory: normalizedCategory,
        symbol: normalizedSymbol,
        positionSide: normalizedPositionSide,
        eventType,
        sourceClientOrderId: null,
        sourceOrderId: null,
        fillQty: 0,
        fillPrice: 0,
        fillValue: 0,
        fee: 0,
        realizedPnl: 0,
        openQtyAfter: 0,
        openCostAfter: 0,
        avgEntryPriceAfter: 0,
        tradeTime,
        note,
      });

      await connection.query(
        `UPDATE live_pid_exit_reservation
            SET status = 'CANCEL_PENDING', updatedAt = CURRENT_TIMESTAMP
          WHERE uid = ?
            AND pid = ?
            AND strategyCategory = ?
            AND positionSide = ?
            AND status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')`,
        [uid, pid, normalizedCategory, normalizedPositionSide]
      );
      logLedgerStateChange("RESERVATION_CANCEL_UNKNOWN", {
        uid,
        pid,
        strategyCategory: normalizedCategory,
        symbol: normalizedSymbol,
        positionSide: normalizedPositionSide,
        reason: "ORPHAN_FLATTEN_WITHOUT_BINANCE_CANCEL_CONFIRMATION",
      });

      const snapshot = await upsertSnapshot(
        connection,
        {
          uid,
          pid,
          strategyCategory: normalizedCategory,
          symbol: normalizedSymbol,
          positionSide: normalizedPositionSide,
        },
        {
          status: "CLOSED",
          openQty: 0,
          openCost: 0,
          avgEntryPrice: 0,
          cycleRealizedPnl: toNumber(current.cycleRealizedPnl),
          cycleFees: toNumber(current.cycleFees),
          entryFillCount: toNumber(current.entryFillCount),
          exitFillCount: toNumber(current.exitFillCount),
          lastExitAt: toSqlDateTime(tradeTime) || toSqlDateTime(new Date()),
        }
      );

      logLedgerStateChange("SNAPSHOT_ORPHAN_CLOSED", {
        uid,
        pid,
        strategyCategory: normalizedCategory,
        symbol: normalizedSymbol,
        positionSide: normalizedPositionSide,
        eventType,
        tradeTime: toSqlDateTime(tradeTime),
        ledgerId: ledgerResult?.existingRow?.id || ledgerResult?.insertId || null,
        snapshotStatus: snapshot?.status || null,
        openQtyBefore: toNumber(current?.openQty),
        openQtyAfter: toNumber(snapshot?.openQty),
        note,
      });

      return {
        ok: true,
        duplicate: false,
        snapshot,
        ledgerId: ledgerResult?.insertId || null,
      };
    }
  );
};

const getCycleTotals = async ({ uid, pid, strategyCategory, positionSide }) => {
  const snapshot = await loadSnapshot({ uid, pid, strategyCategory, positionSide });
  return {
    snapshot,
    realizedPnl: toNumber(snapshot?.cycleRealizedPnl),
    fees: toNumber(snapshot?.cycleFees),
    openQty: toNumber(snapshot?.openQty),
    avgEntryPrice: toNumber(snapshot?.avgEntryPrice),
  };
};

const syncSignalPlaySnapshot = async (pid, positionSide) => {
  if (!pid) {
    return false;
  }

  const [rows] = await db.query(`SELECT uid FROM live_play_list WHERE id = ? LIMIT 1`, [pid]);
  const uid = Number(rows?.[0]?.uid || 0);
  const resolvedSnapshot = uid
    ? positionSide
      ? await loadSnapshot({
          uid,
          pid,
          strategyCategory: "signal",
          positionSide,
        })
      : await loadAnySnapshotByPid({
          uid,
          pid,
          strategyCategory: "signal",
        })
    : null;

  if (!resolvedSnapshot) {
    return false;
  }

  await db.query(
    `UPDATE live_play_list
        SET r_qty = ?, r_exactPrice = ?, created_at = created_at
      WHERE id = ?
      LIMIT 1`,
    [
      toNumber(resolvedSnapshot.openQty),
      toNumber(resolvedSnapshot.avgEntryPrice),
      pid,
    ]
  );

  return true;
};

const syncGridLegSnapshot = async (pid, leg) => {
  if (!pid || !leg) {
    return false;
  }

  const positionSide = normalizePositionSide(leg);
  const [rows] = await db.query(
    `SELECT uid
       FROM live_grid_strategy_list
      WHERE id = ?
      LIMIT 1`,
    [pid]
  );
  const uid = Number(rows?.[0]?.uid || 0);
  if (!uid) {
    return false;
  }

  const snapshot = await loadSnapshot({
    uid,
    pid,
    strategyCategory: "grid",
    positionSide,
  });

  const prefix = positionSide === "LONG" ? "long" : "short";
  const qty = toNumber(snapshot?.openQty);
  const avgEntryPrice = toNumber(snapshot?.avgEntryPrice);

  await db.query(
    `UPDATE live_grid_strategy_list
        SET ${prefix}Qty = ?, ${prefix}EntryPrice = ?
      WHERE id = ?
      LIMIT 1`,
    [qty, avgEntryPrice > 0 ? avgEntryPrice : null, pid]
  );

  logLedgerStateChange("GRID_SNAPSHOT_SYNCED", {
    pid,
    uid,
    strategyCategory: "grid",
    positionSide,
    openQty: qty,
    avgEntryPrice,
  });

  return true;
};

module.exports = {
  normalizeSymbol,
  normalizePositionSide,
  normalizeStrategyCategory,
  parsePlatformClientOrderId,
  buildFillIdentity,
  buildFillIdentityKey,
  applyEntryFill,
  applyExitFill,
  findRecordedFill,
  loadSnapshot,
  loadAnySnapshotByPid,
  loadSnapshotsByPids,
  getOpenQty,
  closeSnapshotAsOrphan,
  getCycleTotals,
  replaceExitReservations,
  markReservationsCanceled,
  markReservationFilledFromExchangeEvidence,
  terminalizeStaleReservationsAfterOwnerClose,
  bindReservationActualOrderId,
  loadActiveReservations,
  loadRecentReservations,
  loadActiveReservationsByPids,
  syncSignalPlaySnapshot,
  syncGridLegSnapshot,
};
