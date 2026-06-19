"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const coin = fs.readFileSync(path.join(root, "coin.js"), "utf8");

const mustInclude = (needle, message) => assert(coin.includes(needle), message || `missing ${needle}`);
const mustMatch = (regex, message) => assert(regex.test(coin), message || `missing ${regex}`);

mustInclude("dispatchExactGridEvidenceToExistingHandler", "exact evidence direct dispatch helper must exist");
mustInclude("readFuturesUserTrades(uid, row.symbol", "direct dispatch must use order-scoped userTrades evidence");
mustInclude("orderId: tradeOrderId", "userTrades lookup must be exact order scoped");
mustInclude("getGridEngine().handleLiveOrderTradeUpdate", "direct dispatch must reuse existing canonical handler");
mustInclude("EXACT_EVIDENCE_DIRECT_HANDLER", "direct dispatch classification must be logged");
mustInclude("EXACT_STATUS_ROW_RECOVERY_REQUIRED", "lack of trade evidence must be explicit");
mustInclude("NO_EVIDENCE_NO_MUTATION", "missing exact evidence must not mutate state");
mustInclude("AMBIGUOUS_ROW_FALLBACK", "row-wide fallback must be restricted to ambiguous refs");
mustMatch(/if\(resolvedTargetScope !== 'PID_SIDE_TARGETED_BUT_ORDER_AMBIGUOUS'\)[\s\S]+NO_EVIDENCE_NO_MUTATION/, "non-ambiguous exact targets must not fall through to row-wide recovery");
assert(!coin.includes("ROW_WIDE_RECOVERY_AFTER_EXACT_STATUS"), "exact status should not automatically widen to row recovery");

const fakeTrades = [
  { id: 1, orderId: 77, qty: "4", price: "1.1", time: 1000 },
  { id: 2, orderId: 77, qty: "6", price: "1.2", time: 2000 },
];
let cumulative = 0;
const synthetic = fakeTrades.map((trade, index) => {
  cumulative += Number(trade.qty);
  return {
    x: "TRADE",
    X: index === fakeTrades.length - 1 ? "FILLED" : "PARTIALLY_FILLED",
    l: Number(trade.qty),
    z: cumulative,
    t: trade.id,
  };
});
assert.deepStrictEqual(synthetic.map((item) => item.l), [4, 6], "direct handler replay must use trade deltas");
assert.deepStrictEqual(synthetic.map((item) => item.z), [4, 10], "direct handler replay must preserve cumulative evidence separately");

console.log("grid-targeted-truth-sync-exact-dispatch-replay-test PASS");
