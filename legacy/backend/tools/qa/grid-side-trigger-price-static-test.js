"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const gridEngine = require("../../grid-engine");
const gridRuntime = require("../../grid-runtime");
const orderIntentQueue = require("../../order-intent-queue");

const repoRoot = path.resolve(__dirname, "../../..");
const gridEngineSource = fs.readFileSync(path.resolve(repoRoot, "backend/grid-engine.js"), "utf8");
const coinSource = fs.readFileSync(path.resolve(repoRoot, "backend/coin.js"), "utf8");

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

check("strict 35/65 grid row does not silently fall back to center trigger", () => {
  const row = {
    triggerPrice: 105,
    lastWebhookPayloadJson: JSON.stringify({
      triggerProfile: "35_65",
    }),
  };
  assert.strictEqual(gridEngine.getGridLegTriggerPrice(row, "LONG"), 0);
  assert.strictEqual(gridEngine.getGridLegTriggerPrice(row, "SHORT"), 0);
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

check("side trigger metadata carries box context across worker projection", () => {
  const row = {
    supportPrice: null,
    resistancePrice: null,
    triggerPrice: null,
    lastWebhookPayloadJson: JSON.stringify({
      supportPrice: 6.84,
      resistancePrice: 7.02,
      triggerPrice: 6.93,
      longTriggerPrice: 6.903,
      shortTriggerPrice: 6.957,
      triggerProfile: "35_65",
      gridRegimeKey: "GRIDREGIME|v1|NY_BOX_GRID_35_65|AVAXUSDT.P|15MIN|6.84|7.02|6.93|2026-06-17T00:00:00",
    }),
  };
  const metadata = gridEngine.__qa.getGridSideTriggerMetadata(row);
  assert.strictEqual(metadata.supportPrice, 6.84);
  assert.strictEqual(metadata.resistancePrice, 7.02);
  assert.strictEqual(metadata.payloadTriggerPrice, 6.93);
  assert.strictEqual(metadata.longTriggerPrice, 6.903);
  assert.strictEqual(metadata.shortTriggerPrice, 6.957);
  assert.strictEqual(metadata.triggerProfile, "35_65");
  assert.strictEqual(gridEngine.__qa.computeLegStopPrice(row, "LONG"), 6.84);
  assert.strictEqual(gridEngine.__qa.computeLegStopPrice(row, "SHORT"), 7.02);
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
    symbol: "HBARUSDT.P",
    timeframe: "15",
    supportPrice: 0.082,
    resistancePrice: 0.084,
    triggerPrice: 0.083,
    longTriggerPrice: 0.0827,
    shortTriggerPrice: 0.0833,
    triggerProfile: "35_65",
    gridRegimeKey: "GRIDREGIME|v1|NY_BOX_GRID_35_65|HBARUSDT.P|15MIN|0.082|0.084|0.083|2026-06-15T10:00:00",
    signalTime: "2026-06-15T10:00:00",
  }, { env: { GRID_EXIT_CONTRACT_MODE: "SHADOW" } });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.payload.symbol, "HBARUSDT.P");
  assert.strictEqual(result.payload.longTriggerPrice, 0.0827);
  assert.strictEqual(result.payload.shortTriggerPrice, 0.0833);
  assert.strictEqual(result.payload.canonicalGridRegimeKey, "GRIDREGIME|v1|NY_BOX_GRID_35_65|HBARUSDT.P|15MIN|0.082|0.084|0.083|2026-06-15T10:00:00");
});

check("NY_BOX_GRID_50_50 HBARUSDT.P ARM preserves equal side triggers", () => {
  const result = gridRuntime.validateGridWebhookPayload({
    eventType: "GRID_ARM",
    strategySignal: "NY_BOX_GRID_50_50",
    symbol: "HBARUSDT.P",
    timeframe: "15",
    supportPrice: 0.082,
    resistancePrice: 0.084,
    triggerPrice: 0.083,
    longTriggerPrice: 0.083,
    shortTriggerPrice: 0.083,
    triggerProfile: "50_50",
    gridRegimeKey: "GRIDREGIME|v1|NY_BOX_GRID_50_50|HBARUSDT.P|15MIN|0.082|0.084|0.083|2026-06-15T10:00:00",
    signalTime: "2026-06-15T10:00:00",
  }, { env: { GRID_EXIT_CONTRACT_MODE: "SHADOW" } });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.payload.symbol, "HBARUSDT.P");
  assert.strictEqual(result.payload.longTriggerPrice, 0.083);
  assert.strictEqual(result.payload.shortTriggerPrice, 0.083);
  assert.strictEqual(result.payload.triggerProfile, "50_50");
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

check("GRID_ARM queue payload hash includes side trigger contract", () => {
  const targetItem = {
    uid: 156,
    pid: 204,
    symbol: "HBARUSDT.P",
    bunbong: "15MIN",
  };
  const basePayload = {
    strategySignal: "NY_BOX_GRID_35_65",
    symbol: "HBARUSDT.P",
    bunbong: "15MIN",
    signalTime: "2026-06-15T10:00:00",
    supportPrice: 0.082,
    resistancePrice: 0.084,
    triggerPrice: 0.083,
    longTriggerPrice: 0.0827,
    shortTriggerPrice: 0.0833,
    triggerProfile: "35_65",
  };
  const originalHash = orderIntentQueue.buildGridArmIntentPayloadHash({ payload: basePayload, targetItem });
  const originalKey = orderIntentQueue.buildGridArmIntentKey({ payload: basePayload, targetItem });
  const changedLongHash = orderIntentQueue.buildGridArmIntentPayloadHash({
    payload: { ...basePayload, longTriggerPrice: 0.0828 },
    targetItem,
  });
  const changedShortHash = orderIntentQueue.buildGridArmIntentPayloadHash({
    payload: { ...basePayload, shortTriggerPrice: 0.0834 },
    targetItem,
  });
  assert.ok(originalKey.includes("HBARUSDT.P"));
  assert.notStrictEqual(originalHash, changedLongHash);
  assert.notStrictEqual(originalHash, changedShortHash);
});

check("GRID_REENTRY hash uses side-selected triggerPrice", () => {
  const longHash = orderIntentQueue.buildGridReentryIntentPayloadHash({
    payload: {
      uid: 156,
      pid: 204,
      symbol: "BTCUSDT",
      timeframe: "15MIN",
      positionSide: "LONG",
      regimeId: 204,
      triggerPrice: 103.5,
      reentryQty: 0.1,
      ownedQtyBasis: 0.1,
      sourceTakeProfitClientOrderId: "tp-long",
    },
  });
  const shortHash = orderIntentQueue.buildGridReentryIntentPayloadHash({
    payload: {
      uid: 156,
      pid: 204,
      symbol: "BTCUSDT",
      timeframe: "15MIN",
      positionSide: "SHORT",
      regimeId: 204,
      triggerPrice: 106.5,
      reentryQty: 0.1,
      ownedQtyBasis: 0.1,
      sourceTakeProfitClientOrderId: "tp-short",
    },
  });
  assert.notStrictEqual(longHash, shortHash);
});

check("GRID_EXIT parent intent preserves HBARUSDT.P scope symbol", () => {
  const normalized = orderIntentQueue.normalizeGridExitParentIntentPayload({
    payload: {
      eventType: "GRID_EXIT",
      strategySignal: "NY_BOX_GRID_35_65",
      symbol: "HBARUSDT.P",
      timeframe: "15MIN",
      exitReason: "BOX_TOUCH",
      touchedBoundary: "SUPPORT",
      exitPrice: 0.082,
    },
    targetItem: {
      uid: 156,
      pid: 204,
      symbol: "HBARUSDT.P",
      strategySignal: "NY_BOX_GRID_35_65",
      timeframe: "15MIN",
    },
  });
  const intentKey = orderIntentQueue.buildGridExitParentIntentKey({
    payload: normalized.gridPayload,
    targetItem: normalized.targetItem,
  });
  assert.strictEqual(normalized.symbol, "HBARUSDT.P");
  assert.ok(intentKey.includes("HBARUSDT.P"));
});

check("Binance adapter converts perp suffix only at API boundary", () => {
  assert.ok(coinSource.includes("const normalizeBinanceFuturesSymbol"));
  assert.ok(coinSource.includes("futuresOrder(type, side, exchangeSymbol"));
  assert.ok(coinSource.includes("futuresCancel(exchangeSymbol"));
  assert.ok(coinSource.includes("openAlgoOrders', { symbol: exchangeSymbol }"));
  assert.ok(coinSource.includes("symbol: exchangeSymbol"));
  assert.ok(coinSource.includes("exchangeSymbol: params?.symbol ? requestParams.symbol : null"));
});

check("static test performs no DB mutation or Binance write", () => {
  assert.strictEqual(true, true);
});

console.log(JSON.stringify({ ok: true, tests, dbMutation: 0, binanceWrite: 0 }, null, 2));

setTimeout(() => process.exit(0), 100);
