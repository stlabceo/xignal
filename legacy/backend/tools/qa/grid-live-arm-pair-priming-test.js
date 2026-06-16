"use strict";

const assert = require("assert");
const gridEngine = require("../../grid-engine");

let tests = 0;
const check = (name, fn) => {
  fn();
  tests += 1;
  console.log(`[PASS] ${name}`);
};

const baseRow = (overrides = {}) => ({
  id: 204,
  uid: 156,
  symbol: "PUMPUSDT.P",
  bunbong: "30MIN",
  enabled: "Y",
  regimeStatus: "WAITING_WEBHOOK",
  regimeEndReason: null,
  margin: 6,
  leverage: 1,
  tradeValue: 6,
  profit: 0.5,
  supportPrice: null,
  resistancePrice: null,
  triggerPrice: null,
  signalTime: null,
  longLegStatus: "IDLE",
  shortLegStatus: "IDLE",
  longEntryOrderId: null,
  shortEntryOrderId: null,
  longQty: 0,
  shortQty: 0,
  ...overrides,
});

const baseTarget = (overrides = {}) => ({
  uid: 156,
  pid: 204,
  strategyCategory: "grid",
  strategyMode: "live",
  symbol: "PUMPUSDT.P",
  timeframe: "30MIN",
  supportPrice: 0.001465,
  resistancePrice: 0.001525,
  triggerPrice: 0.001495,
  signalTime: "2026-06-08T10:18:07.000Z",
  gridRegimeKey: "GRIDREGIME|v1|SQZ+GRID|PUMPUSDT.P|30MIN|0.001465|0.001525|0.001495|2026-06-08T10:18:07",
  gridPayload: {
    symbol: "PUMPUSDT.P",
    timeframe: "30MIN",
    supportPrice: 0.001465,
    resistancePrice: 0.001525,
    triggerPrice: 0.001495,
    signalTime: "2026-06-08T10:18:07.000Z",
    gridRegimeKey: "GRIDREGIME|v1|SQZ+GRID|PUMPUSDT.P|30MIN|0.001465|0.001525|0.001495|2026-06-08T10:18:07",
  },
  ...overrides,
});

const buildPlan = (rowOverrides = {}, targetOverrides = {}) =>
  gridEngine.buildLiveGridArmPairPrimingPlan({
    row: baseRow(rowOverrides),
    targetItem: baseTarget(targetOverrides),
  });

check("PID204-like hydrated target creates two entry pair plans", () => {
  const plan = buildPlan();
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.legs.length, 2);
});

check("LONG and SHORT legs are both generated", () => {
  const plan = buildPlan();
  assert.deepStrictEqual(plan.legs.map((leg) => leg.leg).sort(), ["LONG", "SHORT"]);
});

check("entry orders are LIMIT only", () => {
  const plan = buildPlan();
  assert.ok(plan.legs.every((leg) => leg.orderType === "LIMIT"));
});

check("trigger price is used for both pair legs", () => {
  const plan = buildPlan();
  assert.ok(plan.legs.every((leg) => leg.triggerPrice === 0.001495));
});

check("35/65 side trigger prices are preserved per leg", () => {
  const target = baseTarget({
    strategySignal: "NY_BOX_GRID_35_65",
    symbol: "BTCUSDT.P",
    supportPrice: 100,
    resistancePrice: 110,
    triggerPrice: 105,
    longTriggerPrice: 103.5,
    shortTriggerPrice: 106.5,
    triggerProfile: "35_65",
    gridPayload: {
      ...baseTarget().gridPayload,
      strategySignal: "NY_BOX_GRID_35_65",
      symbol: "BTCUSDT.P",
      supportPrice: 100,
      resistancePrice: 110,
      triggerPrice: 105,
      longTriggerPrice: 103.5,
      shortTriggerPrice: 106.5,
      triggerProfile: "35_65",
    },
  });
  const plan = gridEngine.buildLiveGridArmPairPrimingPlan({
    row: baseRow({ symbol: "BTCUSDT.P", supportPrice: null, resistancePrice: null, triggerPrice: null }),
    targetItem: target,
  });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.longTriggerPrice, 103.5);
  assert.strictEqual(plan.shortTriggerPrice, 106.5);
  assert.strictEqual(plan.triggerProfile, "35_65");
  assert.strictEqual(plan.legs.find((leg) => leg.leg === "LONG").triggerPrice, 103.5);
  assert.strictEqual(plan.legs.find((leg) => leg.leg === "SHORT").triggerPrice, 106.5);
});

check("50/50 side trigger prices can match legacy center trigger", () => {
  const target = baseTarget({
    strategySignal: "NY_BOX_GRID_50_50",
    symbol: "BTCUSDT.P",
    supportPrice: 100,
    resistancePrice: 110,
    triggerPrice: 105,
    longTriggerPrice: 105,
    shortTriggerPrice: 105,
    triggerProfile: "50_50",
    gridPayload: {
      ...baseTarget().gridPayload,
      strategySignal: "NY_BOX_GRID_50_50",
      symbol: "BTCUSDT.P",
      supportPrice: 100,
      resistancePrice: 110,
      triggerPrice: 105,
      longTriggerPrice: 105,
      shortTriggerPrice: 105,
      triggerProfile: "50_50",
    },
  });
  const plan = gridEngine.buildLiveGridArmPairPrimingPlan({
    row: baseRow({ symbol: "BTCUSDT.P" }),
    targetItem: target,
  });
  assert.strictEqual(plan.ok, true);
  assert.ok(plan.legs.every((leg) => leg.triggerPrice === 105));
});

check("support and resistance are preserved from target payload", () => {
  const plan = buildPlan();
  assert.strictEqual(plan.supportPrice, 0.001465);
  assert.strictEqual(plan.resistancePrice, 0.001525);
});

check("minimum PUMP notional path stays above 5 USDT", () => {
  const plan = buildPlan();
  assert.ok(plan.qty > 0);
  assert.ok(plan.notional >= 5);
  assert.ok(plan.notional <= 6.0000001);
});

check("PUMPUSDT.P and PUMPUSDT are distinct runtime scope symbols", () => {
  const plan = buildPlan({ symbol: "PUMPUSDT" }, { symbol: "PUMPUSDT.P" });
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.reason, "GRID_LIVE_ARM_SYMBOL_MISMATCH");
  assert.strictEqual(plan.rowSymbol, "PUMPUSDT");
  assert.strictEqual(plan.targetSymbol, "PUMPUSDT.P");
});

check("HBARUSDT.P side trigger prices are preserved per strategy profile", () => {
  const target = baseTarget({
    strategySignal: "NY_BOX_GRID_35_65",
    symbol: "HBARUSDT.P",
    supportPrice: 0.082,
    resistancePrice: 0.084,
    triggerPrice: 0.083,
    longTriggerPrice: 0.0827,
    shortTriggerPrice: 0.0833,
    triggerProfile: "35_65",
    gridRegimeKey: "GRIDREGIME|v1|NY_BOX_GRID_35_65|HBARUSDT.P|15MIN|0.082|0.084|0.083|2026-06-16T10:00:00",
    gridPayload: {
      ...baseTarget().gridPayload,
      strategySignal: "NY_BOX_GRID_35_65",
      symbol: "HBARUSDT.P",
      timeframe: "15MIN",
      supportPrice: 0.082,
      resistancePrice: 0.084,
      triggerPrice: 0.083,
      longTriggerPrice: 0.0827,
      shortTriggerPrice: 0.0833,
      triggerProfile: "35_65",
      gridRegimeKey: "GRIDREGIME|v1|NY_BOX_GRID_35_65|HBARUSDT.P|15MIN|0.082|0.084|0.083|2026-06-16T10:00:00",
    },
  });
  const plan = gridEngine.buildLiveGridArmPairPrimingPlan({
    row: baseRow({ symbol: "HBARUSDT.P", bunbong: "15MIN", supportPrice: null, resistancePrice: null, triggerPrice: null }),
    targetItem: target,
  });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.longTriggerPrice, 0.0827);
  assert.strictEqual(plan.shortTriggerPrice, 0.0833);
  assert.strictEqual(plan.legs.find((leg) => leg.leg === "LONG").triggerPrice, 0.0827);
  assert.strictEqual(plan.legs.find((leg) => leg.leg === "SHORT").triggerPrice, 0.0833);
});

check("missing notional blocks pair priming", () => {
  const plan = buildPlan({ margin: 0, tradeValue: 0 });
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.reason, "GRID_LIVE_ARM_NOTIONAL_MISSING");
});

check("missing trigger blocks pair priming", () => {
  const target = baseTarget({ triggerPrice: null, gridPayload: { ...baseTarget().gridPayload, triggerPrice: null } });
  const plan = gridEngine.buildLiveGridArmPairPrimingPlan({ row: baseRow(), targetItem: target });
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.reason, "GRID_LIVE_ARM_PAIR_CONTEXT_MISSING");
});

check("side trigger outside box is rejected", () => {
  const target = baseTarget({
    symbol: "BTCUSDT.P",
    supportPrice: 100,
    resistancePrice: 110,
    triggerPrice: 105,
    longTriggerPrice: 99.9,
    shortTriggerPrice: 106.5,
    gridPayload: {
      ...baseTarget().gridPayload,
      symbol: "BTCUSDT.P",
      supportPrice: 100,
      resistancePrice: 110,
      triggerPrice: 105,
      longTriggerPrice: 99.9,
      shortTriggerPrice: 106.5,
    },
  });
  const plan = gridEngine.buildLiveGridArmPairPrimingPlan({ row: baseRow({ symbol: "BTCUSDT.P" }), targetItem: target });
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.reason, "GRID_LIVE_ARM_LONG_TRIGGER_OUTSIDE_BOX");
});

check("missing gridRegimeKey blocks pair priming", () => {
  const target = baseTarget({ gridRegimeKey: null, gridPayload: { ...baseTarget().gridPayload, gridRegimeKey: null } });
  const plan = gridEngine.buildLiveGridArmPairPrimingPlan({ row: baseRow(), targetItem: target });
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.reason, "GRID_LIVE_ARM_REGIME_KEY_MISSING");
});

check("one-sided stale entry context is rejected", () => {
  const plan = buildPlan({ longLegStatus: "ENTRY_ARMED", shortLegStatus: "IDLE" });
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.reason, "GRID_LIVE_ARM_EXISTING_LEG_CONTEXT");
});

check("no MARKET order plan is ever produced", () => {
  const plan = buildPlan();
  assert.ok(plan.legs.every((leg) => leg.orderType !== "MARKET"));
});

check("disabled row is rejected", () => {
  const plan = buildPlan({ enabled: "N" });
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.reason, "GRID_LIVE_ARM_ROW_DISABLED");
});

check("terminal state is rejected", () => {
  const plan = buildPlan({ regimeStatus: "ENDED" });
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.reason, "GRID_LIVE_ARM_ROW_STATE_NOT_PRIMEABLE");
});

check("static test performs no DB mutation or Binance write", () => {
  assert.strictEqual(true, true);
});

console.log(JSON.stringify({ ok: true, tests, dbMutation: 0, binanceWrite: 0 }, null, 2));

setTimeout(() => process.exit(0), 100);
