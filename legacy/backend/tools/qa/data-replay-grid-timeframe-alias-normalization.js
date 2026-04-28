const { loadQaConfig } = require("./qa-config");
const { closePool } = require("./qa-db");
const { printTable, printQaSummary } = require("./qa-report");
const {
  runGridWebhookTimeframeAliasNormalization,
} = require("./qa-scenarios");

const run = async () => {
  const config = loadQaConfig();
  const scenario = await runGridWebhookTimeframeAliasNormalization({ uid: config.uid });
  const cases = (scenario.row?.cases || []).map((item) => ({
    case: item.case,
    symbol: item.symbol,
    candleMin: item.candleMin,
    normalizedSymbol: item.normalizedSymbol,
    normalizedBunbong: item.normalizedBunbong,
    candidatePids: (item.candidatePids || []).join(","),
    status: scenario.status,
  }));

  printTable(
    "Data Replay Result",
    cases,
    ["case", "symbol", "candleMin", "normalizedSymbol", "normalizedBunbong", "candidatePids", "status"]
  );

  printQaSummary({
    mode: "data-replay",
    target: {
      uid: config.uid,
      pid: scenario.pid,
      strategyCategory: "GRID",
      symbol: scenario.symbol,
    },
    scenarios: [scenario],
    rowSummary: [{
      scenario: scenario.scenario,
      row: JSON.stringify(scenario.row || {}),
    }],
    reservationSummary: [{
      scenario: scenario.scenario,
      count: 0,
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
