"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "../../..");
const gridRuntimeSource = fs.readFileSync(path.resolve(repoRoot, "backend/grid-runtime.js"), "utf8");
const usersRouteSource = fs.readFileSync(path.resolve(repoRoot, "backend/routes/users.js"), "utf8");

let dbWriteCount = 0;
let binanceWriteCount = 0;
const sharedKey = "GRIDREGIME|v1|MEAN_REVERT_GRID|ADAUSDT|10MIN|1.1987|1.2345|1.2166|2026-06-05T12:00:00";

const mockRowsByTable = {
  live_grid_strategy_list: [
    {
      id: 201,
      uid: 156,
      a_name: "Grid A",
      strategySignal: "Mean Revert Grid",
      symbol: "ADAUSDT",
      bunbong: "10MIN",
      enabled: "Y",
      regimeStatus: "ACTIVE",
      supportPrice: "1.1987",
      resistancePrice: "1.2345",
      triggerPrice: "1.2166",
      lastWebhookPayloadJson: JSON.stringify({ gridRegimeKey: sharedKey }),
    },
    {
      id: 202,
      uid: 156,
      a_name: "Grid B",
      strategySignal: "Mean Revert Grid",
      symbol: "ADAUSDT",
      bunbong: "10MIN",
      enabled: "Y",
      regimeStatus: "GRID_SINGLE_LEG_ACTIVE_OPPOSITE_RESTING",
      supportPrice: "1.1987",
      resistancePrice: "1.2345",
      triggerPrice: "1.2166",
      lastWebhookPayloadJson: JSON.stringify({ gridRegimeKey: sharedKey }),
    },
    {
      id: 203,
      uid: 156,
      a_name: "Grid C",
      strategySignal: "Mean Revert Grid",
      symbol: "ADAUSDT",
      bunbong: "10MIN",
      enabled: "Y",
      regimeStatus: "ACTIVE",
      supportPrice: "1.1987",
      resistancePrice: "1.2345",
      triggerPrice: "1.2166",
      lastWebhookPayloadJson: JSON.stringify({ gridRegimeKey: "GRIDREGIME|v1|OTHER" }),
    },
    {
      id: 204,
      uid: 156,
      a_name: "Grid D",
      strategySignal: "Other Grid",
      symbol: "ADAUSDT",
      bunbong: "10MIN",
      enabled: "Y",
      regimeStatus: "ACTIVE",
      supportPrice: "1.1987",
      resistancePrice: "1.2345",
      triggerPrice: "1.2166",
      lastWebhookPayloadJson: JSON.stringify({ gridRegimeKey: sharedKey }),
    },
    {
      id: 205,
      uid: 156,
      a_name: "Grid E",
      strategySignal: "Mean Revert Grid",
      symbol: "ADAUSDT",
      bunbong: "10MIN",
      enabled: "N",
      regimeStatus: "ACTIVE",
      supportPrice: "1.1987",
      resistancePrice: "1.2345",
      triggerPrice: "1.2166",
      lastWebhookPayloadJson: JSON.stringify({ gridRegimeKey: sharedKey }),
    },
  ],
  test_grid_strategy_list: [],
};

const gridRuntimeModule = { exports: {} };
vm.runInNewContext(
  gridRuntimeSource,
  {
    module: gridRuntimeModule,
    exports: gridRuntimeModule.exports,
    process: { env: {} },
    require: (request) => {
      if (request === "./database/connect/config") {
        return {
          query: async (sql, params = []) => {
            if (!/^\s*SELECT\b/i.test(sql || "")) {
              dbWriteCount += 1;
              throw new Error(`Unexpected DB write in static test: ${sql}`);
            }
            const table = String(sql || "").match(/FROM\s+([a-zA-Z0-9_]+)/)?.[1];
            const rows = mockRowsByTable[table] || [];
            const [symbol, bunbong, uid] = params;
            return [
              rows.filter((row) => {
                if (String(row.enabled || "").toUpperCase() !== "Y") return false;
                if (symbol && row.symbol !== symbol) return false;
                if (bunbong && row.bunbong !== bunbong) return false;
                if (uid && Number(row.uid) !== Number(uid)) return false;
                return true;
              }),
            ];
          },
        };
      }
      if (request === "./canonical-runtime-state") {
        return {
          getItemEnabled: (item = {}) => String(item.enabled || "").toUpperCase() === "Y",
          decorateGridItemSync: (item = {}) => ({
            ...item,
            controlStateLabel: "STATIC",
            runtimeStateLabel: item.regimeStatus || "STATIC",
          }),
          GRID_RUNTIME_LABELS: { GRIDDING: "GRIDDING", READY: "READY" },
        };
      }
      if (/binance|coin|order-intent/i.test(request)) {
        binanceWriteCount += 1;
        throw new Error(`Unexpected trading dependency in static test: ${request}`);
      }
      return require(request);
    },
  },
  { filename: "grid-runtime.js" }
);

const gridRuntime = gridRuntimeModule.exports;
const enforceEnv = {
  GRID_EXIT_CONTRACT_MODE: "ENFORCE",
  GRID_CANDLE_CLOSE_LEGACY_MODE: "AUDIT_ONLY",
  GRID_EXIT_ORCHESTRATOR_ENABLED: "0",
  GRID_EMERGENCY_STOP_BACKSTOP_MODE: "NEW_KEYED_ONLY",
};

assert.strictEqual(
  JSON.stringify(gridRuntime.getGridExitFeatureFlags({})),
  JSON.stringify({
    GRID_EXIT_CONTRACT_MODE: "SHADOW",
    GRID_CANDLE_CLOSE_LEGACY_MODE: "AUDIT_ONLY",
    GRID_EXIT_ORCHESTRATOR_ENABLED: "0",
    GRID_EMERGENCY_STOP_BACKSTOP_MODE: "NEW_KEYED_ONLY",
  })
);

assert.strictEqual(gridRuntime.normalizeGridRegimeStrategySignal(" Mean   Revert Grid "), "MEAN_REVERT_GRID");
assert.strictEqual(gridRuntime.normalizeGridSymbol("BINANCE:ADAUSDT.P"), "ADAUSDT");
assert.strictEqual(gridRuntime.normalizeGridBunbong("10"), "10MIN");
assert.strictEqual(gridRuntime.normalizeGridRegimePrice("1.198700000000"), "1.1987");
assert.strictEqual(gridRuntime.normalizeGridRegimeTime("2026-06-05 12:00:00"), "2026-06-05T12:00:00");

const canonicalKey = gridRuntime.buildGridRegimeKey({
  strategySignal: "Mean Revert Grid",
  symbol: "BINANCE:ADAUSDT.P",
  timeframe: "10",
  supportPrice: "1.198700000000",
  resistancePrice: "1.234500000000",
  triggerPrice: "1.216600000000",
  signalTime: "2026-06-05 12:00:00",
});
assert.strictEqual(canonicalKey, sharedKey, "buildGridRegimeKey canonical example");

const armBase = {
  eventType: "GRID_ARM",
  strategySignal: "Mean Revert Grid",
  symbol: "BINANCE:ADAUSDT.P",
  timeframe: "10",
  supportPrice: "1.198700000000",
  resistancePrice: "1.234500000000",
  triggerPrice: "1.216600000000",
  signalTime: "2026-06-05 12:00:00",
};

assert.strictEqual(
  gridRuntime.validateGridWebhookPayload(armBase, { env: enforceEnv }).reason,
  "grid-arm-missing-grid-regime-key",
  "GRID_ARM missing key reject in ENFORCE"
);
assert.strictEqual(
  gridRuntime.validateGridWebhookPayload({ ...armBase, gridRegimeKey: "wrong" }, { env: enforceEnv }).reason,
  "grid-arm-grid-regime-key-mismatch",
  "GRID_ARM wrong key reject in ENFORCE"
);
assert.strictEqual(
  gridRuntime.validateGridWebhookPayload({ ...armBase, gridRegimeKey: canonicalKey }, { env: enforceEnv }).ok,
  true,
  "GRID_ARM correct key accepted in ENFORCE"
);
assert.strictEqual(
  gridRuntime.validateGridWebhookPayload({ ...armBase, signalPrice: 1.2166 }, { env: enforceEnv }).reason,
  "forbidden-grid-signal-price-field",
  "GRID_ARM signalPrice reject"
);

const exitBase = {
  eventType: "GRID_EXIT",
  strategySignal: "Mean Revert Grid",
  symbol: "ADAUSDT.P",
  timeframe: "10MIN",
  signalTime: "2026-06-05 12:10:00",
};
assert.strictEqual(
  gridRuntime.validateGridExitWebhookPayload(exitBase, { env: enforceEnv }).reason,
  "grid-exit-missing-grid-regime-key",
  "GRID_EXIT missing key reject in ENFORCE"
);
assert.strictEqual(
  gridRuntime.validateGridExitWebhookPayload({ ...exitBase, gridRegimeKey: sharedKey, signal_price: 1 }, { env: enforceEnv }).reason,
  "forbidden-grid-signal-price-field",
  "GRID_EXIT signal_price reject"
);
assert.strictEqual(
  gridRuntime.validateGridExitWebhookPayload({ ...exitBase, gridRegimeKey: sharedKey }, { env: enforceEnv }).ok,
  true,
  "GRID_EXIT with key validates without box prices"
);
assert.strictEqual(
  gridRuntime.validateGridWebhookPayload({ ...armBase, strategySignal: "Other Released Grid", gridRegimeKey: gridRuntime.buildGridRegimeKey({ ...armBase, strategySignal: "Other Released Grid" }) }, { env: enforceEnv }).ok,
  true,
  "arbitrary strategySignal accepted"
);
assert.ok(
  !gridRuntimeSource.includes("SQZ_GRID") && !gridRuntimeSource.includes("SQZ+GRID"),
  "strategySignal hardcode absent in grid-runtime contract helper"
);

(async () => {
  const wrongKeyPreview = await gridRuntime.previewGridExitWebhook({
    ...exitBase,
    gridRegimeKey: "GRIDREGIME|v1|WRONG",
  });
  assert.strictEqual(wrongKeyPreview.live.armed, 0, "GRID_EXIT wrong key no target");
  assert.strictEqual(
    wrongKeyPreview.targetItems.filter((item) => item.resultCode === "GRID_EXIT_KEY_MISMATCH").length,
    3,
    "wrong key is audited per candidate without target mutation"
  );

  const sameKeyPreview = await gridRuntime.previewGridExitWebhook({
    ...exitBase,
    gridRegimeKey: sharedKey,
  });
  assert.strictEqual(sameKeyPreview.live.armed, 2, "GRID_EXIT same-key multi-PID target preview");
  assert.strictEqual(
    sameKeyPreview.targetItems.some((item) => item.pid === 203 && item.resultCode === "GRID_EXIT_KEY_MISMATCH"),
    true,
    "unrelated same symbol PID untouched by wrong stored key"
  );
  assert.strictEqual(
    sameKeyPreview.targetItems.some((item) => item.pid === 204 && item.resultCode === "GRID_EXIT_SIGNAL_MISMATCH"),
    true,
    "unrelated strategySignal PID untouched"
  );
  assert.strictEqual(
    sameKeyPreview.targetItems.some((item) => item.pid === 205),
    false,
    "disabled row excluded"
  );

  const candlePreview = await gridRuntime.previewGridExitWebhook({
    eventType: "GRID_CANDLE_CLOSE_BREAKOUT",
    strategySignal: "Mean Revert Grid",
    symbol: "ADAUSDT.P",
    timeframe: "10MIN",
    candleClosed: true,
    candleClosePrice: "1.2600",
  });
  assert.strictEqual(candlePreview.live.armed, 0, "GRID_CANDLE_CLOSE_BREAKOUT audit/no-op");
  assert.ok(
    candlePreview.targetItems.every((item) =>
      ["GRID_CANDLE_CLOSE_LEGACY_DISABLED_AUDIT", "GRID_EXIT_SIGNAL_MISMATCH"].includes(item.resultCode)
    ),
    "legacy candle close never produces closeout target"
  );
  assert.strictEqual(
    gridRuntime.validateGridExitWebhookPayload(
      { eventType: "GRID_CANDLE_CLOSE_BREAKOUT", strategySignal: "Mean Revert Grid", symbol: "ADAUSDT.P", timeframe: "10MIN" },
      { env: { ...enforceEnv, GRID_CANDLE_CLOSE_LEGACY_MODE: "REJECT" } }
    ).reason,
    "grid-candle-close-legacy-rejected",
    "candle close REJECT mode validates as rejected"
  );

  const shadowArm = gridRuntime.validateGridWebhookPayload(armBase, {
    env: { ...enforceEnv, GRID_EXIT_CONTRACT_MODE: "SHADOW" },
  });
  assert.strictEqual(shadowArm.ok, true, "SHADOW mode does not reject/mutate target");
  assert.ok(shadowArm.payload.gridRegimeKeyWarnings.includes("grid-arm-missing-grid-regime-key"));

  assert.ok(usersRouteSource.includes("GRID_CANDLE_CLOSE_LEGACY_DISABLED_AUDIT"));
  assert.ok(usersRouteSource.includes("GRID_EXIT_ALERT_AUDIT_ONLY"));
  assert.ok(!usersRouteSource.includes("GRID_EXIT_ALERT_CLOSEOUT_REQUESTED"));
  assert.ok(!usersRouteSource.includes("CANDLE_CLOSE_BREAKOUT_CLOSEOUT_REQUESTED"));

  assert.strictEqual(dbWriteCount, 0, "no DB data mutation invoked");
  assert.strictEqual(binanceWriteCount, 0, "no Binance write path invoked");
  console.log(JSON.stringify({ ok: true, tests: 19, dbMutation: 0, binanceWrite: 0 }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
