const crypto = require("crypto");
const db = require("./database/connect/config");

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

const WEBHOOK_TARGET_RESULT_SEVERITY = {
  ENTRY_REJECTED: "high",
  POSITION_TRACKING_ERROR: "high",
  POSITION_BUCKET_CONFLICT: "high",
  REVERSE_SIGNAL_CLOSE: "medium",
  REVERSE_SIGNAL_CANCEL: "medium",
  RUNTIME_NOT_READY: "medium",
  SIGNAL_TYPE_MISMATCH: "low",
  LOCK_SKIPPED: "low",
  GRID_ARMED: "low",
  GRID_ACTIVE_IGNORED: "low",
  GRID_SIGNAL_MISMATCH: "low",
  ENTERED_PENDING: "low",
};

const normalizeWebhookTargetSeverity = (value) => {
  const severity = String(value || "").trim().toLowerCase();
  if (severity === "high" || severity === "medium" || severity === "low") {
    return severity;
  }
  return "low";
};

const getWebhookTargetSeverity = (item = {}) =>
  normalizeWebhookTargetSeverity(
    item.severity ||
      WEBHOOK_TARGET_RESULT_SEVERITY[String(item.resultCode || "").trim().toUpperCase()] ||
      "low"
  );

const normalizeWebhookTargetOpsStatus = (value) => {
  const status = String(value || "").trim().toUpperCase();
  if (status === "OPEN" || status === "ACK" || status === "RESOLVED") {
    return status;
  }
  return "OPEN";
};

const buildWebhookPayloadHash = (payload) =>
  crypto
    .createHash("sha1")
    .update(safeJsonStringify(payload) || "{}")
    .digest("hex");

const insertWebhookEventLog = async (event = {}) => {
  try {
    const payloadHash =
      event.payloadHash ||
      buildWebhookPayloadHash(event.rawBody || event.normalizedBody || {});

    const [result] = await db.query(
      `INSERT INTO webhook_event_log
        (
          hook_category,
          route_path,
          status,
          result_code,
          request_ip,
          payload_hash,
          strategy_key,
          signal_tag,
          strategy_uuid,
          symbol,
          bunbong,
          signal_type,
          matched_count,
          processed_count,
          ignored_count,
          duplicate_flag,
          http_status,
          note,
          raw_body,
          normalized_body,
          response_body
        )
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(event.hookCategory || "").trim().toLowerCase() || "unknown",
        String(event.routePath || "").trim() || null,
        String(event.status || "RECEIVED").trim().toUpperCase(),
        String(event.resultCode || "RECEIVED").trim().toUpperCase(),
        event.requestIp || null,
        payloadHash,
        event.strategyKey || null,
        event.signalTag || null,
        event.strategyUuid || null,
        event.symbol || null,
        event.bunbong || null,
        event.signalType || null,
        Number(event.matchedCount || 0),
        Number(event.processedCount || 0),
        Number(event.ignoredCount || 0),
        String(event.duplicateFlag || "N").trim().toUpperCase() === "Y" ? "Y" : "N",
        event.httpStatus || null,
        event.note || null,
        safeJsonStringify(event.rawBody),
        safeJsonStringify(event.normalizedBody),
        safeJsonStringify(event.responseBody),
      ]
    );

    return result.insertId || null;
  } catch (error) {
    console.log("[webhook-log] insert failed", error?.message || error);
    return null;
  }
};

const insertWebhookEventTargetLogs = async (eventId, items = []) => {
  if (!eventId || !Array.isArray(items) || !items.length) {
    return 0;
  }

  let insertedCount = 0;
  for (const item of items) {
    try {
      await db.query(
        `INSERT INTO webhook_event_target_log (
            event_id,
            uid,
            pid,
            strategy_category,
            strategy_mode,
            strategy_name,
            strategy_key,
            strategy_uuid,
            symbol,
            bunbong,
            legacy_status,
            regime_status,
            control_state,
            auto_st,
            incoming_signal_type,
            runtime_signal_type,
            result_code,
            severity,
            ops_status,
            note,
            payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(eventId),
          item.uid || null,
          item.pid || null,
          item.strategyCategory || null,
          item.strategyMode || null,
          item.strategyName || null,
          item.strategySignal || item.strategyKey || null,
          item.strategyUuid || null,
          item.symbol || null,
          item.bunbong || null,
          item.legacyStatus || null,
          item.regimeStatus || null,
          item.controlState || null,
          item.autoST || null,
          item.incomingSignalType || null,
          item.runtimeSignalType || null,
          item.resultCode || null,
          getWebhookTargetSeverity(item),
          normalizeWebhookTargetOpsStatus(item.opsStatus),
          item.note || null,
          safeJsonStringify(item),
        ]
      );
      insertedCount += 1;
    } catch (error) {
      console.log("[webhook-log] target insert failed", error?.message || error);
    }
  }

  return insertedCount;
};

module.exports = {
  safeJsonStringify,
  buildWebhookPayloadHash,
  insertWebhookEventLog,
  insertWebhookEventTargetLogs,
};
