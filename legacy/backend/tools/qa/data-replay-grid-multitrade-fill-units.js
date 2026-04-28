const { loadQaConfig } = require("./qa-config");
const { closePool } = require("./qa-db");
const { printTable, printQaSummary } = require("./qa-report");
const {
  summarizeLedger,
  summarizeSnapshot,
  runGridMultiTradeEntryPreservation,
  runGridMultiTradeExitPreservation,
} = require("./qa-scenarios");

const run = async () => {
  const config = loadQaConfig();
  const scenarios = [
    await runGridMultiTradeEntryPreservation({ uid: config.uid }),
    await runGridMultiTradeExitPreservation({ uid: config.uid }),
  ];

  printTable(
    "Data Replay Result",
    scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      ledger: JSON.stringify(summarizeLedger(scenario.ledgerRows)),
      snapshot: JSON.stringify(summarizeSnapshot(scenario.snapshot)),
      row: JSON.stringify({
        regimeStatus: scenario.row?.regimeStatus || null,
        longLegStatus: scenario.row?.longLegStatus || null,
        shortLegStatus: scenario.row?.shortLegStatus || null,
        longQty: Number(scenario.row?.longQty || 0),
        shortQty: Number(scenario.row?.shortQty || 0),
      }),
      reservation: `${(scenario.reservations || []).length}`,
      audit: (scenario.auditLogs || []).join(" || ") || "",
      status: scenario.status,
    })),
    ["scenario", "ledger", "snapshot", "row", "reservation", "audit", "status"]
  );

  printQaSummary({
    mode: "data-replay",
    target: {
      uid: config.uid,
      pid: scenarios.map((scenario) => scenario.pid).join(","),
      strategyCategory: "GRID",
      symbol: scenarios.map((scenario) => scenario.symbol).join(","),
    },
    scenarios,
    ledgerSummary: scenarios.map((scenario) => ({ scenario: scenario.scenario, ...summarizeLedger(scenario.ledgerRows) })),
    snapshotSummary: scenarios.map((scenario) => ({ scenario: scenario.scenario, ...summarizeSnapshot(scenario.snapshot) })),
    rowSummary: scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      row: `${scenario.row?.regimeStatus || "-"} / ${scenario.row?.longLegStatus || "-"} / ${scenario.row?.shortLegStatus || "-"} / ${Number(scenario.row?.longQty || 0)} / ${Number(scenario.row?.shortQty || 0)}`,
    })),
    reservationSummary: scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      count: (scenario.reservations || []).length,
    })),
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
