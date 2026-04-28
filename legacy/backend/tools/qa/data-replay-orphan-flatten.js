const { loadQaConfig } = require("./qa-config");
const { closePool } = require("./qa-db");
const { printTable, printQaSummary } = require("./qa-report");
const {
  summarizeLedger,
  summarizeSnapshot,
  runSignalLocalStaleFlatten,
  runGridLocalStaleFlatten,
  runDirectOrphanFlatten,
  runCorrectionPnlIntegrity,
} = require("./qa-scenarios");

const formatRow = (scenario) => ({
  scenario: scenario.scenario,
  ledger: JSON.stringify(summarizeLedger(scenario.ledgerRows)),
  snapshot: JSON.stringify(summarizeSnapshot(scenario.snapshot)),
  row:
    scenario.strategyCategory === "grid"
      ? JSON.stringify({
          regimeStatus: scenario.row?.regimeStatus || null,
          longLegStatus: scenario.row?.longLegStatus || null,
          longQty: Number(scenario.row?.longQty || 0),
        })
      : JSON.stringify({
          status: scenario.row?.status || null,
          r_qty: Number(scenario.row?.r_qty || 0),
          r_exactPrice: Number(scenario.row?.r_exactPrice || 0),
        }),
  reservation: `${(scenario.reservations || []).length}`,
  audit:
    (scenario.msgList || []).map((item) => `${item.code}:${item.fun}`).join(" || ")
    || (scenario.auditLogs || []).join(" || "),
  status: scenario.status,
});

const run = async () => {
  const config = loadQaConfig();
  const scenarios = [];
  scenarios.push(await runSignalLocalStaleFlatten({ uid: config.uid }));
  scenarios.push(await runGridLocalStaleFlatten({ uid: config.uid }));
  scenarios.push(await runDirectOrphanFlatten({ uid: config.uid }));
  scenarios.push(await runCorrectionPnlIntegrity({ uid: config.uid }));

  printTable(
    "Data Replay Result",
    scenarios.map(formatRow),
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
