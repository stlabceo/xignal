const { loadQaConfig } = require("./qa-config");
const { closePool } = require("./qa-db");
const { printTable, printQaSummary } = require("./qa-report");
const {
  summarizeLedger,
  summarizeSnapshot,
  runSplitTpPartialClose,
} = require("./qa-scenarios");

const run = async () => {
  const config = loadQaConfig();
  const scenario = await runSplitTpPartialClose({ uid: config.uid });

  printTable(
    "Data Replay Result",
    [
      {
        scenario: scenario.scenario,
        ledger: JSON.stringify(summarizeLedger(scenario.ledgerRows)),
        snapshot: JSON.stringify(summarizeSnapshot(scenario.snapshot)),
        row: JSON.stringify({
          status: scenario.row?.status || null,
          r_qty: Number(scenario.row?.r_qty || 0),
          r_exactPrice: Number(scenario.row?.r_exactPrice || 0),
        }),
        reservation: `${(scenario.reservations || []).length}`,
        audit: (scenario.auditLogs || []).join(" || ") || "",
        status: scenario.status,
      },
    ],
    ["scenario", "ledger", "snapshot", "row", "reservation", "audit", "status"]
  );

  printQaSummary({
    mode: "data-replay",
    target: {
      uid: config.uid,
      pid: scenario.pid,
      strategyCategory: "SIGNAL",
      symbol: scenario.symbol,
    },
    scenarios: [scenario],
    ledgerSummary: [{ scenario: scenario.scenario, ...summarizeLedger(scenario.ledgerRows) }],
    snapshotSummary: [{ scenario: scenario.scenario, ...summarizeSnapshot(scenario.snapshot) }],
    rowSummary: [{
      scenario: scenario.scenario,
      row: `${scenario.row?.status || "-"} / ${Number(scenario.row?.r_qty || 0)} / ${Number(scenario.row?.r_exactPrice || 0)}`,
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
