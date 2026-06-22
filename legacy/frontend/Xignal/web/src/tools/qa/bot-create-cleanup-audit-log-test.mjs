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

assert.match(adminRoutes, /LIVE_DRAFT_CLEANUP_ACTION = "USER_CLEANUP_DRAFT"/, 'cleanup audit action is explicit');
assert.match(liveDeleteRoute, /writeControlAudit\(req/, 'Algorithm cleanup writes audit');
assert.match(gridDeleteRoute, /writeControlAudit\(req/, 'Grid cleanup writes audit');
assert.match(liveDeleteRoute, /actionCode:\s*LIVE_DRAFT_CLEANUP_ACTION/, 'Algorithm cleanup uses cleanup audit action');
assert.match(gridDeleteRoute, /actionCode:\s*LIVE_DRAFT_CLEANUP_ACTION/, 'Grid cleanup uses cleanup audit action');
assert.match(liveDeleteRoute, /note:\s*"algorithm-draft-cleanup"/, 'Algorithm cleanup audit note is explicit');
assert.match(gridDeleteRoute, /note:\s*"grid-draft-cleanup"/, 'Grid cleanup audit note is explicit');
assert.match(liveDeleteRoute, /cleanupMode:\s*"SOFT_STATUS"/, 'Algorithm audit metadata records cleanup mode');
assert.match(gridDeleteRoute, /cleanupMode:\s*"SOFT_STATUS"/, 'Grid audit metadata records cleanup mode');
assert.match(adminRoutes, /Explicit USER_DELETE_STRATEGY confirmation is required/, 'cleanup still requires explicit user intent');

console.log(JSON.stringify({ status: 'PASS', tests: 10 }));
