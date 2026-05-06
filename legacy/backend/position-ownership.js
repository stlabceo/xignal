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

const liveWriteSafetyGate = require("./live-write-safety-gate");

const OWNERSHIP_LEGACY_DISABLED = true;

const acquirePositionBucketOwner = async (context = {}) => {
  const gate = liveWriteSafetyGate.evaluateOwnershipGuard({
    ...context,
    strategyCategory: context.ownerStrategyCategory || context.strategyCategory || null,
    pid: context.ownerPid || context.pid || null,
    ownershipEnabled: !OWNERSHIP_LEGACY_DISABLED,
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

  return {
    ok: true,
    conflict: false,
    created: false,
    owner: null,
    legacyDisabled: OWNERSHIP_LEGACY_DISABLED,
  };
};

const touchPositionBucketOwner = async () => true;

const releasePositionBucketOwner = async () => true;

const releaseAllPositionBucketOwnersByPid = async () => 0;

const loadPositionBucketOwner = async () => null;

module.exports = {
  normalizeSymbol,
  normalizePositionSide,
  normalizeStrategyCategory,
  acquirePositionBucketOwner,
  touchPositionBucketOwner,
  releasePositionBucketOwner,
  releaseAllPositionBucketOwnersByPid,
  loadPositionBucketOwner,
  OWNERSHIP_LEGACY_DISABLED,
};
