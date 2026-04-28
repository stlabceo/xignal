const { loadQaConfig } = require("./qa-config");
const { closePool } = require("./qa-db");
const { printQaSummary, printTable } = require("./qa-report");
const {
  summarizeLedger,
  summarizeSnapshot,
  runSamePidDuplicateGridEntry,
  runSamePidDuplicateSignalEntry,
  runDuplicateExit,
  runDifferentPidSameSymbolSide,
} = require("./qa-scenarios");

const formatScenarioRow = (result) => ({
  scenario: result.scenario,
  ledger: JSON.stringify(summarizeLedger(result.ledgerRows)),
  snapshot: JSON.stringify(summarizeSnapshot(result.snapshot)),
  row:
    result.strategyCategory === "grid"
      ? JSON.stringify({
          regimeStatus: result.row?.regimeStatus || null,
          longLegStatus: result.row?.longLegStatus || null,
          longQty: Number(result.row?.longQty || 0),
        })
      : JSON.stringify({
          status: result.row?.status || null,
          r_qty: Number(result.row?.r_qty || 0),
          r_exactPrice: Number(result.row?.r_exactPrice || 0),
        }),
  reservation: `${(result.reservations || []).length}`,
  audit: (result.auditLogs || []).join(" || ") || (result.msgList || []).map((item) => item.code).join(","),
  status: result.status,
});

const run = async () => {
  const config = loadQaConfig();
  const scenarios = [];
  scenarios.push(await runSamePidDuplicateGridEntry({ uid: config.uid }));
  scenarios.push(await runSamePidDuplicateSignalEntry({ uid: config.uid }));
  scenarios.push(await runDuplicateExit({ uid: config.uid }));
  scenarios.push(await runDifferentPidSameSymbolSide({ uid: config.uid }));

  printTable(
    "Data Replay Result",
    scenarios.map(formatScenarioRow),
    ["scenario", "ledger", "snapshot", "row", "reservation", "audit", "status"]
  );

  printQaSummary({
    mode: "data-replay",
    target: {
      uid: config.uid,
      strategyCategory: "MIXED",
      symbol: config.symbol,
    },
    scenarios,
    ledgerSummary: scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      ...summarizeLedger(scenario.ledgerRows),
    })),
    snapshotSummary: scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      ...summarizeSnapshot(scenario.snapshot),
    })),
    rowSummary: scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      row:
        scenario.strategyCategory === "grid"
          ? `${scenario.row?.regimeStatus || "-"} / ${scenario.row?.longLegStatus || "-"} / ${Number(scenario.row?.longQty || 0)}`
          : `${scenario.row?.status || "-"} / ${Number(scenario.row?.r_qty || 0)} / ${Number(scenario.row?.r_exactPrice || 0)}`,
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
