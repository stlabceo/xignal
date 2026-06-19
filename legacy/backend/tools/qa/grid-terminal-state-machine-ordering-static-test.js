"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const gridEngineSource = fs.readFileSync(path.join(repoRoot, "backend/grid-engine.js"), "utf8");
const exitRouteSource = fs.readFileSync(path.join(repoRoot, "backend/grid-exit-route-executor.js"), "utf8");

const sliceFrom = (source, marker, endMarker = null) => {
  const start = source.indexOf(marker);
  assert(start >= 0, `missing marker: ${marker}`);
  if (!endMarker) {
    return source.slice(start);
  }
  const end = source.indexOf(endMarker, start + marker.length);
  assert(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
};

let tests = 0;
const check = (name, fn) => {
  fn();
  tests += 1;
  console.log(`[PASS] ${name}`);
};

check("BOX_BREAK emergency close queues close before protection cleanup", () => {
  const body = sliceFrom(
    gridEngineSource,
    "const emergencyCloseLiveGridLeg = async",
    "const collectMissingGridProtection"
  );
  assert(body.includes("enqueueLiveGridCloseIntent(row, leg, closeQty, logCode"));
  assert(!body.includes("reason: `${logCode}_PROTECTION_CANCEL`"));
  assert(!body.includes("includeExits: true"));
  assert(body.includes("activeProtectionRetained"));
});

check("STOP fill terminal path cancels entries first and leaves protection until flat", () => {
  const body = sliceFrom(
    gridEngineSource,
    "const terminateLiveGridRegimeAfterStopFill = async",
    "const rollbackGridPairSuccessfulLeg"
  );
  const entryCleanupIndex = body.indexOf("reason: \"GRID_STOP_TERMINAL_ENTRY_CLEANUP\"");
  const firstCloseIndex = body.indexOf("emergencyCloseLiveGridLeg(");
  const protectionCleanupIndex = body.indexOf("cleanupLiveGridProtectionAfterFlatClose(");
  assert(entryCleanupIndex >= 0, "entry cleanup is explicit");
  assert(firstCloseIndex > entryCleanupIndex, "close decision happens after entry cleanup");
  assert(protectionCleanupIndex > firstCloseIndex, "protection cleanup is after close-required branches");
  assert(body.includes("includeExits: false"));
  assert(body.includes("GRID_STOP_FLAT_PROTECTION_CLEANUP"));
  assert(body.includes("remainingStoppedQty > 0"));
  assert(body.includes("oppositeQty > 0"));
});

check("actual close fill performs protection cleanup only after flat close convergence", () => {
  const body = sliceFrom(
    gridEngineSource,
    "const handleLiveGridManualCloseFill = async",
    "const handleLiveOrderTradeUpdate = async"
  );
  const remainingCheckIndex = body.indexOf("if (remainingQty > 0)");
  const cleanupIndex = body.indexOf("GRID_CLOSE_CONVERGED_PROTECTION_CLEANUP");
  const releaseIndex = body.indexOf("releaseGridLegPositionOwnership");
  assert(cleanupIndex > remainingCheckIndex, "cleanup is after remaining qty branch");
  assert(cleanupIndex < releaseIndex, "cleanup is part of flat close convergence before local release");
});

check("STOP canceled or expired without fill is logged without terminal handler", () => {
  const body = sliceFrom(
    gridEngineSource,
    "const handleLiveOrderTradeUpdate = async",
    "module.exports = {"
  );
  assert(body.includes("STOP_ORDER_TERMINATED_NO_FILL"));
  assert(body.includes("terminal:N"));
  assert(body.includes("return await handleLiveGridStopFill(parsed, reData);"));
});

check("manual off keeps protection until close fill by canceling entries only", () => {
  const body = sliceFrom(
    gridEngineSource,
    "const deactivateGridStrategy = async",
    "const handleTestLegOpen = async"
  );
  const cancelIndex = body.indexOf("cancelAllGridOrders(\"LIVE\", row");
  const closeIndex = body.indexOf("enqueueLiveGridCloseIntent(row, leg, qty, reason");
  assert(cancelIndex >= 0 && closeIndex > cancelIndex);
  assert(body.includes("includeEntries: true"));
  assert(body.includes("includeExits: false"));
});

check("ENDED live cycle checks exchange-flat convergence before emergency close", () => {
  const body = sliceFrom(
    gridEngineSource,
    "if (row.regimeStatus === \"ENDED\")",
    "await withLiveGridArmLock"
  );
  const flatCheckIndex = body.indexOf("handleEndedLiveGridLegExchangeFlatBeforeClose");
  const closeIndex = body.indexOf("emergencyCloseLiveGridLeg(");
  assert(flatCheckIndex >= 0);
  assert(closeIndex > flatCheckIndex);
  assert(body.includes("ENDED_EXCHANGE_FLAT_BEFORE_CLOSE"));
});

check("explicit TVE EXIT route cancels entries before close and protection after flat", () => {
  const firstCancelIndex = exitRouteSource.indexOf("const cancelCount = await coin.cancelGridOrders");
  const closeLoopIndex = exitRouteSource.indexOf("const closeResults = []");
  const cleanupIndex = exitRouteSource.indexOf("let protectionCleanupCount = 0");
  assert(firstCancelIndex >= 0 && closeLoopIndex > firstCancelIndex);
  const firstCancelBody = exitRouteSource.slice(firstCancelIndex, closeLoopIndex);
  assert(firstCancelBody.includes("includeEntries: true"));
  assert(firstCancelBody.includes("includeExits: false"));
  assert(cleanupIndex > closeLoopIndex);
  const cleanupBody = exitRouteSource.slice(cleanupIndex, exitRouteSource.indexOf("const finalLocal", cleanupIndex));
  assert(cleanupBody.includes("includeEntries: false"));
  assert(cleanupBody.includes("includeExits: true"));
});

console.log(JSON.stringify({ ok: true, tests, dbMutation: 0, binanceWrite: 0 }, null, 2));
setTimeout(() => process.exit(0), 50);
