const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const createScenario = (name, invariant) => ({
  scenario: name,
  invariant,
  pass: true,
  failures: [],
});

const fail = (scenario, message) => {
  scenario.pass = false;
  scenario.failures.push(String(message || "assertion failed"));
};

const expectTrue = (scenario, condition, message) => {
  if (!condition) {
    fail(scenario, message);
  }
};

const expectEqual = (scenario, actual, expected, message) => {
  if (actual !== expected) {
    fail(
      scenario,
      `${message || "value mismatch"} (expected: ${JSON.stringify(expected)}, actual: ${JSON.stringify(actual)})`
    );
  }
};

const expectApprox = (scenario, actual, expected, tolerance = 1e-9, message) => {
  if (Math.abs(toNumber(actual) - toNumber(expected)) > tolerance) {
    fail(
      scenario,
      `${message || "numeric mismatch"} (expected: ${expected}, actual: ${actual}, tolerance: ${tolerance})`
    );
  }
};

const finalizeScenario = (scenario, details = {}) => ({
  ...details,
  scenario: scenario.scenario,
  invariant: scenario.invariant,
  failures: scenario.failures.slice(),
  pass: scenario.pass,
  status: scenario.pass ? "PASS" : "FAIL",
});

module.exports = {
  createScenario,
  expectTrue,
  expectEqual,
  expectApprox,
  finalizeScenario,
};
