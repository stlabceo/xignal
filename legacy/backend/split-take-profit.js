const MAX_SPLIT_TAKE_PROFIT_STAGES = 5;
const DEFAULT_SPLIT_TAKE_PROFIT_GAP = 0.2;

const toEnabledFlag = (value) =>
  value === true ||
  value === "true" ||
  value === "Y" ||
  value === 1 ||
  value === "1";

const toNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const roundToFixedNumber = (value, precision = 8) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Number(numericValue.toFixed(precision));
};

const normalizeStageItem = (item, index) => {
  if (!item || typeof item !== "object") {
    return null;
  }

  const tpPercent = toNumber(
    item.tpPercent ??
      item.tp ??
      item.takeProfit ??
      item.profit ??
      item.targetPercent
  );
  const closeRatio = toNumber(
    item.closeRatio ??
      item.ratio ??
      item.closePercent ??
      item.quantityRatio ??
      item.quantityPercent
  );

  if (!Number.isFinite(tpPercent) || tpPercent <= 0) {
    return null;
  }

  if (!Number.isFinite(closeRatio) || closeRatio <= 0) {
    return null;
  }

  return {
    stageIndex: index,
    tpPercent: roundToFixedNumber(tpPercent, 4),
    closeRatio: roundToFixedNumber(closeRatio, 4),
  };
};

const parseStageArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  return [];
};

const normalizeStages = (value) =>
  parseStageArray(value)
    .map((item, index) => normalizeStageItem(item, index))
    .filter(Boolean)
    .sort((a, b) => a.tpPercent - b.tpPercent)
    .map((item, index) => ({
      ...item,
      stageIndex: index,
    }));

const normalizeSplitTakeProfitPayload = (body = {}) => {
  const enabled = toEnabledFlag(body.splitTakeProfitEnabled);
  const gapValue = toNumber(body.splitTakeProfitGap);
  const gapPercent =
    Number.isFinite(gapValue) && gapValue > 0
      ? roundToFixedNumber(gapValue, 4)
      : DEFAULT_SPLIT_TAKE_PROFIT_GAP;
  const stages = enabled ? normalizeStages(body.splitTakeProfitStages) : [];
  const configuredCount = Number(body.splitTakeProfitCount || 0);
  const splitTakeProfitCount = enabled
    ? Math.min(
        MAX_SPLIT_TAKE_PROFIT_STAGES,
        Math.max(
          1,
          Number.isFinite(configuredCount) && configuredCount > 0
            ? Math.trunc(configuredCount)
            : stages.length
        )
      )
    : 0;
  const trimmedStages = enabled ? stages.slice(0, splitTakeProfitCount) : [];
  const configJson = JSON.stringify({
    gapPercent,
    stages: trimmedStages,
  });

  body.splitTakeProfitEnabled = enabled;
  body.splitTakeProfitGap = gapPercent;
  body.splitTakeProfitCount = splitTakeProfitCount;
  body.splitTakeProfitStages = trimmedStages;
  body.splitTakeProfitConfigJson = enabled ? configJson : null;

  return {
    enabled,
    gapPercent,
    splitTakeProfitCount,
    stages: trimmedStages,
    configJson: enabled ? configJson : null,
  };
};

const parseSplitTakeProfitConfig = (play = {}) => {
  const enabled = toEnabledFlag(play.splitTakeProfitEnabled);
  const defaultConfig = {
    enabled: false,
    gapPercent: DEFAULT_SPLIT_TAKE_PROFIT_GAP,
    splitTakeProfitCount: 0,
    stages: [],
  };

  if (!enabled) {
    return defaultConfig;
  }

  let parsed = {};
  try {
    parsed = JSON.parse(play.splitTakeProfitConfigJson || "{}");
  } catch (error) {
    parsed = {};
  }

  const stages = normalizeStages(parsed.stages || play.splitTakeProfitStages);
  const configuredCount = Number(play.splitTakeProfitCount || stages.length || 0);
  const gapValue = toNumber(parsed.gapPercent ?? play.splitTakeProfitGap);

  return {
    enabled: true,
    gapPercent:
      Number.isFinite(gapValue) && gapValue > 0
        ? roundToFixedNumber(gapValue, 4)
        : DEFAULT_SPLIT_TAKE_PROFIT_GAP,
    splitTakeProfitCount: Math.min(
      MAX_SPLIT_TAKE_PROFIT_STAGES,
      Math.max(1, configuredCount || stages.length || 1)
    ),
    stages: stages.slice(
      0,
      Math.min(MAX_SPLIT_TAKE_PROFIT_STAGES, Math.max(1, configuredCount || stages.length || 1))
    ),
  };
};

const isSplitTakeProfitEnabled = (play = {}) => parseSplitTakeProfitConfig(play).enabled;

const getSplitTakeProfitStage = (playOrConfig, stageIndex) => {
  const config = Array.isArray(playOrConfig?.stages)
    ? playOrConfig
    : parseSplitTakeProfitConfig(playOrConfig);

  return config.stages[stageIndex] || null;
};

const getSplitTakeProfitStageCount = (playOrConfig) => {
  const config = Array.isArray(playOrConfig?.stages)
    ? playOrConfig
    : parseSplitTakeProfitConfig(playOrConfig);
  return config.stages.length;
};

const computeStagePrice = (signalType, entryPrice, tpPercent) => {
  const numericEntryPrice = Number(entryPrice);
  const numericTpPercent = Number(tpPercent);
  if (!Number.isFinite(numericEntryPrice) || numericEntryPrice <= 0) {
    return 0;
  }
  if (!Number.isFinite(numericTpPercent) || numericTpPercent <= 0) {
    return 0;
  }

  const ratio = numericTpPercent * 0.01;
  const rawPrice =
    signalType === "SELL"
      ? numericEntryPrice * (1 - ratio)
      : numericEntryPrice * (1 + ratio);

  return roundToFixedNumber(rawPrice, 10);
};

const computeRatchetedStopPercent = (stageTpPercent, gapPercent = DEFAULT_SPLIT_TAKE_PROFIT_GAP) => {
  const numericTpPercent = Number(stageTpPercent);
  const numericGapPercent = Number(gapPercent);
  if (!Number.isFinite(numericTpPercent) || numericTpPercent <= 0) {
    return 0;
  }

  if (!Number.isFinite(numericGapPercent) || numericGapPercent <= 0) {
    return numericTpPercent;
  }

  return roundToFixedNumber(Math.max(0, numericTpPercent - numericGapPercent), 4);
};

const computeRatchetedStopPrice = ({
  signalType,
  entryPrice,
  stageTpPercent,
  gapPercent = DEFAULT_SPLIT_TAKE_PROFIT_GAP,
  fallbackStopPrice = 0,
}) => {
  const ratchetedStopPercent = computeRatchetedStopPercent(stageTpPercent, gapPercent);
  const ratchetedStopPrice =
    ratchetedStopPercent > 0
      ? computeStagePrice(signalType, entryPrice, ratchetedStopPercent)
      : Number(entryPrice);

  if (!Number.isFinite(ratchetedStopPrice) || ratchetedStopPrice <= 0) {
    return Number(fallbackStopPrice || 0);
  }

  if (!Number.isFinite(Number(fallbackStopPrice || 0)) || Number(fallbackStopPrice || 0) <= 0) {
    return ratchetedStopPrice;
  }

  if (signalType === "SELL") {
    return Math.min(ratchetedStopPrice, Number(fallbackStopPrice || 0));
  }

  return Math.max(ratchetedStopPrice, Number(fallbackStopPrice || 0));
};

const resolveStageCloseQty = ({
  entryQty,
  remainingQty,
  stage,
  isLastStage,
  roundQty,
  minQty = 0,
}) => {
  const numericEntryQty = Number(entryQty);
  const numericRemainingQty = Number(remainingQty);
  const numericMinQty = Number(minQty || 0);

  if (!Number.isFinite(numericEntryQty) || numericEntryQty <= 0) {
    return 0;
  }

  if (!Number.isFinite(numericRemainingQty) || numericRemainingQty <= 0) {
    return 0;
  }

  if (isLastStage) {
    return typeof roundQty === "function"
      ? roundQty(numericRemainingQty)
      : numericRemainingQty;
  }

  const rawQty = numericEntryQty * (Number(stage?.closeRatio || 0) * 0.01);
  const normalizedQty =
    typeof roundQty === "function" ? roundQty(rawQty) : rawQty;

  if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
    return 0;
  }

  if (numericMinQty > 0 && normalizedQty < numericMinQty) {
    return 0;
  }

  return Math.min(normalizedQty, numericRemainingQty);
};

module.exports = {
  MAX_SPLIT_TAKE_PROFIT_STAGES,
  DEFAULT_SPLIT_TAKE_PROFIT_GAP,
  normalizeSplitTakeProfitPayload,
  parseSplitTakeProfitConfig,
  isSplitTakeProfitEnabled,
  getSplitTakeProfitStage,
  getSplitTakeProfitStageCount,
  computeStagePrice,
  computeRatchetedStopPercent,
  computeRatchetedStopPrice,
  resolveStageCloseQty,
};
