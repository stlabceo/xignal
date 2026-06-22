import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '../..');
const repoRoot = resolve(srcRoot, '../../../..');

const readFrontend = (path) => readFileSync(resolve(srcRoot, path), 'utf8');
const readRepo = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

const adminSource = readRepo('backend/routes/admin.js');
const serviceSource = readFrontend('services/trading.js');
const modalSource = readFrontend('pages/trading/BotSetupModal.jsx');
const tradingPageSource = readFrontend('pages/trading/TradingPage.jsx');
const strategySearchSource = readFrontend('pages/strategySearch/StrategySearchPage.jsx');

const sliceBetween = (source, start, end) => {
	const startIndex = source.indexOf(start);
	assert.notEqual(startIndex, -1, `${start} exists`);
	const endIndex = source.indexOf(end, startIndex + start.length);
	assert.notEqual(endIndex, -1, `${end} exists after ${start}`);
	return source.slice(startIndex, endIndex);
};

const liveAddRoute = sliceBetween(adminSource, "router.post('/live/add'", 'router.post("/live/auto"');
const gridLiveAddRoute = sliceBetween(adminSource, 'router.post("/grid/live/add"', 'router.post("/grid/test/add"');
const dashboardRefresh = sliceBetween(tradingPageSource, 'const refreshAfterBotCreated', 'const rawBotRows');

assert.match(liveAddRoute, /const createdId = Number\(firstProcedureRow\(reData\)\?\.id \|\| 0\);/, 'algorithm create reads the procedure-returned exact id');
assert.match(liveAddRoute, /if \(!createdId\) \{[\s\S]*sendSaveFailure/, 'algorithm create blocks success when the exact id is missing');
assert.match(liveAddRoute, /botKind:\s*"ALGORITHM"/, 'algorithm create response declares bot kind');
assert.match(liveAddRoute, /id:\s*createdId/, 'algorithm create response returns id');
assert.match(liveAddRoute, /pid:\s*createdId/, 'algorithm create response returns pid');
assert.match(liveAddRoute, /enabled:\s*"N"/, 'algorithm create response keeps the default disabled contract');
assert.doesNotMatch(liveAddRoute, /return res\.send\(true\)/, 'algorithm create no longer returns boolean success');

assert.match(gridLiveAddRoute, /botKind:\s*"GRID"/, 'grid create response declares bot kind');
assert.match(gridLiveAddRoute, /id:\s*result\.insertId/, 'grid create response returns insertId as id');
assert.match(gridLiveAddRoute, /pid:\s*result\.insertId/, 'grid create response returns insertId as pid');
assert.match(gridLiveAddRoute, /enabled:\s*"N"/, 'grid create response keeps the default disabled contract');

assert.match(serviceSource, /const normalizeCreateResponse = \(response, botKind\) =>/, 'frontend service normalizes create responses');
assert.match(serviceSource, /const pid = Number\(data\?\.pid \|\| data\?\.id \|\| 0\);/, 'frontend service accepts only exact pid or id');
assert.match(serviceSource, /BOT_CREATE_PID_MISSING/, 'frontend service exposes missing PID as an error');
assert.match(serviceSource, /callback\(normalizeCreateResponse\(res, 'ALGORITHM'\)\)/, 'algorithm upload uses canonical response shape');
assert.match(serviceSource, /callback\(normalizeCreateResponse\(res, 'GRID'\)\)/, 'grid upload uses canonical response shape');

assert.doesNotMatch(modalSource, /response === true/, 'modal does not treat boolean true as create success');
assert.doesNotMatch(modalSource, /data === true/, 'modal does not treat boolean response data as create success');
assert.match(modalSource, /Number\(getCreatedPid\(data\)\) > 0/, 'modal requires PID before showing success');
assert.match(modalSource, /getCreatedPid\(response\) \|\| getCreatedPid\(createdInfo\)/, 'modal success message uses the exact created PID');

assert.match(dashboardRefresh, /const exactId = Number\(responseData\?\.id \|\| responseData\?\.pid \|\| 0\);/, 'dashboard refresh reads exact response id');
assert.match(dashboardRefresh, /rows\.find\(\(row\) => Number\(row\.id \|\| 0\) === exactId\)/, 'dashboard refresh matches only the exact PID row');
assert.doesNotMatch(dashboardRefresh, /a_name|strategySignal|symbol/, 'dashboard refresh does not infer created row by name, strategy, or symbol');

assert.doesNotMatch(strategySearchSource, /ATF_VIXFIX[\s\S]*liveCode:\s*'ATF\+VIXFIX'/, 'strategy search does not map legacy QBT ATF_VIXFIX to live create');
assert.doesNotMatch(strategySearchSource, /NY_QUIET_CLOSE_ASIA_BOX[\s\S]*liveCode:\s*'SQZ\+GRID'/, 'strategy search does not map legacy QBT NYBOX to live create');
assert.doesNotMatch(modalSource, /ATF_VIXFIX[\s\S]*liveCode:\s*'ATF\+VIXFIX'/, 'modal does not preserve legacy ATF_VIXFIX mapping');
assert.doesNotMatch(modalSource, /NY_QUIET_CLOSE_ASIA_BOX[\s\S]*liveCode:\s*'SQZ\+GRID'/, 'modal does not preserve legacy NYBOX mapping');
assert.doesNotMatch(modalSource, /strategyTypeById/, 'modal does not hardcode live strategy code type inference');
assert.doesNotMatch(modalSource, /prefill\.strategySignal \|\| prefill\.strategyCode/, 'modal does not infer live strategy source from legacy prefill fields');
assert.doesNotMatch(modalSource, /fallback\.strategySignal/, 'modal does not create fallback live strategy codes');
assert.match(modalSource, /strategySource = getExplicitLiveStrategyCode\(prefill\)/, 'modal only accepts explicit live strategy code fields for prefill');
assert.match(modalSource, /!canCreateFromSelectedStrategy/, 'modal blocks create when no explicit live strategy option is selected');

console.log(JSON.stringify({ status: 'PASS', tests: 29 }));
