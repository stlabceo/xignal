const { loadQaConfig } = require("./qa-config");
const { closePool } = require("./qa-db");
const { printTable, printQaSummary } = require("./qa-report");
const { resolveReadOnlyUid } = require("./qa-db");
const { getReadOnlyConnectivity } = require("./qa-binance");

const run = async () => {
  const config = loadQaConfig();
  const uid = await resolveReadOnlyUid(config.uid);
  if (!(uid > 0)) {
    throw new Error("QA_READONLY_UID_WITH_KEYS_NOT_FOUND");
  }

  const connectivity = await getReadOnlyConnectivity(uid, config.symbol || null);
  const scenarios = [
    {
      scenario: "live read-only API connectivity",
      invariant: "live read-only must not mutate exchange or local state",
      pass:
        connectivity.positionRisk.ok
        && connectivity.openOrders.ok
        && connectivity.openAlgoOrders.ok
        && connectivity.positionMode.ok
        && (!config.symbol || (connectivity.allOrders.ok && connectivity.userTrades.ok)),
      failures: [],
      status: "",
    },
  ];
  scenarios[0].status = scenarios[0].pass ? "PASS" : "FAIL";
  if (!scenarios[0].pass) {
    scenarios[0].failures.push("one or more read-only Binance endpoints failed");
  }

  const rows = [
    {
      item: "uid-api-connectivity",
      expected: "connected",
      actual: connectivity.positionRisk.ok ? "connected" : "failed",
      status: connectivity.positionRisk.ok ? "PASS" : "FAIL",
      note: connectivity.positionRisk.error || "",
    },
    {
      item: "futures-position-risk",
      expected: "readable",
      actual: connectivity.positionRisk.count,
      status: connectivity.positionRisk.ok ? "PASS" : "FAIL",
      note: connectivity.positionRisk.error || "",
    },
    {
      item: "open-orders",
      expected: "readable",
      actual: connectivity.openOrders.count,
      status: connectivity.openOrders.ok ? "PASS" : "FAIL",
      note: connectivity.openOrders.error || "",
    },
    {
      item: "open-algo-orders",
      expected: "readable",
      actual: connectivity.openAlgoOrders.count,
      status: connectivity.openAlgoOrders.ok ? "PASS" : "FAIL",
      note: connectivity.openAlgoOrders.error || "",
    },
    {
      item: "all-orders",
      expected: config.symbol ? "readable" : "symbol required",
      actual: config.symbol ? connectivity.allOrders.count : "skipped",
      status: config.symbol ? (connectivity.allOrders.ok ? "PASS" : "FAIL") : "PASS",
      note: connectivity.allOrders.error || "",
    },
    {
      item: "user-trades",
      expected: config.symbol ? "readable" : "symbol required",
      actual: config.symbol ? connectivity.userTrades.count : "skipped",
      status: config.symbol ? (connectivity.userTrades.ok ? "PASS" : "FAIL") : "PASS",
      note: connectivity.userTrades.error || "",
    },
    {
      item: "position-mode",
      expected: "hedge mode",
      actual: connectivity.positionMode.value,
      status:
        connectivity.positionMode.ok
        && String(connectivity.positionMode.value).trim().toLowerCase() === "true"
          ? "PASS"
          : "FAIL",
      note: connectivity.positionMode.error || "",
    },
  ];

  printTable("Live Read-only Preflight", rows, ["item", "expected", "actual", "status", "note"]);
  printQaSummary({
    mode: "live-readonly",
    target: {
      uid,
      strategyCategory: config.strategyCategory,
      pid: config.pid,
      symbol: config.symbol,
    },
    scenarios,
    binanceSummary: rows,
  });

  if (!scenarios[0].pass) {
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
