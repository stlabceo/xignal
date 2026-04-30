const assert = require("assert");
const gridStats = require("../../stats/grid-stats-ingest");

const buildValidPayload = () => {
  const matrix = {};
  const bestcase = {};
  for (const period of gridStats.REQUIRED_PERIODS) {
    matrix[period] = {};
    let best = null;
    for (const tp of gridStats.TP_CANDIDATES) {
      const netProfit = Number(tp) * 100;
      const winrate = 50 + Number(tp);
      matrix[period][tp] = {
        winrate,
        net_profit: netProfit,
      };
      if (!best || netProfit > best.net_profit) {
        best = { tp: Number(tp), winrate, net_profit: netProfit };
      }
    }
    bestcase[period] = best;
  }
  return {
    type: "ING_ZR_GRID_STATS",
    symbol: "BINANCE:PUMPUSDT.P",
    timeframe: "60",
    calc_mode: "matrix",
    pair_count: 60,
    matrix,
    bestcase,
  };
};

const payload = buildValidPayload();
const validation = gridStats.validateGridStatsPayload(payload);
assert.strictEqual(validation.ok, true, validation.errors.join(","));
assert.strictEqual(validation.normalized.symbol, "PUMPUSDT");
assert.strictEqual(validation.normalized.timeframe, "1H");
assert.strictEqual(gridStats.normalizeGridStatsTimeframe("120"), "2H");
assert.strictEqual(gridStats.normalizeGridStatsSymbol("XRPUSDT.P"), "XRPUSDT");

const metrics = gridStats.expandGridStatsMetrics(payload);
const bestcases = gridStats.extractGridStatsBestcases(payload);
const ranks = gridStats.buildLandingRankRows(bestcases);
assert.strictEqual(metrics.length, 60);
assert.strictEqual(bestcases.length, 5);
assert.strictEqual(ranks.length, 4);
assert.match(gridStats.computeStatsPayloadHash(payload), /^[a-f0-9]{64}$/);

const duplicateHashA = gridStats.computeStatsPayloadHash(payload);
const duplicateHashB = gridStats.computeStatsPayloadHash(JSON.parse(JSON.stringify(payload)));
assert.strictEqual(duplicateHashA, duplicateHashB);

const invalidType = { ...payload, type: "WRONG" };
assert.strictEqual(gridStats.validateGridStatsPayload(invalidType).ok, false);

const malformed = JSON.parse(JSON.stringify(payload));
delete malformed.matrix["1month"]["0.4"];
assert.strictEqual(gridStats.validateGridStatsPayload(malformed).ok, false);

console.log("grid-stats-ingest-parser-test PASS");
