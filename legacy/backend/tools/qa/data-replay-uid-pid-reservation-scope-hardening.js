const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parsePlatformClientOrderId } = require("../../order-client-id");

const ledgerPath = path.resolve(__dirname, "../../pid-position-ledger.js");
const source = fs.readFileSync(ledgerPath, "utf8");

const scenarios = [
  {
    scenario: "parse platform clientOrderId uid/pid",
    expected: "uid/pid extracted",
    run: () => {
      const parsed = parsePlatformClientOrderId("GMANUAL_L_147_991914_11979897");
      assert.strictEqual(parsed.uid, 147);
      assert.strictEqual(parsed.pid, 991914);
      assert.strictEqual(parsed.prefix, "GMANUAL_L");
      assert.strictEqual(parsed.leg, "L");
    },
  },
  {
    scenario: "reservation cancel uid scoped",
    expected: "only scoped clientOrderId row can update",
    run: () => {
      assert.match(source, /const markReservationsCanceled = async \(clientOrderIds = \[\], scope = \{\}\)/);
      assert.match(source, /stage: "MARK_RESERVATIONS_CANCELED"/);
      assert.match(source, /WHERE \$\{reservationScope\.clauses\.join\(" AND "\)\}/);
      assert.doesNotMatch(source, /WHERE clientOrderId IN \(\$\{normalizedIds\.map/);
    },
  },
  {
    scenario: "bind actualOrderId uid scoped",
    expected: "actualOrderId bind uses scoped reservation lookup",
    run: () => {
      assert.match(source, /const bindReservationActualOrderId = async \(clientOrderId, actualOrderId, scope = \{\}\)/);
      assert.match(source, /stage: "BIND_RESERVATION_ACTUAL_ORDER_ID"/);
      assert.match(source, /SET actualOrderId = \?, updatedAt = CURRENT_TIMESTAMP\s+WHERE \$\{reservationScope\.clauses\.join\(" AND "\)\}/);
    },
  },
  {
    scenario: "applyExitFill reservation lookup uid/pid scoped",
    expected: "exit fill source reservation lookup uses caller uid/pid/category/side",
    run: () => {
      assert.match(source, /stage: "APPLY_EXIT_FILL_SOURCE_RESERVATION_LOOKUP"/);
      assert.match(source, /uid,\s+pid,\s+strategyCategory: normalizedCategory,\s+positionSide: normalizedPositionSide/);
      assert.match(source, /stage: "APPLY_RESERVATION_FILL_LOOKUP"/);
    },
  },
  {
    scenario: "parsed mismatch blocks write/update",
    expected: "clientOrderId encoded uid/pid mismatch blocks unsafe update",
    run: () => {
      assert.match(source, /CLIENT_ORDER_UID_MISMATCH_BLOCKED/);
      assert.match(source, /CLIENT_ORDER_PID_MISMATCH_BLOCKED/);
      assert.match(source, /return \{ ok: false, clauses: \[\], params: \[\], parsed, normalizedClientOrderId \}/);
    },
  },
];

const results = [];
for (const scenario of scenarios) {
  scenario.run();
  results.push({
    scenario: scenario.scenario,
    expected: scenario.expected,
    actual: "asserted in source without DB mutation",
    status: "PASS",
  });
}

const report = {
  status: "PASS",
  afterCleanup: 0,
  dbMutation: 0,
  scenarios: results,
};

if (require.main === module) {
  console.log(JSON.stringify(report, null, 2));
}

module.exports = { scenarios, report };
