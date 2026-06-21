"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const seon = read("backend/seon.js");
const coin = read("backend/coin.js");
const webhookLog = read("backend/webhook-event-log.js");
const usersRoute = read("backend/routes/users.js");

const liveTimeCloseIndex = seon.indexOf("'timeExpiryClose'");
const liveWallClockCallIndex = seon.lastIndexOf(
  "getTimeExpiryState(play, dayjs.utc(), { dateObjectAsUtcWallClock: true })",
  liveTimeCloseIndex
);

assert(liveTimeCloseIndex > 0, "SIGNAL_LIVE_TIME_STOP_AUDIT_MISSING: live time-stop close log path is missing");
assert(
  liveWallClockCallIndex > 0 && liveWallClockCallIndex < liveTimeCloseIndex,
  "SIGNAL_LIVE_TIME_STOP_WALL_CLOCK_FAIL: live runtime must treat MySQL Date objects as DB wall-clock time before TIME_EXPIRE"
);
assert(
  usersRoute.includes("updateWebhookEventLogOutcome(webhookEventId") &&
    webhookLog.includes("const updateWebhookEventLogOutcome") &&
    webhookLog.includes("updateWebhookEventLogOutcome,"),
  "SIGNAL_WEBHOOK_OUTCOME_EXPORT_FAIL: signal webhook accepted processing must be able to update webhook_event_log outcome"
);
assert(
  coin.includes("const completeConvergedSignalTimeExitIntentsForRow") &&
    coin.includes("lastErrorCode = ?") &&
    coin.includes("'SIGNAL_CLOSE_ACCEPTED_NOT_CONVERGED'") &&
    coin.includes("repaired: 'SIGNAL_TIME_EXIT_QUEUE_CONVERGED'"),
  "SIGNAL_TIME_EXIT_QUEUE_PROJECTION_FAIL: truth-sync must close accepted-but-not-converged time-stop intents when local canonical state is already converged"
);

console.log("signal-live-time-stop-webhook-contract-static-test PASS");
process.exit(0);
