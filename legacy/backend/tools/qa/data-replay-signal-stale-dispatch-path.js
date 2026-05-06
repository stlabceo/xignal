"use strict";

const assert = require("assert");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");

dayjs.extend(utc);

const { getSignalEntryPendingStaleInfo } = require("../../signal-stale-time");

const buildMysql2Date = (text) => {
  const match = String(text).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  assert.ok(match, `invalid test datetime: ${text}`);
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
};

const signalTargets = [
  { pid: 7, symbol: "XRPUSDT", side: "BUY", signalTime: "2026-05-05 15:15:04" },
  { pid: 9, symbol: "PUMPUSDT", side: "BUY", signalTime: "2026-05-05 21:30:05" },
  { pid: 11, symbol: "SOLUSDT", side: "BUY", signalTime: "2026-05-06 00:00:16" },
];

for (const target of signalTargets) {
  const staleInfo = getSignalEntryPendingStaleInfo(
    {
      id: target.pid,
      status: "EXACT_WAIT",
      r_signalType: target.side,
      r_signalTime: buildMysql2Date(target.signalTime),
    },
    {
      now: dayjs.utc(`${target.signalTime.replace(" ", "T")}.900Z`),
      staleSeconds: 30,
    }
  );

  const wouldDispatchMarketEntry = target.side && !staleInfo.stale;
  assert.strictEqual(staleInfo.stale, false, `PID${target.pid} immediate pending should not stale`);
  assert.strictEqual(wouldDispatchMarketEntry, true, `PID${target.pid} would stay on market-entry dispatch path`);
}

console.log("data-replay-signal-stale-dispatch-path PASS");
