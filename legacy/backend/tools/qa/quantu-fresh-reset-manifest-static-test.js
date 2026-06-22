"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const db = require("../../database/connect/config");

const repoRoot = path.resolve(__dirname, "../../../..");
const resetToolPath = path.join(repoRoot, "legacy/database/tools/quantu-fresh-operational-reset.js");

const extractArray = (source, name) => {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  assert.ok(match, `${name} array exists`);
  return Array.from(match[1].matchAll(/"([A-Za-z0-9_]+)"/g)).map((item) => item[1]);
};

(async () => {
  const source = fs.readFileSync(resetToolPath, "utf8");
  const resetTables = extractArray(source, "RESET_TABLES");
  const preserveTables = extractArray(source, "PRESERVE_TABLES");
  const resetSet = new Set(resetTables);
  const preserveSet = new Set(preserveTables);

  assert.ok(resetSet.has("order_intent_queue"), "order_intent_queue is reset-classified");
  assert.ok(resetSet.has("auth_email_verification_tokens"), "auth_email_verification_tokens is reset-classified");
  assert.ok(resetSet.has("strategy_catalog"), "strategy_catalog is reset-classified for admin registration rebuild");
  assert.ok(!preserveSet.has("strategy_catalog"), "strategy_catalog is not preserve-classified");
  [
    "landing_strategy_rank_cache",
    "strategy_stats_bestcase",
    "strategy_stats_metric",
    "strategy_stats_raw",
  ].forEach((tableName) => {
    assert.ok(resetSet.has(tableName), `${tableName} is reset-classified`);
    assert.ok(!preserveSet.has(tableName), `${tableName} is not preserve-classified`);
  });

  assert.match(source, /readAdminMemberSeedCandidate/, "admin seed candidate reader exists");
  assert.match(source, /restoreAdminMemberSeed/, "admin seed restore function exists");
  assert.match(source, /seedRow\.appKey\s*=\s*null/, "admin seed clears appKey");
  assert.match(source, /seedRow\.appSecret\s*=\s*null/, "admin seed clears appSecret");
  assert.match(source, /seedRow\.tradeAccessMode\s*=\s*"DEMO_ONLY"/, "admin seed forces DEMO_ONLY");
  assert.match(source, /credentialPolicy:\s*"CLEAR_API_KEY_SECRET"/, "admin seed reports secret-clear policy");

  const overlap = resetTables.filter((tableName) => preserveSet.has(tableName));
  assert.deepStrictEqual(overlap, [], "reset/preserve manifest has no overlap");

  const [rows] = await db.query(
    "SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  const classified = new Set([...resetTables, ...preserveTables]);
  const unclassified = rows.map((row) => row.tableName).filter((tableName) => !classified.has(tableName));
  assert.deepStrictEqual(unclassified, [], "all current base tables are classified");

  console.log(JSON.stringify({
    status: "PASS",
    resetTables: resetTables.length,
    preserveTables: preserveTables.length,
    unclassified: unclassified.length,
  }));
  await db.end();
})().catch(async (error) => {
  try {
    await db.end();
  } catch (_ignored) {
  }
  console.error(error);
  process.exit(1);
});
