const { loadQaConfig, parseArgs } = require("./qa-config");
const { closePool, cleanupArtifacts } = require("./qa-db");
const { writeReportFiles, buildTimestampSlug } = require("./qa-runner");
const {
  resolveReplayUid,
  runSignalTimeExitFillRecovery,
  runSignalTimeExitSiblingProtectionLifecycle,
  runSignalTimeExitPartialFill,
} = require("./qa-scenarios");

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadQaConfig();
  const uid = await resolveReplayUid(args.uid || config.uid);
  const startedAt = new Date().toISOString();
  const scenarios = [];

  scenarios.push(await runSignalTimeExitFillRecovery({ uid, cleanup: false }));
  scenarios.push(await runSignalTimeExitSiblingProtectionLifecycle({ uid, cleanup: false }));
  scenarios.push(await runSignalTimeExitPartialFill({ uid, cleanup: false }));

  const cleanupPids = Array.from(new Set(
    scenarios.flatMap((scenario) => scenario.cleanupPids || [])
  ));
  const cleanup = cleanupPids.length > 0
    ? await cleanupArtifacts({
        uid,
        pids: cleanupPids,
        signalIds: cleanupPids,
        gridIds: cleanupPids,
        settleMs: 300,
        passes: 3,
      })
    : { cleaned: true };
  const finishedAt = new Date().toISOString();
  const finalStatus = scenarios.every((scenario) => scenario.pass) && cleanup.cleaned ? "PASS" : "FAIL";
  const report = {
    reportType: "signal-time-exit-recovery",
    startedAt,
    finishedAt,
    uid,
    finalStatus,
    scenarios,
    cleanup,
  };

  const written = writeReportFiles({
    reportType: "qa-signal-time-exit-targeted",
    runId: `signal-time-exit-${buildTimestampSlug(startedAt)}`,
    report,
  });

  console.log(JSON.stringify({
    finalStatus,
    uid,
    scenarioCount: scenarios.length,
    cleanup: cleanup.cleaned ? "PASS" : "FAIL",
    reports: written,
  }, null, 2));

  if(finalStatus !== "PASS"){
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
