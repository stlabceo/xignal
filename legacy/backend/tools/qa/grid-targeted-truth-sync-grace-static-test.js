"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const coin = fs.readFileSync(path.join(root, "coin.js"), "utf8");

const mustInclude = (needle, message) => assert(coin.includes(needle), message || `missing ${needle}`);
const mustNotInclude = (needle, message) => assert(!coin.includes(needle), message || `unexpected ${needle}`);

mustInclude("getGridTargetedTruthSyncEnvNumber('GRID_TARGETED_TRUTH_SYNC_FIRST_VERIFY_GRACE_MS', 2500, 1)", "first verify grace must be configurable and default above zero");
mustInclude("if(!Number.isFinite(parsed))", "invalid targeted truth-sync env values must fall back safely");
mustInclude("const firstVerifyGraceMs = Math.max(", "scheduled grace must be clamped above zero");
mustInclude("? Number(firstVerifyGraceMsOverride)", "exact follow-up must be able to override the broad grace safely");
mustInclude("GRID_TARGETED_TRUTH_SYNC_REPEAT_COOLDOWN_MS = 60000", "repeat cooldown remains separate from first grace");
mustInclude("GRID_TARGETED_TRUTH_SYNC_PROTECTION_REPEAT_COOLDOWN_MS", "protection cooldown must be separate from entry/ambiguous cooldown");
mustInclude("getGridTargetedTruthSyncEnvNumber('GRID_TARGETED_TRUTH_SYNC_PROTECTION_REPEAT_COOLDOWN_MS', 12000, 1000)", "protection cooldown default must be shorter than generic repeat cooldown");
mustInclude("getGridTargetedTruthSyncRepeatCooldownMs", "state/scope-specific repeat cooldown helper must exist");
mustInclude("GRID_PUBLIC_PRICE_HINT_AUDIT_THROTTLE_MS = 60000", "public log throttle remains separate");
mustInclude("TARGET_ALREADY_CONVERGED_BEFORE_VERIFY", "grace-end local convergence must cancel verify before REST");
mustInclude("getGridTargetLocalConvergenceState", "local convergence check must exist");
mustInclude("ENTRY_ORDER_REFERENCE_CHANGED", "entry socket convergence must be detectable");
mustInclude("RESERVATION_ALREADY_", "TP/STOP reservation convergence must be detectable");
mustInclude("enqueueGridTargetedTruthSyncTask", "REST verify must pass through queue after grace");
mustInclude("GRID_PUBLIC_PRICE_HINT_TARGETED_VERIFY_QUEUE_ENQUEUED", "queued verify must be observable");
mustInclude("CRITICAL_PROTECTION_VERIFY_NON_DROP", "critical TP/STOP exact verifies must not be stale-dropped");
mustInclude("reenqueueEligible: true", "stale-dropped non-critical verifies must be eligible for re-enqueue");
mustNotInclude("GRID_TARGETED_TRUTH_SYNC_FIRST_VERIFY_GRACE_MS || 0", "zero default must not remain");

console.log("grid-targeted-truth-sync-grace-static-test PASS");
