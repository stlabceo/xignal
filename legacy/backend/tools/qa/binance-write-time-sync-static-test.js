"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const timeSync = require("../../binance-write-time-sync");

const timestampError = () => {
  const error = new Error("Timestamp for this request was 1000ms ahead of the server's time.");
  error.response = {
    data: {
      code: -1021,
      msg: error.message,
    },
  };
  return error;
};

assert.strictEqual(
  timeSync.calculateFuturesTimeOffsetMs(2000, 1500),
  500,
  "offset is serverTime - localTime"
);

assert.strictEqual(
  timeSync.isTimestampOutsideRecvWindowError(timestampError()),
  true,
  "-1021 is detected as timestamp outside recvWindow"
);

(async () => {
  const state = timeSync.createFuturesTimeSyncState();
  const client = {};
  let serverTime = 100000;
  let localNow = 99000;
  const sync = await timeSync.syncNodeBinanceFuturesClientTime(client, {
    state,
    force: true,
    nowMs: () => localNow,
    fetchServerTime: async () => serverTime,
  });

  assert.strictEqual(sync.offsetMs, 1000, "forced sync updates offset");
  assert.strictEqual(client.timeOffset, 0, "node-binance client offset includes 1000ms safety margin");
  assert.strictEqual(
    timeSync.getFuturesTimestamp({ state, nowMs: () => localNow }),
    99000,
    "manual signed timestamp also includes 1000ms safety margin"
  );

  let attempts = 0;
  let forceSyncs = 0;
  const retryResult = await timeSync.runWithTimestampRetry({
    operation: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw timestampError();
      }
      return { ok: true, attempts };
    },
    syncTime: async ({ force }) => {
      if (force) forceSyncs += 1;
      return { offsetMs: 42 };
    },
    maxTimestampRetries: 1,
  });
  assert.deepStrictEqual(retryResult, { ok: true, attempts: 2 }, "first -1021 retries once and succeeds");
  assert.strictEqual(forceSyncs, 1, "retry forces server time sync once");

  let failedAttempts = 0;
  let failureLogged = 0;
  await assert.rejects(
    () => timeSync.runWithTimestampRetry({
      operation: async () => {
        failedAttempts += 1;
        throw timestampError();
      },
      syncTime: async () => ({ offsetMs: 0 }),
      maxTimestampRetries: 1,
      onFailure: async () => {
        failureLogged += 1;
      },
    }),
    /Timestamp/
  );
  assert.strictEqual(failedAttempts, 2, "retry fail is bounded to original + one retry");
  assert.strictEqual(failureLogged, 1, "final timestamp failure is audited once");

  const coinSource = fs.readFileSync(path.resolve(__dirname, "../../coin.js"), "utf8");
  const requiredSnippets = [
    "runBinanceWriteWithTimeSync(",
    "binance[context.uid].futuresOrder(",
    "binance[context.uid].futuresCancel(",
    "binance[context.uid].privateFuturesRequest(",
    "binanceWriteTimeSync.runWithTimestampRetry({",
    "recvWindow: binanceWriteTimeSync.DEFAULT_RECV_WINDOW_MS",
    "privateFuturesSignedRequest",
  ];
  for (const snippet of requiredSnippets) {
    assert.ok(coinSource.includes(snippet), `coin.js should include ${snippet}`);
  }
  assert.strictEqual(
    coinSource.includes("recvWindow: 10000"),
    false,
    "signed futures paths should not keep a split recvWindow policy"
  );

  const activeLines = coinSource
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), index: index + 1 }))
    .filter((item) => item.line && !item.line.startsWith("//"));
  const directWriteBypass = activeLines.filter((item) =>
    (
      item.line.includes(".futuresOrder(") ||
      item.line.includes(".futuresCancel(") ||
      item.line.includes(".privateFuturesRequest(")
    ) &&
    !item.line.includes("binance[context.uid].futuresOrder(") &&
    !item.line.includes("binance[context.uid].futuresCancel(") &&
    !item.line.includes("binance[context.uid].privateFuturesRequest(")
  );
  assert.deepStrictEqual(directWriteBypass, [], "no direct write bypass remains outside central wrappers");

  console.log("binance-write-time-sync-static-test PASS");
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
