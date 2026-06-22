"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const coinPath = path.join(root, "coin.js");
const enginePath = path.join(root, "grid-engine.js");
const coin = fs.readFileSync(coinPath, "utf8");
const engine = fs.readFileSync(enginePath, "utf8");

const mustInclude = (source, needle, message) => {
  assert(source.includes(needle), message || `missing ${needle}`);
};

const mustNotInclude = (source, needle, message) => {
  assert(!source.includes(needle), message || `unexpected ${needle}`);
};

mustInclude(coin, "GRID_TARGETED_TRUTH_SYNC_FIRST_VERIFY_GRACE_MS", "first verify grace must be explicit");
mustInclude(coin, "GRID_TARGETED_TRUTH_SYNC_REPEAT_COOLDOWN_MS", "repeat cooldown must be explicit");
mustInclude(coin, "GRID_TARGETED_TRUTH_SYNC_IN_FLIGHT_LOCK_TTL_MS", "in-flight lock TTL must be explicit");
mustInclude(coin, "GRID_TARGETED_TRUTH_SYNC_TERMINAL_SUPPRESSION_MS", "terminal suppression must be explicit");
mustInclude(coin, "setTimeout(() =>", "first verify grace must be a separate scheduler delay");
mustInclude(coin, "getGridTargetedTruthSyncEnvNumber('GRID_TARGETED_TRUTH_SYNC_FIRST_VERIFY_GRACE_MS', 5000, 1)", "first verify grace must default safely and reject invalid env values");
mustInclude(coin, "if(!Number.isFinite(parsed))", "targeted truth-sync env parser must reject NaN/invalid values");
mustInclude(coin, "firstVerifyGraceMsOverride", "follow-up scheduler must be able to bypass the initial broad grace safely");
mustInclude(coin, "? Number(firstVerifyGraceMsOverride)", "first verify delay must accept an explicit positive override");

mustInclude(coin, "clientOrderId || clientAlgoId || orderId || algoId || 'NO_ORDER_REF'", "verify key must include exact order references");
mustInclude(coin, "EXACT_ORDER_TARGETED", "exact-order target scope must be represented");
mustInclude(coin, "PID_SIDE_TARGETED_BUT_ORDER_AMBIGUOUS", "ambiguous PID/side target scope must be represented");
mustInclude(coin, "EXACT_EVIDENCE_DIRECT_HANDLER", "exact trade evidence must route to the existing direct handler");
mustInclude(coin, "EXACT_STATUS_ROW_RECOVERY_REQUIRED", "exact status without trade evidence must be labeled");
mustInclude(coin, "AMBIGUOUS_ROW_FALLBACK", "row-wide fallback must be limited to ambiguous local refs");
mustInclude(coin, "NO_EVIDENCE_NO_MUTATION", "missing exact evidence must not mutate canonical state");

mustInclude(coin, "readExactGridTargetOrderStatus", "targeted verify must attempt exact REST status first");
mustInclude(coin, "privateFuturesSignedRequest(uid, '/fapi/v1/order'", "entry exact query must use read-guarded signed request");
mustInclude(coin, "privateFuturesAlgoRequest(uid, '/fapi/v1/algoOrder'", "TP/STOP exact query must use read-guarded algo request");
mustNotInclude(coin, ".futuresOrderStatus(symbol, params)", "entry exact query must not bypass read guard");

mustInclude(coin, "? 'BOOK_TICKER_BEST_ASK' : 'BOOK_TICKER_BEST_BID'", "entry hint must use side-specific bid/ask semantics");
mustInclude(coin, "priceSource: 'MARK_PRICE'", "TP/STOP hint must support mark-price semantics");
mustInclude(coin, "workingType: 'MARK_PRICE'", "Grid conditional exits must be treated as mark-price orders");
mustInclude(coin, "hydrateGridPublicHintMarkPrice", "public hint must hydrate MARK_PRICE when cache is missing");
mustInclude(coin, "MARK_PRICE_HYDRATION_FAILED", "mark hydration failures must be visible and throttled");
mustInclude(coin, "for(const slotSymbol of Array.from(new Set([normalizedSymbol, exchangeSymbol]", "mark hydration must bridge .P and exchange-symbol price slots");
mustInclude(coin, "bestBid", "book ticker best bid must be preserved");
mustInclude(coin, "bestAsk", "book ticker best ask must be preserved");
mustInclude(coin, "markPrice", "mark price must be preserved for conditional exits");

mustInclude(coin, "directFillConfirmation: false", "public price crossing must remain hint-only");
mustInclude(coin, "createsOrderOrLedger: false", "public price crossing must not directly mutate canonical state");
mustInclude(coin, "GRID_TARGETED_TRUTH_SYNC_GLOBAL_CONCURRENCY", "targeted verify must have a global concurrency limit");
mustInclude(coin, "GRID_TARGETED_TRUTH_SYNC_PER_UID_CONCURRENCY", "targeted verify must have a per-uid concurrency limit");
mustInclude(coin, "GRID_TARGETED_TRUTH_SYNC_PER_SYMBOL_CONCURRENCY", "targeted verify must have a per-symbol concurrency limit");
mustInclude(coin, "GRID_TARGETED_TRUTH_SYNC_GLOBAL_STARTS_PER_SECOND", "targeted verify must have a start-rate budget");
mustInclude(coin, "GRID_TARGETED_TRUTH_SYNC_PROTECTION_REPEAT_COOLDOWN_MS", "protection repeat cooldown must be separated from generic cooldown");
mustInclude(coin, "GRID_TARGETED_TRUTH_SYNC_ENTRY_NEW_FOLLOWUP_MS", "ENTRY NEW exact status must have a bounded follow-up verify");
mustInclude(coin, "GRID_PUBLIC_PRICE_HINT_TARGETED_VERIFY_ENTRY_NEW_FOLLOWUP_SCHEDULED", "ENTRY NEW follow-up must be observable");
mustInclude(coin, "bypassRepeatCooldown: true", "ENTRY NEW follow-up must bypass the 60s repeat cooldown only for the same exact order");
mustInclude(coin, "CRITICAL_PROTECTION_VERIFY_NON_DROP", "critical TP/STOP exact verifies must be retained instead of stale-dropped");
mustInclude(coin, "gridTargetedTruthSyncSafetyNet", "non-critical stale drops must be registered for safety-net observability");
mustInclude(coin, "getGridTargetedTruthSyncSafetyNetPids(uid, limit)", "safety-net PIDs must feed batch truth-sync candidate selection");
mustInclude(coin, "safetyNetPids.forEach(pushPid)", "safety-net PIDs must be prioritized before normal scan candidates");
mustInclude(coin, "safetyNetCandidateCount", "safety-net scan participation must be observable separately from registration");
mustInclude(coin, "TARGET_ALREADY_CONVERGED_BEFORE_VERIFY", "socket convergence during grace must cancel scheduled verify before REST");
mustNotInclude(coin, "GRID_TARGETED_TRUTH_SYNC_VERIFY_COOLDOWN_MS", "old cooldown constant must not remain");
mustNotInclude(coin, "gridTargetedTruthSyncVerifyRunning.add", "running lock must be a timestamp map, not a Set call");

mustInclude(engine, "ORDER_TERMINAL_PARTIAL_POLICY_BLOCKED", "terminal-with-fill must be separated from broad recovery");
mustInclude(engine, "ENTRY_ORDER_TERMINATED_NO_FILL", "entry terminal no-fill must clear stale entry refs");
mustInclude(engine, "[`${prefix}EntryOrderId`]: null", "entry terminal no-fill must clear only the scoped leg entry ref");
mustNotInclude(engine, "ORDER_TERMINAL_WITH_FILL_RECOVERY", "terminal partial must not route to broad truth-sync recovery");

console.log("grid-targeted-truth-sync-closure-static-test PASS");
setTimeout(() => process.exit(0), 100);
