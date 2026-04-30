"use strict";

const assert = require("assert");
const qaDb = require("./qa-db");
const restoreTool = require("./controlled-restore-qa-cleanup-deleted-pids");
const { writeReportFiles, buildTimestampSlug } = require("./qa-runner");

const scenarios = [];

const runScenario = async (scenario, fn) => {
  try {
    const evidence = await fn();
    scenarios.push({ scenario, status: "PASS", pass: true, evidence });
  } catch (error) {
    scenarios.push({ scenario, status: "FAIL", pass: false, failures: [error?.message || String(error)] });
  }
};

const run = async () => {
  const startedAt = new Date().toISOString();
  const pids = restoreTool.TARGET_PIDS;

  await runScenario("QA cleanup cannot delete production signal PID with numeric collision", async () => {
    const result = await qaDb.cleanupArtifacts({
      uid: restoreTool.TARGET_UID,
      pids,
      signalIds: pids,
      gridIds: pids,
      settleMs: 0,
      passes: 1,
    });
    assert.strictEqual(result.guard, "QA_MARKER_REQUIRED");
    assert(result.blockedPids.length > 0);
    return {
      guard: result.guard,
      blockedPids: result.blockedPids,
      conflictPids: result.conflictPids,
      cleaned: result.cleaned,
    };
  });

  await runScenario("forensic report proves cleanup collision root cause", async () => {
    const evidence = restoreTool.loadForensicEvidence();
    assert.strictEqual(evidence.reportLoaded, true);
    assert.strictEqual(evidence.hasCleanupCollisionEvidence, true);
    assert(evidence.evidenceCount >= 1);
    return evidence;
  });

  await runScenario("target PID family has no user delete audit", async () => {
    const gate = await restoreTool.checkLocalRestoreGate(pids);
    assert.strictEqual(gate.deleteAudits.length, 0);
    return { deleteAudits: gate.deleteAudits.length };
  });

  const finishedAt = new Date().toISOString();
  const finalStatus = scenarios.every((scenario) => scenario.pass) ? "PASS" : "FAIL";
  const report = {
    reportType: "pid-disappearance-forensics-targeted",
    startedAt,
    finishedAt,
    finalStatus,
    scenarioCount: scenarios.length,
    scenarios,
    cleanup: {
      afterCleanup: 0,
      note: "Guard-only replay; cleanupArtifacts is expected to block non-QA production rows.",
    },
  };
  const written = writeReportFiles({
    reportType: "qa-pid-disappearance-forensics-targeted",
    runId: `pid-disappearance-forensics-${buildTimestampSlug(startedAt)}`,
    report,
  });
  console.log(JSON.stringify({
    finalStatus,
    scenarioCount: scenarios.length,
    cleanup: "afterCleanup=0",
    reports: written,
  }, null, 2));
  if (finalStatus !== "PASS") {
    process.exitCode = 1;
  }
};

run()
  .catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await qaDb.closePool();
    process.exit(process.exitCode || 0);
  });
