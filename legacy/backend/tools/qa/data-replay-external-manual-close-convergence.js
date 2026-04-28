const { loadQaConfig, parseArgs } = require("./qa-config");
const { closePool, countArtifactRowsForPids, cleanupArtifacts } = require("./qa-db");
const { printTable } = require("./qa-report");
const {
  summarizeLedger,
  summarizeSnapshot,
  resolveReplayUid,
  runGridExternalManualCloseAttributableFill,
  runGridExternalManualCloseCorrectionFallback,
  runGridExternalManualCloseAmbiguousMultiPid,
  runSignalExternalManualCloseThenOffConvergence,
  runExternalCloseWithOrphanProtectionBlocked,
} = require("./qa-scenarios");

const formatScenarioRow = (scenario) => ({
  scenario: scenario.scenario,
  pid: scenario.pid,
  ledger: JSON.stringify(summarizeLedger(scenario.ledgerRows || [])),
  snapshot: JSON.stringify(summarizeSnapshot(scenario.snapshot)),
  reservation: `${(scenario.reservations || []).length}`,
  audit: (scenario.auditLogs || []).join(" || "),
  status: scenario.status,
  failures: (scenario.failures || []).join(" | "),
});

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadQaConfig(args.config || args.c || undefined);
  const resolvedUid = await resolveReplayUid(config.uid);
  const startedAt = new Date().toISOString();

  const scenarioFns = [
    runGridExternalManualCloseAttributableFill,
    runGridExternalManualCloseCorrectionFallback,
    runGridExternalManualCloseAmbiguousMultiPid,
    runSignalExternalManualCloseThenOffConvergence,
    runExternalCloseWithOrphanProtectionBlocked,
  ];

  const scenarios = [];
  const cleanupRows = [];
  for (const scenarioFn of scenarioFns) {
    const result = await scenarioFn({ uid: resolvedUid, cleanup: false });
    const cleanupPids = []
      .concat(result.cleanupPids || [])
      .map((value) => Number(value || 0))
      .filter((value) => value > 0);
    const rowCountsAfterRun = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
    const cleanupResult = cleanupPids.length > 0
      ? await cleanupArtifacts({
          uid: resolvedUid,
          pids: cleanupPids,
          signalIds: cleanupPids,
          gridIds: cleanupPids,
          settleMs: 300,
          passes: 3,
        })
      : { cleaned: false, pids: [] };
    const rowCountsAfterCleanup = await countArtifactRowsForPids({ uid: resolvedUid, pids: cleanupPids });
    const scenario = {
      ...result,
      rowCountsAfterRun,
      rowCountsAfterCleanup,
      cleanup: cleanupResult,
    };
    if (Object.values(rowCountsAfterCleanup).some((value) => Number(value || 0) !== 0)) {
      scenario.pass = false;
      scenario.status = "FAIL";
      scenario.failures = []
        .concat(scenario.failures || [])
        .concat(["cleanup left residual QA rows"]);
    }
    scenarios.push(scenario);
    cleanupRows.push({
      scenario: scenario.scenario,
      pids: cleanupPids.join(","),
      afterCleanup: rowCountsAfterCleanup,
      cleanupStatus: Object.values(rowCountsAfterCleanup).every((value) => Number(value || 0) === 0)
        ? "PASS"
        : "FAIL",
    });
  }

  const finishedAt = new Date().toISOString();
  const finalStatus = scenarios.every((scenario) => scenario.status === "PASS") ? "PASS" : "FAIL";
  const report = {
    startedAt,
    finishedAt,
    uid: resolvedUid,
    scenarios,
    cleanup: cleanupRows,
    finalStatus,
  };

  printTable(
    "External Manual Close Convergence Replay",
    scenarios.map(formatScenarioRow),
    ["scenario", "pid", "ledger", "snapshot", "reservation", "audit", "status", "failures"]
  );
  printTable(
    "Cleanup Verification",
    cleanupRows,
    ["scenario", "pids", "afterCleanup", "cleanupStatus"]
  );
  console.log(JSON.stringify(report, null, 2));
  if (finalStatus !== "PASS") {
    process.exitCode = 1;
  }
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
    process.exit(process.exitCode || 0);
  });
