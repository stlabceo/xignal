const normalizeClientOrderId = (value) => {
  if (value == null || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
};

const parsePlatformClientOrderId = (clientOrderId) => {
  const normalized = normalizeClientOrderId(clientOrderId);
  if (!normalized) {
    return null;
  }

  const parts = normalized.split("_");
  const simplePrefixes = new Set(["NEW", "SPLITTP", "STOP", "PROFIT", "TIME"]);
  if (simplePrefixes.has(parts[0]) && parts.length >= 3) {
    const uid = Number(parts[1]);
    const pid = Number(parts[2]);
    if (uid > 0 && pid > 0) {
      return { clientOrderId: normalized, prefix: parts[0], uid, pid };
    }
  }

  const gridPrefixes = new Set(["GENTRY", "GTP", "GSTOP", "GMANUAL"]);
  if (gridPrefixes.has(parts[0]) && parts.length >= 4) {
    const uid = Number(parts[2]);
    const pid = Number(parts[3]);
    if (uid > 0 && pid > 0) {
      return {
        clientOrderId: normalized,
        prefix: `${parts[0]}_${parts[1] || ""}`,
        uid,
        pid,
        leg: parts[1] || null,
      };
    }
  }

  return null;
};

module.exports = {
  normalizeClientOrderId,
  parsePlatformClientOrderId,
};
