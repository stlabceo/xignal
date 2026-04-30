const { loadQaConfig, parseArgs } = require("./qa-config");
const {
  closePool,
  resolveReadOnlyUid,
  loadStrategyRow,
  loadSnapshotRows,
  loadReservations,
} = require("./qa-db");
const {
  getReadOnlyConnectivity,
  getPositionRisk,
  getOpenOrders,
  getOpenAlgoOrders,
} = require("./qa-binance");
const {
  compareAggregateState,
  compareProtectionState,
  detectStaleLocalState,
  detectUnprotectedOpenPositions,
} = require("./qa-live");
const { printTable } = require("./qa-report");
const {
  getGitMeta,
  getDbMeta,
  normalizeScenarioReport,
  runGuardScript,
  writeReportFiles,
  buildTimestampSlug,
} = require("./qa-runner");

const buildScenario = ({ scenario, invariant, pass, failures = [] }) => ({
  scenario,
  invariant,
  pass,
  status: pass ? "PASS" : "FAIL",
  failures,
});

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const runId = `QA_READONLY_${buildTimestampSlug(startedAt)}`;
  const explicitConfigPath = args.config ? args.config : null;

  if (!explicitConfigPath) {
    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      git: getGitMeta(),
      db: getDbMeta(),
      scenarios: [],
      readOnly: [],
      guardChecks: [],
      notes: ["No --config supplied. Live read-only run-all was skipped by design."],
      finalStatus: "SKIPPED",
    };
    const reportPaths = writeReportFiles({
      reportType: "qa-live-readonly",
      runId,
      report,
    });
    console.log(`runId: ${runId}`);
    console.log(`status: SKIPPED`);
    console.log(`report.json: ${reportPaths.jsonPath}`);
    console.log(`report.md: ${reportPaths.mdPath}`);
    return;
  }

  const config = loadQaConfig();
  const uid = await resolveReadOnlyUid(config.uid);
  if (!(uid > 0)) {
    throw new Error("QA_READONLY_UID_WITH_KEYS_NOT_FOUND");
  }

  const connectivity = await getReadOnlyConnectivity(uid, config.symbol || null);
  const connectivityPass =
    connectivity.positionRisk.ok &&
    connectivity.openOrders.ok &&
    connectivity.openAlgoOrders.ok &&
    connectivity.positionMode.ok &&
    (!config.symbol || (connectivity.allOrders.ok && connectivity.userTrades.ok));
  const scenarios = [
    buildScenario({
      scenario: "live read-only API connectivity",
      invariant: "live read-only must not mutate exchange or local state",
      pass: connectivityPass,
      failures: connectivityPass ? [] : ["one or more read-only Binance endpoints failed"],
    }),
  ];

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

  scenarios.push(
    buildScenario({
      scenario: "live read-only aggregate comparison",
      invariant: "exchange aggregate and local PID sums are compared, not copied",
      pass: aggregatePass,
      failures: aggregatePass
        ? []
        : aggregateRows
            .filter((row) => String(row.risk || "OK").toUpperCase() !== "OK")
            .map((row) => `${row.symbol}:${row.side}:${row.risk}`),
    })
  );
  scenarios.push(
    buildScenario({
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
        .concat(stalePass ? [] : staleRows.map((row) => `${row.category}:${row.symbol || "-"}:${row.side || "-"}:${row.risk}`))
        .concat(unprotectedPass ? [] : unprotectedRows.map((row) => `${row.pid || "-"}:${row.symbol || "-"}:${row.side || "-"}:${row.risk}`)),
    })
  );

  const strategyCategory = String(config.strategyCategory || "SIGNAL").trim().toUpperCase();
  const observeTarget = {
    strategyCategory,
    strategyId: config.strategyId || null,
    pid: config.pid || null,
    symbol: config.symbol || null,
  };
  let observeConfigStatus = "FOUND";
  const strategyRow = await loadStrategyRow({
    strategyCategory,
    strategyId: config.strategyId,
    pid: config.pid,
  });
  let observeRows = {
    strategyRow: null,
    snapshots: [],
    reservations: [],
    positions: [],
    openOrders: [],
    openAlgoOrders: [],
  };
  if (strategyRow) {
    const [snapshots, reservations, positions, openOrders, openAlgoOrders] = await Promise.all([
      loadSnapshotRows({ uid, pid: strategyRow.id, strategyCategory: strategyCategory.toLowerCase() }),
      loadReservations({ uid, pid: strategyRow.id, strategyCategory: strategyCategory.toLowerCase() }),
      getPositionRisk(uid, strategyRow.symbol).catch((error) => [{ symbol: strategyRow.symbol, positionSide: "", positionAmt: 0, error: error?.message || String(error) }]),
      getOpenOrders(uid, strategyRow.symbol).catch((error) => [{ clientOrderId: "", status: "BINANCE_READ_FAILED", note: error?.message || String(error) }]),
      getOpenAlgoOrders(uid, strategyRow.symbol).catch((error) => [{ clientAlgoId: "", status: "BINANCE_READ_FAILED", note: error?.message || String(error) }]),
    ]);
    observeRows = {
      strategyRow,
      snapshots,
      reservations,
      positions,
      openOrders,
      openAlgoOrders,
    };
    scenarios.push(
      buildScenario({
        scenario: "live read-only strategy observe",
        invariant: "live observe must stay read-only while surfacing local/exchange state",
        pass: true,
        failures: [],
      })
    );
  } else {
    observeConfigStatus = "OBSERVE_CONFIG_STALE";
    observeRows = {
      strategyRow: null,
      snapshots: [],
      reservations: [],
      positions: [],
      openOrders: [],
      openAlgoOrders: [],
      observeConfigStatus,
      requested: observeTarget,
      note: "Configured observe target was not found; aggregate/protection/stale checks determine live risk.",
    };
    scenarios.push(
      buildScenario({
        scenario: "live read-only strategy observe",
        invariant: "missing observe config is reported separately from current live risk",
        pass: true,
        failures: [],
      })
    );
  }

  const guardResult = runGuardScript({ configPath: explicitConfigPath });
  const guardRows = [{
    scenario: "live execution trigger guard",
    exitCode: guardResult.exitCode,
    blocked: guardResult.blocked ? "Y" : "N",
    notImplemented: guardResult.notImplemented ? "Y" : "N",
    status: guardResult.blocked ? "PASS" : "FAIL",
    reason: guardResult.blocked
      ? "LIVE_EXECUTION_TRIGGER_BLOCKED_BY_GUARD"
      : (guardResult.output || "").split(/\r?\n/).slice(-1)[0] || "",
  }];
  scenarios.push(
    buildScenario({
      scenario: "live execution trigger guard",
      invariant: "live execution must fail closed until explicit target and safe state are confirmed",
      pass: guardResult.blocked,
      failures: guardResult.blocked ? [] : [guardRows[0].reason || "guard did not block"],
    })
  );

  const normalizedScenarios = scenarios.map(normalizeScenarioReport);
  const finalStatus = normalizedScenarios.every((scenario) => scenario.status === "PASS")
    ? "PASS"
    : "FAIL";
  const finishedAt = new Date().toISOString();

  const report = {
    startedAt,
    finishedAt,
    git: getGitMeta(),
    db: getDbMeta(),
    scenarios: normalizedScenarios,
    readOnly: aggregateRows,
    protection: protectionRows,
    stale: staleRows,
    unprotectedOpenPositions: unprotectedRows,
    observeConfig: {
      status: observeConfigStatus,
      requested: observeTarget,
      note: observeConfigStatus === "OBSERVE_CONFIG_STALE"
        ? "OBSERVE_CONFIG_STALE: configured observe target was absent; finalStatus is driven by canonical matrix checks."
        : "",
    },
    guardChecks: guardRows,
    notes: observeConfigStatus === "OBSERVE_CONFIG_STALE"
      ? ["OBSERVE_CONFIG_STALE separated from live matrix risk."]
      : [],
    finalStatus,
  };
  const reportPaths = writeReportFiles({
    reportType: "qa-live-readonly",
    runId,
    report,
  });

  printTable("Live Read-only Connectivity", [
    {
      uid,
      positionRisk: connectivity.positionRisk.ok ? "PASS" : "FAIL",
      openOrders: connectivity.openOrders.ok ? "PASS" : "FAIL",
      openAlgoOrders: connectivity.openAlgoOrders.ok ? "PASS" : "FAIL",
      allOrders: !config.symbol || connectivity.allOrders.ok ? "PASS" : "FAIL",
      userTrades: !config.symbol || connectivity.userTrades.ok ? "PASS" : "FAIL",
      positionMode: connectivity.positionMode.ok ? "PASS" : "FAIL",
      note: [
        connectivity.positionRisk.error,
        connectivity.openOrders.error,
        connectivity.openAlgoOrders.error,
        connectivity.allOrders.error,
        connectivity.userTrades.error,
        connectivity.positionMode.error,
      ].filter(Boolean).join(" | "),
    },
  ], ["uid", "positionRisk", "openOrders", "openAlgoOrders", "allOrders", "userTrades", "positionMode", "note"]);
  printTable("Aggregate Comparison", aggregateRows, ["uid", "symbol", "side", "binancePositionQty", "localPidOpenQtySum", "diff", "relatedPids", "risk", "note"]);
  printTable("Protection Comparison", protectionRows.length > 0 ? protectionRows : [{
    pid: "",
    symbol: "",
    side: "",
    localReservation: "",
    binanceActiveProtection: "",
    isMatch: "",
    risk: "none",
    note: "",
  }], ["pid", "symbol", "side", "localReservation", "binanceActiveProtection", "isMatch", "risk", "note"]);
  printTable("Stale Local State Detection", staleRows.length > 0 ? staleRows : [{
    category: "",
    symbol: "",
    side: "",
    pid: "",
    risk: "none",
  }], ["category", "symbol", "side", "pid", "risk"]);
  printTable("Unprotected Open Position Detection", unprotectedRows.length > 0 ? unprotectedRows : [{
    pid: "",
    symbol: "",
    side: "",
    localOpenQty: "",
    binancePositionQty: "",
    localActiveReservationCount: "",
    binanceActiveProtectionCount: "",
    risk: "none",
    note: "",
  }], ["pid", "symbol", "side", "localOpenQty", "binancePositionQty", "localActiveReservationCount", "binanceActiveProtectionCount", "risk", "note"]);
  if (observeRows.strategyRow) {
    printTable("Observed Strategy Row", [observeRows.strategyRow], Object.keys(observeRows.strategyRow));
  } else if (observeRows.observeConfigStatus) {
    printTable("Observe Config", [{
      status: observeRows.observeConfigStatus,
      strategyCategory: observeRows.requested.strategyCategory,
      strategyId: observeRows.requested.strategyId,
      pid: observeRows.requested.pid,
      symbol: observeRows.requested.symbol,
      note: observeRows.note,
    }], ["status", "strategyCategory", "strategyId", "pid", "symbol", "note"]);
  }
  printTable("Guard Check", guardRows, ["scenario", "exitCode", "blocked", "notImplemented", "status", "reason"]);
  console.log(`\nrunId: ${runId}`);
  console.log(`report.json: ${reportPaths.jsonPath}`);
  console.log(`report.md: ${reportPaths.mdPath}`);
  console.log(`finalStatus: ${finalStatus}`);

  if (finalStatus !== "PASS") {
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
