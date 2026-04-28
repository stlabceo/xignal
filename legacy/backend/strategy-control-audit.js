const db = require("./database/connect/config");

const normalizeEnabledValue = (value) =>
  ["Y", "TRUE", "1", "ON"].includes(String(value || "").trim().toUpperCase()) ? "Y" : "N";

const buildLegacyControlFields = (value) => {
  const enabled = normalizeEnabledValue(value);
  return enabled === "Y"
    ? { enabled: "Y", st: "START", autoST: "Y" }
    : { enabled: "N", st: "STOP", autoST: "N" };
};

const trimText = (value, maxLength = 255) => {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const writeStrategyControlAudit = async ({
  actorUserId = null,
  targetUserId = null,
  strategyCategory = null,
  strategyMode = null,
  pid = null,
  actionCode = null,
  previousEnabled = "N",
  nextEnabled = "N",
  requestIp = null,
  note = null,
  metadata = null,
} = {}) => {
  if (!strategyCategory || !strategyMode || !pid || !actionCode) {
    return { ok: false, skipped: true, reason: "INVALID_AUDIT_PAYLOAD" };
  }

  try {
    const [result] = await db.query(
      `INSERT INTO strategy_control_audit
        (
          actorUserId,
          targetUserId,
          strategyCategory,
          strategyMode,
          pid,
          actionCode,
          previousEnabled,
          nextEnabled,
          requestIp,
          note,
          metadataJson
        )
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        actorUserId ? Number(actorUserId) : null,
        targetUserId ? Number(targetUserId) : null,
        String(strategyCategory || "").trim().toLowerCase(),
        String(strategyMode || "").trim().toLowerCase(),
        Number(pid || 0),
        String(actionCode || "").trim().toUpperCase(),
        normalizeEnabledValue(previousEnabled),
        normalizeEnabledValue(nextEnabled),
        trimText(requestIp, 100),
        trimText(note, 255),
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    return { ok: true, insertId: Number(result?.insertId || 0) || null };
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") {
      return { ok: false, skipped: true, reason: "AUDIT_TABLE_MISSING" };
    }
    throw error;
  }
};

module.exports = {
  buildLegacyControlFields,
  normalizeEnabledValue,
  writeStrategyControlAudit,
};
