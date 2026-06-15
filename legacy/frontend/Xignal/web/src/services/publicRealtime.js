const DEFAULT_PUBLIC_REALTIME_API_BASE = '';

const getPublicRealtimeBase = () =>
	(import.meta.env.VITE_PUBLIC_REALTIME_API_BASE || DEFAULT_PUBLIC_REALTIME_API_BASE).replace(/\/+$/, '');

const appendParams = (url, params = {}) => {
	Object.entries(params).forEach(([key, value]) => {
		if (value === undefined || value === null || value === '') return;
		url.searchParams.set(key, String(value));
	});
	return url;
};

const buildRequestUrl = (path, params = {}) => {
	const base = getPublicRealtimeBase();
	if (base) return appendParams(new URL(path, base), params).toString();
	const url = appendParams(new URL(path, window.location.origin), params);
	return `${url.pathname}${url.search}`;
};

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

export const publicRealtime = {
	nyBoxSnapshot(params = {}) {
		return requestPublicRealtime('/api/items/ny-box/snapshot', params);
	},
	nyBoxSymbol(symbol) {
		return requestPublicRealtime(`/api/items/ny-box/symbol/${encodeURIComponent(symbol)}`);
	},
	fearGreedSnapshot(params = {}) {
		return requestPublicRealtime('/api/items/fear-greed/snapshot', params);
	},
	fearGreedSymbol(symbol) {
		return requestPublicRealtime(`/api/items/fear-greed/symbol/${encodeURIComponent(symbol)}`);
	},
	supportResistanceSnapshot(params = {}) {
		return requestPublicRealtime('/api/items/support-resistance/snapshot', params);
	},
	supportResistanceSymbol(symbol) {
		return requestPublicRealtime(`/api/items/support-resistance/symbol/${encodeURIComponent(symbol)}`);
	}
};
