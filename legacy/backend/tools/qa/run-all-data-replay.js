const fs = require("fs");
const path = require("path");

process.env.QA_REPLAY_MODE = process.env.QA_REPLAY_MODE || "1";
process.env.QA_DISABLE_BINANCE_WRITES = process.env.QA_DISABLE_BINANCE_WRITES || "1";

const { installQaReplayNetworkFirewall } = require("./qa-network-firewall");
const qaReplayFirewall = installQaReplayNetworkFirewall();
console.log(
  `[QA_REPLAY_SAFETY] mode=data-replay, binanceWrites=blocked, networkFirewall=${qaReplayFirewall.installed ? "ON" : "OFF"}`
);

const { loadQaConfig, parseArgs } = require("./qa-config");
const {
  closePool,
  countArtifactRowsForPids,
  cleanupArtifacts,
  findQaTempPidsByUid,
  loadQaTempArtifactRows,
} = require("./qa-db");
const { printTable } = require("./qa-report");
const {
  summarizeLedger,
  summarizeSnapshot,
  resolveReplayUid,
  runSamePidDuplicateGridEntry,
  runSamePidDuplicateSignalEntry,
  runDuplicateExit,
  runDifferentPidSameSymbolSide,
  runPartialFillDistinctTradeIds,
  runSignalEntryRecoveryPartialFill,
  runSignalSplitTpMultiFillExitAccounting,
  runSignalTimeExitFillRecovery,
  runSignalTimeExitSiblingProtectionLifecycle,
  runSignalTimeExitPartialFill,
  runSplitTpPartialClose,
  runGridMultiTradeEntryPreservation,
  runGridMultiTradeExitPreservation,
  runLiveReadonlyDetectsSixPositionsEightConditionalsProtectionShortage,
  runGridDuplicateExitRecoveryDoesNotCancelCurrentProtection,
  runSignalEntryPartiallyFilledThenCanceled,
  runGridEntryPartiallyFilledThenExpired,
  runPartialFillStateMachineExpectedTransitions,
  runOrderStatusStateMachineFinalizationScenarios,
  runOnOffDeleteAndOrderDisplayStateScenarios,
  runCrossPidOwnershipGuard,
  runGridReservationOwnedStopFillRecovery,
  runSignalRecoveredCloseViaTruthSync,
  runGridRecoveredCloseViaReconcile,
  runGridExternalManualCloseAttributableFill,
  runGridExternalManualCloseCorrectionFallback,
  runGridExternalManualCloseAmbiguousMultiPid,
  runSignalExternalManualCloseThenOffConvergence,
  runExternalCloseWithOrphanProtectionBlocked,
  runSignalLocalStaleFlatten,
  runGridLocalStaleFlatten,
  runGridWebhookTimeframeAliasNormalization,
  runSignalStrategyAliasInternalCodeMapping,
  runSignalForceOffRuntimeReadySnapshotOpen,
  runSignalForceOffCloseFailureKeepsProtection,
  runSignalForceOffNormalCloseSequencing,
  runLiveReadonlyDetectsUnprotectedOpenPosition,
  runLiveReadonlyDetectsLocalCanceledBinanceActiveOrder,
  runLiveReadonlyDetectsBinanceOpenLocalFlat,
  runLiveReadonlyDetectsOrphanCloseOrderForFlatSide,
  runLiveReadonlyDetectsOversizedProtectionVsPosition,
  runCrossPidOverfillGuardWithTpGmanual,
  runDirectOrphanFlatten,
  runCorrectionPnlIntegrity,
} = require("./qa-scenarios");
const {
  buildTimestampSlug,
  getGitMeta,
  getDbMeta,
  buildRangeLabel,
  normalizeScenarioReport,
  runNodeChecks,
  writeReportFiles,
} = require("./qa-runner");

const QA_DIR = __dirname;
const ROOT_DIR = path.resolve(QA_DIR, "../../../..");

const formatRowSummary = (scenario) => {
  if (scenario.strategyCategory === "mixed") {
    return scenario.row || {};
  }

  if (scenario.strategyCategory === "grid") {
    return {
      regimeStatus: scenario.row?.regimeStatus || null,
      longLegStatus: scenario.row?.longLegStatus || null,
      shortLegStatus: scenario.row?.shortLegStatus || null,
      longQty: Number(scenario.row?.longQty || 0),
      shortQty: Number(scenario.row?.shortQty || 0),
    };
  }

  return {
    status: scenario.row?.status || null,
    r_qty: Number(scenario.row?.r_qty || 0),
    r_exactPrice: Number(scenario.row?.r_exactPrice || 0),
  };
};

const collectNodeCheckTargets = () => {
  const qaFiles = fs
    .readdirSync(QA_DIR)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(QA_DIR, name));
  return qaFiles.concat([
    path.resolve(QA_DIR, "../../routes/admin.js"),
    path.resolve(QA_DIR, "../../routes/users.js"),
    path.resolve(QA_DIR, "../../routes/validation.js"),
    path.resolve(QA_DIR, "../../signal-strategy-identity.js"),
    path.resolve(QA_DIR, "../../signal-force-off-control.js"),
    path.resolve(QA_DIR, "../../order-display-state.js"),
    path.resolve(QA_DIR, "../../strategy-delete-intent.js"),
    path.resolve(QA_DIR, "../../coin.js"),
    path.resolve(QA_DIR, "../../grid-engine.js"),
    path.resolve(QA_DIR, "../../pid-position-ledger.js"),
    path.resolve(QA_DIR, "../../seon.js"),
  ]);
};

const buildFailureScenario = ({ scriptName, scenarioName, invariant, error, uid, cleanupPids = [], rowCountsBefore = null, rowCountsAfterRun = null, rowCountsAfterCleanup = null, cleanupResult = null }) => ({
  scenario: scenarioName,
  invariant,
  pass: false,
  status: "FAIL",
  failures: [error?.stack || error?.message || String(error)],
  scriptName,
  uid,
  pid: cleanupPids.join(","),
  symbol: null,
  strategyCategory: null,
  cleanupPids,
  rowCountsBefore,
  rowCountsAfterRun,
  rowCountsAfterCleanup,
  cleanup: cleanupResult,
  ledgerRows: [],
  snapshot: null,
  row: null,
  reservations: [],
  msgList: [],
  auditLogs: [],
});

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadQaConfig();
  const continueOnFail = String(args["continueOnFail"] || args["continue-on-fail"] || "true").trim().toLowerCase() !== "false";
  const resolvedUid = await resolveReplayUid(config.uid);
  const startedAt = new Date().toISOString();
  const runId = `${config.qaRunLabel || "QA_RUN"}_${buildTimestampSlug(startedAt)}`;
  const globalCleanupPids = new Set();

  const preExistingTempPids = await findQaTempPidsByUid(resolvedUid);
  const preExistingTempCounts = await countArtifactRowsForPids({ uid: resolvedUid, pids: preExistingTempPids });

  const syntaxChecks = runNodeChecks(collectNodeCheckTargets());
  const syntaxPass = syntaxChecks.every((item) => item.status === "PASS");
  const scenarioDefinitions = [
    {
      scriptName: "data-replay-ledger-dedupe.js",
      run: async () => ([
        await runSamePidDuplicateGridEntry({ uid: resolvedUid, cleanup: false }),
        await runSamePidDuplicateSignalEntry({ uid: resolvedUid, cleanup: false }),
        await runDuplicateExit({ uid: resolvedUid, cleanup: false }),
        await runDifferentPidSameSymbolSide({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-partial-fill.js",
      run: async () => ([
        await runPartialFillDistinctTradeIds({ uid: resolvedUid, cleanup: false }),
        await runSignalEntryRecoveryPartialFill({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-protection-shortage-partial-state-machine.js",
      run: async () => ([
        await runLiveReadonlyDetectsSixPositionsEightConditionalsProtectionShortage({ uid: resolvedUid, cleanup: false }),
        await runGridDuplicateExitRecoveryDoesNotCancelCurrentProtection({ uid: resolvedUid, cleanup: false }),
        await runSignalEntryPartiallyFilledThenCanceled({ uid: resolvedUid, cleanup: false }),
        await runGridEntryPartiallyFilledThenExpired({ uid: resolvedUid, cleanup: false }),
        await runPartialFillStateMachineExpectedTransitions({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-order-status-state-machine.js",
      run: async () => runOrderStatusStateMachineFinalizationScenarios({ uid: resolvedUid }),
    },
    {
      scriptName: "data-replay-onoff-delete-display-state.js",
      run: async () => runOnOffDeleteAndOrderDisplayStateScenarios({ uid: resolvedUid }),
    },
    {
      scriptName: "data-replay-signal-split-tp-exit-multifill.js",
      run: async () => ([
        await runSignalSplitTpMultiFillExitAccounting({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-signal-time-exit-recovery.js",
      run: async () => ([
        await runSignalTimeExitFillRecovery({ uid: resolvedUid, cleanup: false }),
        await runSignalTimeExitSiblingProtectionLifecycle({ uid: resolvedUid, cleanup: false }),
        await runSignalTimeExitPartialFill({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-split-tp.js",
      run: async () => ([
        await runSplitTpPartialClose({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-grid-multitrade-fill-units.js",
      run: async () => ([
        await runGridMultiTradeEntryPreservation({ uid: resolvedUid, cleanup: false }),
        await runGridMultiTradeExitPreservation({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-cross-pid-ownership-guard.js",
      run: async () => ([
        await runCrossPidOwnershipGuard({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-grid-reservation-owned-exit-recovery.js",
      run: async () => ([
        await runGridReservationOwnedStopFillRecovery({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-external-manual-close-convergence.js",
      run: async () => ([
        await runGridExternalManualCloseAttributableFill({ uid: resolvedUid, cleanup: false }),
        await runGridExternalManualCloseCorrectionFallback({ uid: resolvedUid, cleanup: false }),
        await runGridExternalManualCloseAmbiguousMultiPid({ uid: resolvedUid, cleanup: false }),
        await runSignalExternalManualCloseThenOffConvergence({ uid: resolvedUid, cleanup: false }),
        await runExternalCloseWithOrphanProtectionBlocked({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-grid-timeframe-alias-normalization.js",
      run: async () => ([
        await runGridWebhookTimeframeAliasNormalization({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-signal-strategy-alias-internal-code.js",
      run: async () => ([
        await runSignalStrategyAliasInternalCodeMapping({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-signal-force-off-close-sequencing.js",
      run: async () => ([
        await runSignalForceOffRuntimeReadySnapshotOpen({ uid: resolvedUid, cleanup: false }),
        await runSignalForceOffCloseFailureKeepsProtection({ uid: resolvedUid, cleanup: false }),
        await runSignalForceOffNormalCloseSequencing({ uid: resolvedUid, cleanup: false }),
        await runLiveReadonlyDetectsUnprotectedOpenPosition({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-ownership-protection-lifecycle.js",
      run: async () => ([
        await runLiveReadonlyDetectsLocalCanceledBinanceActiveOrder({ uid: resolvedUid, cleanup: false }),
        await runLiveReadonlyDetectsBinanceOpenLocalFlat({ uid: resolvedUid, cleanup: false }),
        await runLiveReadonlyDetectsOrphanCloseOrderForFlatSide({ uid: resolvedUid, cleanup: false }),
        await runLiveReadonlyDetectsOversizedProtectionVsPosition({ uid: resolvedUid, cleanup: false }),
        await runCrossPidOverfillGuardWithTpGmanual({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-reconcile-flat.js",
      run: async () => ([
        await runSignalRecoveredCloseViaTruthSync({ uid: resolvedUid, cleanup: false }),
        await runGridRecoveredCloseViaReconcile({ uid: resolvedUid, cleanup: false }),
      ]),
    },
    {
      scriptName: "data-replay-orphan-flatten.js",
      run: async () => ([
        await runSignalLocalStaleFlatten({ uid: resolvedUid, cleanup: false }),
        await runGridLocalStaleFlatten({ uid: resolvedUid, cleanup: false }),
        await runDirectOrphanFlatten({ uid: resolvedUid, cleanup: false }),
        await runCorrectionPnlIntegrity({ uid: resolvedUid, cleanup: false }),
      ]),
    },
  ];

  const scenarios = [];
  const cleanupRows = [];
  const notes = [];

  if (!syntaxPass) {
    notes.push("Node syntax check failed; data replay scenarios were skipped.");
  } else {
    if (preExistingTempPids.length > 0) {
      const preRunCleanup = await cleanupArtifacts({
        uid: resolvedUid,
        pids: preExistingTempPids,
        signalIds: preExistingTempPids,
        gridIds: preExistingTempPids,
        settleMs: 300,
        passes: 3,
      });
      const preRunCountsAfterCleanup = await countArtifactRowsForPids({ uid: resolvedUid, pids: preExistingTempPids });
      notes.push(
        `Pre-run QA temp sweep removed existing QA_% rows: pids=${buildRangeLabel(preExistingTempPids)}, countsBefore=${JSON.stringify(preExistingTempCounts)}, countsAfter=${JSON.stringify(preRunCountsAfterCleanup)}, cleaned=${preRunCleanup.cleaned}`
      );
    }

    for (const definition of scenarioDefinitions) {
      try {
        const results = await definition.run();
        for (const result of results) {
          const cleanupPids = [].concat(result.cleanupPids || []).map((value) => Number(value || 0)).filter((value) => value > 0);
          cleanupPids.forEach((value) => globalCleanupPids.add(value));
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
            scriptName: definition.scriptName,
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
            tempPidRange: buildRangeLabel(cleanupPids),
            before: scenario.rowCountsBefore,
            afterRun: rowCountsAfterRun,
            afterCleanup: rowCountsAfterCleanup,
            cleanupStatus: Object.values(rowCountsAfterCleanup).every((value) => Number(value || 0) === 0)
              ? "PASS"
              : "FAIL",
          });

          if (!scenario.pass && !continueOnFail) {
            notes.push(`Stopped after ${scenario.scenario} because continue-on-fail=false.`);
            break;
          }
        }
        if (!continueOnFail && scenarios.some((scenario) => !scenario.pass)) {
          break;
        }
      } catch (error) {
        const leftoverPids = await findQaTempPidsByUid(resolvedUid);
        leftoverPids.forEach((value) => globalCleanupPids.add(value));
        const rowCountsAfterRun = await countArtifactRowsForPids({ uid: resolvedUid, pids: leftoverPids });
        const cleanupResult = leftoverPids.length > 0
          ? await cleanupArtifacts({
              uid: resolvedUid,
              pids: leftoverPids,
              signalIds: leftoverPids,
              gridIds: leftoverPids,
              settleMs: 300,
              passes: 3,
            })
          : { cleaned: false, pids: [] };
        const rowCountsAfterCleanup = await countArtifactRowsForPids({ uid: resolvedUid, pids: leftoverPids });
        const failed = buildFailureScenario({
          scriptName: definition.scriptName,
          scenarioName: `${definition.scriptName} :: unhandled`,
          invariant: "data replay harness should fail closed and keep cleanup auditable",
          error,
          uid: resolvedUid,
          cleanupPids: leftoverPids,
          rowCountsBefore: null,
          rowCountsAfterRun,
          rowCountsAfterCleanup,
          cleanupResult,
        });
        scenarios.push(failed);
        cleanupRows.push({
          scenario: failed.scenario,
          tempPidRange: buildRangeLabel(leftoverPids),
          before: failed.rowCountsBefore,
          afterRun: rowCountsAfterRun,
          afterCleanup: rowCountsAfterCleanup,
          cleanupStatus: Object.values(rowCountsAfterCleanup).every((value) => Number(value || 0) === 0)
            ? "PASS"
            : "FAIL",
        });
        if (!continueOnFail) {
          notes.push(`Stopped after ${definition.scriptName} because continue-on-fail=false and an unhandled error occurred.`);
          break;
        }
      }
    }
  }

  const finalSweepPids = Array.from(globalCleanupPids);
  if (syntaxPass && finalSweepPids.length > 0) {
    const finalSweepResult = await cleanupArtifacts({
      uid: resolvedUid,
      pids: finalSweepPids,
      signalIds: finalSweepPids,
      gridIds: finalSweepPids,
      registeredQaPids: finalSweepPids,
      settleMs: 300,
      passes: 3,
    });
    const finalSweepResidual = await loadQaTempArtifactRows({ uid: resolvedUid, pids: finalSweepPids });
    notes.push(
      `Final QA sweep: pids=${buildRangeLabel(finalSweepPids)}, cleaned=${finalSweepResult.cleaned}, residualSignals=${(finalSweepResidual.live_play_list || []).length}, residualGrids=${(finalSweepResidual.live_grid_strategy_list || []).length}, residualMsgs=${(finalSweepResidual.msg_list || []).length}`
    );
  }

  const finalTempPids = await findQaTempPidsByUid(resolvedUid);
  const finalTempCounts = await countArtifactRowsForPids({ uid: resolvedUid, pids: finalTempPids });
  const normalizedScenarios = scenarios.map(normalizeScenarioReport);
  const finalStatus = syntaxPass && normalizedScenarios.every((scenario) => scenario.status === "PASS")
    ? "PASS"
    : "FAIL";
  const finishedAt = new Date().toISOString();

  const report = {
    startedAt,
    finishedAt,
    git: getGitMeta(),
    db: getDbMeta(),
    continueOnFail,
    syntaxChecks,
    scenarios: normalizedScenarios,
    cleanup: cleanupRows,
    initialTempPidRange: buildRangeLabel(preExistingTempPids),
    finalTempPidRange: buildRangeLabel(finalTempPids),
    initialTempCounts: preExistingTempCounts,
    finalTempCounts,
    tempUid: resolvedUid,
    tempPidRange: buildRangeLabel(
      normalizedScenarios.flatMap((scenario) => scenario.cleanupPids || [])
    ),
    notes,
    finalStatus,
  };
  const reportPaths = writeReportFiles({
    reportType: "qa",
    runId,
    report,
  });

  printTable(
    "Node Check",
    syntaxChecks,
    ["file", "status", "error"]
  );
  printTable(
    "Data Replay Run-all",
    scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      script: scenario.scriptName,
      ledger: JSON.stringify(summarizeLedger(scenario.ledgerRows || [])),
      snapshot: JSON.stringify(summarizeSnapshot(scenario.snapshot)),
      row: JSON.stringify(formatRowSummary(scenario)),
      reservation: `${(scenario.reservations || []).length}`,
      audit:
        (scenario.auditLogs || []).join(" || ")
        || (scenario.msgList || []).map((item) => `${item.code}:${item.fun}`).join(" || "),
      status: scenario.status,
    })),
    ["scenario", "script", "ledger", "snapshot", "row", "reservation", "audit", "status"]
  );
  printTable(
    "Cleanup Verification",
    cleanupRows,
    ["scenario", "tempPidRange", "before", "afterRun", "afterCleanup", "cleanupStatus"]
  );
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
