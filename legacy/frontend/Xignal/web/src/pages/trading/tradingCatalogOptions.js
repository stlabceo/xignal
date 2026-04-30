const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT', 'DOGEUSDT', 'PUMPUSDT'];
const DEFAULT_SIGNAL_TIMEFRAMES = ['1MIN', '3MIN', '5MIN', '10MIN', '15MIN'];
const DEFAULT_GRID_TIMEFRAMES = ['1MIN', '3MIN', '5MIN', '10MIN', '15MIN'];
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
	const strategyCode = String(item.strategyCode || item.runtimeType || signalName || displayName || '').trim();

	return {
		id: item.id ?? null,
		strategyCategory: category,
		strategyName: String(item.strategyName || displayName || signalName || '').trim(),
		signalName,
		displayName,
		strategyCode,
		aliases: Array.isArray(item.aliases) ? item.aliases : [],
		allowedSymbols: sortByOrder(uniq(item.allowedSymbols || []), SYMBOL_ORDER),
		allowedTimeframes: sortByOrder(uniq(item.allowedTimeframes || []), TIMEFRAME_ORDER),
		canCreatePid: item.canCreatePid !== false,
		createBlockerCode: item.createBlockerCode || null,
		createBlockerMessage: item.createBlockerMessage || null
	};
};

export const buildCatalogItems = (items = [], category = 'signal') => {
	const fallbackItems =
		category === 'grid'
			? [
					{
						id: null,
						strategyCategory: 'grid',
						strategyName: 'SQZ+GRID',
						signalName: 'SQZ+GRID',
						displayName: 'SQZ+GRID',
						strategyCode: 'SQZ+GRID',
						allowedSymbols: DEFAULT_SYMBOLS,
						allowedTimeframes: DEFAULT_GRID_TIMEFRAMES,
						canCreatePid: true,
						createBlockerCode: null,
						createBlockerMessage: null
					}
			  ]
			: [
					{
						id: null,
						strategyCategory: 'signal',
						strategyName: 'ATF+VIXFIX',
						signalName: 'ATF+VIXFIX',
						displayName: 'ATF+VIXFIX',
						strategyCode: 'ATF+VIXFIX',
						allowedSymbols: DEFAULT_SYMBOLS,
						allowedTimeframes: DEFAULT_SIGNAL_TIMEFRAMES,
						canCreatePid: true,
						createBlockerCode: null,
						createBlockerMessage: null
					}
			  ];

	const sourceItems = Array.isArray(items) && items.length ? items : fallbackItems;

	return sourceItems
		.map((item) => normalizeCatalogItem(item, category))
		.filter((item) => item.signalName)
		.sort((left, right) => String(left.strategyName || left.signalName).localeCompare(String(right.strategyName || right.signalName)));
};

export const formatCatalogStrategyLabel = (item = {}) => {
	if (String(item.strategyCategory || '').toLowerCase() === 'grid') {
		return item.displayName || item.signalName || item.strategyName || '-';
	}

	return item.displayName || item.strategyName || item.signalName || '-';
};

export const formatCatalogSymbolLabel = (symbol) => {
	const normalized = String(symbol || '').trim().toUpperCase().replace(/\.P$/i, '');
	return normalized ? `${normalized}.P` : '-';
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
		value: item.strategyCode || item.signalName,
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
