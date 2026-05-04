"use strict";

const assert = require("assert");
const {
  evaluateDbTarget,
  assertSafeDbTarget,
} = require("../../database/db-fingerprint-guard");

const cases = [
  {
    name: "remote XIGNAL host and database fails",
    target: {
      host: "1.234.63.146",
      port: "3306",
      database: "xignal",
      user: "root",
    },
    ok: false,
  },
  {
    name: "localhost XIGNAL database fails",
    target: {
      host: "localhost",
      port: "3306",
      database: "xignal",
      user: "quantu_app",
    },
    ok: false,
  },
  {
    name: "localhost QUANTU database passes",
    target: {
      host: "localhost",
      port: "3307",
      database: "quantu_local",
      user: "quantu_app",
    },
    ok: true,
  },
  {
    name: "root user fails in dev",
    target: {
      host: "localhost",
      port: "3307",
      database: "quantu_local",
      user: "root",
    },
    ok: false,
  },
  {
    name: "seed runner remote target fails",
    target: {
      host: "1.234.63.146",
      port: "3306",
      database: "xignal",
      user: "quantu_migration",
    },
    ok: false,
    context: "seed-runner",
  },
  {
    name: "migration runner remote target fails",
    target: {
      host: "1.234.63.146",
      port: "3306",
      database: "xignal",
      user: "quantu_migration",
    },
    ok: false,
    context: "migration-runner",
  },
  {
    name: "QA runner remote target fails",
    target: {
      host: "1.234.63.146",
      port: "3306",
      database: "xignal",
      user: "quantu_app",
    },
    ok: false,
    context: "qa-runner",
  },
];

for (const testCase of cases) {
  const evaluation = evaluateDbTarget(testCase.target, {
    context: testCase.context || "guard-test",
  });
  assert.strictEqual(evaluation.ok, testCase.ok, testCase.name);

  if (testCase.ok) {
    assert.doesNotThrow(() => assertSafeDbTarget(testCase.target));
  } else {
    assert.throws(
      () => assertSafeDbTarget(testCase.target, { context: testCase.context || "guard-test" }),
      /QUANTU DB guard failed/,
      testCase.name
    );
  }
}

console.log("quantu_db_guard_static_test=PASS");
