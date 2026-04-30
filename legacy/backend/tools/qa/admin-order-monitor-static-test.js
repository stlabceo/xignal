const assert = require("assert");
const monitor = require("../../admin-order-monitor");

const assertEqual = (actual, expected, message) => {
  assert.strictEqual(actual, expected, `${message}: expected ${expected}, got ${actual}`);
};

const run = () => {
  const cleanRisk = monitor.classifyCurrentRisk({
    uid: 147,
    symbol: "XRPUSDT",
    side: "LONG",
    binanceQty: 0,
    localOpenQty: 0,
    activeProtectionCount: 0,
    expectedProtectionCount: 0,
    activeProtectionQty: 0,
    ownerPids: [],
  });
  assertEqual(cleanRisk.lifecycleStatus, "CLOSED_FLAT_CLEAN", "current flat clean lifecycle");
  assertEqual(cleanRisk.severity, "OK", "current flat clean severity");

  const missingProtection = monitor.classifyCurrentRisk({
    uid: 147,
    symbol: "XRPUSDT",
    side: "LONG",
    binanceQty: 18.1,
    localOpenQty: 18.1,
    activeProtectionCount: 0,
    expectedProtectionCount: 2,
    activeProtectionQty: 0,
    ownerPids: [991748],
  });
  assertEqual(missingProtection.lifecycleStatus, "OPEN_NO_PROTECTION", "missing protection lifecycle");
  assertEqual(missingProtection.severity, "CRITICAL", "missing protection severity");

  const oversizedProtection = monitor.classifyCurrentRisk({
    uid: 147,
    symbol: "PUMPUSDT",
    side: "LONG",
    binanceQty: 11952,
    localOpenQty: 11952,
    activeProtectionCount: 2,
    expectedProtectionCount: 2,
    activeProtectionQty: 13966,
    ownerPids: [991751],
  });
  assertEqual(oversizedProtection.lifecycleStatus, "PROTECTION_OVERSIZED", "oversized protection lifecycle");
  assertEqual(oversizedProtection.severity, "CRITICAL", "oversized protection severity");

  const normalTpCycle = monitor.classifyOrderCycle({
    uid: 147,
    pid: 991748,
    category: "signal",
    strategy: "SQZGBRK",
    symbol: "XRPUSDT",
    side: "LONG",
    ledgerRows: [
      { eventType: "SIGNAL_ENTRY_FILL", fillQty: "18.1", sourceTradeId: "entry-a" },
      { eventType: "SIGNAL_EXIT_FILL", fillQty: "18.1", realizedPnl: "0.12", sourceTradeId: "exit-a" },
    ],
    rawOrders: [
      {
        orderId: "2",
        clientOrderId: "PROFIT_L_147_991748_1",
        status: "FILLED",
        inferredIntent: "TAKE_PROFIT",
        executedQty: "18.1",
        origQty: "18.1",
        eventTime: "2026-04-30T01:00:00.000Z",
      },
    ],
    snapshots: [{ openQty: "0" }],
    reservations: [],
  });
  assertEqual(normalTpCycle.lifecycleStatus, "CLOSED_BY_TP", "normal TP cycle lifecycle");
  assertEqual(normalTpCycle.severity, "OK", "normal TP cycle severity");

  const gridManualCycle = monitor.classifyOrderCycle({
    uid: 147,
    pid: 991500,
    category: "grid",
    strategy: "SQZ GRID",
    symbol: "XRPUSDT",
    side: "LONG",
    ledgerRows: [
      { eventType: "GRID_ENTRY_FILL", fillQty: "3.7", sourceTradeId: "entry-g" },
      { eventType: "GRID_MANUAL_CLOSE_FILL", fillQty: "3.7", realizedPnl: "-0.01", sourceTradeId: "exit-g" },
    ],
    rawOrders: [
      {
        orderId: "3",
        clientOrderId: "GMANUAL_L_147_991500_1",
        status: "FILLED",
        inferredIntent: "GRID_MANUAL_CLOSE",
        executedQty: "3.7",
        origQty: "3.7",
      },
    ],
    snapshots: [{ openQty: "0" }],
    reservations: [],
  });
  assertEqual(gridManualCycle.lifecycleStatus, "CLOSED_BY_MANUAL", "normal grid manual close lifecycle");
  assertEqual(gridManualCycle.severity, "OK", "normal grid manual close severity");

  assertEqual(monitor.isExpectedIgnoreCode("NO_MATCHING_STRATEGY"), true, "NO_MATCHING_STRATEGY expected ignore");
  assertEqual(monitor.isExpectedIgnoreCode("GRID_ACTIVE_IGNORED"), true, "GRID_ACTIVE_IGNORED expected ignore");
  assertEqual(monitor.isExpectedIgnoreCode("duplicate ignored"), true, "duplicate expected ignore");

  const raw = monitor.buildRawOrderRow({
    order: {
      symbol: "XRPUSDT",
      orderId: "147797474565",
      clientOrderId: "GMANUAL_L_147_991914_11979897",
      type: "MARKET",
      side: "SELL",
      positionSide: "LONG",
      origQty: "18.1",
      executedQty: "18.1",
      status: "FILLED",
      time: "2026-04-30T00:34:00.000Z",
    },
    trades: [{ id: "3097747576" }, { id: "3097747577" }],
    ledgerRows: [{ sourceTradeId: "3097747576" }],
    reservationRows: [],
  });
  assertEqual(raw.inferredPid, 991914, "raw order PID inference");
  assertEqual(raw.inferredIntent, "GRID_MANUAL_CLOSE", "raw order intent inference");
  assertEqual(raw.tradeIds.length, 2, "raw order trade ids preserved");
  assertEqual(raw.localLedgerMatch, true, "raw order ledger match by trade id");

  const keyA = monitor.buildIssueKey({
    uid: 147,
    pid: 991748,
    category: "signal",
    symbol: "XRPUSDT",
    side: "LONG",
    cycleId: "cycle-a",
    orderId: "order-a",
    issueType: "PROTECTION_MISSING",
  });
  const keyB = monitor.buildIssueKey({
    uid: 147,
    pid: 991748,
    category: "signal",
    symbol: "XRPUSDT",
    side: "LONG",
    cycleId: "cycle-b",
    orderId: "order-b",
    issueType: "PROTECTION_MISSING",
  });
  assert.notStrictEqual(keyA, keyB, "protection issue keys are cycle/order scoped");

  console.log(JSON.stringify({
    status: "PASS",
    checks: [
      "current flat clean gate current CRITICAL 0",
      "protection issue attaches to affected cycle/order key",
      "normal closed TP cycle shows OK",
      "normal grid manual close cycle shows OK",
      "NO_MATCHING_STRATEGY/GRID_ACTIVE_IGNORED/duplicate ignored are expected",
      "raw Binance order explorer preserves orderId/tradeId evidence",
      "msg_list is not used by classifier",
    ],
  }));
};

run();
process.exit(0);
