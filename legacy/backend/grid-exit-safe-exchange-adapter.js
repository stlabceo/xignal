"use strict";

const orderIntentQueue = require("./order-intent-queue");

const resolveCancelIntent = ({ cancelIntent = null, cancelTarget = null } = {}) => {
  if (cancelIntent) {
    return cancelIntent;
  }
  return {
    intentType: cancelTarget?.intentType,
    uid: cancelTarget?.uid,
    pid: cancelTarget?.pid,
    strategyCategory: "grid",
    intentKey: cancelTarget?.sourceChildNaturalKey || cancelTarget?.childNaturalKey,
    payload: cancelTarget || {},
  };
};

const executeGridExitGateAActualCancel = ({
  cancelIntent = null,
  cancelTarget = null,
  mode = "OFF",
  flags = {},
  client = null,
} = {}) => {
  const normalizedMode = String(mode || "OFF").trim().toUpperCase();
  const env = flags?.env || flags || {};
  const targetCount = Number(flags?.targetCount || env.GRID_EXIT_ACTUAL_CANCEL_TARGET_COUNT || 1);
  return orderIntentQueue.buildGridExitCancelExecutorDryRun({
    childIntent: resolveCancelIntent({ cancelIntent, cancelTarget }),
    cancelCandidate: cancelTarget || cancelIntent?.payload || {},
    mode: normalizedMode,
    mockBinanceClient: client,
    env,
    targetCount,
  });
};

const executeGridExitGateBMarketClose = ({
  closePlan = {},
  mode = "OFF",
  flags = {},
  client = null,
} = {}) => {
  const normalizedMode = String(mode || "OFF").trim().toUpperCase();
  const env = flags?.env || flags || {};
  const targetCount = Number(flags?.targetCount || env.GRID_EXIT_ACTUAL_MARKET_CLOSE_TARGET_COUNT || 1);
  return orderIntentQueue.buildGridExitMarketCloseDryRun({
    marketClosePlan: closePlan,
    mode: normalizedMode,
    mockCloseClient: client,
    env,
    targetCount,
  });
};

module.exports = {
  executeGridExitGateAActualCancel,
  executeGridExitGateBMarketClose,
};
