const assert = require("assert");
const { parsePlatformClientOrderId } = require("../../order-client-id");

const cases = [
  ["NEW_147_991748", { prefix: "NEW", uid: 147, pid: 991748 }],
  ["SPLITTP_147_991748_123", { prefix: "SPLITTP", uid: 147, pid: 991748 }],
  ["STOP_147_991752_4276598703", { prefix: "STOP", uid: 147, pid: 991752 }],
  ["PROFIT_147_991752_4276598703", { prefix: "PROFIT", uid: 147, pid: 991752 }],
  ["TIME_147_18_147615759568", { prefix: "TIME", uid: 147, pid: 18 }],
  ["GENTRY_L_147_991501_24408595", { prefix: "GENTRY_L", uid: 147, pid: 991501, leg: "L" }],
  ["GENTRY_S_147_991501_24408724", { prefix: "GENTRY_S", uid: 147, pid: 991501, leg: "S" }],
  ["GTP_L_147_991501_1", { prefix: "GTP_L", uid: 147, pid: 991501, leg: "L" }],
  ["GTP_S_147_991501_1", { prefix: "GTP_S", uid: 147, pid: 991501, leg: "S" }],
  ["GSTOP_L_147_991501_1", { prefix: "GSTOP_L", uid: 147, pid: 991501, leg: "L" }],
  ["GSTOP_S_147_991501_1", { prefix: "GSTOP_S", uid: 147, pid: 991501, leg: "S" }],
  ["GMANUAL_L_147_991501_1", { prefix: "GMANUAL_L", uid: 147, pid: 991501, leg: "L" }],
  ["GMANUAL_S_147_991501_1", { prefix: "GMANUAL_S", uid: 147, pid: 991501, leg: "S" }],
];

for (const [clientOrderId, expected] of cases) {
  const parsed = parsePlatformClientOrderId(clientOrderId);
  assert(parsed, `${clientOrderId} should parse`);
  assert.strictEqual(parsed.prefix, expected.prefix, clientOrderId);
  assert.strictEqual(parsed.uid, expected.uid, clientOrderId);
  assert.strictEqual(parsed.pid, expected.pid, clientOrderId);
  if (expected.leg) {
    assert.strictEqual(parsed.leg, expected.leg, clientOrderId);
  }
}

assert.strictEqual(parsePlatformClientOrderId("web_manual_close"), null);
assert.strictEqual(parsePlatformClientOrderId("STOP_not_a_uid_991752"), null);

console.log("uid-pid-reservation-scope-static-test PASS");
