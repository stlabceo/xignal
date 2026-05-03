const assert = require("assert");
const guard = require("../../binance-read-guard");

const makeError = (status, retryAfter) => ({
  response: {
    status,
    headers: retryAfter ? { "retry-after": retryAfter } : {},
    data: { code: status, msg: `mock ${status}` },
  },
});

guard.resetForTest();

guard.assertPrivateRequestAllowed({ uid: 147, endpoint: "/fapi/v3/account" });
guard.recordPrivateRequestFailure({
  uid: 147,
  endpoint: "/fapi/v3/account",
  error: makeError(429, "2"),
});

assert.throws(
  () => guard.assertPrivateRequestAllowed({ uid: 147, endpoint: "/fapi/v3/account" }),
  /rate-limit|circuit/i
);

guard.resetForTest();
guard.recordPrivateRequestFailure({
  uid: 147,
  endpoint: "/fapi/v3/account",
  error: makeError(418, "5"),
});

assert.throws(
  () => guard.assertPrivateRequestAllowed({ uid: 154, endpoint: "/fapi/v2/positionRisk" }),
  /circuit/i
);

const snapshot = guard.getStateSnapshot();
assert.strictEqual(snapshot.globalBlocked, true);
assert.ok(snapshot.counters.some((row) => row.outcome === "http_418"));

guard.resetForTest();
assert.doesNotThrow(() => guard.assertPrivateRequestAllowed({ uid: 154, endpoint: "/fapi/v2/positionRisk" }));

console.log("binance-read-guard-static-test PASS");
