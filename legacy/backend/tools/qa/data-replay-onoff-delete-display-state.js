const { loadQaConfig, parseArgs } = require("./qa-config");
const { closePool } = require("./qa-db");
const { writeReportFiles, buildTimestampSlug } = require("./qa-runner");
const {
  resolveReplayUid,
  runOnOffDeleteAndOrderDisplayStateScenarios,
} = require("./qa-scenarios");

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadQaConfig(args.config || args.c || undefined);
  const uid = await resolveReplayUid(args.uid || config.uid);
  const startedAt = new Date().toISOString();
  const scenarios = await runOnOffDeleteAndOrderDisplayStateScenarios({ uid });
  const finishedAt = new Date().toISOString();
  const finalStatus = scenarios.every((scenario) => scenario.pass) ? "PASS" : "FAIL";
  const report = {
    reportType: "onoff-delete-display-state",
    startedAt,
    finishedAt,
    uid,
    finalStatus,
    scenarios,
    cleanup: {
      cleaned: true,
      pids: [],
      note: "Pure delete-intent and display-state replay; no QA temp rows are created.",
    },
  };

  const written = writeReportFiles({
    reportType: "qa-onoff-delete-display-state-targeted",
    runId: `onoff-delete-display-state-${buildTimestampSlug(startedAt)}`,
    report,
  });

  console.log(JSON.stringify({
    finalStatus,
    uid,
    scenarioCount: scenarios.length,
    cleanup: "PASS",
    reports: written,
  }, null, 2));

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
