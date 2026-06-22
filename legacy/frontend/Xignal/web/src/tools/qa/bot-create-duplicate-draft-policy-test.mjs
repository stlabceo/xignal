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

const liveAddRoute = sliceBetween(adminRoutes, "router.post('/live/add'", 'router.post("/live/auto"');
const gridAddRoute = sliceBetween(adminRoutes, 'router.post("/grid/live/add"', 'router.post("/grid/test/add"');

assert.match(adminRoutes, /BOT_CREATE_DUPLICATE_DRAFT_CODE = "BOT_CREATE_DUPLICATE_DRAFT"/, 'duplicate draft code is explicit');
assert.match(adminRoutes, /const findDuplicateSignalDraft = async/, 'Algorithm duplicate draft lookup exists');
assert.match(adminRoutes, /const findDuplicateGridDraft = async/, 'Grid duplicate draft lookup exists');
assert.match(adminRoutes, /sendDuplicateDraftResponse/, 'duplicate draft response helper exists');
assert.match(adminRoutes, /res\.status\(409\)\.json/, 'duplicate draft returns 409');
assert.match(adminRoutes, /existingPid/, 'duplicate response exposes existing PID');
assert.match(adminRoutes, /loadDraftDependencyCounts/, 'duplicate policy requires no queue/ledger/snapshot/reservation');
assert.match(adminRoutes, /hasNoDraftDependencies/, 'duplicate policy checks clean draft dependencies');

const signalDuplicateIndex = liveAddRoute.indexOf('findDuplicateSignalDraft');
const signalInsertIndex = liveAddRoute.indexOf('const reData = await dbcon.DBCall');
assert(signalDuplicateIndex > -1 && signalInsertIndex > -1 && signalDuplicateIndex < signalInsertIndex, 'Algorithm duplicate guard runs before SP insert');

const gridDuplicateIndex = gridAddRoute.indexOf('findDuplicateGridDraft');
const gridInsertIndex = gridAddRoute.indexOf('const [result] = await db.query');
assert(gridDuplicateIndex > -1 && gridInsertIndex > -1 && gridDuplicateIndex < gridInsertIndex, 'Grid duplicate guard runs before insert');

assert.match(adminRoutes, /COALESCE\(type, ''\) = \?/, 'Algorithm duplicate key includes runtime strategy');
assert.match(adminRoutes, /COALESCE\(symbol, ''\) = \?/, 'duplicate key includes symbol');
assert.match(adminRoutes, /COALESCE\(bunbong, ''\) = \?/, 'duplicate key includes timeframe');
assert.match(adminRoutes, /COALESCE\(strategySignal, ''\) = \?/, 'Grid duplicate key includes runtime strategySignal');
assert.match(adminRoutes, /UPPER\(COALESCE\(enabled, 'N'\)\) = 'N'/, 'duplicate policy only targets disabled drafts');

console.log(JSON.stringify({ status: 'PASS', tests: 16 }));
