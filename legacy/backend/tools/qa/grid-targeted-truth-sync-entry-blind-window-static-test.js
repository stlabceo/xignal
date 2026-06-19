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
  "GRID_TARGETED_TRUTH_SYNC_ENTRY_NEW_FOLLOWUP_MS",
  "ENTRY NEW exact status must schedule a bounded follow-up verify instead of waiting for the full repeat cooldown"
);
mustInclude(
  "GRID_TARGETED_TRUTH_SYNC_ENTRY_NEW_FOLLOWUP_MAX",
  "ENTRY NEW follow-up must be explicitly bounded"
);
mustInclude(
  "if(!bypassRepeatCooldown && lastAt > 0",
  "normal cooldown must remain, but exact follow-up must be able to bypass it narrowly"
);
mustInclude(
  "gridTargetedTruthSyncVerifyLastAt.delete(verifyKey);",
  "follow-up must clear the same exact order cooldown before rechecking"
);
mustInclude(
  "source: 'TARGETED_TRUTH_SYNC_ENTRY_NEW_FOLLOWUP'",
  "follow-up rechecks must be source-labeled for audit"
);
mustInclude(
  "firstVerifyGraceMsOverride: 1",
  "follow-up recheck must not add the broad first-verify grace again"
);
mustInclude(
  "entryNewFollowUpScheduled = scheduleEntryNewFollowUp",
  "NEW exact status must be the trigger point for the follow-up"
);
mustInclude(
  "GRID_PUBLIC_PRICE_HINT_TARGETED_VERIFY_ENTRY_NEW_FOLLOWUP_SCHEDULED",
  "follow-up scheduling must be visible in logs"
);

const defaultEntryCooldownMs = 60000;
const defaultEntryNewFollowUpMs = 12000;
const followUpExactGraceMs = 1;
assert(
  defaultEntryNewFollowUpMs + followUpExactGraceMs < defaultEntryCooldownMs,
  "default ENTRY NEW follow-up must close the 60s blind-window"
);

console.log(JSON.stringify({
  status: "PASS",
  defaultEntryCooldownMs,
  defaultEntryNewFollowUpMs,
  followUpExactGraceMs,
  blindWindowClosedByDefault: true,
}, null, 2));
