import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../../../..');
const adminRoutes = readFileSync(resolve(repoRoot, 'backend/routes/admin.js'), 'utf8');

const sliceBetween = (source, start, end) => {
	const startIndex = source.indexOf(start);
	assert.notEqual(startIndex, -1, `${start} exists`);
	const endIndex = source.indexOf(end, startIndex + start.length);
	assert.notEqual(endIndex, -1, `${end} exists after ${start}`);
	return source.slice(startIndex, endIndex);
};

const liveDeleteRoute = sliceBetween(adminRoutes, 'router.post("/live/del"', 'router.post("/test/del"');
const gridDeleteRoute = sliceBetween(adminRoutes, 'router.post("/grid/live/del"', 'router.post("/grid/test/del"');

assert.match(adminRoutes, /BOT_DRAFT_CLEANUP_STATUS = "CANCELED_DRAFT"/, 'soft cleanup status is explicit');
assert.match(liveDeleteRoute, /UPDATE \$\{getSignalTableName\("LIVE"\)\}/, 'Algorithm live cleanup updates row instead of deleting');
assert.match(liveDeleteRoute, /status = \?/, 'Algorithm live cleanup marks status');
assert.match(liveDeleteRoute, /BOT_DRAFT_CLEANUP_STATUS/, 'Algorithm live cleanup uses canonical cleanup status');
assert.doesNotMatch(liveDeleteRoute, /DELETE FROM \$\{getSignalTableName\("LIVE"\)\}/, 'Algorithm live cleanup does not physical delete');

assert.match(gridDeleteRoute, /UPDATE \$\{getGridTableName\("LIVE"\)\}/, 'Grid live cleanup updates row instead of deleting');
assert.match(gridDeleteRoute, /regimeStatus = \?/, 'Grid live cleanup marks regime status');
assert.match(gridDeleteRoute, /regimeEndReason = 'DRAFT_CLEANUP'/, 'Grid cleanup reason is explicit');
assert.doesNotMatch(gridDeleteRoute, /DELETE FROM \$\{getGridTableName\("LIVE"\)\}/, 'Grid live cleanup does not physical delete');
assert.match(adminRoutes, /cleanupMode:\s*"SOFT_STATUS"/, 'cleanup response declares soft status mode');
assert.match(adminRoutes, /hasDraftCleanupStatus/, 'lists can hide cleaned drafts');

console.log(JSON.stringify({ status: 'PASS', tests: 11 }));
