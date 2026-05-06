"use strict";

const assert = require("assert");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");

dayjs.extend(utc);

const {
  parseDatabaseUtcDateTime,
  getSignalEntryPendingStaleInfo,
} = require("../../signal-stale-time");

const assertAlmostEqual = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`
  );
};

const mysql2LocalDate = new Date(2026, 4, 5, 15, 15, 4, 0);
assert.strictEqual(
  parseDatabaseUtcDateTime(mysql2LocalDate).toISOString(),
  "2026-05-05T15:15:04.000Z",
  "mysql2 DATETIME wall-clock Date is reinterpreted as UTC wall-clock"
);

assert.strictEqual(
  parseDatabaseUtcDateTime("2026-05-05 15:15:04").toISOString(),
  "2026-05-05T15:15:04.000Z",
  "DB DATETIME string parses as UTC"
);

const immediate = getSignalEntryPendingStaleInfo(
  {
    status: "EXACT_WAIT",
    r_signalTime: mysql2LocalDate,
  },
  {
    now: dayjs.utc("2026-05-05 15:15:04.832", "YYYY-MM-DD HH:mm:ss.SSS"),
    staleSeconds: 30,
  }
);

assert.strictEqual(immediate.stale, false, "newly created signal pending is not stale");
assert.strictEqual(immediate.reason, null, "newly created signal pending has no stale reason");
assertAlmostEqual(immediate.ageSeconds, 0.832, 0.001, "immediate signal age");

const oldPending = getSignalEntryPendingStaleInfo(
  {
    status: "EXACT_WAIT",
    r_signalTime: "2026-05-05 15:15:04",
  },
  {
    now: dayjs.utc("2026-05-05 15:16:00", "YYYY-MM-DD HH:mm:ss"),
    staleSeconds: 30,
  }
);

assert.strictEqual(oldPending.stale, true, "old signal pending remains stale");
assert.strictEqual(oldPending.reason, "dispatch-timeout", "old signal pending keeps review reason");
assertAlmostEqual(oldPending.ageSeconds, 56, 0.001, "old pending age");

const ready = getSignalEntryPendingStaleInfo(
  {
    status: "READY",
    r_signalTime: "2026-05-05 15:15:04",
  },
  {
    now: dayjs.utc("2026-05-05 15:16:00", "YYYY-MM-DD HH:mm:ss"),
    staleSeconds: 30,
  }
);

assert.strictEqual(ready.stale, false, "non-EXACT_WAIT rows are never stale pending");
assert.strictEqual(ready.ageSeconds, 0, "non-EXACT_WAIT age is zero");

console.log("signal-stale-time-static-test PASS");
