const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const admin = read("backend/routes/admin.js");
const seon = read("backend/seon.js");
const gridRuntime = read("backend/grid-runtime.js");
const demoTrackRecord = read("backend/demo-track-record.js");
const userScreenDemoQa = read("backend/tools/qa/user-screen-demo-trading-live-price-qa.js");

assert(
  admin.includes('router.post("/test/hook"') && admin.includes('router.post("/grid/test/hook"'),
  "USER_DEMO_API_NOT_CONNECTED: /admin test demo hook routes are missing"
);
assert(
  admin.includes("seon.enterTestCoin") && admin.includes("includeLive: false") && admin.includes("includeTest: true"),
  "USER_DEMO_ROUTE_NOT_CONNECTED: signal demo hook must call test-only enter path"
);
assert(
  admin.includes("gridRuntime.processGridWebhook(normalizedPayload") &&
    admin.includes("includeLive: false") &&
    admin.includes("includeTest: true") &&
    admin.includes("uid: userId"),
  "USER_DEMO_ROUTE_NOT_CONNECTED: grid demo hook must be user-scoped test-only"
);
assert(
  seon.includes("exports.enterTestCoin") &&
    seon.includes("includeLive: false") &&
    seon.includes("includeTest: true") &&
    seon.includes("exports.runPlayTestForDemoQa"),
  "USER_DEMO_ALGO_ENTRY_FAIL: seon demo-only entry/runtime exports are missing"
);
assert(
  seon.includes("dateObjectAsUtcWallClock") &&
    seon.includes("getTimeExpiryState(play, dayjs.utc(), { dateObjectAsUtcWallClock: true })"),
  "USER_DEMO_ALGO_TIME_STOP_FAIL: test runtime must treat MySQL Date objects as DB wall-clock time"
);
assert(
  gridRuntime.includes("const scopedUid = Number(options.uid || options.userId || 0) || null") &&
    gridRuntime.includes("uidPredicate"),
  "USER_DEMO_GRID_ARM_FAIL: grid demo hook must support uid-scoped target matching"
);

const branchIndex = admin.indexOf('if (targetMode === "test")');
const liveLedgerIndex = admin.indexOf("FROM live_pid_position_ledger");
assert(
  branchIndex > 0 && liveLedgerIndex > branchIndex,
  "USER_DEMO_STATS_CONTAMINATION_RISK: test track-record branch must run before live ledger projection"
);
assert(
  demoTrackRecord.includes("test_play_log") &&
    demoTrackRecord.includes("test_grid_strategy_list") &&
    !demoTrackRecord.includes("live_pid_position_ledger") &&
    !demoTrackRecord.includes("order_intent_queue") &&
    !demoTrackRecord.includes("GRID_LIVE_ARM"),
  "USER_DEMO_STATS_CONTAMINATION_RISK: demo track-record projection must use demo stores only"
);
assert(
  demoTrackRecord.includes('trackRecordType: "demo"') &&
    demoTrackRecord.includes('strategySuccessScope: "demo_only"') &&
    demoTrackRecord.includes("recommendationEligible: false"),
  "USER_DEMO_TRACK_RECORD_FAIL: demo track-record isolation fields are missing"
);
assert(
  userScreenDemoQa.includes("await createInitialFarm({ token, uid });\n  await classifyGridCandidates();") &&
    userScreenDemoQa.includes("if (!scenarioState.G3_GRID_TP_CLOSE)"),
  "USER_DEMO_GRID_TP_CLOSE_FAIL: user-screen demo QA must observe armed Grid state before ticks and defer closeout until TP close"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: [
        "admin demo hook routes",
        "signal test-only target path",
        "grid test-only uid-scoped target path",
        "test time-stop DB wall-clock handling",
        "test track-record live-projection bypass",
        "demo-only track-record stores",
        "demo stats isolation fields",
        "grid release demo observes arm before tick and closeout after TP",
      ],
    },
    null,
    2
  )
);
