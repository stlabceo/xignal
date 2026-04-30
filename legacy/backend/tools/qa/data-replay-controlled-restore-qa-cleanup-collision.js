"use strict";

const assert = require("assert");
const restoreTool = require("./controlled-restore-qa-cleanup-deleted-pids");
const qaDb = require("./qa-db");
const { writeReportFiles, buildTimestampSlug } = require("./qa-runner");

const scenarios = [];

const runScenario = async (name, fn) => {
  try {
    const evidence = await fn();
    scenarios.push({ scenario: name, status: "PASS", pass: true, evidence });
  } catch (error) {
    scenarios.push({
      scenario: name,
      status: "FAIL",
      pass: false,
      failures: [error?.message || String(error)],
    });
  }
};

const run = async () => {
  const startedAt = new Date().toISOString();

  await runScenario("production signal PID deleted by QA cleanup numeric collision is restorable", async () => {
    const candidates = await restoreTool.buildRestoreCandidates(restoreTool.TARGET_PIDS);
    assert.strictEqual(candidates.length, 10);
    assert.deepStrictEqual(candidates.map((candidate) => candidate.confidence), new Array(10).fill("HIGH"));
    return candidates.map((candidate) => ({
      pid: candidate.pid,
      symbol: candidate.restoreRow.symbol,
      bunbong: candidate.restoreRow.bunbong,
      enabled: candidate.restoreRow.enabled,
      status: candidate.restoreRow.status,
      r_qty: candidate.restoreRow.r_qty,
    }));
  });

  await runScenario("controlled restore dry-run does not mutate target rows", async () => {
    const beforeGate = await restoreTool.checkLocalRestoreGate(restoreTool.TARGET_PIDS);
    const report = await restoreTool.executeRestore({
      dryRun: true,
      checkBinance: false,
    });
    const afterGate = await restoreTool.checkLocalRestoreGate(restoreTool.TARGET_PIDS);
    assert.strictEqual(report.finalStatus, "DRY_RUN_PASS");
    assert.strictEqual(beforeGate.liveRows.length, afterGate.liveRows.length);
    assert.strictEqual(beforeGate.activeReservations.length, afterGate.activeReservations.length);
    return {
      finalStatus: report.finalStatus,
      restoreSourceBlocked: report.gates.restoreSource.blocked.length,
      liveRowsBefore: beforeGate.liveRows.length,
      liveRowsAfter: afterGate.liveRows.length,
    };
  });

  await runScenario("restore blocked for low confidence PID", async () => {
    const candidate = restoreTool.validateRestoreCandidate({
      pid: 991744,
      sourceRow: null,
      auditRows: [],
      forensicEvidence: { hasCleanupCollisionEvidence: false },
    });
    assert.strictEqual(candidate.confidence, "LOW");
    assert(candidate.failures.includes("SOURCE_ROW_MISSING"));
    assert(candidate.failures.includes("CREATE_AUDIT_MISSING"));
    assert(candidate.failures.includes("QA_CLEANUP_COLLISION_EVIDENCE_MISSING"));
    assert.strictEqual(candidate.restoreRow, null);
    return { confidence: candidate.confidence, failures: candidate.failures };
  });

  await runScenario("delete requires explicit USER_DELETE_STRATEGY audit absence", async () => {
    const gate = await restoreTool.checkLocalRestoreGate(restoreTool.TARGET_PIDS);
    assert.strictEqual(gate.deleteAudits.length, 0);
    return { deleteAuditRows: gate.deleteAudits.length };
  });

  const finishedAt = new Date().toISOString();
  const finalStatus = scenarios.every((scenario) => scenario.pass) ? "PASS" : "FAIL";
  const report = {
    reportType: "controlled-restore-qa-cleanup-collision-targeted",
    startedAt,
    finishedAt,
    finalStatus,
    scenarioCount: scenarios.length,
    scenarios,
    cleanup: {
      afterCleanup: 0,
      note: "Dry-run/select-only targeted replay; no QA temp rows and no production rows mutated.",
    },
  };
  const written = writeReportFiles({
    reportType: "qa-controlled-restore-qa-cleanup-collision-targeted",
    runId: `controlled-restore-${buildTimestampSlug(startedAt)}`,
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
