"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const seonSource = fs.readFileSync(path.resolve(repoRoot, "backend/seon.js"), "utf8");
const coinSource = fs.readFileSync(path.resolve(repoRoot, "backend/coin.js"), "utf8");
const workerSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-worker.js"), "utf8");
const queueSource = fs.readFileSync(path.resolve(repoRoot, "backend/order-intent-queue.js"), "utf8");
const gridEngineSource = fs.readFileSync(path.resolve(repoRoot, "backend/grid-engine.js"), "utf8");

let tests = 0;
const check = (label, fn) => {
  fn();
  tests += 1;
  console.log(`[PASS] ${label}`);
};

check("boot safety block can only start scoped Grid EXIT rescue worker", () => {
  assert(seonSource.includes("getQaScopedGridExitRescueContext"));
  assert(seonSource.includes("LIVE_QA_ALLOW_SCOPED_EXIT_RESCUE"));
  assert(seonSource.includes("LIVE_QA_ALLOWED_PID"));
  assert(seonSource.includes("LIVE_QA_SYMBOL"));
  assert(seonSource.includes("BOOT_SAFETY_GATE_SCOPED_RESCUE_ALLOWED"));
  assert(seonSource.includes("RUN_MAIN_TIMER_SKIPPED_QA_SCOPED_GRID_RUNTIME"));
});

check("scoped rescue still requires QA scoped Grid runtime", () => {
  assert(/isQaScopedGridRuntime\(\)[\s\S]+LIVE_QA_ALLOW_SCOPED_EXIT_RESCUE[\s\S]+Boolean\(pid\)[\s\S]+Boolean\(symbol\)/.test(seonSource));
});

check("QA temp Grid close guard has exact PID and symbol allow contract", () => {
  assert(coinSource.includes("isScopedGridExitQaCloseAllowed"));
  assert(coinSource.includes("LIVE_QA_ALLOWED_PID"));
  assert(coinSource.includes("LIVE_QA_SYMBOL"));
  assert(coinSource.includes("Number(pid || 0) !== context.pid"));
  assert(coinSource.includes("normalizeQaScopedGridSymbol(symbol || row?.symbol || '') !== context.symbol"));
});

check("QA temp Grid close guard checks regime key when provided", () => {
  assert(coinSource.includes("LIVE_QA_GRID_REGIME_KEY"));
  assert(coinSource.includes("extractGridRegimeKeyFromGridRow"));
  assert(coinSource.includes("getDispatchGridRegimeKey"));
  assert(coinSource.includes("expectedRegimeKey !== providedRegimeKey"));
});

check("worker passes close intent gridRegimeKey to coin close dispatcher", () => {
  assert(workerSource.includes("gridRegimeKey: payload.gridRegimeKey || payload.regimeKey || null"));
});

check("Grid close intent payload preserves gridRegimeKey", () => {
  assert(gridEngineSource.includes("gridRegimeKey: row.gridRegimeKey || options.gridRegimeKey || extractGridRegimeKeyFromLastPayload"));
  assert(queueSource.includes("gridRegimeKey: String(payload.gridRegimeKey || payload.regimeKey || \"\").trim() || null"));
});

console.log(JSON.stringify({
  result: "PASS",
  tests,
  dbMutation: 0,
  binanceWrite: 0,
}, null, 2));
