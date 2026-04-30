process.env.QA_REPLAY_MODE = process.env.QA_REPLAY_MODE || "1";
process.env.QA_DISABLE_BINANCE_WRITES = process.env.QA_DISABLE_BINANCE_WRITES || "1";

const fs = require("fs");
const path = require("path");
const https = require("https");

const binanceWriteGuard = require("../../binance-write-guard");
const coin = require("../../coin");
const qaBinance = require("./qa-binance");
const {
  closePool,
  createTempGridStrategy,
  cleanupArtifacts,
  countArtifactRowsForPids,
} = require("./qa-db");
const { installQaReplayNetworkFirewall } = require("./qa-network-firewall");
const { writeReportFiles, buildTimestampSlug, getGitMeta, getDbMeta } = require("./qa-runner");

const uid = 147;
const symbols = ["XRPUSDT", "PUMPUSDT"];

const expect = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const getExchangeCounters = async () => {
  const result = {};
  for (const symbol of symbols) {
    const [orders, trades, openOrders, openAlgoOrders] = await Promise.all([
      qaBinance.getAllOrders(uid, symbol, 50),
      qaBinance.getUserTrades(uid, symbol, 50),
      qaBinance.getOpenOrders(uid, symbol),
      qaBinance.getOpenAlgoOrders(uid, symbol),
    ]);
    result[symbol] = {
      allOrderIds: (Array.isArray(orders) ? orders : []).map((row) => String(row.orderId)).sort(),
      tradeIds: (Array.isArray(trades) ? trades : []).map((row) => String(row.id)).sort(),
      openOrderIds: (Array.isArray(openOrders) ? openOrders : []).map((row) => String(row.orderId)).sort(),
      openAlgoIds: (Array.isArray(openAlgoOrders) ? openAlgoOrders : []).map((row) => String(row.algoId || row.orderId || row.clientAlgoId)).sort(),
    };
  }
  return result;
};

const stableCounters = (before, after) =>
  JSON.stringify(before) === JSON.stringify(after);

const assertGuardBlocks = (context, expectedReason) => {
  const decision = binanceWriteGuard.evaluateBinanceWriteAllowed(context);
  expect(decision.allowed === false, `${context.action} should be blocked`);
  expect(decision.reason === expectedReason, `${context.action} expected ${expectedReason}, got ${decision.reason}`);
  return decision;
};

const assertGuardBlocksScenario = ({ scenario, action, caller, symbol = "XRPUSDT", expectedReason = "QA_DISABLE_BINANCE_WRITES_BLOCKED", context = {} }) => {
  const decision = assertGuardBlocks(
    {
      uid,
      action,
      symbol,
      caller,
      ...context,
    },
    expectedReason
  );
  return {
    scenario,
    expected: `guard block before Binance write (${action})`,
    actual: decision.reason,
    status: "PASS",
  };
};

const assertNetworkPostBlocked = () => {
  installQaReplayNetworkFirewall();
  try {
    https.request({
      hostname: "fapi.binance.com",
      path: "/fapi/v1/order",
      method: "POST",
    });
  } catch (error) {
    expect(error.code === "QA_REPLAY_BINANCE_NETWORK_WRITE_BLOCKED", "network firewall should block Binance POST");
    return error.message;
  }
  throw new Error("network firewall did not block Binance POST");
};

const assertNoDirectWriteBypass = () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../coin.js"), "utf8");
  const activeLines = source
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), index: index + 1 }))
    .filter((item) => item.line && !item.line.startsWith("//"));

  const futuresOrderBypass = activeLines.filter(
    (item) => item.line.includes(".futuresOrder(") && !item.line.includes("binance[context.uid].futuresOrder(")
  );
  const futuresCancelBypass = activeLines.filter(
    (item) => item.line.includes(".futuresCancel(") &&
      !item.line.includes("binance[context.uid].futuresCancel(")
  );
  const privateFuturesRequestBypass = activeLines.filter(
    (item) => item.line.includes(".privateFuturesRequest(") && !item.line.includes("binance[context.uid].privateFuturesRequest(")
  );

  expect(futuresOrderBypass.length === 0, `direct futuresOrder bypass: ${JSON.stringify(futuresOrderBypass)}`);
  expect(futuresCancelBypass.length === 0, `direct futuresCancel bypass: ${JSON.stringify(futuresCancelBypass)}`);
  expect(privateFuturesRequestBypass.length === 0, `direct privateFuturesRequest bypass: ${JSON.stringify(privateFuturesRequestBypass)}`);
};

const run = async () => {
  const startedAt = new Date().toISOString();
  const scenarios = [];
  const cleanup = [];
  let tempRow = null;
  let before = null;
  let after = null;

  try {
    before = await getExchangeCounters();

    assertGuardBlocks(
      { uid, action: "WRITE_CLOSE_MARKET", symbol: "XRPUSDT", caller: "test.qaReplay", isReplay: true },
      "QA_DISABLE_BINANCE_WRITES_BLOCKED"
    );
    scenarios.push({
      scenario: "QA replay central guard blocks market close",
      expected: "blocked before Binance write",
      actual: "QA_DISABLE_BINANCE_WRITES_BLOCKED",
      status: "PASS",
    });

    scenarios.push(assertGuardBlocksScenario({
      scenario: "QA replay tries signal force-OFF close",
      action: "WRITE_CLOSE_MARKET",
      caller: "coin.sendForcing.forceOff",
    }));
    scenarios.push(assertGuardBlocksScenario({
      scenario: "QA replay tries TIME exit close",
      action: "WRITE_CLOSE_MARKET",
      caller: "coin.signalTimeExit",
    }));
    scenarios.push(assertGuardBlocksScenario({
      scenario: "QA replay tries signal TP/STOP/SPLITTP create",
      action: "WRITE_PROTECTION_CREATE",
      caller: "coin.signalProtectionCreate",
    }));
    scenarios.push(assertGuardBlocksScenario({
      scenario: "QA replay tries grid TP/STOP create",
      action: "WRITE_PROTECTION_CREATE",
      caller: "coin.gridProtectionCreate",
    }));
    scenarios.push(assertGuardBlocksScenario({
      scenario: "QA replay tries cancelGridOrders",
      action: "WRITE_CANCEL_ORDER",
      caller: "coin.cancelGridOrders",
    }));
    scenarios.push(assertGuardBlocksScenario({
      scenario: "live execution script without approval",
      action: "WRITE_WEBHOOK_SEND",
      caller: "live-execution-trigger-webhook",
      symbol: "PUMPUSDT",
      expectedReason: "LIVE_EXECUTION_QA_APPROVAL_MISSING",
      context: {
        env: { QA_LIVE_EXECUTION_MODE: "1" },
        isLiveExecutionQa: true,
      },
    }));

    assertGuardBlocks(
      { uid, action: "WRITE_CREATE_ORDER", symbol: "PUMPUSDT", caller: "test.noApproval", env: {} },
      "BINANCE_LIVE_WRITES_NOT_ENABLED"
    );
    scenarios.push({
      scenario: "production mode without explicit live write enable is blocked",
      expected: "fail closed",
      actual: "BINANCE_LIVE_WRITES_NOT_ENABLED",
      status: "PASS",
    });

    const allowedMock = binanceWriteGuard.evaluateBinanceWriteAllowed({
      uid,
      action: "WRITE_CREATE_ORDER",
      symbol: "PUMPUSDT",
      caller: "test.mock",
      clientIsMock: true,
    });
    expect(allowedMock.allowed === true, "mock client decision should be allowed");
    scenarios.push({
      scenario: "mock client can exercise code path without live write",
      expected: "guard allows mock only",
      actual: allowedMock.reason,
      status: "PASS",
    });

    let signedPostBlocked = false;
    try {
      await qaBinance.signedRequest(uid, "/fapi/v1/order", { symbol: "XRPUSDT" }, "POST");
    } catch (error) {
      signedPostBlocked = binanceWriteGuard.isBinanceWriteGuardError(error);
    }
    expect(signedPostBlocked, "qa-binance signed POST must be blocked");
    scenarios.push({
      scenario: "qa-binance signed POST firewall",
      expected: "throw before credentials/network write",
      actual: "BINANCE_WRITE_BLOCKED_BY_GUARD",
      status: "PASS",
    });

    const networkBlockMessage = assertNetworkPostBlocked();
    scenarios.push({
      scenario: "network firewall blocks Binance POST",
      expected: "throw before request",
      actual: networkBlockMessage,
      status: "PASS",
    });

    assertNoDirectWriteBypass();
    scenarios.push({
      scenario: "coin.js write surface routes through guarded wrappers",
      expected: "no direct futuresOrder/privateFuturesRequest bypass",
      actual: "PASS",
      status: "PASS",
    });

    tempRow = await createTempGridStrategy({
      uid,
      symbol: "PUMPUSDT",
      bunbong: "1MIN",
      regimeStatus: "ENDED",
      longLegStatus: "OPEN",
      longQty: 2000,
    });
    const result = await coin.closeGridLegMarketOrder({
      uid,
      pid: tempRow.id,
      symbol: tempRow.symbol,
      leg: "LONG",
      qty: 2000,
    });
    expect(result === null, "GMANUAL close should return null in QA replay before live write");
    scenarios.push({
      scenario: "exact accident path GMANUAL grid close is blocked",
      expected: "closeGridLegMarketOrder returns null before futuresOrder",
      actual: "PASS",
      status: "PASS",
    });

    const beforeCleanup = await countArtifactRowsForPids({ uid, pids: [tempRow.id] });
    await cleanupArtifacts({ uid, pids: [tempRow.id] });
    const afterCleanup = await countArtifactRowsForPids({ uid, pids: [tempRow.id] });
    cleanup.push({
      scenario: "exact accident path GMANUAL grid close is blocked",
      tempPidRange: String(tempRow.id),
      before: beforeCleanup,
      afterCleanup,
      cleanupStatus: Object.values(afterCleanup).every((value) => Number(value || 0) === 0) ? "PASS" : "FAIL",
    });
    tempRow = null;

    after = await getExchangeCounters();
    expect(stableCounters(before, after), "Binance allOrders/userTrades/open order counters changed during guard test");

    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      git: getGitMeta(),
      db: getDbMeta(),
      category: "QA_REPLAY_LIVE_WRITE_ESCAPE",
      beforeExchangeCounters: before,
      afterExchangeCounters: after,
      scenarios,
      cleanup,
      finalStatus: scenarios.every((scenario) => scenario.status === "PASS") &&
        cleanup.every((row) => row.cleanupStatus === "PASS")
        ? "PASS"
        : "FAIL",
    };
    const paths = writeReportFiles({
      reportType: "qa-binance-write-escape-guard-targeted",
      runId: `QA_BINANCE_WRITE_ESCAPE_GUARD_${buildTimestampSlug(startedAt)}`,
      report,
    });
    console.log(`status: ${report.finalStatus}`);
    console.log(`report.json: ${paths.jsonPath}`);
    console.log(`report.md: ${paths.mdPath}`);
    if (report.finalStatus !== "PASS") {
      process.exitCode = 1;
    }
  } catch (error) {
    if (tempRow?.id) {
      await cleanupArtifacts({ uid, pids: [tempRow.id] }).catch(() => {});
    }
    throw error;
  }
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
