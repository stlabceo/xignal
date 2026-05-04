const fs = require("fs");
const path = require("path");
const Module = require("module");

const loadCoinQaModule = () => {
  const targetPath = path.resolve(__dirname, "../../coin.js");
  const source = fs.readFileSync(targetPath, "utf8");
  const appended = `${source}

module.exports.__qa = {
  binance,
  buildSignalTruthSyncOrderBy,
  loadLiveSignalTruthSyncRows,
  truthSyncLiveSignalPlay,
  buildSignalRuntimeIssues,
  loadMissingSignalTimeExitExecutionFromExchange,
  recoverSignalEntryFillFromExchange,
  recoverSignalExitFillFromExchange,
  recoverGridEntryFillFromExchange: exports.recoverGridEntryFillFromExchange,
  recoverGridExitFillFromExchange: exports.recoverGridExitFillFromExchange,
  convergeLiveSignalPositionToExchangeFlat,
  loadLivePlaySnapshot,
  syncLiveBoundExitOrders,
  hasRecentLocalBoundReservationCoverage,
  resolvePidOwnedCloseQtyGuard,
  closeGridLegMarketOrder: exports.closeGridLegMarketOrder
};
`;

  const mod = new Module(targetPath, module);
  mod.filename = targetPath;
  mod.paths = Module._nodeModulePaths(path.dirname(targetPath));
  mod._compile(appended, targetPath);
  return mod.exports;
};

module.exports = {
  loadCoinQaModule,
};
