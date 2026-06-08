"use strict";

const assert = require("assert");
const gridRuntime = require("../../grid-runtime");
const helper = require("./grid-tve-canonical-payload-helper");

let tests = 0;
const check = (name, fn) => {
  fn();
  tests += 1;
  console.log(`[PASS] ${name}`);
};

const baseInput = {
  strategySignal: "SQZ+GRID",
  symbol: "PUMPUSDT.P",
  timeframe: "30min",
  supportPrice: "0.001465000000",
  resistancePrice: "0.001525000000",
  triggerPrice: "0.001495000000",
  signalTime: "2026-06-08T10:42:32.123Z",
};

check("ARM payload uses backend canonical buildGridRegimeKey output", () => {
  const built = helper.buildGridArmTvePayloadUsingCanonicalKey(baseInput);
  assert.strictEqual(built.ok, true);
  assert.strictEqual(built.payload.gridRegimeKey, gridRuntime.buildGridRegimeKey(built.payload));
});

check("ARM payload validates in ENFORCE mode before send", () => {
  const built = helper.buildGridArmTvePayloadUsingCanonicalKey(baseInput);
  const gate = helper.validateGridArmPayloadBeforeSend(built.payload);
  assert.strictEqual(gate.ok, true);
  assert.strictEqual(gate.equality, true);
});

check("EXIT payload uses the same canonical gridRegimeKey as ARM", () => {
  const arm = helper.buildGridArmTvePayloadUsingCanonicalKey(baseInput);
  const exit = helper.buildGridExitTvePayloadUsingCanonicalKey(baseInput);
  assert.strictEqual(exit.ok, true);
  assert.strictEqual(exit.payload.gridRegimeKey, arm.payload.gridRegimeKey);
});

check("EXIT payload validates in ENFORCE/REJECT mode before send", () => {
  const built = helper.buildGridExitTvePayloadUsingCanonicalKey(baseInput);
  const gate = helper.validateGridExitPayloadBeforeSend(built.payload);
  assert.strictEqual(gate.ok, true);
  assert.strictEqual(gate.equality, true);
});

check("key mismatch blocks send before route", () => {
  const built = helper.buildGridArmTvePayloadUsingCanonicalKey(baseInput);
  const gate = helper.validateGridArmPayloadBeforeSend({
    ...built.payload,
    gridRegimeKey: "wrong",
  });
  assert.strictEqual(gate.ok, false);
  assert.ok(["grid-arm-grid-regime-key-mismatch", "grid-regime-key-send-gate-mismatch"].includes(gate.reason));
});

check("PUMPUSDT.P normalizes to PUMPUSDT in canonical key", () => {
  const built = helper.buildGridArmTvePayloadUsingCanonicalKey(baseInput);
  assert.ok(built.payload.gridRegimeKey.includes("|PUMPUSDT|"));
  assert.ok(!built.payload.gridRegimeKey.includes("PUMPUSDT.P"));
});

check("30MIN timeframe normalization is canonical", () => {
  const built = helper.buildGridArmTvePayloadUsingCanonicalKey(baseInput);
  assert.ok(built.payload.gridRegimeKey.includes("|30MIN|"));
});

check("price normalization removes trailing zeros", () => {
  const built = helper.buildGridArmTvePayloadUsingCanonicalKey(baseInput);
  assert.ok(built.payload.gridRegimeKey.includes("|0.001465|0.001525|0.001495|"));
});

check("time normalization removes milliseconds and uses T separator", () => {
  const built = helper.buildGridArmTvePayloadUsingCanonicalKey(baseInput);
  const normalizedTime = gridRuntime.normalizeGridRegimeTime(baseInput.signalTime);
  assert.ok(built.payload.gridRegimeKey.endsWith(`|${normalizedTime}`));
  assert.ok(normalizedTime.includes("T"));
  assert.ok(!normalizedTime.includes("."));
});

check("signalPrice is absent from helper output", () => {
  const built = helper.buildGridArmTvePayloadUsingCanonicalKey({ ...baseInput, signalPrice: 1.23 });
  assert.strictEqual(built.ok, false);
  assert.strictEqual(built.reason, "forbidden-grid-tve-field:signalPrice");
});

check("PID/UID/target identity fields are rejected", () => {
  for (const field of ["pid", "uid", "userId", "targetId"]) {
    const built = helper.buildGridArmTvePayloadUsingCanonicalKey({ ...baseInput, [field]: 204 });
    assert.strictEqual(built.ok, false);
    assert.strictEqual(built.reason, `forbidden-grid-tve-field:${field}`);
  }
});

check("helper output contains no forbidden identity fields", () => {
  const built = helper.buildGridArmTvePayloadUsingCanonicalKey(baseInput);
  for (const field of helper.FORBIDDEN_GRID_TVE_FIELDS) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(built.payload, field), false);
  }
});

console.log(JSON.stringify({ ok: true, tests, dbMutation: 0, binanceWrite: 0 }, null, 2));
setTimeout(() => process.exit(0), 100);
