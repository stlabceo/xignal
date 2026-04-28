const { loadQaConfig } = require("./qa-config");
const { closePool } = require("./qa-db");
const { printTable, printQaSummary } = require("./qa-report");
const {
  runCrossPidOwnershipGuard,
} = require("./qa-scenarios");

const run = async () => {
  const config = loadQaConfig();
  const scenario = await runCrossPidOwnershipGuard({ uid: config.uid });

  printTable(
    "Data Replay Result",
    [
      {
        scenario: scenario.scenario,
        snapshot: JSON.stringify(scenario.snapshot),
        row: JSON.stringify(scenario.row),
        reservation: JSON.stringify(scenario.reservations || []),
        audit: (scenario.auditLogs || []).join(" || ") || "",
        status: scenario.status,
      },
    ],
    ["scenario", "snapshot", "row", "reservation", "audit", "status"]
  );

  printQaSummary({
    mode: "data-replay",
    target: {
      uid: config.uid,
      pid: scenario.pid,
      strategyCategory: "MIXED",
      symbol: scenario.symbol,
    },
    scenarios: [scenario],
    rowSummary: [{
      scenario: scenario.scenario,
      row: JSON.stringify(scenario.row),
    }],
    reservationSummary: [{
      scenario: scenario.scenario,
      count: (scenario.reservations || []).length,
    }],
  });
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
