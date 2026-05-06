const db = require("./database/connect/config");
const liveWriteSafetyGate = require("./live-write-safety-gate");

const normalizeSymbol = (symbol) =>
  String(symbol || "")
    .trim()
    .toUpperCase()
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

const OWNERSHIP_LEGACY_DISABLED = false;
const OPEN_STATUS = "OPEN";
const CLOSED_STATUS = "CLOSED";
const RESERVED_STATUS = "RESERVED";
const REVIEW_STATUS = "REVIEW";
const OWNERSHIP_TABLE = "live_position_bucket_owner";
const REQUIRED_COLUMNS = [
  "uid",
  "symbol",
  "positionSide",
  "ownerPid",
  "ownerStrategyCategory",
  "ownedQty",
  "reservedCloseQty",
  "status",
  "version",
];

let readinessCache = null;
let readinessCacheAt = 0;

const isOwnershipEnabled = () => !OWNERSHIP_LEGACY_DISABLED;

const normalizeContext = (context = {}) => {
  const uid = Number(context.uid || 0);
  const ownerPid = Number(context.ownerPid || context.pid || 0);
  const ownerStrategyCategory = normalizeStrategyCategory(
    context.ownerStrategyCategory || context.strategyCategory
  );
  const symbol = normalizeSymbol(context.symbol);
  const positionSide = normalizePositionSide(context.positionSide);

  return {
    ...context,
    uid,
    ownerPid,
    pid: ownerPid,
    ownerStrategyCategory,
    strategyCategory: ownerStrategyCategory,
    symbol,
    positionSide,
  };
};

const isValidContext = (context = {}) =>
  Boolean(
    context.uid &&
      context.ownerPid &&
      context.ownerStrategyCategory &&
      context.symbol &&
      context.positionSide
  );

const mapOwnerRow = (row = null) => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    uid: Number(row.uid || 0),
    ownerPid: Number(row.ownerPid || 0),
    pid: Number(row.ownerPid || 0),
    ownerStrategyCategory: normalizeStrategyCategory(row.ownerStrategyCategory),
    strategyCategory: normalizeStrategyCategory(row.ownerStrategyCategory),
    symbol: normalizeSymbol(row.symbol),
    positionSide: normalizePositionSide(row.positionSide),
    ownedQty: toNumber(row.ownedQty),
    reservedCloseQty: toNumber(row.reservedCloseQty),
    availableCloseQty: Math.max(0, toNumber(row.ownedQty) - toNumber(row.reservedCloseQty)),
    legacyDisabled: OWNERSHIP_LEGACY_DISABLED,
  };
};

const getOwnershipReadiness = async ({ force = false } = {}) => {
  const now = Date.now();
  if (!force && readinessCache && now - readinessCacheAt < 5000) {
    return readinessCache;
  }

  const [[tableRow], [columnRows]] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = ?`,
      [OWNERSHIP_TABLE]
    ),
    db.query(
      `SELECT column_name AS columnName
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?`,
      [OWNERSHIP_TABLE]
    ),
  ]);

  const tableExists = Number(tableRow?.[0]?.cnt || 0) === 1;
  const columnSet = new Set((columnRows || []).map((row) => String(row.columnName || "")));
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !columnSet.has(column));
  readinessCache = {
    enabled: isOwnershipEnabled() && tableExists && missingColumns.length === 0,
    legacyDisabled: OWNERSHIP_LEGACY_DISABLED,
    tableExists,
    missingColumns,
    status: isOwnershipEnabled() && tableExists && missingColumns.length === 0 ? "OK" : "BLOCKED",
  };
  readinessCacheAt = now;
  return readinessCache;
};

const buildInvalidResult = (reason) => ({
  ok: false,
  conflict: false,
  created: false,
  owner: null,
  reason,
  legacyDisabled: OWNERSHIP_LEGACY_DISABLED,
});

const acquirePositionBucketOwner = async (context = {}) => {
  const normalized = normalizeContext(context);
  const gate = liveWriteSafetyGate.evaluateOwnershipGuard({
    ...normalized,
    ownershipEnabled: isOwnershipEnabled(),
  });

  if (!gate.allowed) {
    return {
      ok: false,
      conflict: false,
      created: false,
      owner: null,
      reason: gate.reason,
      safetyGate: gate,
      legacyDisabled: OWNERSHIP_LEGACY_DISABLED,
    };
  }

  if (!isValidContext(normalized)) {
    return buildInvalidResult("INVALID_OWNERSHIP_BUCKET");
  }

  const readiness = await getOwnershipReadiness();
  if (!readiness.enabled) {
    return {
      ...buildInvalidResult(readiness.tableExists ? "OWNERSHIP_SCHEMA_INCOMPLETE" : "OWNERSHIP_TABLE_MISSING"),
      readiness,
    };
  }

  await db.query(
    `INSERT INTO live_position_bucket_owner
      (
        uid,
        symbol,
        positionSide,
        ownerPid,
        ownerStrategyCategory,
        ownerSignalType,
        ownerStrategyName,
        ownerState,
        sourceClientOrderId,
        sourceOrderId,
        note,
        ownedQty,
        reservedCloseQty,
        status,
        version
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 1)
     ON DUPLICATE KEY UPDATE
        ownerSignalType = COALESCE(VALUES(ownerSignalType), ownerSignalType),
        ownerStrategyName = COALESCE(VALUES(ownerStrategyName), ownerStrategyName),
        ownerState = VALUES(ownerState),
        sourceClientOrderId = COALESCE(VALUES(sourceClientOrderId), sourceClientOrderId),
        sourceOrderId = COALESCE(VALUES(sourceOrderId), sourceOrderId),
        note = VALUES(note),
        status = CASE
          WHEN ownedQty > 0 THEN 'OPEN'
          ELSE VALUES(status)
        END,
        version = version + 1,
        updatedAt = CURRENT_TIMESTAMP`,
    [
      normalized.uid,
      normalized.symbol,
      normalized.positionSide,
      normalized.ownerPid,
      normalized.ownerStrategyCategory,
      normalized.ownerSignalType || null,
      normalized.ownerStrategyName || null,
      normalized.ownerState || RESERVED_STATUS,
      normalized.sourceClientOrderId || null,
      normalized.sourceOrderId == null ? null : String(normalized.sourceOrderId),
      normalized.note || null,
      normalized.ownerState === OPEN_STATUS ? OPEN_STATUS : RESERVED_STATUS,
    ]
  );

  const owner = await loadPositionBucketOwner(normalized);
  return {
    ok: true,
    conflict: false,
    created: false,
    owner,
    legacyDisabled: OWNERSHIP_LEGACY_DISABLED,
  };
};

const touchPositionBucketOwner = async (context = {}) => {
  const normalized = normalizeContext(context);
  if (!isValidContext(normalized)) {
    return false;
  }

  const readiness = await getOwnershipReadiness();
  if (!readiness.enabled) {
    return false;
  }

  const [result] = await db.query(
    `UPDATE live_position_bucket_owner
        SET ownerSignalType = COALESCE(?, ownerSignalType),
            ownerState = COALESCE(?, ownerState),
            sourceClientOrderId = COALESCE(?, sourceClientOrderId),
            sourceOrderId = COALESCE(?, sourceOrderId),
            note = COALESCE(?, note),
            version = version + 1,
            updatedAt = CURRENT_TIMESTAMP
      WHERE uid = ?
        AND symbol = ?
        AND positionSide = ?
        AND ownerPid = ?
        AND ownerStrategyCategory = ?`,
    [
      normalized.ownerSignalType || null,
      normalized.ownerState || null,
      normalized.sourceClientOrderId || null,
      normalized.sourceOrderId == null ? null : String(normalized.sourceOrderId),
      normalized.note || null,
      normalized.uid,
      normalized.symbol,
      normalized.positionSide,
      normalized.ownerPid,
      normalized.ownerStrategyCategory,
    ]
  );

  return Number(result?.affectedRows || 0) > 0;
};

const releasePositionBucketOwner = async (context = {}) => {
  const normalized = normalizeContext(context);
  if (!isValidContext(normalized)) {
    return false;
  }

  const [result] = await db.query(
    `UPDATE live_position_bucket_owner
        SET ownedQty = 0,
            reservedCloseQty = 0,
            ownerState = 'RELEASED',
            status = 'CLOSED',
            version = version + 1,
            updatedAt = CURRENT_TIMESTAMP
      WHERE uid = ?
        AND symbol = ?
        AND positionSide = ?
        AND ownerPid = ?
        AND ownerStrategyCategory = ?`,
    [
      normalized.uid,
      normalized.symbol,
      normalized.positionSide,
      normalized.ownerPid,
      normalized.ownerStrategyCategory,
    ]
  );

  return Number(result?.affectedRows || 0) > 0;
};

const releaseAllPositionBucketOwnersByPid = async (context = {}) => {
  const ownerPid = Number(context.ownerPid || context.pid || 0);
  const ownerStrategyCategory = normalizeStrategyCategory(
    context.ownerStrategyCategory || context.strategyCategory
  );
  if (!ownerPid) {
    return 0;
  }

  const params = [ownerPid];
  let categoryClause = "";
  if (ownerStrategyCategory) {
    categoryClause = " AND ownerStrategyCategory = ?";
    params.push(ownerStrategyCategory);
  }

  const [result] = await db.query(
    `UPDATE live_position_bucket_owner
        SET ownedQty = 0,
            reservedCloseQty = 0,
            ownerState = 'RELEASED',
            status = 'CLOSED',
            version = version + 1,
            updatedAt = CURRENT_TIMESTAMP
      WHERE ownerPid = ?${categoryClause}`,
    params
  );

  return Number(result?.affectedRows || 0);
};

const loadPositionBucketOwner = async (context = {}, { connection = null, forUpdate = false } = {}) => {
  const normalized = normalizeContext(context);
  if (!isValidContext(normalized)) {
    return null;
  }

  const query = connection || db;
  const [rows] = await query.query(
    `SELECT *
       FROM live_position_bucket_owner
      WHERE uid = ?
        AND symbol = ?
        AND positionSide = ?
        AND ownerPid = ?
        AND ownerStrategyCategory = ?
      LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [
      normalized.uid,
      normalized.symbol,
      normalized.positionSide,
      normalized.ownerPid,
      normalized.ownerStrategyCategory,
    ]
  );

  return mapOwnerRow(rows?.[0] || null);
};

const applyEntryFill = async (context = {}, { connection = null } = {}) => {
  const normalized = normalizeContext(context);
  const fillQty = toNumber(context.fillQty);
  if (!isValidContext(normalized) || !(fillQty > 0)) {
    return { ok: false, reason: "INVALID_OWNERSHIP_ENTRY_FILL", owner: null };
  }

  const readiness = await getOwnershipReadiness();
  if (!readiness.enabled) {
    return {
      ok: false,
      reason: readiness.tableExists ? "OWNERSHIP_SCHEMA_INCOMPLETE" : "OWNERSHIP_TABLE_MISSING",
      readiness,
      owner: null,
    };
  }

  const query = connection || db;
  await query.query(
    `INSERT INTO live_position_bucket_owner
      (
        uid,
        symbol,
        positionSide,
        ownerPid,
        ownerStrategyCategory,
        ownerSignalType,
        ownerStrategyName,
        ownerState,
        sourceClientOrderId,
        sourceOrderId,
        note,
        ownedQty,
        reservedCloseQty,
        status,
        version
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'OPEN', 1)
     ON DUPLICATE KEY UPDATE
        ownedQty = ownedQty + VALUES(ownedQty),
        ownerSignalType = COALESCE(VALUES(ownerSignalType), ownerSignalType),
        ownerStrategyName = COALESCE(VALUES(ownerStrategyName), ownerStrategyName),
        ownerState = VALUES(ownerState),
        sourceClientOrderId = COALESCE(VALUES(sourceClientOrderId), sourceClientOrderId),
        sourceOrderId = COALESCE(VALUES(sourceOrderId), sourceOrderId),
        note = VALUES(note),
        status = 'OPEN',
        version = version + 1,
        updatedAt = CURRENT_TIMESTAMP`,
    [
      normalized.uid,
      normalized.symbol,
      normalized.positionSide,
      normalized.ownerPid,
      normalized.ownerStrategyCategory,
      normalized.ownerSignalType || null,
      normalized.ownerStrategyName || null,
      normalized.ownerState || "OPEN",
      normalized.sourceClientOrderId || null,
      normalized.sourceOrderId == null ? null : String(normalized.sourceOrderId),
      normalized.note || null,
      fillQty,
    ]
  );

  const owner = await loadPositionBucketOwner(normalized, { connection, forUpdate: Boolean(connection) });
  return { ok: true, owner, appliedQty: fillQty };
};

const applyExitFill = async (context = {}, { connection = null } = {}) => {
  const normalized = normalizeContext(context);
  const appliedRequestQty = toNumber(context.fillQty);
  const requestedQty = toNumber(context.requestedQty || context.fillQty);
  if (!isValidContext(normalized) || !(appliedRequestQty > 0)) {
    return { ok: false, reason: "INVALID_OWNERSHIP_EXIT_FILL", owner: null, appliedQty: 0 };
  }

  const readiness = await getOwnershipReadiness();
  if (!readiness.enabled) {
    return {
      ok: false,
      blocked: true,
      reason: readiness.tableExists ? "OWNERSHIP_SCHEMA_INCOMPLETE" : "OWNERSHIP_TABLE_MISSING",
      readiness,
      owner: null,
      appliedQty: 0,
    };
  }

  const owner = await loadPositionBucketOwner(normalized, { connection, forUpdate: Boolean(connection) });
  if (!owner || !(owner.ownedQty > 0)) {
    return {
      ok: false,
      blocked: true,
      reason: "OWNERSHIP_BUCKET_MISSING_OR_ZERO",
      owner,
      appliedQty: 0,
    };
  }

  const appliedQty = Math.min(appliedRequestQty, owner.ownedQty);
  const overExit = requestedQty > owner.ownedQty + 1e-9;
  const nextOwnedQty = Math.max(0, owner.ownedQty - appliedQty);
  const nextReservedCloseQty = Math.min(toNumber(owner.reservedCloseQty), nextOwnedQty);
  const query = connection || db;
  await query.query(
    `UPDATE live_position_bucket_owner
        SET ownedQty = ?,
            reservedCloseQty = ?,
            ownerState = ?,
            status = ?,
            sourceClientOrderId = COALESCE(?, sourceClientOrderId),
            sourceOrderId = COALESCE(?, sourceOrderId),
            note = ?,
            version = version + 1,
            updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [
      nextOwnedQty,
      nextReservedCloseQty,
      overExit ? "REVIEW_OVER_EXIT" : nextOwnedQty > 0 ? "PARTIAL_EXIT" : "CLOSED",
      overExit ? REVIEW_STATUS : nextOwnedQty > 0 ? OPEN_STATUS : CLOSED_STATUS,
      normalized.sourceClientOrderId || null,
      normalized.sourceOrderId == null ? null : String(normalized.sourceOrderId),
      normalized.note || (overExit ? "over-exit clamped to PID-owned qty" : "exit fill applied"),
      owner.id,
    ]
  );

  const updated = await loadPositionBucketOwner(normalized, { connection, forUpdate: Boolean(connection) });
  return {
    ok: true,
    blocked: false,
    overExit,
    reason: overExit ? "OWNERSHIP_OVER_EXIT_CLAMPED" : "OK",
    owner: updated,
    appliedQty,
    requestedQty,
  };
};

const reserveCloseQty = async (context = {}, { connection = null } = {}) => {
  const normalized = normalizeContext(context);
  const requestedQty = toNumber(context.qty || context.requestedQty);
  if (!isValidContext(normalized) || !(requestedQty > 0)) {
    return { ok: false, reason: "INVALID_CLOSE_RESERVATION", reservedQty: 0 };
  }

  const owner = await loadPositionBucketOwner(normalized, { connection, forUpdate: Boolean(connection) });
  if (!owner || !(owner.ownedQty > 0)) {
    return { ok: false, reason: "OWNERSHIP_BUCKET_MISSING_OR_ZERO", owner, reservedQty: 0 };
  }

  const availableQty = Math.max(0, owner.ownedQty - owner.reservedCloseQty);
  const reservedQty = Math.min(requestedQty, availableQty);
  if (!(reservedQty > 0)) {
    return { ok: false, reason: "OWNERSHIP_CLOSE_QTY_RESERVED", owner, reservedQty: 0 };
  }

  const query = connection || db;
  await query.query(
    `UPDATE live_position_bucket_owner
        SET reservedCloseQty = reservedCloseQty + ?,
            ownerState = 'CLOSE_RESERVED',
            version = version + 1,
            updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [reservedQty, owner.id]
  );

  const updated = await loadPositionBucketOwner(normalized, { connection, forUpdate: Boolean(connection) });
  return {
    ok: true,
    owner: updated,
    requestedQty,
    reservedQty,
    availableQty,
    clamped: requestedQty > reservedQty,
  };
};

const releaseCloseReservation = async (context = {}, { connection = null } = {}) => {
  const normalized = normalizeContext(context);
  const releaseQty = toNumber(context.qty || context.releaseQty);
  if (!isValidContext(normalized) || !(releaseQty > 0)) {
    return false;
  }

  const owner = await loadPositionBucketOwner(normalized, { connection, forUpdate: Boolean(connection) });
  if (!owner) {
    return false;
  }

  const nextReservedCloseQty = Math.max(0, owner.reservedCloseQty - releaseQty);
  const query = connection || db;
  await query.query(
    `UPDATE live_position_bucket_owner
        SET reservedCloseQty = ?,
            version = version + 1,
            updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [nextReservedCloseQty, owner.id]
  );
  return true;
};

const listOpenPositionBucketOwners = async ({ uid, symbol, positionSide } = {}) => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedPositionSide = normalizePositionSide(positionSide);
  if (!uid || !normalizedSymbol || !normalizedPositionSide) {
    return [];
  }

  const readiness = await getOwnershipReadiness();
  if (!readiness.enabled) {
    return [];
  }

  const [rows] = await db.query(
    `SELECT *
       FROM live_position_bucket_owner
      WHERE uid = ?
        AND symbol = ?
        AND positionSide = ?
        AND ownedQty > 0.000000001
        AND status IN ('OPEN', 'REVIEW')
      ORDER BY ownerPid ASC, ownerStrategyCategory ASC`,
    [Number(uid), normalizedSymbol, normalizedPositionSide]
  );
  return (rows || []).map(mapOwnerRow);
};

const resolveOwnedCloseQty = async ({
  uid,
  pid,
  strategyCategory,
  symbol,
  positionSide,
  requestedQty = 0,
  ignoreReserved = false,
} = {}, { connection = null } = {}) => {
  const readiness = await getOwnershipReadiness();
  if (!readiness.enabled) {
    return {
      allowed: false,
      reason: readiness.tableExists ? "OWNERSHIP_SCHEMA_INCOMPLETE" : "OWNERSHIP_TABLE_MISSING",
      readiness,
      owner: null,
      pidOwnedQty: 0,
      reservedCloseQty: 0,
      availableCloseQty: 0,
      finalCloseQty: 0,
    };
  }

  const owner = await loadPositionBucketOwner({
    uid,
    ownerPid: pid,
    ownerStrategyCategory: strategyCategory,
    symbol,
    positionSide,
  }, { connection, forUpdate: Boolean(connection) });

  if (!owner || !(owner.ownedQty > 0)) {
    return {
      allowed: false,
      reason: "OWNERSHIP_BUCKET_MISSING_OR_ZERO",
      owner,
      pidOwnedQty: 0,
      reservedCloseQty: 0,
      availableCloseQty: 0,
      finalCloseQty: 0,
    };
  }

  const requestedCloseQty = toNumber(requestedQty);
  const availableCloseQty = ignoreReserved
    ? owner.ownedQty
    : Math.max(0, owner.ownedQty - owner.reservedCloseQty);
  const targetQty = requestedCloseQty > 0 ? requestedCloseQty : availableCloseQty;
  const finalCloseQty = Math.min(targetQty, availableCloseQty);
  return {
    allowed: finalCloseQty > 0,
    reason: finalCloseQty > 0 ? "OK" : "OWNERSHIP_CLOSE_QTY_RESERVED",
    owner,
    pidOwnedQty: owner.ownedQty,
    reservedCloseQty: owner.reservedCloseQty,
    availableCloseQty,
    requestedCloseQty,
    finalCloseQty,
    overRequested: requestedCloseQty > owner.ownedQty + 1e-9,
  };
};

module.exports = {
  normalizeSymbol,
  normalizePositionSide,
  normalizeStrategyCategory,
  acquirePositionBucketOwner,
  touchPositionBucketOwner,
  releasePositionBucketOwner,
  releaseAllPositionBucketOwnersByPid,
  loadPositionBucketOwner,
  applyEntryFill,
  applyExitFill,
  reserveCloseQty,
  releaseCloseReservation,
  listOpenPositionBucketOwners,
  resolveOwnedCloseQty,
  getOwnershipReadiness,
  isOwnershipEnabled,
  OWNERSHIP_LEGACY_DISABLED,
};
