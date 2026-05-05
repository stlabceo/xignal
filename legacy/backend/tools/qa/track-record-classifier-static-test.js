const assert = require("assert");
const classifier = require("../../track-record-classifier");

const assertEqual = (actual, expected, message) => {
  assert.strictEqual(actual, expected, `${message}: expected ${expected}, got ${actual}`);
};

const pid10EntryFail = classifier.classifyTrackRecordRow({
  pid: 10,
  strategyCategory: "signal",
  completed: true,
  processStatus: "ABNORMAL",
  targetResultCode: "ENTERED_PENDING",
  currentStepLabel: "runtime EXACT_WAIT",
  problemDetail: "dispatch-timeout ENTRY_FAIL",
  ledgerFillCount: 0,
  entryLedgerCount: 0,
  exitLedgerCount: 0,
  algorithmMeta: {
    actualEntryNotional: null,
    realizedPnl: 0,
  },
});
assertEqual(pid10EntryFail.bucket, "review", "PID10 ENTRY_FAIL bucket");
assertEqual(pid10EntryFail.needsReview, true, "PID10 ENTRY_FAIL needs review");
assertEqual(pid10EntryFail.result, "REVIEW", "PID10 ENTRY_FAIL result");

const fakeBreakeven = classifier.classifyTrackRecordRow({
  pid: 9,
  strategyCategory: "grid",
  completed: true,
  processStatus: "NORMAL",
  ledgerFillCount: 1,
  entryLedgerCount: 1,
  exitLedgerCount: 0,
  gridMeta: {
    currentRegimeRealizedPnl: 0,
    actualEntryNotional: null,
  },
});
assertEqual(fakeBreakeven.bucket, "review", "no-exit/no-denominator grid row bucket");
assertEqual(fakeBreakeven.result, "REVIEW", "no-exit/no-denominator grid row result");

const trueBreakeven = classifier.classifyTrackRecordRow({
  pid: 5,
  strategyCategory: "grid",
  completed: true,
  processStatus: "NORMAL",
  ledgerFillCount: 2,
  entryLedgerCount: 1,
  exitLedgerCount: 1,
  gridMeta: {
    currentRegimeRealizedPnl: 0,
    actualEntryNotional: 100,
  },
});
assertEqual(trueBreakeven.bucket, "completed", "true breakeven bucket");
assertEqual(trueBreakeven.result, "BREAKEVEN", "true breakeven result");
assertEqual(trueBreakeven.performanceEligible, true, "true breakeven performance eligibility");

const activePending = classifier.classifyTrackRecordRow({
  pid: 9,
  strategyCategory: "grid",
  completed: false,
  processStatus: "ACTIVE",
  activeEntryOrderCount: 1,
  currentPositionQty: 0,
});
assertEqual(activePending.bucket, "active", "pending active entry bucket");
assertEqual(activePending.result, "OPEN", "pending active entry result");

const reconciledUnknown = classifier.classifyTrackRecordRow({
  pid: 6,
  strategyCategory: "grid",
  completed: true,
  processStatus: "NORMAL",
  entryLedgerCount: 1,
  exitLedgerCount: 1,
  gridMeta: {
    currentRegimeRealizedPnl: 1,
    actualEntryNotional: 100,
  },
  summaryText: "TRUTH_SYNC GMANUAL closed",
});
assertEqual(reconciledUnknown.bucket, "review", "reconciled unknown bucket");
assertEqual(
  reconciledUnknown.reconciliationOrigin,
  "RECONCILED_AFTER_UNKNOWN_DEFECT",
  "reconciled unknown origin"
);

console.log(JSON.stringify({
  status: "PASS",
  checks: [
    "ENTRY_FAIL dispatch-timeout goes to review",
    "fake breakeven requires entry+exit evidence and denominator",
    "true breakeven still allowed with complete evidence",
    "pending active entry is ongoing",
    "reconciliation-origin cycle is not normal completed without expected reason",
  ],
}));
process.exit(0);
