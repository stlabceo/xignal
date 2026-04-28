const { loadQaConfig } = require("./qa-config");
const { closePool } = require("./qa-db");
const { printTable, printQaSummary } = require("./qa-report");
const {
  summarizeLedger,
  summarizeSnapshot,
  runGridReservationOwnedStopFillRecovery,
} = require("./qa-scenarios");

const run = async () => {
  const config = loadQaConfig();
  const scenario = await runGridReservationOwnedStopFillRecovery({ uid: config.uid });

  printTable(
    "Data Replay Result",
    [{
      scenario: scenario.scenario,
      ledger: JSON.stringify(summarizeLedger(scenario.ledgerRows)),
      snapshot: JSON.stringify(scenario.snapshot),
      row: JSON.stringify(scenario.row),
      reservation: `${(scenario.reservations || []).length}`,
      audit: (scenario.auditLogs || []).join(" || ") || "",
      status: scenario.status,
    }],
    ["scenario", "ledger", "snapshot", "row", "reservation", "audit", "status"]
  );

  printQaSummary({
    mode: "data-replay",
    target: {
      uid: config.uid,
      pid: scenario.pid,
      strategyCategory: "MIXED",
      symbol: "PUMPUSDT",
    },
    scenarios: [scenario],
    ledgerSummary: [{ scenario: scenario.scenario, ...summarizeLedger(scenario.ledgerRows) }],
    snapshotSummary: [{ scenario: scenario.scenario, snapshot: JSON.stringify(summarizeSnapshot(scenario.snapshot?.grid)) }],
    rowSummary: [{ scenario: scenario.scenario, row: JSON.stringify(scenario.row) }],
    reservationSummary: [{ scenario: scenario.scenario, count: (scenario.reservations || []).length }],
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
