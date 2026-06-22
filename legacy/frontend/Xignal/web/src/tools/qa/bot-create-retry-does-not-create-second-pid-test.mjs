import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../../../..');
const adminRoutes = readFileSync(resolve(repoRoot, 'backend/routes/admin.js'), 'utf8');
const tradingService = readFileSync(resolve(__dirname, '../../services/trading.js'), 'utf8');

const sliceBetween = (source, start, end) => {
	const startIndex = source.indexOf(start);
	assert.notEqual(startIndex, -1, `${start} exists`);
	const endIndex = source.indexOf(end, startIndex + start.length);
	assert.notEqual(endIndex, -1, `${end} exists after ${start}`);
	return source.slice(startIndex, endIndex);
};

const liveAddRoute = sliceBetween(adminRoutes, "router.post('/live/add'", 'router.post("/live/auto"');
const gridAddRoute = sliceBetween(adminRoutes, 'router.post("/grid/live/add"', 'router.post("/grid/test/add"');

assert.match(liveAddRoute, /return sendDuplicateDraftResponse/, 'Algorithm retry returns duplicate response instead of inserting');
assert.match(gridAddRoute, /return sendDuplicateDraftResponse/, 'Grid retry returns duplicate response instead of inserting');
assert.doesNotMatch(liveAddRoute, /deduped:\s*true/, 'Option A existing PID reuse is not enabled');
assert.doesNotMatch(gridAddRoute, /deduped:\s*true/, 'Grid does not silently reuse duplicate draft');
assert.match(liveAddRoute, /botKind:\s*"ALGORITHM"/, 'Algorithm duplicate response declares bot kind');
assert.match(gridAddRoute, /botKind:\s*"GRID"/, 'Grid duplicate response declares bot kind');
assert.match(tradingService, /normalizeCreateError/, 'frontend normalizes 409 duplicate errors through error path');
assert.match(tradingService, /data\?\.code \|\| 'BOT_CREATE_FAILED'/, 'frontend preserves backend duplicate code');

console.log(JSON.stringify({ status: 'PASS', tests: 8 }));
