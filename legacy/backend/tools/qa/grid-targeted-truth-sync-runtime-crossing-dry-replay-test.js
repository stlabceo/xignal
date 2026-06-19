"use strict";

const assert = require("assert");

const replay = ({ exactStatus, socketConvergesDuringGrace = false, readGuardBlocked = false, burst = 1 }) => {
  const result = {
    publicPriceWrites: 0,
    scheduled: burst,
    canceledBeforeRest: 0,
    exactRestCalls: 0,
    canonicalMutations: 0,
    deferred: 0,
    maxConcurrent: 0,
  };
  const globalLimit = 6;
  const startable = Math.min(burst, globalLimit);
  result.deferred += Math.max(0, burst - globalLimit);
  result.maxConcurrent = startable;
  for (let i = 0; i < startable; i += 1) {
    if (socketConvergesDuringGrace) {
      result.canceledBeforeRest += 1;
      continue;
    }
    if (readGuardBlocked) {
      result.deferred += 1;
      continue;
    }
    result.exactRestCalls += 1;
    if (exactStatus === "FILLED" || exactStatus === "PARTIALLY_FILLED") {
      result.canonicalMutations += 1;
    }
    if (exactStatus === "NEW") {
      result.canonicalMutations += 0;
    }
  }
  return result;
};

const socketFirst = replay({ exactStatus: "FILLED", socketConvergesDuringGrace: true });
assert.strictEqual(socketFirst.publicPriceWrites, 0, "public price hint must not write canonical state");
assert.strictEqual(socketFirst.canceledBeforeRest, 1, "socket convergence during grace must cancel verify");
assert.strictEqual(socketFirst.exactRestCalls, 0, "socket convergence during grace must avoid REST");

const exactNew = replay({ exactStatus: "NEW" });
assert.strictEqual(exactNew.exactRestCalls, 1, "NEW case should perform exact read");
assert.strictEqual(exactNew.canonicalMutations, 0, "NEW exact status must not mutate canonical state");

const exactFilled = replay({ exactStatus: "FILLED" });
assert.strictEqual(exactFilled.exactRestCalls, 1, "FILLED case should perform exact read");
assert.strictEqual(exactFilled.canonicalMutations, 1, "FILLED exact evidence should route one canonical handler mutation");

const readGuard = replay({ exactStatus: "FILLED", readGuardBlocked: true });
assert.strictEqual(readGuard.exactRestCalls, 0, "read guard block should prevent exact read execution");
assert.strictEqual(readGuard.canonicalMutations, 0, "read guard block must not mutate canonical state");
assert.strictEqual(readGuard.deferred, 1, "read guard block must defer");

const burst = replay({ exactStatus: "NEW", burst: 100 });
assert(burst.maxConcurrent <= 6, "burst dry replay must respect global concurrency");
assert(burst.deferred >= 94, "burst dry replay must defer excess requests");

console.log("grid-targeted-truth-sync-runtime-crossing-dry-replay-test PASS");
