const BOT_CREATE_DISABLED_MESSAGE = '전략 설정 초기화 후 Bot 추가가 가능합니다.';

const pickText = (...values) => {
	for (const value of values) {
		const normalized = String(value || '').trim();
		if (normalized) return normalized;
	}
	return '';
};

const normalizeCategory = (value) => {
	const normalized = String(value || '').trim().toLowerCase();
	if (normalized === 'grid') return 'grid';
	if (normalized === 'signal' || normalized === 'algorithm') return 'algorithm';
	return '';
};

export const getExplicitLiveStrategyCode = (strategy = {}) =>
	pickText(
		strategy.liveCode,
		strategy.live_code,
		strategy.liveStrategyCode,
		strategy.live_strategy_code,
		strategy.canonicalLiveStrategyCode,
		strategy.canonical_live_strategy_code,
		strategy.canonicalStrategyCode,
		strategy.canonical_strategy_code,
		strategy.liveBotCode,
		strategy.live_bot_code
	);

export const getRuntimeStrategyCode = (strategy = {}) =>
	pickText(
		strategy.runtimeStrategyCode,
		strategy.runtime_strategy_code,
		strategy.runtimeCode,
		strategy.runtime_code,
		strategy.strategyCode,
		strategy.strategy_code,
		strategy.signalName,
		strategy.signal_name,
		strategy.type,
		strategy.strategySignal
	);

export const resolveLiveStrategyCreateConfig = (strategy = {}) => {
	const liveStrategyCode = getExplicitLiveStrategyCode(strategy);
	if (!liveStrategyCode) {
		return {
			supported: false,
			blockerCode: 'LIVE_STRATEGY_CODE_REQUIRED',
			blockerMessage: BOT_CREATE_DISABLED_MESSAGE,
			reason: BOT_CREATE_DISABLED_MESSAGE
		};
	}
	const runtimeStrategyCode = getRuntimeStrategyCode(strategy) || liveStrategyCode;

	return {
		supported: true,
		liveStrategyCode,
		runtimeStrategyCode,
		lane: strategy.lane || '',
		variant: strategy.variant || null,
		instrumentType: strategy.instrumentType || 'PERP',
		marketType: strategy.marketType || 'USD_M_FUTURES',
		venue: strategy.venue || 'BINANCE',
		enabledForCreate: strategy.enabledForCreate !== false,
		userSelectable: strategy.userSelectable !== false,
		category:
			normalizeCategory(strategy.liveStrategyCategory) ||
			normalizeCategory(strategy.live_strategy_category) ||
			normalizeCategory(strategy.strategyCategory) ||
			normalizeCategory(strategy.strategy_category) ||
			normalizeCategory(strategy.backtestType) ||
			normalizeCategory(strategy.strategyType)
	};
};

export { BOT_CREATE_DISABLED_MESSAGE };
