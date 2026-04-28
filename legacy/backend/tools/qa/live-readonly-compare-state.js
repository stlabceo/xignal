const { loadQaConfig } = require("./qa-config");
const { closePool } = require("./qa-db");
const { printTable, printQaSummary } = require("./qa-report");
const { resolveReadOnlyUid } = require("./qa-db");
const {
  compareAggregateState,
  compareProtectionState,
  detectStaleLocalState,
  detectUnprotectedOpenPositions,
} = require("./qa-live");

const run = async () => {
  const config = loadQaConfig();
  const uid = await resolveReadOnlyUid(config.uid);
  if (!(uid > 0)) {
    throw new Error("QA_READONLY_UID_WITH_KEYS_NOT_FOUND");
  }

  const [aggregateRows, protectionRows, staleRows, unprotectedRows] = await Promise.all([
    compareAggregateState(uid, { compareSymbols: config.compareSymbols }),
    compareProtectionState(uid, { compareSymbols: config.compareSymbols }),
    detectStaleLocalState(uid, { compareSymbols: config.compareSymbols }),
    detectUnprotectedOpenPositions(uid, { compareSymbols: config.compareSymbols }),
  ]);
  const aggregatePass = aggregateRows.every((row) => String(row.risk || "OK").toUpperCase() === "OK");
  const protectionPass = protectionRows.every((row) => String(row.risk || "OK").toUpperCase() === "OK");
  const stalePass = staleRows.length === 0;
  const unprotectedPass = unprotectedRows.length === 0;

  const scenarios = [
    {
      scenario: "live read-only aggregate comparison",
      invariant: "exchange aggregate and local PID sums are compared, not copied",
      pass: aggregatePass,
      failures: aggregatePass
        ? []
        : aggregateRows
            .filter((row) => String(row.risk || "OK").toUpperCase() !== "OK")
            .map((row) => `${row.symbol}:${row.side}:${row.risk}`),
      status: aggregatePass ? "PASS" : "FAIL",
    },
    {
      scenario: "live read-only protection comparison",
      invariant: "protection truth uses exchange active orders plus local ownership",
      pass: protectionPass && stalePass && unprotectedPass,
      failures: []
        .concat(
          protectionPass
            ? []
            : protectionRows
                .filter((row) => String(row.risk || "OK").toUpperCase() !== "OK")
                .map((row) => `${row.pid || "-"}:${row.symbol || "-"}:${row.risk}`)
        )
        .concat(
          stalePass
            ? []
            : staleRows.map((row) => `${row.category}:${row.symbol || "-"}:${row.side || "-"}:${row.risk}`)
        )
        .concat(
          unprotectedPass
            ? []
            : unprotectedRows.map((row) => `${row.pid || "-"}:${row.symbol || "-"}:${row.side || "-"}:${row.risk}`)
        ),
      status: protectionPass && stalePass && unprotectedPass ? "PASS" : "FAIL",
    },
  ];

  printTable(
    "Aggregate Comparison",
    aggregateRows,
    ["uid", "symbol", "side", "binancePositionQty", "localPidOpenQtySum", "diff", "relatedPids", "risk", "note"]
  );
  printTable(
    "Protection Comparison",
    protectionRows,
    ["pid", "symbol", "side", "localReservation", "binanceActiveProtection", "isMatch", "risk", "note"]
  );
  printTable(
    "Stale Local State Detection",
    staleRows.length > 0 ? staleRows : [{ category: "", symbol: "", side: "", pid: "", risk: "none" }],
    ["category", "symbol", "side", "pid", "risk"]
  );
  printTable(
    "Unprotected Open Position Detection",
    unprotectedRows.length > 0 ? unprotectedRows : [{ pid: "", symbol: "", side: "", localOpenQty: "", binancePositionQty: "", localActiveReservationCount: "", binanceActiveProtectionCount: "", risk: "none", note: "" }],
    ["pid", "symbol", "side", "localOpenQty", "binancePositionQty", "localActiveReservationCount", "binanceActiveProtectionCount", "risk", "note"]
  );

  printQaSummary({
    mode: "live-readonly",
    target: {
      uid,
      strategyCategory: config.strategyCategory,
      pid: config.pid,
      symbol: config.symbol,
    },
    scenarios,
    binanceSummary: aggregateRows,
    reservationSummary: protectionRows,
    unprotectedOpenPositions: unprotectedRows,
  });

  if (scenarios.some((scenario) => !scenario.pass)) {
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
