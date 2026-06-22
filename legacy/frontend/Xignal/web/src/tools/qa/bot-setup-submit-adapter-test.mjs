import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '../..');

const read = (path) => readFileSync(resolve(srcRoot, path), 'utf8');

const modalSource = read('pages/trading/BotSetupModal.jsx');
const dashboardSource = read('pages/trading/TradingPage.jsx');
const strategySearchSource = read('pages/strategySearch/StrategySearchPage.jsx');
const takeProfitSource = read('pages/takeProfitSearch/TakeProfitSearchPage.jsx');
const tradingServiceSource = read('services/trading.js');

const between = (source, startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	assert.notEqual(start, -1, `${startMarker} exists`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.notEqual(end, -1, `${endMarker} exists after ${startMarker}`);
	return source.slice(start, end);
};

let tests = 0;
const check = (condition, message) => {
	tests += 1;
	assert.ok(condition, message);
};

const algorithmPayload = between(modalSource, 'const makeAlgorithmPayload = (form, strategyItem) => {', 'const makeGridPayload = (form, strategyItem) => {');
const gridPayload = between(modalSource, 'const makeGridPayload = (form, strategyItem) => {', 'const isSuccessfulCreateResponse');
const submitBlock = between(modalSource, 'const callCreateApi = (isGrid, payload) =>', 'const validateFormForCreate');
const strategyPrefill = between(strategySearchSource, 'const buildStrategyBotPrefill =', 'function StrategyDetailModal');

check(submitBlock.includes('isGrid ? trading.gridLiveDetailUpload : trading.liveDetailUpload'), 'Algorithm/Grid submit uses the correct live service branch');
check(!modalSource.includes('testDetailUpload(') && !modalSource.includes('gridTestDetailUpload('), 'submit path never calls test add mutation');
check(!modalSource.includes('liveAutoItem(') && !modalSource.includes('gridLiveAutoItem(') && !modalSource.includes('GRID_LIVE_ARM'), 'submit path does not auto enable/start/ARM');

check(algorithmPayload.includes('type: runtimeStrategyCode'), 'Algorithm payload maps runtime strategy to type');
check(algorithmPayload.includes('liveStrategyCode: form.strategySignal'), 'Algorithm payload carries selected liveStrategyCode separately');
check(algorithmPayload.includes('runtimeStrategyCode'), 'Algorithm payload carries runtimeStrategyCode separately');
check(algorithmPayload.includes('symbol: normalizeSymbol(form.symbol)'), 'Algorithm payload preserves runtime symbol through normalizeSymbol');
check(algorithmPayload.includes('bunbong: toSignalPayloadBunbong(form.bunbong)'), 'Algorithm payload maps timeframe to backend bunbong');
check(algorithmPayload.includes('profit: form.splitTakeProfitEnabled ?') && algorithmPayload.includes('margin: form.margin') && algorithmPayload.includes('leverage: form.leverage'), 'Algorithm payload carries TP, margin, and leverage without unit conversion');
check(algorithmPayload.includes("if (form.stopLossMode === 'percent')") && algorithmPayload.includes('payload.stopLoss = form.stopLoss'), 'Algorithm percent stop is included only when active');
check(algorithmPayload.includes("if (form.stopLossMode === 'reverse')") && algorithmPayload.includes("payload.stopLossReverseEnabled = 'Y'"), 'Algorithm reverse stop is included only when active');
check(algorithmPayload.includes("if (form.stopLossMode === 'time')") && algorithmPayload.includes("payload.stopLossTimeEnabled = 'Y'") && algorithmPayload.includes('payload.stopLossTimeValue = form.stopLossTimeValue'), 'Algorithm time stop is included only when active');

check(gridPayload.includes('strategySignal: runtimeStrategyCode'), 'Grid payload maps runtime strategy to strategySignal');
check(gridPayload.includes('liveStrategyCode: form.strategySignal'), 'Grid payload carries selected liveStrategyCode separately');
check(gridPayload.includes('symbol: normalizeSymbol(form.symbol)'), 'Grid payload preserves runtime symbol through normalizeSymbol');
check(gridPayload.includes('bunbong: form.bunbong'), 'Grid payload maps timeframe to bunbong without algorithm conversion');
check(gridPayload.includes('profit: form.profit') && gridPayload.includes('tradeValue: toNumber(form.margin) * toNumber(form.leverage)'), 'Grid payload carries TP and calculates margin x leverage tradeValue');
check(!/direction|signalType|stopLoss|stopLossTime|stopLossReverse/.test(gridPayload), 'Grid payload has no direction or stop fields');

check(modalSource.includes('submitInFlightRef.current') && modalSource.includes('createCompleted'), 'double submit and post-success re-submit are guarded');
check(modalSource.includes('strategySource = getExplicitLiveStrategyCode(prefill)'), 'modal prefill strategy source is explicit live strategy only');
check(!modalSource.includes('fallback.strategySignal'), 'modal does not create fallback live strategy codes');
check(modalSource.includes('!canCreateFromSelectedStrategy'), 'modal blocks submit without a selected explicit live strategy option');
check(modalSource.includes('onCreated({ category: isGrid ?') && modalSource.includes('getCreatedPid(response) || getCreatedPid(createdInfo)'), 'success handler supports list refetch and PID confirmation');
check(dashboardSource.includes('refreshAfterBotCreated') && dashboardSource.includes('const targetMode = MODE.LIVE') && dashboardSource.includes('fetchDashboardPayload(targetMode)'), 'dashboard refetches live list after Bot create');
check(dashboardSource.includes('const exactId = Number(responseData?.id || responseData?.pid || 0)') && dashboardSource.includes('Number(row.id || 0) === exactId'), 'dashboard PID confirmation uses exact create response id');
check(!dashboardSource.includes('sameName') && !dashboardSource.includes('sameStrategy'), 'dashboard does not infer created PID from name/symbol/strategy');
check(dashboardSource.includes('makePidLabel') && dashboardSource.includes('pidLabel'), 'dashboard displays typed PID labels');

check(!/ATF_VIXFIX[\s\S]*liveCode:\s*'ATF\+VIXFIX'/.test(strategySearchSource), 'strategy search does not map QBT ATF_VIXFIX to live create');
check(!/NY_QUIET_CLOSE_ASIA_BOX[\s\S]*liveCode:\s*'SQZ\+GRID'/.test(strategySearchSource), 'strategy search does not map QBT NY box to live create');
check(strategySearchSource.includes('resolveLiveStrategyCreateConfig'), 'strategy search resolves Bot create only from explicit live strategy contract');
check(strategyPrefill.includes('liveStrategyCode: botConfig.liveStrategyCode'), 'strategy search sends explicit liveStrategyCode only when provided');
check(strategyPrefill.includes('runtimeStrategyCode: botConfig.runtimeStrategyCode'), 'strategy search forwards runtime strategy code');
check(strategyPrefill.includes('strategySignal: botConfig.runtimeStrategyCode'), 'strategy search uses runtime code as the create strategy signal');
check(!/tpPct|candidate|bestcase|Best Case/.test(strategyPrefill), 'strategy search does not auto-prefill Best Case TP');

check(takeProfitSource.includes('resolveLiveStrategyCreateConfig'), 'take-profit search requires explicit live strategy contract');
check(!takeProfitSource.includes('strategySignal: selectedRow.strategyId'), 'take-profit search does not use QBT strategy id as live strategy signal');
check(takeProfitSource.includes('liveStrategyCode: selectedRowBotConfig.liveStrategyCode'), 'take-profit search passes explicit live strategy code');
check(takeProfitSource.includes('runtimeStrategyCode: selectedRowBotConfig.runtimeStrategyCode'), 'take-profit search forwards runtime strategy code');
check(takeProfitSource.includes('strategySignal: selectedRowBotConfig.runtimeStrategyCode'), 'take-profit search uses runtime code for Bot create');
check(takeProfitSource.includes('tpPct: selectedRow.tpPct'), 'take-profit search still pre-fills selected row TP');
check(tradingServiceSource.includes('liveDetailUpload(body, params, callback)') && tradingServiceSource.includes('gridLiveDetailUpload(body, params, callback)'), 'trading service exposes both live add adapters');

console.log(JSON.stringify({ status: 'PASS', tests }));
