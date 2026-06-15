const DEFAULT_PUBLIC_BACKTEST_API_BASE = '';

const getPublicBacktestBase = () =>
	(import.meta.env.VITE_PUBLIC_BACKTEST_API_BASE || DEFAULT_PUBLIC_BACKTEST_API_BASE).replace(/\/+$/, '');

export const normalizePublicBacktestSymbol = (value) =>
	String(value || '')
		.trim()
		.toUpperCase()
		.replace(/^BINANCE:/, '')
		.replace(/\.P$/, '');

export const normalizePublicBacktestTimeframe = (value) => {
	const raw = String(value || '').trim().toUpperCase();
	const minute = raw.match(/^(\d+)\s*(M|MIN|MINUTE|MINUTES)?$/);
	if (minute) return minute[1];
	const hour = raw.match(/^(\d+)\s*(H|HOUR|HOURS)$/);
	if (hour) return String(Number(hour[1]) * 60);
	return raw;
};

const appendParams = (url, params = {}) => {
	Object.entries(params).forEach(([key, value]) => {
		if (value === undefined || value === null || value === '') return;
		if (key === 'strategyId' && value === 'all') return;
		url.searchParams.set(key, String(value));
	});
	return url;
};

const buildRequestUrl = (path, params = {}) => {
	const base = getPublicBacktestBase();
	if (base) return appendParams(new URL(path, base), params).toString();
	const url = appendParams(new URL(path, window.location.origin), params);
	return `${url.pathname}${url.search}`;
};

const requestPublicBacktest = async (path, params = {}) => {
	const url = buildRequestUrl(path, params);
	try {
		const response = await fetch(url, {
			headers: { accept: 'application/json' }
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			return {
				ok: false,
				dataStatus: 'ERROR',
				items: [],
				error: payload?.message || payload?.error || `HTTP ${response.status}`
			};
		}
		return {
			ok: payload?.ok !== false,
			dataStatus: payload?.dataStatus || 'READY',
			items: Array.isArray(payload?.items) ? payload.items : [],
			meta: payload?.meta || null,
			source: payload?.source || 'tradingview_qbt_stats_v1',
			error: payload?.error || null
		};
	} catch (error) {
		return {
			ok: false,
			dataStatus: 'ERROR',
			items: [],
			error: error?.message || 'public backtest API request failed'
		};
	}
};

export const publicBacktest = {
	strategies() {
		return requestPublicBacktest('/api/public/backtests/strategies');
	},
	options(params = {}) {
		return requestPublicBacktest('/api/public/backtests/options', {
			...params,
			symbol: params.symbol ? normalizePublicBacktestSymbol(params.symbol) : undefined,
			timeframe: params.timeframe ? normalizePublicBacktestTimeframe(params.timeframe) : undefined
		});
	},
	detail(params = {}) {
		return requestPublicBacktest('/api/public/backtests/detail', {
			...params,
			symbol: params.symbol ? normalizePublicBacktestSymbol(params.symbol) : undefined,
			timeframe: params.timeframe ? normalizePublicBacktestTimeframe(params.timeframe) : undefined
		});
	}
};
