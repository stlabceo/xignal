const { loadQaConfig } = require("./qa-config");
const { closePool } = require("./qa-db");
const { printTable, printQaSummary } = require("./qa-report");
const {
  runLiveReadonlyDetectsLocalCanceledBinanceActiveOrder,
  runLiveReadonlyDetectsBinanceOpenLocalFlat,
  runLiveReadonlyDetectsOrphanCloseOrderForFlatSide,
  runLiveReadonlyDetectsOversizedProtectionVsPosition,
  runCrossPidOverfillGuardWithTpGmanual,
} = require("./qa-scenarios");

const run = async () => {
  const config = loadQaConfig();
  const scenarios = [
    await runLiveReadonlyDetectsLocalCanceledBinanceActiveOrder({ uid: config.uid }),
    await runLiveReadonlyDetectsBinanceOpenLocalFlat({ uid: config.uid }),
    await runLiveReadonlyDetectsOrphanCloseOrderForFlatSide({ uid: config.uid }),
    await runLiveReadonlyDetectsOversizedProtectionVsPosition({ uid: config.uid }),
    await runCrossPidOverfillGuardWithTpGmanual({ uid: config.uid }),
  ];

  printTable(
    "Ownership / Protection Lifecycle Replay",
    scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      row: JSON.stringify(scenario.row || {}),
      audit: (scenario.auditLogs || []).join(" || "),
      status: scenario.status,
    })),
    ["scenario", "row", "audit", "status"]
  );

  printQaSummary({
    mode: "data-replay",
    target: {
      uid: config.uid,
      pid: scenarios.map((scenario) => scenario.pid).join(","),
      strategyCategory: "MIXED",
      symbol: "PUMPUSDT/XRPUSDT",
    },
    scenarios,
  });

  if (scenarios.some((scenario) => scenario.status !== "PASS")) {
    process.exitCode = 1;
  }
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error?.stack || error?.message || error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
      process.exit(process.exitCode || 0);
    });
}
