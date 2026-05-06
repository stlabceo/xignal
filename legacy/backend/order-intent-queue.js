"use strict";

const crypto = require("crypto");
const db = require("./database/connect/config");

const STATUS = Object.freeze({
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  DONE: "DONE",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
});

const INTENT_TYPE = Object.freeze({
  GRID_LIVE_ARM: "GRID_LIVE_ARM",
});

const DEFAULT_MAX_ATTEMPTS = 3;

let schemaReady = false;

const safeJsonStringify = (value) => {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({
      stringifyError: true,
      message: error?.message || "unknown",
    });
  }
};

const parseJsonSafe = (value, fallback = null) => {
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

const sha1 = (value) =>
  crypto.createHash("sha1").update(String(value || "")).digest("hex");

const normalizeSymbol = (symbol) =>
  String(symbol || "").trim().toUpperCase().replace(/\.P$/i, "");

const normalizeTimeframe = (value) => String(value || "").trim().toUpperCase();

const ensureOrderIntentSchema = async () => {
  if (schemaReady) {
    return true;
  }

  const [existingRows] = await db.query(
    `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'order_intent_queue'`
  );
  if (Number(existingRows?.[0]?.cnt || 0) > 0) {
    schemaReady = true;
    return true;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS order_intent_queue (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      intentKey VARCHAR(191) NOT NULL,
      fifoKey VARCHAR(191) NOT NULL,
      uid INT UNSIGNED NOT NULL,
      pid INT UNSIGNED NOT NULL,
      strategyCategory VARCHAR(20) NOT NULL,
      intentType VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      priority INT NOT NULL DEFAULT 100,
      attemptCount INT NOT NULL DEFAULT 0,
      maxAttempts INT NOT NULL DEFAULT 3,
      lockedBy VARCHAR(80) DEFAULT NULL,
      lockedAt DATETIME DEFAULT NULL,
      availableAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      startedAt DATETIME DEFAULT NULL,
      finishedAt DATETIME DEFAULT NULL,
      routePath VARCHAR(100) DEFAULT NULL,
      sourceEventId BIGINT UNSIGNED DEFAULT NULL,
      payloadHash CHAR(40) DEFAULT NULL,
      payloadJson LONGTEXT DEFAULT NULL,
      resultJson LONGTEXT DEFAULT NULL,
      lastErrorCode VARCHAR(80) DEFAULT NULL,
      lastErrorMessage VARCHAR(255) DEFAULT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_order_intent_key (intentKey),
      KEY idx_order_intent_claim (status, availableAt, priority, id),
      KEY idx_order_intent_fifo (fifoKey, status, id),
      KEY idx_order_intent_owner (uid, strategyCategory, pid, status, createdAt),
      KEY idx_order_intent_payload_hash (payloadHash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  schemaReady = true;
  return true;
};

const buildGridArmIntentPayloadHash = ({ payload = {}, targetItem = {} } = {}) =>
  sha1(
    safeJsonStringify({
      action: INTENT_TYPE.GRID_LIVE_ARM,
      uid: targetItem.uid,
      pid: targetItem.pid,
      strategySignal: payload.strategySignal,
      symbol: normalizeSymbol(payload.symbol || targetItem.symbol),
      bunbong: normalizeTimeframe(payload.bunbong || targetItem.bunbong),
      signalTime: payload.signalTime || payload.time || null,
      supportPrice: payload.supportPrice,
      resistancePrice: payload.resistancePrice,
      triggerPrice: payload.triggerPrice,
    })
  );

const buildGridArmIntentKey = ({ payload = {}, targetItem = {} } = {}) =>
  [
    INTENT_TYPE.GRID_LIVE_ARM,
    Number(targetItem.uid || 0),
    Number(targetItem.pid || 0),
    normalizeSymbol(payload.symbol || targetItem.symbol),
    normalizeTimeframe(payload.bunbong || targetItem.bunbong),
    buildGridArmIntentPayloadHash({ payload, targetItem }),
  ].join(":");

const buildGridArmFifoKey = ({ targetItem = {} } = {}) =>
  [
    Number(targetItem.uid || 0),
    "grid",
    Number(targetItem.pid || 0),
    "regime",
    Number(targetItem.pid || 0),
  ].join(":");

const normalizeQueuedIntentRow = (row = null) => {
  if (!row) {
    return null;
  }
  return {
    ...row,
    id: Number(row.id || 0),
    uid: Number(row.uid || 0),
    pid: Number(row.pid || 0),
    priority: Number(row.priority || 0),
    attemptCount: Number(row.attemptCount || 0),
    maxAttempts: Number(row.maxAttempts || 0),
    payload: parseJsonSafe(row.payloadJson, null),
    result: parseJsonSafe(row.resultJson, null),
  };
};

const enqueueGridLiveArmIntents = async ({
  payload = {},
  previewResult = {},
  routePath = "/user/api/grid/hook",
  sourceEventId = null,
} = {}) => {
  await ensureOrderIntentSchema();
  const liveTargets = (previewResult?.targetItems || []).filter(
    (item) =>
      item?.strategyCategory === "grid" &&
      item?.strategyMode === "live" &&
      String(item.resultCode || "").toUpperCase() === "GRID_ARM_PREVIEW"
  );

  const summary = {
    requested: liveTargets.length,
    inserted: 0,
    duplicate: 0,
    intents: [],
  };

  for (const targetItem of liveTargets) {
    const payloadHash = buildGridArmIntentPayloadHash({ payload, targetItem });
    const intentKey = buildGridArmIntentKey({ payload, targetItem });
    const fifoKey = buildGridArmFifoKey({ targetItem });
    const intentPayload = {
      action: INTENT_TYPE.GRID_LIVE_ARM,
      routePath,
      sourceEventId,
      targetItem,
      gridPayload: payload,
    };

    const [result] = await db.query(
      `INSERT IGNORE INTO order_intent_queue
        (
          intentKey,
          fifoKey,
          uid,
          pid,
          strategyCategory,
          intentType,
          status,
          priority,
          attemptCount,
          maxAttempts,
          routePath,
          sourceEventId,
          payloadHash,
          payloadJson
        )
       VALUES (?, ?, ?, ?, 'grid', ?, ?, 100, 0, ?, ?, ?, ?, ?)`,
      [
        intentKey,
        fifoKey,
        Number(targetItem.uid || 0),
        Number(targetItem.pid || 0),
        INTENT_TYPE.GRID_LIVE_ARM,
        STATUS.PENDING,
        DEFAULT_MAX_ATTEMPTS,
        routePath,
        sourceEventId,
        payloadHash,
        safeJsonStringify(intentPayload),
      ]
    );

    const inserted = Number(result?.affectedRows || 0) === 1;
    if (inserted) {
      summary.inserted += 1;
    } else {
      summary.duplicate += 1;
    }

    summary.intents.push({
      intentKey,
      fifoKey,
      uid: Number(targetItem.uid || 0),
      pid: Number(targetItem.pid || 0),
      status: inserted ? STATUS.PENDING : "DUPLICATE",
    });
  }

  return summary;
};

const claimNextIntent = async ({ workerId = null } = {}) => {
  await ensureOrderIntentSchema();
  const claimWorkerId = String(workerId || `worker-${process.pid || "local"}`).slice(0, 80);
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT *
         FROM order_intent_queue q
        WHERE q.status = 'PENDING'
          AND q.availableAt <= NOW()
          AND NOT EXISTS (
            SELECT 1
              FROM order_intent_queue earlier
             WHERE earlier.fifoKey = q.fifoKey
               AND earlier.id < q.id
               AND earlier.status IN ('PENDING', 'RUNNING')
          )
        ORDER BY q.priority ASC, q.id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`
    );

    const row = rows?.[0] || null;
    if (!row) {
      await connection.commit();
      return null;
    }

    await connection.query(
      `UPDATE order_intent_queue
          SET status = 'RUNNING',
              lockedBy = ?,
              lockedAt = NOW(),
              startedAt = COALESCE(startedAt, NOW()),
              attemptCount = attemptCount + 1
        WHERE id = ?
          AND status = 'PENDING'`,
      [claimWorkerId, row.id]
    );

    await connection.commit();
    return normalizeQueuedIntentRow({
      ...row,
      status: STATUS.RUNNING,
      lockedBy: claimWorkerId,
      attemptCount: Number(row.attemptCount || 0) + 1,
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

const completeIntent = async ({ id, status, result = null, errorCode = null, errorMessage = null } = {}) => {
  await ensureOrderIntentSchema();
  const normalizedStatus = String(status || "").trim().toUpperCase();
  if (!Object.values(STATUS).includes(normalizedStatus)) {
    throw new Error(`invalid intent status:${status}`);
  }

  await db.query(
    `UPDATE order_intent_queue
        SET status = ?,
            finishedAt = CASE WHEN ? IN ('DONE', 'FAILED', 'BLOCKED') THEN NOW() ELSE finishedAt END,
            lockedBy = CASE WHEN ? IN ('DONE', 'FAILED', 'BLOCKED') THEN NULL ELSE lockedBy END,
            lockedAt = CASE WHEN ? IN ('DONE', 'FAILED', 'BLOCKED') THEN NULL ELSE lockedAt END,
            resultJson = ?,
            lastErrorCode = ?,
            lastErrorMessage = ?
      WHERE id = ?`,
    [
      normalizedStatus,
      normalizedStatus,
      normalizedStatus,
      normalizedStatus,
      safeJsonStringify(result),
      errorCode || null,
      errorMessage ? String(errorMessage).slice(0, 255) : null,
      id,
    ]
  );
};

const recoverStaleRunningIntents = async ({ staleSeconds = 60 } = {}) => {
  await ensureOrderIntentSchema();
  const [result] = await db.query(
    `UPDATE order_intent_queue
        SET status = 'PENDING',
            lockedBy = NULL,
            lockedAt = NULL,
            availableAt = NOW(),
            lastErrorCode = 'WORKER_STALE_REQUEUED',
            lastErrorMessage = 'worker stale running intent requeued'
      WHERE status = 'RUNNING'
        AND lockedAt < DATE_SUB(NOW(), INTERVAL ? SECOND)`,
    [Math.max(1, Number(staleSeconds || 60))]
  );
  return Number(result?.affectedRows || 0);
};

const loadIntentByKey = async (intentKey) => {
  await ensureOrderIntentSchema();
  const [rows] = await db.query(
    `SELECT * FROM order_intent_queue WHERE intentKey = ? LIMIT 1`,
    [intentKey]
  );
  return normalizeQueuedIntentRow(rows?.[0] || null);
};

const deleteQaIntentsByPrefix = async (prefix) => {
  await ensureOrderIntentSchema();
  await db.query(
    `DELETE FROM order_intent_queue WHERE intentKey LIKE ?`,
    [`${String(prefix || "")}%`]
  );
};

const deleteQaIntentsByUid = async (uid) => {
  await ensureOrderIntentSchema();
  await db.query(
    `DELETE FROM order_intent_queue WHERE uid = ?`,
    [Number(uid || 0)]
  );
};

module.exports = {
  STATUS,
  INTENT_TYPE,
  ensureOrderIntentSchema,
  buildGridArmIntentPayloadHash,
  buildGridArmIntentKey,
  buildGridArmFifoKey,
  enqueueGridLiveArmIntents,
  claimNextIntent,
  completeIntent,
  recoverStaleRunningIntents,
  loadIntentByKey,
  deleteQaIntentsByPrefix,
  deleteQaIntentsByUid,
};
