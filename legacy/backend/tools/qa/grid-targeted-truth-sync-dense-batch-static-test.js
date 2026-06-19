"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const coin = fs.readFileSync(path.join(root, "coin.js"), "utf8");

const mustInclude = (source, needle, message) => {
  assert(source.includes(needle), message || `missing ${needle}`);
};

mustInclude(
  coin,
  "GRID_TARGETED_TRUTH_SYNC_DENSE_CRITICAL_THRESHOLD",
  "dense critical threshold must be configurable"
);
mustInclude(
  coin,
  "tryStartGridTargetedTruthSyncDenseCriticalBatch",
  "targeted truth-sync queue must attempt same-symbol dense critical batching"
);
mustInclude(
  coin,
  "executeGridTargetedTruthSyncDenseCriticalBatch",
  "dense critical batch must have a dedicated executor"
);
mustInclude(
  coin,
  "readFuturesOpenAlgoOrders(numericUid, normalizedSymbol)",
  "dense batch must first read symbol-scoped open algo orders"
);
mustInclude(
  coin,
  "readFuturesAllAlgoOrders(numericUid, normalizedSymbol, { limit: 1000 })",
  "dense batch must read symbol-scoped all algo orders instead of per-order status"
);
mustInclude(
  coin,
  "readFuturesUserTrades(numericUid, normalizedSymbol, { limit: 1000 })",
  "dense batch must reuse one symbol trade read for fill evidence"
);
mustInclude(
  coin,
  "findGridDenseAlgoOrderForTask(candidate.task, indexedOrders)",
  "dense batch must match only candidate order references"
);
mustInclude(
  coin,
  "readGridDenseExactOrderFallback",
  "dense batch must have exact-order fallback for allAlgo/openAlgo pagination or age gaps"
);
mustInclude(
  coin,
  "GRID_TARGETED_TRUTH_SYNC_DENSE_EXACT_FALLBACK_MAX",
  "dense exact fallback must be bounded to avoid unbounded REST bursts"
);
mustInclude(
  coin,
  "DENSE_EXACT_ORDER_NOT_FOUND_AFTER_FALLBACK",
  "dense fallback misses must remain observable through the safety-net path"
);
mustInclude(
  coin,
  "recoveryScope: 'NO_EVIDENCE_NO_MUTATION'",
  "dense batch must not mutate when exchange evidence is missing"
);
mustInclude(
  coin,
  "preloadedTrades: symbolTrades",
  "dense batch must avoid per-candidate userTrades calls after one symbol read"
);
mustInclude(
  coin,
  "denseCriticalTradeFallbacks",
  "dense batch must retry order-scoped userTrades when the symbol batch misses a filled order"
);

console.log("grid-targeted-truth-sync-dense-batch-static-test PASS");
