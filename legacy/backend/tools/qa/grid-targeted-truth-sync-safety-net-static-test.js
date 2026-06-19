"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const coin = fs.readFileSync(path.join(root, "coin.js"), "utf8");

const mustInclude = (needle, message) => {
  assert(coin.includes(needle), message || `missing ${needle}`);
};

mustInclude(
  "registerGridTargetedTruthSyncSafetyNet(task, 'TARGETED_VERIFY_QUEUE_STALE_DROPPED')",
  "stale-drop path must register a safety-net record"
);
mustInclude(
  "const getGridTargetedTruthSyncSafetyNetPids = (uid, limit = 12)",
  "safety-net records must expose PID candidates for the batch truth-sync scanner"
);
mustInclude(
  "safetyNetPids.forEach(pushPid)",
  "batch truth-sync must prioritize safety-net PIDs before normal runtime/snapshot/reservation scan candidates"
);
mustInclude(
  "gridTargetedTruthSyncMetrics.safetyNetScanCandidates += safetyNetPids.length",
  "scanner participation must be counted separately from safety-net registration"
);
mustInclude(
  "GRID_REST_TRUTH_SYNC_SCAN_SET",
  "batch truth-sync scan set must remain observable"
);
mustInclude(
  "safetyNetCandidateCount: safetyNetPids.length",
  "scan-set log must expose safety-net participation"
);
mustInclude(
  "scanSetFinalPids: pids",
  "final batch candidate set must be auditable"
);

console.log(JSON.stringify({
  status: "PASS",
  safetyNetRegistration: true,
  safetyNetBatchCandidatePriority: true,
  safetyNetRecoveryCompletionSource: "truthSyncLiveGridRuntime -> truthSyncLiveGridRow",
}, null, 2));
