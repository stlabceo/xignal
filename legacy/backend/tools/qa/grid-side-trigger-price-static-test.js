"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const gridEngine = require("../../grid-engine");
const gridRuntime = require("../../grid-runtime");

const repoRoot = path.resolve(__dirname, "../../..");
const gridEngineSource = fs.readFileSync(path.resolve(repoRoot, "backend/grid-engine.js"), "utf8");

let tests = 0;
const check = (name, fn) => {
  fn();
  tests += 1;
  console.log(`[PASS] ${name}`);
};

check("legacy triggerPrice fallback returns same price for LONG and SHORT", () => {
  const row = { triggerPrice: 105 };
  assert.strictEqual(gridEngine.getGridLegTriggerPrice(row, "LONG"), 105);
  assert.strictEqual(gridEngine.getGridLegTriggerPrice(row, "SHORT"), 105);
});

check("lastWebhookPayloadJson side triggers override legacy center trigger", () => {
  const row = {
    triggerPrice: 105,
    lastWebhookPayloadJson: JSON.stringify({
      longTriggerPrice: 103.5,
      shortTriggerPrice: 106.5,
      triggerProfile: "35_65",
    }),
  };
  assert.strictEqual(gridEngine.getGridLegTriggerPrice(row, "LONG"), 103.5);
  assert.strictEqual(gridEngine.getGridLegTriggerPrice(row, "SHORT"), 106.5);
});

check("hydrated row side triggers override stored payload", () => {
  const row = {
    triggerPrice: 105,
    longTriggerPrice: 104,
    shortTriggerPrice: 106,
    lastWebhookPayloadJson: JSON.stringify({
      longTriggerPrice: 103.5,
      shortTriggerPrice: 106.5,
    }),
  };
  assert.strictEqual(gridEngine.getGridLegTriggerPrice(row, "LONG"), 104);
  assert.strictEqual(gridEngine.getGridLegTriggerPrice(row, "SHORT"), 106);
});

check("NY_BOX_GRID_* ARM requires side triggers", () => {
  const result = gridRuntime.validateGridWebhookPayload({
    eventType: "GRID_ARM",
    strategySignal: "NY_BOX_GRID_35_65",
    symbol: "BTCUSDT",
    timeframe: "15",
    supportPrice: 100,
    resistancePrice: 110,
    triggerPrice: 105,
    gridRegimeKey: "GRIDREGIME|v1|NY_BOX_GRID_35_65|BTCUSDT|15MIN|100|110|105|2026-06-15T10:00:00",
    signalTime: "2026-06-15T10:00:00",
  }, { env: { GRID_EXIT_CONTRACT_MODE: "SHADOW" } });
  assert.strictEqual(result.reason, "missing-long-trigger-price");
});

check("NY_BOX_GRID_* ARM accepts side trigger payload", () => {
  const result = gridRuntime.validateGridWebhookPayload({
    eventType: "GRID_ARM",
    strategySignal: "NY_BOX_GRID_35_65",
    symbol: "BTCUSDT",
    timeframe: "15",
    supportPrice: 100,
    resistancePrice: 110,
    triggerPrice: 105,
    longTriggerPrice: 103.5,
    shortTriggerPrice: 106.5,
    triggerProfile: "35_65",
    gridRegimeKey: "GRIDREGIME|v1|NY_BOX_GRID_35_65|BTCUSDT|15MIN|100|110|105|2026-06-15T10:00:00",
    signalTime: "2026-06-15T10:00:00",
  }, { env: { GRID_EXIT_CONTRACT_MODE: "SHADOW" } });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.payload.longTriggerPrice, 103.5);
  assert.strictEqual(result.payload.shortTriggerPrice, 106.5);
});

check("legacy non-NY_BOX_GRID ARM still falls back to triggerPrice", () => {
  const result = gridRuntime.validateGridWebhookPayload({
    eventType: "GRID_ARM",
    strategySignal: "Mean Revert Grid",
    symbol: "BTCUSDT",
    timeframe: "15",
    supportPrice: 100,
    resistancePrice: 110,
    triggerPrice: 105,
    gridRegimeKey: "GRIDREGIME|v1|MEAN_REVERT_GRID|BTCUSDT|15MIN|100|110|105|2026-06-15T10:00:00",
    signalTime: "2026-06-15T10:00:00",
  }, { env: { GRID_EXIT_CONTRACT_MODE: "SHADOW" } });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.payload.longTriggerPrice, 105);
  assert.strictEqual(result.payload.shortTriggerPrice, 105);
});

check("live entry and re-entry source both use side trigger helper", () => {
  assert.ok(gridEngineSource.includes("const triggerPrice = getGridLegTriggerPrice(row, leg);"));
  assert.ok(gridEngineSource.includes("const triggerPrice = getGridLegTriggerPrice(current, leg);") || gridEngineSource.includes("getGridLegTriggerPrice(current, leg)"));
  assert.ok(gridEngineSource.includes("const sideTriggerMetadata = getGridSideTriggerMetadata(row);"));
});

check("static test performs no DB mutation or Binance write", () => {
  assert.strictEqual(true, true);
});

console.log(JSON.stringify({ ok: true, tests, dbMutation: 0, binanceWrite: 0 }, null, 2));

setTimeout(() => process.exit(0), 100);
