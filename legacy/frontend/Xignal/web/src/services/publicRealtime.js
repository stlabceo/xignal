import { PERP_INSTRUMENT_TYPE, PERP_MARKET_TYPE, PERP_VENUE, normalizePerpNativeSymbol } from '../pages/trading/perpInstrument';

const DEFAULT_PUBLIC_REALTIME_API_BASE = '';
export const PUBLIC_REALTIME_UPSTREAM_CONTRACT = Object.freeze({
	venue: PERP_VENUE,
	instrumentType: PERP_INSTRUMENT_TYPE,
	marketType: PERP_MARKET_TYPE,
	sourceFamily: 'BINANCE_USD_M_FUTURES'
});

const getPublicRealtimeBase = () =>
	(import.meta.env.VITE_PUBLIC_REALTIME_API_BASE || DEFAULT_PUBLIC_REALTIME_API_BASE).replace(/\/+$/, '');

const appendParams = (url, params = {}) => {
	Object.entries(params).forEach(([key, value]) => {
		if (value === undefined || value === null || value === '') return;
		url.searchParams.set(key, String(value));
	});
	return url;
};

const withPerpInstrumentParams = (params = {}) => ({
	...params,
	venue: PUBLIC_REALTIME_UPSTREAM_CONTRACT.venue,
	instrumentType: PUBLIC_REALTIME_UPSTREAM_CONTRACT.instrumentType,
	marketType: PUBLIC_REALTIME_UPSTREAM_CONTRACT.marketType
});

const buildRequestUrl = (path, params = {}) => {
	const base = getPublicRealtimeBase();
	const instrumentParams = withPerpInstrumentParams(params);
	if (base) return appendParams(new URL(path, base), instrumentParams).toString();
	const url = appendParams(new URL(path, window.location.origin), instrumentParams);
	return `${url.pathname}${url.search}`;
};

const itemPath = {
	ny_box: 'ny-box',
	fear_greed: 'fear-greed',
	support_resistance: 'support-resistance'
};

const STREAM_INITIAL_RETRY_MS = 3000;
const STREAM_MAX_RETRY_MS = 60000;
const STREAM_MAX_CONSECUTIVE_FAILURES = 6;

const requestPublicRealtime = async (path, params = {}) => {
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
				raw: payload,
				error: payload?.message || payload?.error || `HTTP ${response.status}`
			};
		}
		const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.items) ? payload.items : [];
		return {
			ok: payload?.ok !== false,
			dataStatus: items.length ? 'READY' : payload?.dataStatus || 'NO_REAL_DATA',
			items,
			raw: payload,
			itemType: payload?.itemType || null,
			timeframe: payload?.timeframe || params.timeframe || null,
			updatedAt: payload?.updatedAt || payload?.meta?.livePriceUpdatedAtKst || null,
			error: payload?.error || null
		};
	} catch (error) {
		return {
			ok: false,
			dataStatus: 'ERROR',
			items: [],
			raw: null,
			error: error?.message || 'public realtime API request failed'
		};
	}
};

const streamParamsForItem = (itemType, params = {}) => {
	if (itemType === 'ny_box') return params;
	if (itemType === 'support_resistance') return { ...params, logic: params.logic || 'vp' };
	return params;
};

const createFetchItemStream = (url, handlers = {}) => {
	let closed = false;
	let controller = null;
	let retryTimer = null;
	let consecutiveFailures = 0;

	const parseChunk = (buffer) => {
		const events = buffer.split('\n\n');
		const rest = events.pop() || '';
		for (const rawEvent of events) {
			const data = rawEvent
				.split('\n')
				.filter((line) => line.startsWith('data:'))
				.map((line) => line.slice(5).trimStart())
				.join('\n');
			if (!data) continue;
			handlers.onEvent?.(JSON.parse(data));
		}
		return rest;
	};

	const connect = async () => {
		controller = new AbortController();
		let buffer = '';
		try {
			const response = await fetch(url, {
				headers: { accept: 'text/event-stream' },
				signal: controller.signal
			});
			if (!response.ok || !response.body) throw new Error(`Stream failed: ${response.status}`);
			consecutiveFailures = 0;
			handlers.onOpen?.();
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			while (!closed) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer = parseChunk(buffer + decoder.decode(value, { stream: true }));
			}
		} catch (error) {
			if (!closed) {
				consecutiveFailures += 1;
				handlers.onError?.(error);
			}
		}
		if (!closed) {
			if (consecutiveFailures >= STREAM_MAX_CONSECUTIVE_FAILURES) return;
			const retryDelay = Math.min(
				STREAM_MAX_RETRY_MS,
				STREAM_INITIAL_RETRY_MS * 2 ** Math.max(0, consecutiveFailures - 1)
			);
			retryTimer = window.setTimeout(() => {
				void connect();
			}, retryDelay);
		}
	};

	void connect();

	return () => {
		closed = true;
		if (retryTimer !== null) window.clearTimeout(retryTimer);
		controller?.abort();
	};
};

const createItemStream = (itemType, params = {}, handlers = {}) => {
	const path = itemPath[itemType];
	if (!path) return () => {};
	const url = buildRequestUrl(`/api/items/${path}/stream`, streamParamsForItem(itemType, params));
	return createFetchItemStream(url, handlers);
};

export const publicRealtime = {
	nyBoxSnapshot(params = {}) {
		return requestPublicRealtime('/api/items/ny-box/snapshot', params);
	},
	nyBoxSymbol(symbol, params = {}) {
		return requestPublicRealtime(`/api/items/ny-box/symbol/${encodeURIComponent(normalizePerpNativeSymbol(symbol))}`, params);
	},
	fearGreedSnapshot(params = {}) {
		return requestPublicRealtime('/api/items/fear-greed/snapshot', params);
	},
	fearGreedSymbol(symbol, params = {}) {
		return requestPublicRealtime(`/api/items/fear-greed/symbol/${encodeURIComponent(normalizePerpNativeSymbol(symbol))}`, params);
	},
	supportResistanceSnapshot(params = {}) {
		return requestPublicRealtime('/api/items/support-resistance/snapshot', params);
	},
	supportResistanceSymbol(symbol, params = {}) {
		return requestPublicRealtime(`/api/items/support-resistance/symbol/${encodeURIComponent(normalizePerpNativeSymbol(symbol))}`, params);
	},
	createItemStream
};
