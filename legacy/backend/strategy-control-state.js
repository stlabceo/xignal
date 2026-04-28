const db = require("./database/connect/config");
const dbcon = require("./dbcon");
const strategyControlAudit = require("./strategy-control-audit");

const normalizeEnabledValue = strategyControlAudit.normalizeEnabledValue;
const buildLegacyControlFields = strategyControlAudit.buildLegacyControlFields;

const normalizeMode = (mode = "LIVE") =>
  String(mode || "LIVE").trim().toUpperCase() === "TEST" ? "TEST" : "LIVE";

const getPlayTableName = (mode = "LIVE") =>
  normalizeMode(mode) === "TEST" ? "test_play_list" : "live_play_list";

const getGridTableName = (mode = "LIVE") =>
  normalizeMode(mode) === "TEST" ? "test_grid_strategy_list" : "live_grid_strategy_list";

const trimAuditText = (value, maxLength = 255) => {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const writeRequiredControlAudit = async ({
  audit = null,
  strategyCategory = null,
  strategyMode = null,
  pid = null,
  nextEnabled = "N",
} = {}) => {
  if (!audit) {
    return null;
  }

  const actionCode = String(audit.actionCode || "").trim().toUpperCase();
  if (!actionCode || !strategyCategory || !strategyMode || !pid) {
    throw new Error("CONTROL_AUDIT_INVALID_PAYLOAD");
  }

  const result = await strategyControlAudit.writeStrategyControlAudit({
    actorUserId: audit.actorUserId || null,
    targetUserId: audit.targetUserId || null,
    strategyCategory,
    strategyMode,
    pid,
    actionCode,
    previousEnabled: normalizeEnabledValue(audit.previousEnabled),
    nextEnabled: normalizeEnabledValue(audit.nextEnabled || nextEnabled),
    requestIp: trimAuditText(audit.requestIp, 100),
    note: trimAuditText(audit.note, 255),
    metadata: audit.metadata || null,
  });

  if (!result?.ok || !result?.insertId) {
    throw new Error(`CONTROL_AUDIT_WRITE_FAILED:${result?.reason || "UNKNOWN"}`);
  }

  return result;
};

const applyPlayControlState = async ({
  mode = "LIVE",
  pid,
  enabled = "N",
  status = "READY",
  resetRuntime = false,
  audit = null,
} = {}) => {
  if (!pid) {
    return false;
  }

  const normalizedMode = normalizeMode(mode);
  const controlFields = buildLegacyControlFields(enabled);
  const tableName = getPlayTableName(normalizedMode);

  if (resetRuntime) {
    await dbcon.DBCall(`CALL SP_${normalizedMode}_PLAY_INIT(?)`, [pid]);
  }

  await db.query(
    `UPDATE ${tableName}
        SET enabled = ?, status = ?, st = NULL, autoST = NULL
      WHERE id = ? LIMIT 1`,
    [
      controlFields.enabled,
      String(status || "READY").trim().toUpperCase() || "READY",
      pid,
    ]
  );

  await writeRequiredControlAudit({
    audit,
    strategyCategory: "signal",
    strategyMode: normalizedMode.toLowerCase(),
    pid,
    nextEnabled: controlFields.enabled,
  });

  return true;
};

const applyGridControlState = async ({
  mode = "LIVE",
  pid,
  enabled = "N",
  regimeEndReason = null,
  audit = null,
} = {}) => {
  if (!pid) {
    return false;
  }

  const normalizedMode = normalizeMode(mode);
  const controlFields = buildLegacyControlFields(enabled);
  const tableName = getGridTableName(normalizedMode);

  await db.query(
    `UPDATE ${tableName}
        SET st = NULL, autoST = NULL, enabled = ?, regimeEndReason = ?, updatedAt = NOW()
      WHERE id = ? LIMIT 1`,
    [
      controlFields.enabled,
      regimeEndReason || null,
      pid,
    ]
  );

  await writeRequiredControlAudit({
    audit,
    strategyCategory: "grid",
    strategyMode: normalizedMode.toLowerCase(),
    pid,
    nextEnabled: controlFields.enabled,
  });

  return true;
};

module.exports = {
  applyGridControlState,
  applyPlayControlState,
  buildLegacyControlFields,
  normalizeEnabledValue,
};
