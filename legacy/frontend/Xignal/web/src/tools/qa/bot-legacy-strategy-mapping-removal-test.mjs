import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '../..');

const read = (path) => readFileSync(resolve(srcRoot, path), 'utf8');

const modalSource = read('pages/trading/BotSetupModal.jsx');
const strategySearchSource = read('pages/strategySearch/StrategySearchPage.jsx');
const takeProfitSource = read('pages/takeProfitSearch/TakeProfitSearchPage.jsx');
const dashboardSource = read('pages/trading/TradingPage.jsx');
const tradingServiceSource = read('services/trading.js');
const liveContractSource = read('pages/trading/liveStrategyContract.js');
const catalogSource = read('pages/trading/tradingCatalogOptions.js');

const combinedCreateSources = [
	modalSource,
	strategySearchSource,
	takeProfitSource,
	dashboardSource,
	tradingServiceSource,
	catalogSource
].join('\n');

let tests = 0;
const check = (condition, message) => {
	tests += 1;
	assert.ok(condition, message);
};

check(!combinedCreateSources.includes('STRATEGY_SEARCH_LIVE_MAPPINGS'), 'legacy strategy search live mapping table is removed');
check(!combinedCreateSources.includes('resolveStrategySearchLiveMapping'), 'legacy strategy search live mapping resolver is removed');
check(!combinedCreateSources.includes('qbtToLiveStrategy'), 'QBT to live strategy helper is removed');
check(!combinedCreateSources.includes('directLiveStrategyCatalog'), 'hardcoded direct live strategy catalog is removed from create flow');
check(!combinedCreateSources.includes('BACKTEST_STRATEGY_KEY_MAP'), 'dashboard no longer maps live codes to public backtest ids');
check(!combinedCreateSources.includes('STRATEGY_NAME_MAP'), 'dashboard no longer maps legacy ids to display names');
check(!combinedCreateSources.includes('normalizeBacktestStrategyKey'), 'dashboard no longer normalizes live strategy keys into backtest keys');

check(!/ATF_VIXFIX[\s\S]*liveCode:\s*'ATF\+VIXFIX'/.test(combinedCreateSources), 'ATF_VIXFIX is not mapped to ATF+VIXFIX for live create');
check(!/NY_QUIET_CLOSE_ASIA_BOX[\s\S]*liveCode:\s*'SQZ\+GRID'/.test(combinedCreateSources), 'NY_QUIET_CLOSE_ASIA_BOX is not mapped to SQZ+GRID for live create');
check(!/strategySignal:\s*selectedRow\.strategyId/.test(takeProfitSource), 'TP search does not send QBT strategyId as live strategySignal');
check(!/strategySignal:\s*mapping\.liveCode/.test(strategySearchSource), 'Strategy search does not send mapped live strategy code');
check(!/prefill\.strategyId\s*\|\|\s*prefill\.strategyName/.test(modalSource), 'Bot setup initial strategy source ignores legacy strategy id/name');
check(!/prefill\.strategySignal\s*\|\|\s*prefill\.strategyCode/.test(modalSource), 'Bot setup does not infer live code from legacy prefill strategy fields');
check(!/fallback\.strategySignal/.test(modalSource), 'Bot setup does not create fallback live strategy codes');
check(!/strategyTypeById/.test(modalSource), 'Bot setup does not infer category from hardcoded live strategy strings');
check(!/strategyName:\s*'ATF\+VIXFIX'|strategyCode:\s*'ATF\+VIXFIX'|strategyName:\s*'SQZ\+GRID'|strategyCode:\s*'SQZ\+GRID'/.test(catalogSource), 'catalog has no hardcoded live strategy fallback rows');

check(liveContractSource.includes('getExplicitLiveStrategyCode'), 'explicit live strategy code helper exists');
check(liveContractSource.includes('resolveLiveStrategyCreateConfig'), 'live strategy create config helper exists');
check(liveContractSource.includes('전략 설정 초기화 후 Bot 추가가 가능합니다.'), 'disabled Bot CTA message matches product decision');
check(strategySearchSource.includes('resolveLiveStrategyCreateConfig'), 'Strategy Search uses explicit live strategy create contract');
check(takeProfitSource.includes('resolveLiveStrategyCreateConfig'), 'TP Search uses explicit live strategy create contract');
check(strategySearchSource.includes('liveStrategyCode: botConfig.liveStrategyCode'), 'Strategy Search prefill uses explicit liveStrategyCode');
check(takeProfitSource.includes('liveStrategyCode: selectedRowBotConfig.liveStrategyCode'), 'TP Search prefill uses explicit liveStrategyCode');
check(dashboardSource.includes('bot.raw.backtestStrategyId') && dashboardSource.includes('bot.raw.publicBacktestStrategyId'), 'Dashboard public backtest query requires explicit backtest strategy id');
check(modalSource.includes('strategySource = getExplicitLiveStrategyCode(prefill)'), 'Bot setup prefill source is explicit live strategy only');
check(modalSource.includes('!canCreateFromSelectedStrategy'), 'Bot setup blocks create without selected explicit live strategy option');

console.log(JSON.stringify({ status: 'PASS', tests }));
