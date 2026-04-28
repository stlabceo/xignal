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

const acquirePositionBucketOwner = async () => ({
  ok: true,
  conflict: false,
  created: false,
  owner: null,
  legacyDisabled: true,
});

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
};
