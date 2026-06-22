import { formatPerpInstrumentLabel, normalizePerpNativeSymbol } from './perpInstrument';

const SYMBOL_ORDER = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT', 'DOGEUSDT', 'PUMPUSDT', 'PAXGUSDT'];
const TIMEFRAME_ORDER = ['1MIN', '2MIN', '3MIN', '5MIN', '10MIN', '15MIN', '30MIN', '1H', '2H', '4H', '1D'];

const uniq = (values = []) => Array.from(new Set(values.filter(Boolean)));

const sortByOrder = (values = [], order = []) => {
	const orderMap = new Map(order.map((value, index) => [value, index]));

	return [...values].sort((left, right) => {
		const leftIndex = orderMap.has(left) ? orderMap.get(left) : Number.MAX_SAFE_INTEGER;
		const rightIndex = orderMap.has(right) ? orderMap.get(right) : Number.MAX_SAFE_INTEGER;
		if (leftIndex !== rightIndex) {
			return leftIndex - rightIndex;
		}
		return String(left).localeCompare(String(right));
	});
};

const normalizeCatalogItem = (item = {}, category) => {
	const signalName = String(item.signalName || item.strategyName || item.displayName || '').trim();
	const displayName = String(item.displayName || item.strategyName || signalName || '').trim();
	const liveStrategyCode = String(
		item.liveCode ||
		item.liveStrategyCode ||
			item.live_strategy_code ||
			item.canonicalLiveStrategyCode ||
			item.canonical_live_strategy_code ||
			item.canonicalStrategyCode ||
			item.canonical_strategy_code ||
			item.liveBotCode ||
			item.live_bot_code ||
			''
	).trim();
	const runtimeStrategyCode = String(
		item.runtimeStrategyCode ||
			item.runtime_strategy_code ||
			item.runtimeCode ||
			item.runtime_code ||
			item.strategyCode ||
			item.strategy_code ||
			item.runtimeType ||
			item.signalName ||
			''
	).trim();

	return {
		id: item.id ?? null,
		strategyCategory: category,
		strategyName: String(item.strategyName || displayName || signalName || '').trim(),
		signalName,
		displayName,
		strategyCode: liveStrategyCode || runtimeStrategyCode,
		liveCode: liveStrategyCode,
		liveStrategyCode,
		runtimeCode: runtimeStrategyCode,
		runtimeStrategyCode,
		lane: item.lane || '',
		variant: item.variant || null,
		instrumentType: item.instrumentType || 'PERP',
		marketType: item.marketType || 'USD_M_FUTURES',
		venue: item.venue || 'BINANCE',
		enabledForCreate: item.enabledForCreate !== false,
		userSelectable: item.userSelectable !== false,
		aliases: Array.isArray(item.aliases) ? item.aliases : [],
		allowedSymbols: sortByOrder(uniq((item.allowedSymbols || []).map(normalizePerpNativeSymbol)), SYMBOL_ORDER),
		allowedTimeframes: sortByOrder(uniq(item.allowedTimeframes || []), TIMEFRAME_ORDER),
		canCreatePid: item.canCreatePid !== false,
		createBlockerCode: item.createBlockerCode || null,
		createBlockerMessage: item.createBlockerMessage || null,
		backtestStrategyId: item.backtestStrategyId || item.publicBacktestStrategyId || null
	};
};

export const buildCatalogItems = (items = [], category = 'signal') => {
	return (Array.isArray(items) ? items : [])
		.map((item) => normalizeCatalogItem(item, category))
		.filter((item) => item.strategyCode)
		.sort((left, right) => String(left.strategyName || left.signalName).localeCompare(String(right.strategyName || right.signalName)));
};

export const formatCatalogStrategyLabel = (item = {}) => {
	if (String(item.strategyCategory || '').toLowerCase() === 'grid') {
		return item.displayName || item.signalName || item.strategyName || '-';
	}

	return item.displayName || item.strategyName || item.signalName || '-';
};

export const formatCatalogSymbolLabel = (symbol) => {
	return formatPerpInstrumentLabel(symbol);
};

export const formatCatalogTimeframeLabel = (timeframe) => {
	const normalized = String(timeframe || '').trim().toUpperCase();
	const minuteMatch = normalized.match(/^(\d+)MIN$/);
	if (minuteMatch) {
		return `${minuteMatch[1]}min`;
	}

	return normalized || '-';
};

export const toCatalogSymbolOptions = (symbols = []) =>
	sortByOrder(uniq(symbols), SYMBOL_ORDER).map((symbol) => ({
		value: symbol,
		label: formatCatalogSymbolLabel(symbol)
	}));

export const toCatalogTimeframeOptions = (timeframes = []) =>
	sortByOrder(uniq(timeframes), TIMEFRAME_ORDER).map((timeframe) => ({
		value: timeframe,
		label: formatCatalogTimeframeLabel(timeframe)
	}));

export const toCatalogStrategyOptions = (items = []) =>
	items.map((item) => ({
		value: item.liveStrategyCode || item.strategyCode || item.signalName,
		label: formatCatalogStrategyLabel(item)
	}));

export const normalizeSignalFormBunbong = (value) => {
	const normalized = String(value || '').trim().toUpperCase();
	if (!normalized) {
		return '1MIN';
	}

	if (/^\d+$/.test(normalized)) {
		return `${normalized}MIN`;
	}

	const minuteMatch = normalized.match(/^(\d+)\s*(M|MIN|MINUTE|MINUTES)$/);
	if (minuteMatch) {
		return `${minuteMatch[1]}MIN`;
	}

	return normalized.replace(/\s+/g, '');
};

export const toSignalPayloadBunbong = (value) => {
	const normalized = normalizeSignalFormBunbong(value);
	const minuteMatch = normalized.match(/^(\d+)MIN$/);
	if (minuteMatch) {
		return minuteMatch[1];
	}

	return normalized;
};
