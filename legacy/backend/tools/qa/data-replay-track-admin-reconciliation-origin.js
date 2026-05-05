const assert = require("assert");
const trackRecord = require("../../track-record-classifier");
const monitor = require("../../admin-order-monitor");

const entryFail = trackRecord.classifyTrackRecordRow({
  pid: 10,
  strategyCategory: "signal",
  completed: true,
  processStatus: "ABNORMAL",
  currentStepLabel: "EXACT_WAIT dispatch-timeout ENTRY_FAIL",
  entryLedgerCount: 0,
  exitLedgerCount: 0,
  ledgerFillCount: 0,
  algorithmMeta: { realizedPnl: 0, actualEntryNotional: null },
});
assert.strictEqual(entryFail.bucket, "review");
assert.strictEqual(entryFail.result, "REVIEW");

const pendingEntry = monitor.classifyCurrentRisk({
  uid: 156,
  symbol: "PUMPUSDT",
  side: "SHORT",
  binanceQty: 0,
  localOpenQty: 0,
  activeProtectionCount: 0,
  expectedProtectionCount: 0,
  activeProtectionQty: 0,
  activeEntryCount: 1,
  activeEntryQty: 13601,
  ownerPids: [9],
});
assert.strictEqual(pendingEntry.lifecycleStatus, "ACTIVE_ENTRY_PENDING");
assert.strictEqual(pendingEntry.currentRisk, true);

const raw = monitor.buildRawOrderRow({
  order: {
    symbol: "PUMPUSDT",
    orderId: "4322815438",
    clientOrderId: "GENTRY_S_156_9_35612954",
    type: "LIMIT",
    side: "SELL",
    positionSide: "SHORT",
    reduceOnly: false,
    origQty: "13601",
    executedQty: "0",
    status: "NEW",
  },
});
assert.strictEqual(raw.inferredPid, 9);
assert.strictEqual(raw.evidenceScope, "HISTORICAL_EXCHANGE_EVIDENCE");

const reconciled = monitor.classifyOrderCycle({
  uid: 156,
  pid: 9,
  category: "grid",
  strategy: "SQZ+GRID",
  symbol: "PUMPUSDT",
  side: "SHORT",
  ledgerRows: [
    { eventType: "GRID_ENTRY_FILL", fillQty: "13601", sourceTradeId: "entry" },
    {
      eventType: "GRID_MANUAL_CLOSE_FILL",
      fillQty: "13601",
      realizedPnl: "0",
      sourceTradeId: "exit",
      sourceClientOrderId: "GMANUAL_S_156_9_45968208",
    },
  ],
  rawOrders: [
    {
      orderId: "4323363345",
      clientOrderId: "GMANUAL_S_156_9_45968208",
      inferredIntent: "GRID_MANUAL_CLOSE",
      status: "FILLED",
      executedQty: "13601",
      origQty: "13601",
    },
  ],
  snapshots: [{ openQty: "0" }],
  reservations: [],
});
assert.strictEqual(reconciled.reconciliationOrigin, "RECONCILED_AFTER_PROJECTION_DEFECT");
assert.strictEqual(reconciled.severity, "WARN");

console.log(JSON.stringify({
  status: "PASS",
  scenario: "track-admin-reconciliation-origin",
  binanceDelta: 0,
  checks: [
    "PID10 ENTRY_FAIL is review",
    "PUMP PID9 active entry is current/ongoing evidence",
    "admin parser maps GENTRY_S_156_9_35612954 to pid 9",
    "GMANUAL/reconciled cycle is warning origin evidence, not normal proof",
  ],
}));
process.exit(0);
