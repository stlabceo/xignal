const { loadQaConfig } = require("./qa-config");
const { closePool } = require("./qa-db");
const { printTable, printQaSummary } = require("./qa-report");
const {
  runSignalForceOffRuntimeReadySnapshotOpen,
  runSignalForceOffCloseFailureKeepsProtection,
  runSignalForceOffNormalCloseSequencing,
  runLiveReadonlyDetectsUnprotectedOpenPosition,
} = require("./qa-scenarios");

const run = async () => {
  const config = loadQaConfig();
  const scenarios = [
    await runSignalForceOffRuntimeReadySnapshotOpen({ uid: config.uid }),
    await runSignalForceOffCloseFailureKeepsProtection({ uid: config.uid }),
    await runSignalForceOffNormalCloseSequencing({ uid: config.uid }),
    await runLiveReadonlyDetectsUnprotectedOpenPosition({ uid: config.uid }),
  ];

  printTable(
    "Data Replay Result",
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
      strategyCategory: "SIGNAL",
      symbol: "QAXRPUSDT",
    },
    scenarios,
    rowSummary: scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      row: JSON.stringify(scenario.row || {}),
    })),
    reservationSummary: scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      count: (scenario.reservations || []).length,
    })),
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
